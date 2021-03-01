const Generator = require('../../lib/generator');
const crypto = require('crypto');

const oldPackages = [
  '@feathersjs/authentication-oauth1',
  '@feathersjs/authentication-oauth2',
  '@feathersjs/authentication-jwt'
];

module.exports = class UpgradeGenerator extends Generator {
  writing() {
    const dependencies = [ '@feathersjs/authentication-oauth' ];

    Object.keys(this.pkg.dependencies).forEach(name => {
      const isCore = name.startsWith('@feathersjs/') && !oldPackages.includes(name);
      const isAdapter = name.startsWith('feathers-') && this.generatorPkg.dependencies[name];

      if (isCore || isAdapter) {
        dependencies.push(name);
        delete this.pkg.dependencies[name];
      }
    });

    oldPackages.forEach(name => {
      delete this.pkg.dependencies[name];
    });
    
    this.conflicter.force = true;
    
    const authFile = this.destinationPath(this.libDirectory, 'authentication.js');

    if (this.fs.exists(authFile)) {
      this.fs.copy(authFile,
        this.destinationPath(this.libDirectory, 'authentication.backup.js')
      );

      this.fs.copy(
        this.srcTemplatePath('authentication'),
        this.srcDestinationPath(this.libDirectory, 'authentication')
      );
    }

    const configFile = this.destinationPath('config', 'default.json');

    if (this.fs.exists(configFile)) {
      const config = this.fs.readJSON(configFile);
    
      config.authentication = {
        'entity': 'user',
        'service': 'users',
        'secret': crypto.randomBytes(20).toString('base64'),
        'authStrategies': ['jwt', 'local'],
        'jwtOptions': {
          'header': { 'typ': 'access' },
          'audience': 'https://yourdomain.com',
          'issuer': 'feathers',
          'algorithm': 'HS256',
          'expiresIn': '1d'
        },
        'local': {
          'usernameField': 'email',
          'passwordField': 'password'
        }
      };

      this.fs.copy(
        configFile,
        this.destinationPath('config', 'default.backup.json')
      );

      this.fs.writeJSON(configFile, config);
    }

    this.fs.writeJSON(this.destinationPath('package.json'), this.pkg);
    this._packagerInstall(dependencies, {
      save: true
    });
  }
  
  end () {
    this._runLintIfAvailable();
  }
};

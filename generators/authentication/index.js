const _ = require('lodash');
const { transform, ts } = require('@feathersjs/tools');
const crypto = require('crypto');
const validate = require('validate-npm-package-name');

const Generator = require('../../lib/generator');

module.exports = class AuthGenerator extends Generator {
  prompting() {
    this.checkPackage();

    const prompts = [{
      type: 'checkbox',
      name: 'strategies',
      message: 'What authentication strategies do you want to use? (See API docs for all 180+ supported oAuth providers)',
      choices: [{
        name: 'Username + Password (Local)',
        value: 'local',
        checked: true
      }, {
        name: 'Auth0',
        value: 'auth0'
      }, {
        name: 'Google',
        value: 'google'
      }, {
        name: 'Facebook',
        value: 'facebook'
      }, {
        name: 'Twitter',
        value: 'twitter'
      }, {
        name: 'GitHub',
        value: 'github'
      }]
    }, {
      name: 'entity',
      message: 'What is the name of the user (entity) service?',
      default: 'users'
    }];

    return this.prompt(prompts).then(props => {
      this.props = Object.assign(this.props, props);
      this.props.oauthProviders = this.props.strategies.filter(s => s !== 'local');
    });
  }

  _transformCode(code) {
    const ast = transform(code);
    const appDeclaration = ast.findDeclaration('app');
    const configureServices = ast.findConfigure('services');
    const requireCall = 'const authentication = require(\'./authentication\');';

    if (appDeclaration.length === 0) {
      throw new Error('Could not find \'app\' variable declaration in app.js to insert database configuration. Did you modify app.js?');
    }

    if (configureServices.length === 0) {
      throw new Error('Could not find .configure(services) call in app.js after which to insert database configuration. Did you modify app.js?');
    }

    appDeclaration.insertBefore(requireCall);
    configureServices.insertBefore('app.configure(authentication);');

    return ast.toSource();
  }

  _transformCodeTs(code) {
    const ast = transform(code, {
      parser: ts
    });
    const appDeclaration = ast.findDeclaration('app');
    const configureServices = ast.findConfigure('services');
    const requireCall = 'import authentication from \'./authentication\';';

    if (appDeclaration.length === 0) {
      throw new Error('Could not find \'app\' variable declaration in app.ts to insert database configuration. Did you modify app.ts?');
    }

    if (configureServices.length === 0) {
      throw new Error('Could not find .configure(services) call in app.ts after which to insert database configuration. Did you modify app.ts?');
    }

    appDeclaration.insertBefore(requireCall);
    configureServices.insertBefore('app.configure(authentication);');

    return ast.toSource();
  }

  _writeConfiguration(context) {
    const config = Object.assign({}, this.defaultConfig);

    const authentication = {
      'entity': context.singularEntity,
      'service': context.camelEntity,
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

    const { oauthProviders = [] } = this.props;
    
    if (oauthProviders.length) {
      authentication.oauth = authentication.oauth || {
        redirect: '/'
      };

      for (let strategy of this.props.oauthProviders) {
        const strategyConfig = {
          key: `<${strategy} oauth key>`,
          secret: `<${strategy} oauth secret>`
        };
        
        switch (strategy) {
        case 'google':
          strategyConfig.scope = [ 'email', 'profile', 'openid' ];
          break;

        case 'auth0':
          strategyConfig.subdomain = `<${strategy} subdomain>`;
          strategyConfig.scope = [ 'profile', 'openid', 'email' ];
          break;
        }

        authentication.oauth[strategy] = strategyConfig;
      }
    }


    config.authentication = authentication;
    this.conflicter.force = true;
    this.fs.writeJSON(
      this.destinationPath(this.configDirectory, 'default.json'),
      config
    );
  }

  writing() {
    const dependencies = [
      '@feathersjs/authentication',
      '@feathersjs/authentication-local',
      '@feathersjs/authentication-oauth'
    ];
    const context = Object.assign({
      kebabEntity: validate(this.props.entity).validForNewPackages ? this.props.entity : _.kebabCase(this.props.entity),
      camelEntity: _.camelCase(this.props.entity),
      singularEntity: _.camelCase(this.props.entity).replace(/s$/, ''),
      libDirectory: this.libDirectory
    }, this.props);

    if(!this.fs.exists(this.srcDestinationPath(this.libDirectory, 'services', context.kebabEntity, `${context.kebabEntity}.service`))) {
      // Create the users service
      this.composeWith(require.resolve('../service'), {
        props: {
          tester: context.tester,
          name: context.entity,
          path: `/${context.kebabEntity}`,
          authentication: context
        }
      });
    }

    // If the file doesn't exist yet, add it to the app.js
    if (!this.fs.exists(this.srcDestinationPath(this.libDirectory, 'authentication'))) {
      const appSrc = this.srcDestinationPath(this.libDirectory, 'app');

      this.conflicter.force = true;
      const code = this.fs.read(appSrc).toString();
      let transformed;
      if (this.srcType === 'ts') {
        transformed = this._transformCodeTs(code);
      } else {
        transformed = this._transformCode(code);
      }
      this.fs.write(appSrc, transformed);
    }

    this.fs.copyTpl(
      this.srcTemplatePath('authentication'),
      this.srcDestinationPath(this.libDirectory, 'authentication'),
      context
    );

    this.fs.copyTpl(
      this.srcTemplatePath(`test.${this.testLibrary}`),
      this.srcDestinationPath(this.testDirectory, 'authentication.test'),
      context
    );

    this._writeConfiguration(context);
    this._packagerInstall(dependencies, {
      save: true
    });
    if (this.srcType === 'ts') {
      this._packagerInstall(['@types/jsonwebtoken'], { saveDev: true });
    }
  }
  
  end () {
    this._runLintIfAvailable();
  }
};

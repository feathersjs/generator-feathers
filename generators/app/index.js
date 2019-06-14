const Generator = require('../../lib/generator');
const path = require('path');
const makeConfig = require('./configs');
const { kebabCase } = require('lodash');

module.exports = class AppGenerator extends Generator {
  constructor (args, opts) {
    super(args, opts);

    this.props = {
      name: this.pkg.name || process.cwd().split(path.sep).pop(),
      description: this.pkg.description,
      src: this.pkg.directories && this.pkg.directories.lib
    };

    this.dependencies = [
      '@feathersjs/feathers',
      '@feathersjs/errors',
      '@feathersjs/configuration',
      '@feathersjs/express',
      'serve-favicon',
      'compression',
      'helmet',
      'winston@^3.0.0',
      'cors'
    ];

    this.devDependencies = [
      'nodemon@^1.18.7',
      'eslint',
      'request',
      'request-promise'
    ];
  }

  prompting () {
    const dependencies = this.dependencies.concat(this.devDependencies)
      .concat([
        '@feathersjs/express',
        '@feathersjs/socketio',
        '@feathersjs/primus'
      ]);
    const prompts = [{
      type: 'confirm',
      name: 'ts',
      message: 'Use typescript',
      default: false,
    }, {
      name: 'name',
      message: 'Project name',
      when: !this.pkg.name,
      default: this.props.name,
      filter: kebabCase,
      validate (input) {
        // The project name can not be the same as any of the dependencies
        // we are going to install
        const isSelfReferential = dependencies.some(dependency => {
          const separatorIndex = dependency.indexOf('@');
          const end = separatorIndex !== -1 ? separatorIndex : dependency.length;
          const dependencyName = dependency.substring(0, end);

          return dependencyName === input;
        });

        if (isSelfReferential) {
          return `Your project can not be named '${input}' because the '${input}' package will be installed as a project dependency.`;
        }

        return true;
      }
    }, {
      name: 'description',
      message: 'Description',
      when: !this.pkg.description
    }, {
      name: 'src',
      message: 'What folder should the source files live in?',
      default: 'src',
      when: !(this.pkg.directories && this.pkg.directories.lib)
    }, {
      name: 'packager',
      type: 'list',
      message: 'Which package manager are you using (has to be installed globally)?',
      default: 'npm@>= 3.0.0',
      choices: [
        { name: 'npm',  value: 'npm@>= 3.0.0'   },
        { name: 'Yarn', value: 'yarn@>= 0.18.0' }
      ]
    }, {
      type: 'checkbox',
      name: 'providers',
      message: 'What type of API are you making?',
      choices: [
        { name: 'REST',                   value: 'rest',     checked: true },
        { name: 'Realtime via Socket.io', value: 'socketio', checked: true },
        { name: 'Realtime via Primus',    value: 'primus',                 }
      ],
      validate (input) {
        if (input.indexOf('primus') !== -1 && input.indexOf('socketio') !== -1) {
          return 'You can only pick SocketIO or Primus, not both.';
        }

        return true;
      }
    }, {
      type: 'list',
      name: 'tester',
      message: 'Which testing framework do you prefer?',
      default: 'mocha',
      choices: [
        { name: 'Mocha + assert', value: 'mocha' },
        { name: 'Jest',           value: 'jest'  }
      ],
      pageSize: 7 // unnecessary; trying to get codeclimate to leave me alone :(
    }];

    return this.prompt(prompts).then(props => {
      this.props = Object.assign(this.props, props);
    });
  }

  writing () {
    const props = this.props;
    if (props.ts) {
      this.sourceRoot(path.join(__dirname, 'templates-ts'));
    }
    const pkg = this.pkg = makeConfig.package(this);
    const context = Object.assign({}, props, {
      hasProvider (name) {
        return props.providers.indexOf(name) !== -1;
      }
    });

    // Static content for the root folder (including dotfiles)
    this.fs.copy(this.templatePath('static'), this.destinationPath());
    this.fs.copy(this.templatePath('static', '.*'), this.destinationPath());
    // Static content for the directories.lib folder
    this.fs.copy(this.templatePath('src'), this.destinationPath(props.src));
    // This hack is necessary because NPM does not publish `.gitignore` files
    this.fs.copy(this.templatePath('_gitignore'), this.destinationPath('', '.gitignore'));

    this.fs.copyTpl(
      this.templatePath('README.md'),
      this.destinationPath('', 'README.md'),
      context
    );

    this.fs.copyTpl(
      this.templatePath(props.ts ? 'app.ts' : 'app.js'),
      this.destinationPath(props.src, props.ts ? 'app.ts' : 'app.js'),
      context
    );

    this.fs.copyTpl(
      this.templatePath(props.ts ? `app.test.${props.tester}.ts` : `app.test.${props.tester}.js`),
      this.destinationPath(this.testDirectory, props.ts ? 'app.test.ts' : 'app.test.js'),
      context
    );

    this.fs.writeJSON(
      this.destinationPath('package.json'),
      pkg
    );

    if (props.ts) {
      this.fs.writeJSON(
        this.destinationPath('tsconfig.json'),
        makeConfig.tsconfig(this)
      );

      if (props.tester === 'jest') {
        this.fs.copyTpl(
          this.templatePath('jest.config.js'),
          this.destinationPath('jest.config.js'),
          context
        );
      }
    } else {
      this.fs.writeJSON(
        this.destinationPath('.eslintrc.json'),
        makeConfig.eslintrc(this)
      );
    }

    this.fs.writeJSON(
      this.destinationPath(this.configDirectory, 'default.json'),
      makeConfig.configDefault(this)
    );

    this.fs.writeJSON(
      this.destinationPath(this.configDirectory, 'production.json'),
      makeConfig.configProduction(this)
    );
  }

  install () {
    this.props.providers.forEach(provider => {
      const type = provider === 'rest' ? 'express' : provider;

      this.dependencies.push(`@feathersjs/${type}`);

      if (provider === 'primus') {
        this.dependencies.push('ws');
      }
    });

    this._packagerInstall(this.dependencies, {
      save: true
    });

    if (this.props.ts) {
      const excluded = [
        'eslint',
        'nodemon@^1.18.7',
      ];
      this.devDependencies = this.devDependencies.concat([
        '@types/compression',
        '@types/cors',
        '@types/helmet',
        '@types/request-promise',
        '@types/serve-favicon',
        'shx',
        'ts-node-dev',
        'tslint',
        'typescript',
        `@types/${this.props.tester}`,
        `ts-${this.props.tester}`,
      ]).filter(item => !excluded.includes(item));
    }

    this.devDependencies.push(this.props.tester);

    this._packagerInstall(this.devDependencies, {
      saveDev: true
    });
  }
};

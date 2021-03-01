const _ = require('lodash');
const { transform, ts } = require('@feathersjs/tools');
const validate = require('validate-npm-package-name');
const Generator = require('../../lib/generator');

const stripSlashes = name => name.replace(/^(\/*)|(\/*)$/g, '');

module.exports = class ServiceGenerator extends Generator {
  prompting() {
    this.checkPackage();

    const { props } = this;
    const prompts = [
      {
        type: 'list',
        name: 'adapter',
        message: 'What kind of service is it?',
        default: 'nedb',
        choices: [
          { name: 'A custom service', value: 'generic' },
          { name: 'In Memory', value: 'memory' },
          { name: 'NeDB', value: 'nedb' },
          { name: 'MongoDB', value: 'mongodb' },
          { name: 'Mongoose', value: 'mongoose' },
          { name: 'Sequelize', value: 'sequelize' },
          { name: 'KnexJS', value: 'knex' },
          { name: 'Objection', value: 'objection' },
          { name: 'Cassandra', value: 'cassandra' },
          { name: 'Couchbase', value: 'couchbase' }
        ]
      }, {
        name: 'name',
        message: 'What is the name of the service?',
        validate(input) {
          switch (input.trim()) {
          case '':
            return 'Service name can not be empty';
          case 'authentication':
            return '`authentication` is a reserved service name';
          default:
            return true;
          }
        },
        when: !props.name
      }, {
        name: 'path',
        message: 'Which path should the service be registered on?',
        when: !props.path,
        default(answers) {
          const parts = (answers.name || props.name).split('/');
          const name = _.kebabCase(parts.pop());

          return `/${parts.concat(name).join('/')}`;
        },
        validate(input) {
          if (input.trim() === '') {
            return 'Service path can not be empty';
          }

          return true;
        }
      }, {
        name: 'requiresAuth',
        message: 'Does the service require authentication?',
        type: 'confirm',
        default: true,
        when: !!(this.defaultConfig.authentication && !props.authentication)
      }
    ];

    return this.prompt(prompts).then(answers => {
      const parts = (answers.name || props.name)
        .split('/')
        // exclude route parameters from folder hierarchy i.e. /users/:id/roles
        .filter(part => !part.startsWith(':'));
      const name = parts.pop();

      this.props = Object.assign({
        requiresAuth: false
      }, props, answers, {
        subfolder: parts,
        snakeName: _.snakeCase(name),
        kebabName: validate(name).validForNewPackages ? name : _.kebabCase(name),
        camelName: _.camelCase(name),
        className: _.upperFirst(_.camelCase(name))
      });
    });
  }

  _transformCode(code) {
    const { kebabName, subfolder } = this.props;
    const ast = transform(code);
    const mainExpression = ast.find(transform.FunctionExpression).closest(transform.ExpressionStatement);
    const folder = subfolder.concat(kebabName).join('/');
    const camelName = _.camelCase(folder);
    const serviceRequire = `const ${camelName} = require('./${folder}/${kebabName}.service.js');`;
    const serviceCode = `app.configure(${camelName});`;

    if (mainExpression.length !== 1) {
      this.log
        .writeln()
        .conflict(`${this.libDirectory}/services/index.js seems to have more than one function declaration and we can not register the new service. Did you modify it?`)
        .info('You will need to add the next lines manually to the file')
        .info(serviceRequire)
        .info(serviceCode)
        .writeln();
    } else {
      // Add require('./service')
      mainExpression.insertBefore(serviceRequire);
      // Add app.configure(service) to service/index.js
      mainExpression.insertLastInFunction(serviceCode);
    }

    return ast.toSource();
  }

  _transformCodeTs(code) {
    const { kebabName, subfolder } = this.props;
    const ast = transform(code, {
      parser: ts
    });
    const folder = subfolder.concat(kebabName).join('/');
    const camelName = _.camelCase(folder);
    const serviceImport = `import ${camelName} from './${folder}/${kebabName}.service';`;
    const serviceCode = `app.configure(${camelName});`;

    const lastImport = ast.find(transform.ImportDeclaration).at(-1).get();
    const newImport = transform(serviceImport).find(transform.ImportDeclaration).get().node;

    lastImport.insertAfter(newImport);

    const blockStatement = ast.find(transform.BlockStatement).get().node;
    const newCode = transform(serviceCode).find(transform.ExpressionStatement).get().node;
    blockStatement.body.push(newCode);

    return ast.toSource();
  }

  writing() {
    const { adapter, kebabName, subfolder } = this.props;
    const moduleMappings = {
      generic: `./${kebabName}.class`,
      memory: 'feathers-memory',
      nedb: 'feathers-nedb',
      mongodb: 'feathers-mongodb',
      mongoose: 'feathers-mongoose',
      sequelize: 'feathers-sequelize',
      knex: 'feathers-knex',
      objection: 'feathers-objection',
      cassandra: 'feathers-cassandra',
      couchbase: 'feathers-couchbase'
    };
    const serviceModule = moduleMappings[adapter];
    const serviceFolder = [this.libDirectory, 'services', ...subfolder, kebabName];
    const mainFile = this.srcDestinationPath(...serviceFolder, `${kebabName}.service`);
    const modelTpl = `${adapter}${this.props.authentication ? '-user' : ''}`;
    const hasModel = this.fs.exists(this.srcTemplatePath('model', modelTpl));
    const context = Object.assign({}, this.props, {
      libDirectory: this.libDirectory,
      modelName: hasModel ? `${kebabName}.model` : null,
      path: stripSlashes(this.props.path),
      relativeRoot: '../'.repeat(subfolder.length + 2),
      serviceModule
    });

    // Do not run code transformations if the service file already exists
    if (!this.fs.exists(mainFile)) {
      const servicejs = this.srcDestinationPath(this.libDirectory, 'services', 'index');
      let transformed;
      if (this.isTypescript) {
        transformed = this._transformCodeTs(
          this.fs.read(servicejs).toString()
        );
      } else {
        transformed = this._transformCode(
          this.fs.read(servicejs).toString()
        );
      }
      this.conflicter.force = true;
      this.fs.write(servicejs, transformed);
    }

    const requiresConnection = adapter !== 'generic' && adapter !== 'memory' &&
      !this.fs.exists(this.srcDestinationPath(this.libDirectory, adapter));

    // Run the `connection` generator for the selected database
    // It will not do anything if the db has been set up already
    if (requiresConnection) {
      this.composeWith(require.resolve('../connection'), {
        props: { adapter, service: this.props.name }
      });
    }
    
    // Copy the service class
    this.fs.copyTpl(
      this.srcTemplatePath('types', adapter),
      this.srcDestinationPath(...serviceFolder, `${kebabName}.class`),
      context
    );

    if (context.modelName) {
      // Copy the model
      this.fs.copyTpl(
        this.srcTemplatePath('model', modelTpl),
        this.srcDestinationPath(this.libDirectory, 'models', context.modelName),
        context
      );
    }

    this.fs.copyTpl(
      this.srcTemplatePath(`hooks${this.props.authentication ? '-user' : ''}`),
      this.srcDestinationPath(...serviceFolder, `${kebabName}.hooks`),
      context
    );

    this.fs.copyTpl(
      this.srcTemplatePath('service'),
      mainFile,
      context
    );

    this.fs.copyTpl(
      this.srcTemplatePath(`test.${this.testLibrary}`),
      this.srcDestinationPath(this.testDirectory, 'services', ...subfolder, `${kebabName}.test`),
      context
    );

    if (serviceModule.charAt(0) !== '.') {
      this._packagerInstall([serviceModule], { save: true });
    }

    if (this.isTypescript) {
      const typeMap = {
        sequelize: [ '@types/bluebird' ],
        mongodb: ['@types/mongodb'],
        nedb: ['@types/nedb'],
        cassandra: ['@types/cassaknex']
      };

      if (typeMap[adapter]) {
        this._packagerInstall(typeMap[adapter], { saveDev: true });
      }
    }
  }
  
  end () {
    this._runLintIfAvailable();
  }
};

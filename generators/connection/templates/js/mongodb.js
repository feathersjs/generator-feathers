const MongoClient = require('mongodb').MongoClient;

module.exports = function (app) {
  const connection = app.get('mongodb');
  const database = connection.substr(connection.lastIndexOf('/') + 1);
  const mongoClient = MongoClient.connect(connection, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(client => client.db(database));

  app.set('mongoClient', mongoClient);
};

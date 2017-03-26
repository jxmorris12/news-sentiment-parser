const _ = require('lodash');

var config         = require('./config'),
    express        = require('express')
    path           = require('path'),
    mongoDbService = require('./services/db-service');

/*
 * Create app with expressJS
 */
var app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname + '/index.html'));
});

app.get('/sources', function (req, res) {
  mongoDb.getAllObjectsFromCollection("sources")
    .then(sources => res.send(sources))
    .catch(err => res.error(err || "Unknown error getting sources"));
});

app.listen(config.PORT, function () {
  console.log('Started up News Parsing server on port', config.PORT);
});

// Load Mongo database
var mongoDb = new mongoDbService(config.mongoUrl);
const _ = require('lodash');

var config         = require('./config'),
    constants      = require('./constants'),
    express        = require('express')
    path           = require('path'),
    ghost          = require('ghost-article-sdk'),
    ghostConfig    = require('./ghost-config'),
    Moment         = require('moment'),
    mongoDbService = require('./services/db-service')
    sentiment = require('sentiment');

/*
 * Create app with expressJS
 */
var app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname + '/index.html'));
});

app.listen(config.PORT, function () {
  console.log('Started up News Parsing server on port', config.PORT);
});

// Load Mongo database
var mongoDb = new mongoDbService(config.mongoUrl);
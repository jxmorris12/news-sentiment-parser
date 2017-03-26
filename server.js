const _ = require('lodash');

var config         = require('./config'),
    express        = require('express')
    path           = require('path'),
    mongoDbService = require('./services/db-service')
    schedule       = require('node-schedule');

/*
 * Create app with expressJS
 */
var app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname + '/index.html'));
});

app.get('/sources', function (req, res) {
  mongoDb.getObjectsFromCollection("sources")
    .then(sources => res.send(sources))
    .catch(err => res.error(err || "Unknown error getting sources"));
});

app.get('/articles/:sourceid', function (req, res) {
  const sourceid = req.params.sourceid;
  mongoDb.getObjectsFromCollection("articles", { "articleSourceId": sourceid })
    .then(articles => res.send(articles))
    .catch(err => res.error(err || `Unknown error getting articles from sourceid ${sourceid}`));
});

app.listen(process.env.PORT || config.port || 3000, function () {
  console.log('Started up News Parsing server on port', config.PORT);
});

// Load Mongo database
var mongoDb = new mongoDbService(config.mongoUrl);

/*
 *  Run job to scrape & save new articles
 */
var articleManager = require('./articleManager');
var j = schedule.scheduleJob('* 15 * * * *', function() { 
  // Runs every 15 mins
  console.log('running cronjob')
  articleManager.syncDatabase(mongoDb);
});

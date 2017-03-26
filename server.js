var config      = require('./config'),
    express     = require('express')
    path        = require('path')
    ghost       = require('ghost-article-sdk')
    ghostConfig = require('./ghost-config');

var app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname + '/index.html'));
});

app.listen(config.PORT, function () {
  console.log('Started up News Parsing server on port ', config.PORT);
});


// Create news API client.
var newsClient = new ghost(ghostConfig);
// Load Ghost services.
var ingestService = newsClient.IngestService;
var parsingService = newsClient.ParsingService;
var afinnService = newsClient.AFINNModelService;
var summarizeService = newsClient.SummaryService;

console.log(newsClient);


/*
 * Get list of sources.
 */
var parseRawSource = function(source) {
  return {
      id: source.id,
      name: source.name,
      description: source.description,
      url: source.url,
      category: source.category,
      language: source.language,
      country: source.country,
      smallLogoUrl: source.urlsToLogos.small,
      mediumLogoUrl: source.urlsToLogos.medium,
      largeLogoUrl: source.urlsToLogos.large,
      hasSortByTop: source.sortBysAvailable.indexOf('top') > 0,
      hasSortByPopular: source.sortBysAvailable.indexOf('popular') > 0,
      hasSortByLatest: source.sortBysAvailable.indexOf('latest') > 0,
    };
}

ingestService.getSources()
  .map(source => parseRawSource(source))
  .then(function(sources) {
    // console.log('Sources:', sources);
  });

/*
 * Get sources
 */

// Connect to MongoDB instance
var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;
// URL where server is running
var url = 'mongodb://localhost:27017/news-api'

MongoClient.connect(url, function (err, db) {
	if (err) {
		console.log('couldnt connect error: ', err);
	} else {
		console.log('connected to ', url);
	}

	// Select Article collection (creates collection if not already there)
	var articles = db.collection('articles');

	// Format json for an article
	var a1 = {
		title: 'Foobar',
		author: 'Bazbar',
		source: 'google.com',
		topics: [
			'abc',
			'123'
		]
	};

	// Insert to Article collection
	articles.insert(a1);
});


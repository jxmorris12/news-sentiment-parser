var config      = require('./config'),
    express     = require('express')
    ghost       = require('ghost-article-sdk')
    ghostConfig = require('./ghost-config');

var app = express();

app.get('/', function (req, res) {
  res.send('Hello World!')
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
const _ = require('lodash');

var config         = require('./config'),
    constants      = require('./constants'),
    express        = require('express')
    path           = require('path'),
    ghost          = require('ghost-article-sdk'),
    ghostConfig    = require('./ghost-config'),
    Moment         = require('moment'),
    mongoDbService = require('./services/db-service');


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


// Create news API client.
var newsClient = new ghost(ghostConfig);
// Load Ghost services.
var ingestService = newsClient.IngestService;
var parsingService = newsClient.ParsingService;
var afinnService = newsClient.AFINNModelService;
var summarizeService = newsClient.SummaryService;
// Load Mongo database
var mongoDb = new mongoDbService(config.mongoUrl);

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

/* 
 * Get and store sources (for refreshing list of sources in database)
 */
var getAndStoreSources = function() {
  ingestService.getSources()
    .map(source => parseRawSource(source))
    .then(sources => postSourcesToDatabase(sources));
}

// UNCOMMENT THIS LINE TO REPOPULATE DB WITH SOURCE OBJECTS
 // getAndStoreSources();

/*
 * Posts a list of <source> objects to "source" collection in database
 */
 var postSourcesToDatabase = function(sources) {
  console.log("posting sources:", sources.length);
  mongoDb.postToCollection("sources", sources)
    .then(() => console.log("Successfully posted sources to database."));
 }

/*
 * Handle new additions to database.
 */
 
 var manageNewArticleEntries = function(articles) {
  console.log(
    "**** BEGIN ARTICLES **** \n\n",
    articles.map(a => a.title),
    "\n\n **** END ARTICLES ****"
  );

  // Next steps: (1) score, (2) strip, and (3) post.

 };


/*
 * Get latest articles.
 */

 var loadArticlesFromSources = function(sources) {
    // For each article source in our system, grab latest articles
    console.log(`Starting latest articles news ingest at ${Moment().format('LLL')}`);
    
    return Promise.all(
    sources.map(source => {
      if (!source.hasSortByLatest) return Promise.resolve();
      // 0) hold article info from news api
      return ingestService.getLatest({ source: source.id })
      .filter(articleInfo => {
        // 1) filter out non-political-sounding articles
        let articleDetails = (articleInfo.title + articleInfo.description) || articleInfo || "";
        let lowercaseArticleDetails = articleDetails.toLowerCase();

        let matchesGoodKeywords = false;

        for(var i in constants.goodkeywords) {
          let goodkeyword = constants.goodkeywords[i];
          if(lowercaseArticleDetails.indexOf(goodkeyword) >= 0) {
            matchesGoodKeywords = true;
            break;
          }
        }

        for(var i in constants.badkeywords) {
          let badkeyword = constants.badkeywords[i];
          if(lowercaseArticleDetails.indexOf(badkeyword) >= 0) {
            return false;
          }
        }

        return matchesGoodKeywords;
      })
      .map(articleInfo => {
        let article, articleExtract, articleContent, articleSummary, articleTopics;
        // 2) extract article information
        return parsingService.extractFromUrl(articleInfo.url)
        .tap(extract => articleExtract = extract)
        // 3) extract article text content
        .then(() => parsingService.getArticleContentFromUrl(articleInfo.url))
        .tap(content => articleContent = content)

        // 4) extract article topics
        .then(() => parsingService.extractTopicsFromContent(articleContent))
        .tap(topics => articleTopics = topics)

        // 5) summarize article from content
        .then(() => summarizeService.summarizeContent(articleInfo.title, articleContent))
        .tap(summary => articleSummary = summary)

        // 6) determine if article has already been stored, if not store it (*** temporarily deprecated ***)
        // .then(() => Db.article.findOne({ where: { srcUrl: articleInfo.url } }))
        .then(article => {
          article = {
            title: articleInfo.title,
            caption: articleInfo.description,
            topics: articleTopics.join(),
            author: articleInfo.author,
            srcUrl: articleInfo.url,
            srcPublisher: source.name,
            srcPublisherLogoUrl: source.mediumLogoUrl,
            summary: articleSummary,
            content: articleExtract.content,
            status: 'published',
            articleSourceId: source.id
          };

          return article;
        })
        // TODO
        // 1) run article through a model to generate topics
        // 2) run article through a model to generate score
      }, { concurrency: 5 })
    }))
    // Condense to one longer array.
    .then(_.flatten)
    .then(articles => {
      console.log(`Finished latest articles news ingest at ${Moment().format('LLL')}`)
      // Return non-null articles in callback.
      return articles.filter(x => x);
    })
    .catch(err => console.error(`IngestLatestArticlesJobError`, { err: err }));
};

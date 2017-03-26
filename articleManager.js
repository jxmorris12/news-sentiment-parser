const _ = require('lodash');

var config         = require('./config'),
    constants      = require('./constants'),
    path           = require('path'),
    ghost          = require('ghost-article-sdk'),
    ghostConfig    = require('./ghost-config'),
    Moment         = require('moment'),
    mongoDbService = require('./services/db-service'),
    prompt         = require('syncprompt'),
    sha1           = require('sha1'),
    sentiment      = require('sentiment');


// Create news API client.
var newsClient = new ghost(ghostConfig);
// Load Ghost services.
var ingestService = newsClient.IngestService;
var parsingService = newsClient.ParsingService;
var afinnService = newsClient.AFINNModelService;
var summarizeService = newsClient.SummaryService;
// Load Mongo database
var mongoDb = new mongoDbService(config.mongoUrl, function() {
  main();
});

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
  mongoDb.postManyToCollection("sources", sources)
    .then(() => console.log("Successfully posted sources to database."));
 }


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
        /* TODO: Option for getting Top or Popular or Recent */
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

        // Map article to our model
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
            time: article.publishedAt, /* todo: I don't think this works */
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

/*
 * Post articles to 'articles' by ID
 */

var postArticlesToDatabase = function(articles) {
  var articlesWithIds = articles.map(article => {
    article._id = sha1(article.srcUrl)
    return article;
  });
  return mongoDb.postManyToCollection("articles", articlesWithIds);
}

/*
 * The function that does it all
 */ 
var loadAllNewArticles = function() {
  // (0) Get sources
  return mongoDb.getObjectsFromCollection("sources")
  // (1) Get all new articles for each source
    .then(sources => loadArticlesFromSources(sources))
  // (2) Score all articles
    .then(articles => articles.map(article => scoreArticle(article)))
  // (3) Strip out unneeded information
    .then(articles => articles.map(article => slimArticle(article)))
  // (4) Post articles to Mongo, cleverly avoiding duplicates
    .then(articles => postArticlesToDatabase(articles))
  // Check for errors
    .catch(err => console.error(`LoadAllNewArticlesError`, { err: err }));
}

/*
 * The function that does it all
 */ 
var rescoreAllSources = function() {
  var sourcesCache;
  // (0) Get sources
  return mongoDb.getObjectsFromCollection("sources")
  // (1) Get all articles from database each source
    .then(sources => {
      sourcesCache = sources;
      return Promise.all(sources.map(source => mongoDb.getObjectsFromCollection("articles", { "articleSourceId": source.id })));
    })
    // (2) Average both params for all articles
    .then(articlesBySource => {
      for(currentSource in articlesBySource) {
        const articlesByCurrentSource = articlesBySource[currentSource];

        if(articlesByCurrentSource.length == 0) continue;

        const totalSentiment = articlesByCurrentSource.reduce((acc, art) => { return art.sentiment + acc }, 0);
        const totalVocab = articlesByCurrentSource.reduce((acc, art) => { return art.vocab + acc }, 0);

        // (3) Add new sentiment score to source object

        // Average sentiment score.
        sourcesCache[currentSource].sentiment = totalSentiment / articlesByCurrentSource.length; 
        // Average vocabulary score.
        sourcesCache[currentSource].vocab = totalVocab / articlesByCurrentSource.length; 
      }

      // (4) Post new sources
      return mongoDb.postManyToCollection("sources", sourcesCache);
    })
    .then(sources => console.log(`Successfully updated scores of ${sourcesCache.length} elements.`))
    // Check for errors
    .catch(err => console.error(`RescoreAllSourcesError`, { err: err }));
}

/*
 * Slim down an article before saving it
 */
const slimmedArticleParams = ["title", "author", "srcUrl", "articleSourceId", "sentiment", "vocab", "time"];
var slimArticle = function(article) {
  var slimmedArticle = {};
  for(var i in slimmedArticleParams) {
    const param = slimmedArticleParams[i];
    slimmedArticle[param] = article[param];
  }
  return slimmedArticle;
}

/*
 * Score an article by two metrics -- sentiment & verbal complexity
 */
var scoreArticle = function(article) {
  article["sentiment"] = scoreArticleSentiment(article);
  article["vocab"] = scoreArticleVocab(article);
  return article;
}

/*
 * Score article sentiment with AFINN
 */
var scoreArticleSentiment = function(article) {
  var strippedContent = parsingService.removeHtmlTags(article.content);
  var rawSentimentScore = sentiment(strippedContent).score;
  return rawSentimentScore;
  // return _.clamp(_.round(rawSentimentScore), -5, 5);
}

/* 
 * Score article verbal complexity with homemade algorithm
 */
var scoreArticleVocab = function(article) {
  var strippedContent = parsingService.removeHtmlTags(article.content);
  var allWordsInArticle = strippedContent.split(" ");
  var totalWordLength = allWordsInArticle.reduce((acc, word) => { return word.length + acc }, 0);
  return (totalWordLength / allWordsInArticle.length ) **2;
}


/*
 * Main function that takes user input and runs helpers
 */
var main = function() {
  var sourcesOrArticles;
  do {
    sourcesOrArticles = prompt("\n'D' to download new articles. 'S' to sync sources. 'X' to exit. ").toUpperCase();
  } while(sourcesOrArticles != "D" && sourcesOrArticles != "S" && sourcesOrArticles != "X");

  if(sourcesOrArticles == "X") process.exit();

  const userDefinedFunction = (sourcesOrArticles == "D") ? loadAllNewArticles : rescoreAllSources;

  userDefinedFunction().then(() => main());

}
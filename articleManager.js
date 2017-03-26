const _ = require('lodash');

var config         = require('./config'),
    constants      = require('./constants'),
    path           = require('path'),
    ghost          = require('ghost-article-sdk'),
    ghostConfig    = require('./ghost-config'),
    Moment         = require('moment'),
    mongoDbService = require('./services/db-service'),
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

/*
 * Post articles to 'articles' by ID
 */

var postArticlesToDatabase = function(articles) {
  var articlesWithIds = articles.map(article => {
    article._id = sha1(article.srcUrl)
    return article;
  });
  return mongoDb.postToCollection("articles", articlesWithIds);
}

/*
 * The function that does it all
 */ 
var loadAllNewArticles = function() {
  // (0) Get sources
  mongoDb.getObjectsFromCollection("sources")
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
  // (0) Get sources
  mongoDb.getObjectsFromCollection("sources")
  // (1) Get all articles from database each source
    .then(sources => {
      return Promise.all(
        sources.map(source => getObjectsFromCollection("articles", { "articleSourceId": source.id }))
      );
    })
    // (2) Average both params for all articles
    .then(something => console.log("got something",something) )
    // Check for errors
    .catch(err => console.error(`RescoreAllSourcesError`, { err: err }));
}

/*
 * Slim down an article before saving it
 */
const slimmedArticleParams = ["title", "author", "srcUrl", "articleSourceId", "sentiment", "vocab"];
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

// 
// SANDBOX TEST ENV
// 
function testSentiments() {
  var testArticle1 = { title: 'How Republicans’ new health plan would affect American incomes',
    caption: 'Poorer and older Americans would come out worse. So would those living deep in Trump country',
    topics: '',
    author: 'The Economist',
    srcUrl: 'http://www.economist.com/blogs/graphicdetail/2017/03/daily-chart-17',
    srcPublisher: 'The Economist',
    srcPublisherLogoUrl: 'http://i.newsapi.org/the-economist-m.png',
    summary: 'How Republicans’ new health plan would affect American incomes\nOn the other hand, the AHCA&#x2019;s tax cuts would put an extra $5,600 a year in the pockets of families making more than $200,000.</p><img src="http://cdn.static-economist.com/sites/default/files/images/2017/03/blogs/graphic-detail/20170325_woc257_5.png" alt=""><p>Older Americans would also suffer under the proposed new system.',
    content: '<div><p>PITY the poor Republicans. For the past four nationwide American elections, their rallying cry has been the outright repeal of the Affordable Care Act, better known as Obamacare. Now, with nearly complete control of government in the party&#x2019;s hands, the promise has come due. On the evening of March 23rd, the House of Representatives was scheduled to vote on their plan to overhaul Obamacare and replace it with the American Health Care Act (AHCA). As would be expected of a Republican bill, the AHCA would reduce the amount of money redistributed via the health-care system from the rich to the poor, leaving lower-income Americans with less assistance. More surprisingly, it would also benefit the young, who lean towards the Democrats, at the expense of the middle-aged, who tend to support Republicans&#x2014;and might aid voters who backed Hillary Clinton while harming those who made Donald Trump president.</p><p>As a candidate, Mr Trump promised that &#x201C;everybody&#x2019;s going to be taken care of&#x201D; by his replacement of Obamacare with &#x201C;something terrific&#x201D;. That vow is hard to reconcile with an <a href="http://www.urban.org/sites/default/files/publication/89071/2001188-who-gains-and-who-loses-under-the-american-health-care-act.pdf" target="_blank">analysis</a> by the Tax Policy Centre, a think-tank, of the AHCA&#x2019;s impact. It found that all American families making less than $50,000 a year would be worse off financially if the bill became law. Those earning less than $10,000 a year would be hit the hardest, losing $1,420 a year, or an average of one-third of their incomes. On the other hand, the AHCA&#x2019;s tax cuts would put an extra $5,600 a year in the pockets of families making more than $200,000.</p><img src="http://cdn.static-economist.com/sites/default/files/images/2017/03/blogs/graphic-detail/20170325_woc257_5.png" alt=""><p>Older Americans would also suffer under the proposed new system. Today, 60-year-olds making $50,000 generally spend 10-15% of their income on health insurance. If the AHCA passes, many would pay several times that. In Alaska, premiums for some seniors would rise to a ludicrous 69% of income, according to modelled <a href="http://kff.org/interactive/tax-credits-under-the-affordable-care-act-vs-replacement-proposal-interactive-map" target="_blank">estimates</a> from the Kaiser Family Foundation, a health-care think-tank. The consequences would be direst in counties that backed Mr Trump overwhelmingly in last year&#x2019;s election, putting Republican representatives in a difficult position. In La Paz County, Arizona, where 72% voted to &#x201C;make America great again&#x201D;, poor seniors could expect the cost of health insurance premiums after taxes to rise from 5% of their incomes under Obamacare to 132% under the AHCA.</p><img src="http://cdn.static-economist.com/sites/default/files/images/2017/03/blogs/graphic-detail/20170325_woc930_2.png" alt=""><p>The bill will have to surmount steep political obstacles to become law. Wonks from the Congressional Budget Office dealt it a harsh blow last week when they released a forecast that by 2026 the AHCA would increase the number of Americans without health insurance by 24m, gifting Democrats with a useful cudgel. Because of concerns about maintaining insurance coverage and affordability, numerous moderate Republican legislators have come out against the bill. Meanwhile, the hard-line House Freedom Caucus opposes it for not going far enough to dismantle the architecture of Obamacare. Rand Paul, a libertarian senator, has dismissed it as &#x201C;Obamacare-lite&#x201D;. Combined with unanimous opposition from Democrats, this brewing revolt could bring an embarrassing defeat for Paul Ryan, the speaker of the House and architect of the AHCA.</p><p>Still, House Republicans are hoping to quash dissent within their ranks, by making just enough modifications to the bill for it to pass by their self-imposed deadline. Mr Ryan has been steadfastly working the backbenches, and, in a closed-door meeting, Mr Trump threatened to &#x201C;come after&#x201D; one particularly unruly congressman. Millions of Americans&#x2019; health care will hinge on their powers of persuasion.</p></div>',
    status: 'published',
    articleSourceId: 'the-economist' };
  var testArticle2 = { title: 'Trump ally Stone offers to testify in Russian meddling probe',
    caption: 'Roger Stone, a longtime ally of President Donald Trump, said on Sunday he has offered to testify before a congressional committee investigating possible Russian meddling in the 2016 presidential election and ties to the Trump campaign.',
    topics: 'trump,democrat,investigating',
    author: 'Reuters Editorial',
    srcUrl: 'http://www.reuters.com/article/us-usa-trump-russia-idUSKBN16X0RK',
    srcPublisher: 'Reuters',
    srcPublisherLogoUrl: 'http://i.newsapi.org/reuters-m.png',
    summary: 'Trump ally Stone offers to testify in Russian meddling probe\nStone said he was anxious to testify in public.</p><span></span><p>&quot;I reiterate again, I have had no contacts or collusions with the Russians,&quot; he told ABC, adding later, &quot;There is no collusion, none, at least none that I know about, in Donald Trump&apos;s campaign for president.&quot; </p><span></span> <span></span><p>At Monday&apos;s intelligence committee hearing, Adam Schiff, the top Democrat on the panel, cited concern over Stone&apos;s communications with WikiLeaks founder Julian Assange and Guccifer 2, who claimed responsibility for hacking the Democratic groups.</p><span></span><p>The U.S.',
    content: '<span> <span></span> <span><p><span>WASHINGTON</span> Roger Stone, a longtime ally of President Donald Trump, said on Sunday he has offered to testify before a congressional committee investigating possible Russian meddling in the 2016 presidential election and ties to the Trump campaign.</p></span><span></span><p>Stone, an informal adviser to Trump, told ABC&apos;s &quot;This Week&quot; he had not received a reply from the House of Representatives intelligence committee on his offer of public testimony.</p><span></span><p>Along with former Trump campaign manager Paul Manafort, who has also offered to testify, Stone was among the Trump associates whose communications and financial transactions were being examined by the FBI and others as part of a larger investigation into possible links with Russian officials, according to a Jan. 20 report in the New York Times.</p><span></span><p>Without citing any names, FBI Director James Comey confirmed at the committee&apos;s public hearing last week that the FBI was investigating possible Russian ties to Trump&apos;s campaign as Moscow sought to influence the 2016 election. Stone said he was anxious to testify in public.</p><span></span><p>&quot;I reiterate again, I have had no contacts or collusions with the Russians,&quot; he told ABC, adding later, &quot;There is no collusion, none, at least none that I know about, in Donald Trump&apos;s campaign for president.&quot; </p><span></span> <span></span><p>At Monday&apos;s intelligence committee hearing, Adam Schiff, the top Democrat on the panel, cited concern over Stone&apos;s communications with WikiLeaks founder Julian Assange and Guccifer 2, who claimed responsibility for hacking the Democratic groups.</p><span></span><p>The U.S. intelligence community has concluded that Russia was behind the hacking of Democratic Party groups during the 2016 campaign. Russia has denied the allegations of meddling.</p><span></span> <span></span><p>Trump has dismissed the idea of any coordination between his campaign and Russia and has accused Democrats and the media of using the issue to attack him.</p><span></span><p>The House committee investigation was marred on Wednesday after its Republican chairman, Representative Devin Nunes, announced to the public and briefed Trump that U.S. intelligence may have swept up communications by Trump associates before telling the committee.</p><span></span><p>Nunes apologized to the intelligence panel the next day.</p><span></span> <span></span><p>However, he further alienated Democrats on the committee on Friday when he canceled a hearing with intelligence officials from former Democratic President Barack Obama&apos;s administration in order to have a classified briefing with the directors of the National Security Agency and Federal Bureau of Investigation.</p><span></span><p>The committee&apos;s top Democrat, Adam Schiff, suggested the cancellation came after pressure from the White House.</p><span></span><p>Schiff and other Democrats said last week&apos;s actions raised more doubts about whether Nunes, a Trump ally who served on the president&apos;s transition team, can conduct a credible investigation.</p><span></span><p>&#x201C;I think the chairman has to make a decision whether to act as a surrogate of the White House as he did during the campaign and the transition or to lead an independent and credible, investigation,&#x201D; Schiff told CBS&apos; &#x201C;Face the Nation.&#x201D; </p><span></span><p> (Reporting by Doina Chiacu; Editing by Jeffrey Benkoe)</p><span></span></span>',
    status: 'published',
    articleSourceId: 'reuters' };

    console.log( scoreArticleSentiment(testArticle1), scoreArticleVocab(testArticle1) );
    console.log( scoreArticleSentiment(testArticle2), scoreArticleVocab(testArticle2) );
    // afinnService.scoreEmoji(testArticle2.caption).then(t2c => console.log("a2c",t2c));

}

setTimeout(function() {
  loadAllNewArticles(); 
  // rescoreAllSources();
}, 1500 );
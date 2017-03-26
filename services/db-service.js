var mongodb = require('mongodb');

class MongoDatabase {

    /**
     * @param {NewsApiIngestService} newsApiIngestService
     * @param {AFINNModelService} AFINNModelService
     * @param {ArticleParsingService} parsingService
     * @param {ArticleSummaryService} summaryService
     */
    constructor (mongoUrl, callback) {
        /*
         * Connect to database at {mongoUrl}
         */

        // Connect to MongoDB instance
        var MongoClient = mongodb.MongoClient;
        // Create database object
        this.db = null;

        var self = this;

        MongoClient.connect(mongoUrl, function (err, db) {
            if (err) {
                self.db = null;
                console.error('couldnt connect error: ', err);
            } else {
                self.db = db;
                console.log('connected to ', mongoUrl);
            }
            if(callback) callback();
        });
    }

    checkConnected() {
        if( !this.db ) {
            console.error('Must connect to database');
        }
    }

    postManyToCollection(collectionName, docs) {

        // Check for errors
        this.checkConnected();

        // Get collection
        var collection = this.db.collection(collectionName);

        // Post to collection
        return Promise.all(
            docs.map(doc => new Promise(
                (resolve, reject) => {
                    collection.save(doc, function(err, result) {
                        if(err) {
                            console.error("Error posting documents to collection " + collectionName + ".");
                            reject(err);
                        } else {
                            resolve(result);
                        }
                    });
            })
            )
         );
    }

    getObjectsFromCollection(collectionName, params={}) {
        var collection = this.db.collection(collectionName);
        return new Promise(
            (resolve, reject) => {
                collection.find(params).toArray(function(err, result) {
                    if(err) {
                        console.error("Error searching collection " + collectionName + ".");
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
        });
    }

}

module.exports = MongoDatabase;
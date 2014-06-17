var assert = require('assert'),
    Persistence = require('../persistence.js'),
    client;

describe('given a connected persistence', function() {

  before(function(done) {
    Persistence.setConfig({ redis_host: 'localhost', redis_port: 6379 });
    Persistence.connect(function() {
      client = Persistence.redis();
      Persistence.delWildCard('*', done);
    });
  });

  after(function(done) {
    Persistence.delWildCard('*', function() {
      Persistence.disconnect(done);
    });
  });

  describe('while handling errors', function() {
    it('should filter out non JSON redis strings (ie. do not return corrupted data)', function(done) {

      var key = 'persistence.test';

      client.del(key);
      client.hset(key, 'bar1', 'this string should be filtered out');
      client.hset(key, 'bar2', '"this string should be returned"', function() {
        Persistence.readHashAll(key, function(result) {
          assert.deepEqual({ bar2: 'this string should be returned' }, result);
          done();
        });
      });
    });
  });

  describe('while persisting messages', function() {
    it('should serialize objects', function(done) {
      // (nherment) TODO: the result should actually be deserialized because it is being serialized in persistOrdered()
      // The problem is that radar_client currently deserializes the response.
      // We need to make the client not deserialize the response so that we can deserialize it here.

      var key = 'persistence.messages.object.test';
      var objectValue = {
        foo: 'bar'
      };

      Persistence.persistOrdered(key, objectValue, function(err) {
        if(err) {
          return done(err);
        }
        Persistence.readOrderedWithScores(key, undefined, function(replies) {

          assert(replies instanceof Array);
          assert.equal(2, replies.length);
          assert.equal('string', typeof replies[0]);
          assert.equal(JSON.stringify(objectValue), replies[0]);
          done();
        });
      });
    });

    it('should serialize strings', function(done) {
      // (nherment) TODO: the result should actually be deserialized because it is being serialized in persistOrdered()
      // The problem is that radar_client currently deserializes the response.
      // We need to make the client not deserialize the response so that we can deserialize it here.

      var key = 'persistence.messages.string.test';
      var stringValue = 'Hello World';

      Persistence.persistOrdered(key, stringValue, function(err) {
        if(err) {
          return done(err);
        }
        Persistence.readOrderedWithScores(key, undefined, function(replies) {

          assert(replies instanceof Array);
          assert.equal(2, replies.length);
          assert.equal('string', typeof replies[0]);
          assert.equal(JSON.stringify(stringValue), replies[0]);
          done();
        });
      });
    });
  });

});

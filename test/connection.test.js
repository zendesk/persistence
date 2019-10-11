var assert = require('assert'),
    ConnectionHelper = require('../lib/connection_helper.js'),
    SentinelHelper = require('simple_sentinel'),
    client;

describe('given a ConnectionHelper', function() {
  var configuration = {
    connection_settings: {
      redis: {
        host: 'localhost',
        port: 16379
      },
      sentinel: {
        // sentinel master name is required
        id: 'mymaster',
        sentinels: [
        {
          host: 'localhost',
          port: 26379
        },
        {
          host: 'localhost',
          port: 26380
        },
        {
          host: 'localhost',
          port: 26381
        }]
      }
    }
  };
  describe('with redis configuration', function() {
      var helper_config = {
        redis : {
          ports: [ 16379 ]
        },
      };
    before(function() {
      SentinelHelper.start(helper_config);
    });
    after(function() {
      SentinelHelper.stop(helper_config);
    });
    it('should connect', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'redis';

      var connection = ConnectionHelper.connection(config);
      connection.establish(function() {
        assert.deepEqual(connection.config,  { host: 'localhost', port: 16379, enableReadyCheck: true });
        connection.teardown(function() {
          ConnectionHelper.destroyConnection(config, done);
        })
      });
    });
    it('should reuse existing connection', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'redis';

      var connection = ConnectionHelper.connection(config);
      connection.establish(function() {
        assert.deepEqual(connection.config,  { host: 'localhost', port: 16379, enableReadyCheck: true });
        assert.deepEqual(connection, ConnectionHelper.connection(config));
        connection.teardown(function() {
          ConnectionHelper.destroyConnection(config, done);
        })
      });
    });
  });

  describe('with sentinel configuration', function() {
      var helper_config = {
        redis : {
          ports: [ 16379, 16380, 16381 ]
        },
        sentinel: {
          ports: [ 26379, 26380, 26381 ]
        }
      };
    before(function() {
      this.timeout(10000);
      SentinelHelper.start(helper_config);
    });
    after(function(done) {
      this.timeout(10000);
      SentinelHelper.stop(helper_config);
      setTimeout(function () {
        done()
      }, 200)
    });

    it('should connect', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'sentinel';
      var connection = ConnectionHelper.connection(config);
      connection.establish(function() {
        assert.equal(connection.config.id,  configuration.connection_settings.sentinel.id);

        var expected_sentinels = new Set(configuration.connection_settings.sentinel.sentinels);
        var received_sentinels = new Set(connection.config.sentinels);
        assert.deepStrictEqual(received_sentinels, expected_sentinels);
        connection.teardown(function() {
          ConnectionHelper.destroyConnection(config, done);
        })
      });
    });

    it('should reuse existing connection', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'sentinel';

      var connection = ConnectionHelper.connection(config);
 
      connection.establish(function() {
        assert.deepEqual(connection, ConnectionHelper.connection(config));
        connection.teardown(function() {
          ConnectionHelper.destroyConnection(config, done);
        })
      });
    });
  });
  describe('given a connection', function() {
    var connection;
    var config = JSON.parse(JSON.stringify(configuration));
    config.use_connection = 'redis';

    var helper_config = {
      redis : {
        ports: [ 16379 ]
      },
    };
    before(function(done) {
      process.env.noverbose=true;
      SentinelHelper.start(helper_config);
      connection = ConnectionHelper.connection(config);
      connection.establish(done);
    });
    after(function(done) {
      ConnectionHelper.destroyConnection(config,done);
      process.env.noverbose=true;
      SentinelHelper.stop(helper_config);
    });
    it('should not create different clients for multiple establish calls', function(done) {
      var client1, client2;
      connection.establish(function() {
        client1 = connection.client;
      });
      connection.establish(function() {
        client2 = connection.client;
        assert.equal(client1, client2);
        done();
      });
    });
  });
});

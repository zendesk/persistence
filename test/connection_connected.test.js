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

  describe('with redis configuration,', function() {
    it ('should not connect when redis is not running', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'redis';

      var connection = ConnectionHelper.connection(config);
      connection.establish();

      setTimeout(function () {
        if (connection && !connection.client) {
          ConnectionHelper.destroyConnection(config, done);
        }
      }, 1000);

    });
  });

  describe('with sentinel configuration', function() {
    it ('should not connect when neither sentinel nor redis is running', 
                                                              function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'sentinel';

      var connection = ConnectionHelper.connection(config);
      connection.establish();

      setTimeout(function () {
        if (connection && !connection.client) {
          ConnectionHelper.destroyConnection(config, done);
        }
      }, 1000);

    });
  });

  describe('with sentinel configuration,', function() {
    var helper_config = {
      redis : {
        ports: [ 16379, 16380, 16381 ]
      },
    };

    before(function() {
      this.timeout(20000);
      SentinelHelper.start(helper_config);
    });
    after(function() {
      this.timeout(10000);
      SentinelHelper.stop(helper_config);
    });

    it ('should not connect when redis is running', function(done) {
      this.timeout(10000);
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'sentinel';

      var connection = ConnectionHelper.connection(config);
      connection.establish();

      setTimeout(function () {
        if (connection && !connection.client) {
          ConnectionHelper.destroyConnection(config, done);
        }
      }, 1000);

    });
  });

  describe('with sentinel configuration,', function() {
    var helper_config = {
      redis : {
        ports: [ 16379, 16380, 16381 ]
      },
      sentinel: {
        ports: [ 26379, 26380, 26381 ]
      }
    };

    before(function() {
      this.timeout(20000);
      SentinelHelper.start(helper_config);
    });
    after(function() {
      this.timeout(10000);
      SentinelHelper.stop(helper_config);
    });

    it ('should connect when redis and sentinel are running', function(done) {
      var config = JSON.parse(JSON.stringify(configuration));
      config.use_connection = 'sentinel';

      var connection = ConnectionHelper.connection(config);
      connection.establish(function () {
        if (connection && connection.client && connection.client.connected) {
          ConnectionHelper.destroyConnection(config, done);
        }
      });
    });
  });
});

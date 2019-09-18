var assert = require('assert'),
    SentinelHelper = require('simple_sentinel');

describe('A sentinel-connected persistence', function() {
  var child, childRunning;
  var helperConfig = {
    redis: {
      ports: [ 16379, 16380, 16381 ]
    },
    sentinel: {
      ports: [ 26379, 26380, 26381 ]
    }
  };

  var connect = function(done) {
    child = require('child_process').fork(__dirname + '/connect.js');
    childRunning = true;
    child.on('message', function (message) {
      switch (message) {
        case 'connected':
          connectionStatus = true;
          done();
          break;
        case 'invalid_connection':
          connectionStatus = false;
          break;
        case 'valid_connection':
          connectionStatus = true;
          break;
        default:
          break;
      }
    });
    child.send('connect');
  };

  before(function(done) {
    this.timeout(10000);
    SentinelHelper.start(helperConfig);
    connect(done);
  });
  after(function() {
    this.timeout(10000);
    child.kill();
    child.send('killoff');
    SentinelHelper.stop(helperConfig);
  });

  it('should not die if master fails, but should reconnect to new master', function(done) {
    this.timeout(30000);
    // Cause underlying redis to fail over
    require('child_process').exec('redis-cli -p 26379 sentinel failover mymaster');

    var intervalStatusCheck = setInterval(function () {
      child.send('status');
    }, 1000);
    setTimeout(function() {
      assert.ok(connectionStatus);
      clearInterval(intervalStatusCheck);
      done();
    }, 25000);
  });
});

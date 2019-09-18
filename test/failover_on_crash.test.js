var assert = require('assert'),
    SentinelHelper = require('simple_sentinel'),
    Persistence = require('../lib/persistence');

describe('For a sentinel-connected persistence', function() {
  var child, connectionStatus;
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
    child.on('message', function (message) {
      switch (message) {
        case 'connected':
          connectionStatus = true;
          done();
          break;
        case 'invalid_connection':
          connectionStatus = false;
          break;
        case 'vaid_connection':
          connectionStatus = true;
          break;
        default:
          break;
      }
    })
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

  it('verify that a reconnected Persistence succeeds after an intentional crash', function(done) {
    this.timeout(15000);
    setTimeout(function () {
      child.send('status');
    }, 5000);
    setTimeout(function() {
      assert.ok(connectionStatus);
      done();
    }, 9000);
    child.send('test_error');
  });
});

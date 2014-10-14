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
    child.on('message', function(message) {
      console.log(message);
      if(message === 'connected') {
        done();
      }
    });
    child.on('exit', function() {
      childRunning = false;
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
    SentinelHelper.stop(helperConfig);
  });

  it('should die if master fails, but able to restart with new master', function(done) {
    this.timeout(30000);
    child.on('exit', function() {
      setTimeout(function() {
        connect(function() {
          assert.ok(childRunning);
          done();
        });
      }, 9000);
    });

    // Cause underlying redis to fail over
    require('child_process').exec('redis-cli -p 26379 sentinel failover mymaster');
  });
});

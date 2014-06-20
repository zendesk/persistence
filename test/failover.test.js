var assert = require('assert'),
    ConnectionHelper = require('../connection_helper.js'),
    SentinelHelper = require('simple_sentinel'),
    client;

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
    process.env.noverbose=true;
    SentinelHelper.start(helperConfig);
    connect(done);
  });
  after(function() {
    child.kill();
    process.env.noverbose=true;
    SentinelHelper.stop(helperConfig);
  });

  it('should die if master fails, but able to restart with new master', function(done) {
    this.timeout(10000);
    child.on('exit', function() {
      setTimeout(function() {
        connect(function() {
          assert.ok(childRunning);
          done();
        });
      }, 5000);
    });
    //Kill master
    SentinelHelper.stop({ redis: { ports: [ 16379 ] } });
  });
});

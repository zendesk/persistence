var Persistence = require('../persistence.js');
var configuration = require('../configuration.example.js');

configuration.use_connection = 'sentinel';

Persistence.setConfig(configuration);

function Dummy () { }

Dummy.prototype.toString = function() {
  return this;
}

Dummy.prototype.test = function(pattern) {
  return pattern == '/READONLY/'
}

process.on('message', function(message) {
  if(message === 'connect') {
    Persistence.connect(function() {
      process.send('connected');
      setInterval(function() {
        Persistence.persistHash('xyz', 'f', 1);
      }, 1000);
    });
  }
  else if (message === 'test_error')
  {
    Persistence.handler(new Dummy());
  }
});

var Persistence = require('../lib/persistence.js');
var configuration = require('../configuration.example.js');

configuration.use_connection = 'sentinel';

Persistence.setConfig(configuration);

function Dummy () { }

Dummy.prototype.toString = function() {
  return 'error string contains READONLY';
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

var Persistence = require('../lib/persistence.js');
var configuration = require('../configuration.example.js');

configuration.use_connection = 'sentinel';

Persistence.setConfig(configuration);

function Dummy () { }

Dummy.prototype.toString = function() {
  return 'error string contains READONLY';
}

var intervalCommand;

process.on('message', function(message) {
  switch (message) {
    case 'connect':
      Persistence.connect(function() {
        process.send('connected');
        intervalCommand = setInterval(function() {
          Persistence.persistHash('xyz', 'f', 1);
        }, 1000);
      });
      break;
    case 'test_error':
      Persistence.handler(new Dummy());
      break;
    case 'killoff':
      clearInterval(intervalCommand);
      break;
    case 'status':
      process.send(Persistence.isConnectionReady() ? 'valid_connection' : 'invalid_connection');
      break;
    default:
      console.log('Invalid message');
  }
});



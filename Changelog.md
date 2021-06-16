### v2.0.2
* [PR #30](https://github.com/zendesk/persistence/pull/30) Upgrades packages
* [PR #29](https://github.com/zendesk/persistence/pull/29) Replaces Travis with Github Actions

### v2.0.1
* [PR #27](https://github.com/zendesk/persistence/pull/27) Adds node v12 to
Travis

### v2.0.0
* Replace node redis with ioredis

### v1.0.10
* Update redis client to `0.12.1`

### v1.0.9
* Update redis client to `2.0.8`

### v1.08
* pin dependencies and test CI in Node 4 - PR #17
* update Mocha to v5 - PR #18
* reconnect to new master after redis failover - PR #20:w

### v1.07
* fixes brittle test by using separate port numbers

### v1.06
* use forked version of sentintel client - see PR #14

### v1.05
* improve error reporting - see PR #13

### v1.0.4
* pin redis to version 0.12.1 - see PR #12
* update travis config and README.md badges

### v1.0.3
* fix use of multi in single key get/set methods
* add expireTTL to single key get/set methods

### v1.0.2
* add get/set methods for single keys

### v1.0.1
* Crash when connection times out
* Refactor connection.js

### v1.0.0
* License updated

### v0.4.0
* Changes for stream resource
** List (with id) abstraction
** Lock module
** Id generator module (globally autoincrementing ids)

### v0.3.1
* Avoid argument rearrangement because of undefined callback

### v0.3.0
* Use redis-sentinel instead of redis-sentinel-client
* Use latest redis library
* Crash if master goes down
* Tests for connection

### v0.2.0
* Use latest minilog version for logging

### v0.1.1
* Initial version (extracted from radar)
* Support both redis; and sentinel through redis-sentinel-client

'use strict'

class BucketConfig {
  constructor(config) {
    this.config = config
  }

  getConfig() {
    return this.config
  }
  //update the current configuration with the ones stored in serverless.yml
  update(fileConfig) {

  }
}

module.exports = BucketConfig

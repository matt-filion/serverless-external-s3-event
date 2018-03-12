'use strict'

const S3 = require('./S3.js')

class BucketConfig {
  constructor(config, serverless, provider) {
    this.config = config
    this.s3 = new S3()
    if (serverless != undefined){
      serverless.cli.log(serverless.service.getServiceObject().name)
      serverless.cli.log(serverless.service.provider.stage)
    }
  }

  getConfig() {
    return this.config
  }
  //update the current configuration with the ones stored in serverless.yml
  update(fileConfig) {
    this.addNewNotifications(fileConfig)

  }

  addNewNotifications(fileConfig) {
    fileConfig.events.forEach((event) => {
      if (this.isNew(event)) this.addNewNotification(event)
    })
  }

  isNew(event) {
    let id = this.s3.getId(event)
    let found = this.config.results.LambdaFunctionConfigurations.find(function(e) {
      return e.Id == id
    })
    return found == undefined
  }

  addNewNotification(event) {
    let id = this.s3.getId(event)
    let filter = undefined

    if(event.existingS3.rules && event.existingS3.rules.length !== 0) {
      filter = {
        Key: {
          FilterRules: event.existingS3.rules.map( rule => {
            const key = Object.keys(rule)[0];
            return {
              Name: key,
              Value: rule[key]
            }
          })
        }
      }
    }

    this.config.results.LambdaFunctionConfigurations.push({
      Id: id,
      LambdaFunctionArn: event.arn,
      Events: event.existingS3.events,
      Filter: filter
    })
  }
}

module.exports = BucketConfig

'use strict'

const S3 = require('./S3.js')

class BucketConfig {
  constructor(config, serverless, options) {
    this.config = config
    this.options = options;
    this.s3 = new S3()
    this.serverless = serverless
    if (serverless != undefined){
      this.service = serverless.service.getServiceObject().name
      this.stage = serverless.service.provider.stage
    }
  }

  getConfig() {
    return this.config
  }
  //update the current configuration with the ones stored in serverless.yml
  update(fileConfig) {
    this.addNewNotifications(fileConfig)
    this.removeObsoleteNotifications(fileConfig)
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

    this.config.results.LambdaFunctionConfigurations.push({
      Id: id,
      LambdaFunctionArn: event.arn,
      Events: event.existingS3.events,
      Filter: this.notificationFilterFrom(event)
    })
  }

  notificationFilterFrom(event) {
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

    return filter
  }

  removeObsoleteNotifications(fileConfig) {
    let notifications = this.config
      .results
      .LambdaFunctionConfigurations
      .filter(n => this.isActive(n, fileConfig))
    this.config.results.LambdaFunctionConfigurations = notifications
  }

  isActive(notification, fileConfig) {
    return this.inConfig(notification, fileConfig) || this.notRelevant(notification, fileConfig)
  }

  inConfig(notification, fileConfig) {
    let found = fileConfig.events.find((event) => {
      let id = this.s3.getId(event)
      return id == notification.Id && this.relevantARN(event.arn)
    })
    return found != undefined
  }

  notRelevant(notification, fileConfig) {
    return (this.relevantARN(notification.LambdaFunctionArn) == null) || !notification.Id.startsWith("exS3-v2")
  }

  relevantARN(arn) {
    const aliasPart = (this.options && this.options.alias) ? `.*:${this.options.alias}` : '';
    let re = new RegExp(this.service + "-" + this.stage + aliasPart, 'gi')
    return arn.match(re)
  }
}

module.exports = BucketConfig

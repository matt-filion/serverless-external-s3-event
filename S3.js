'use strict';

const crypto = require('crypto');

class S3 {
  constructor(serverless,options,provider){
    this.serverless = serverless;
    this.provider   = provider;
    this.options    = options;
  }

  getId(event) {
    const eventTypes = event.existingS3.events ? 
      Array.isArray(event.existingS3.events) ? event.existingS3.events : [event.existingS3.events]
      : ['s3:ObjectCreated:*'];
    const rules      = event.existingS3.rules ? event.existingS3.rules.sort( (a,b) => Object.keys(a) - Object.keys(b) ) : [];
    const md5Data    = `${event.arn}_${eventTypes.join('OR').replace(/[\.\:\*]/g,'')}_${rules.map(rule => JSON.stringify(rule)).join('-')}`;
    const md5        = crypto.createHash('md5').update(md5Data).digest("hex");
    return `exS3-v2--${md5}`;
  }

  getLambdaNotifications(bucket){
    return this.provider.request('S3', 'getBucketNotificationConfiguration', { Bucket: bucket })
      .then( results => {
        return {bucket, results:results};
      })
  }

  putLambdaNotification(bucketConfig) {
    const payload = {
      Bucket: bucketConfig.bucket,
      NotificationConfiguration: bucketConfig.results
    }

    return this.provider.request('S3', 'putBucketNotificationConfiguration', payload)
      .catch( error => {
         if(this.options['continue-on-error']) {
          this.serverless.cli.log(`\t ERROR: ${payload.Bucket} ${error.message}`);
        } else {
          return Promise.reject(`${payload.Bucket} ${error.message}`);
        }
      });
  }
}

module.exports = S3;

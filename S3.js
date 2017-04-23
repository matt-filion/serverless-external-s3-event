'use strict';

const crypto = require('crypto');

class S3 {
  constructor(serverless,options,provider){
    this.serverless = serverless;
    this.provider   = provider;
    this.options    = options;
  }

  getId(event) {
    const eventTypes = event.existingS3.event || ['s3:ObjectCreated:*'];
    const rules      = event.existingS3.rules ? event.existingS3.rules.sort( (a,b) => Object.keys(a) - Object.keys(b) ) : [];
    const md5Data    = `${event.arn}_${eventTypes.join('OR').replace(/[\.\:\*]/g,'')}_${rules.map(rule => JSON.stringify(rule)).join('-')}`;
    const md5        = crypto.createHash('md5').update(md5Data).digest("hex");
    return `exS3-v2--${md5}`;
  }

  getLambdaNotifications(bucket){
    return this.provider.request('S3', 'getBucketNotificationConfiguration', { Bucket: bucket })
      .then( results => {
        return {bucket,results:results.LambdaFunctionConfigurations};
      })
  }

  putLambdaNotification(bucketConfig){
    const payload = {
      Bucket: bucketConfig.name,
      NotificationConfiguration: {
        LambdaFunctionConfigurations: bucketConfig.events.map( event => {
          /*
           * Filters are optional in the configuration.
           */
          let filter = undefined;

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

          /*
           * Default to object creation, or accept the one or more event types provided.
           */
          const bucketEventTypes = event.existingS3.event || ['s3:ObjectCreated:*'];

          /*
           * http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putBucketNotificationConfiguration-property
           */
          return {
            Events: bucketEventTypes,
            LambdaFunctionArn: event.arn,
            Filter: filter,
            Id: this.getId(event)
          }
        })
      }
    }

    console.log("putLambdaNotification payload",JSON.stringify(payload,' ',4));

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
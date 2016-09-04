'use strict';

class Deploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options    = options;
    this.commands   = {
      s3deploy: {
        lifecycleEvents: [
          'events'
        ]
      },
    };
    this.hooks = {
      'after:s3deploy:events': this.afterDeployFunctions.bind(this)
    };
  }

  afterDeployFunctions() {

//
//    /*
//     * TODO
//     *  - Event Filters
//     *  - 
//     */
    const cliOptions          = this.serverless.pluginManager.cliOptions;
    const sdk                 = this.serverless.pluginManager.plugins.find( item => item.constructor.name === 'AwsDeploy').sdk;
    const AWS                 = sdk.sdk;
    const credentials         = sdk.getCredentials(cliOptions.stage,cliOptions.region);
    const S3                  = new AWS.S3(credentials);
    const CloudFormation      = new AWS.CloudFormation(credentials);
    const bucketNotifications = this.serverless.service.getAllFunctions()
      .map(name => this.serverless.service.getFunction(name) )
      /*
       * Create a LambdaFunctionConfigurations for existingS3 configuration
       *  on each functionObj.
       */
      .map(functionObj => this.getLambdaFunctionConfigurationsFromFunction(functionObj) )
      /*
       * Flatten the results
       */
      .reduce( (accumulator,current) => accumulator = accumulator.concat(current) , [])
      /*
       * Organize the resulting configurations so that all events for the
       *  same bucket are together.
       */
      .reduce( (accumulator,current) => {
        let bucketLambdaConfigs = accumulator.find( eventConfig => eventConfig.name === current.bucket );
        if(!bucketLambdaConfigs) {
          bucketLambdaConfigs = { bucket:current.bucket, configs:[] };
          accumulator.push(bucketLambdaConfigs);
        }
        bucketLambdaConfigs.configs.push(current.config);
        return accumulator;
      }, [])
      /*
       * Create a bucket configuration as AWS needs it for each
       *  bucket.
       */
      .map(bucketConfig=> {
        return {
          Bucket:bucketConfig.bucket,
          NotificationConfiguration: {
            LambdaFunctionConfigurations:bucketConfig.configs
          }
        } 
      })

    /*
     * Lookup the ARN for each function referenced within the bucket
     *  events.
     */
    return CloudFormation.describeStacks({ StackName: sdk.getStackName(cliOptions.stage) }).promise()
      .then(results => results.Stacks[0].Outputs)
      .then(outputs => {
        bucketNotifications.forEach( notification => {
          notification.NotificationConfiguration.LambdaFunctionConfigurations.forEach( lambdaFunctionConfiguration => {
            var output = outputs.find( output => output.OutputValue.endsWith(':function:'+lambdaFunctionConfiguration.LambdaFunctionArn) )
            lambdaFunctionConfiguration.LambdaFunctionArn = output.OutputValue
            
          })
        })
        return bucketNotifications;
      })
      /*
       * Attach the events to each bucket.
       */
      .then( buckets => {
        console.log("Attaching event(s) to:",buckets.reduce( (result,bucket) => result += bucket.Bucket + ' ',''));
        return buckets;
      })
      .then( bucketNotifications => Promise.all( bucketNotifications.map(param => S3.putBucketNotificationConfiguration(param).promise() ) ) )
      .then( () => console.log("Done."))
      .catch( error => console.log("Error attaching event(s)",error));
    
  }
  
  getLambdaFunctionConfigurationsFromFunction(functionObj) {
    return functionObj.events
      .filter(event => event.existingS3)
      .map(event => {
        var bucketEvents = event.existingS3.bucketEvents ? event.existingS3.bucketEvents : ['s3:ObjectCreated:*'];
        
        /*
         * Hoping the ID causes overwriting of an existing configuration.
         */
        return {
          bucket: event.existingS3.bucket,
          config: {
            Id: 'trigger--' + functionObj.name + '--when--' + bucketEvents.join().replace(/[\.\:\*]/g,''), 
            LambdaFunctionArn: functionObj.name,
            Events: bucketEvents
          }
        }
      })
  }
}

module.exports = Deploy;
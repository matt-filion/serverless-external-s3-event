'use strict';

class Deploy {
  constructor(serverless, options) {
    this.serverless  = serverless;
    this.options     = options;
    this.provider    = this.serverless.getProvider('aws');
    this.commands    = {
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

    // console.log("this.provider",this.provider);

    const bucketNotifications = this.serverless.service.getAllFunctions()
      .map( name => this.serverless.service.getFunction(name) )
      /*
       * Create a LambdaFunctionConfigurations for existingS3 configuration
       *  on each functionObj.
       */
      .map( functionObj => this.getLambdaFunctionConfigurationsFromFunction(functionObj) )
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
     * Don't bother doing any work if there is no configurations specified for this
     *  plugin.
     */
    if(bucketNotifications.length===0) return Promise.resolve();

    /*
     * Lookup the ARN for each function referenced within the bucket
     *  events.
     */
    return this.provider.request('CloudFormation','describeStacks',null,this.options.stage,this.options.region)
      .then(results => results.Stacks[0] ? results.Stacks[0].Outputs : [])
      .then(outputs => {
        bucketNotifications.forEach( notification => {
          notification.NotificationConfiguration.LambdaFunctionConfigurations.forEach( lambdaFunctionConfiguration => {
            var output = outputs.find( output => output.OutputValue.endsWith(':function:'+lambdaFunctionConfiguration.LambdaFunctionArn) )
            lambdaFunctionConfiguration.LambdaFunctionArn = output.OutputValue
          })
        })
      })
      /*
       * Attach the events to each bucket.
       */
      .then( () => console.log("Attaching event(s) to:",bucketNotifications.reduce( (result,bucket) => result += bucket.Bucket + ' ','')) )
      .then( () => Promise.all( bucketNotifications.map(param => this.provider.request('S3','putBucketNotificationConfiguration', param, this.options.stage, this.options.region) ) ) )
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
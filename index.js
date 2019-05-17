'use strict';

const Permissions = require('./Permissions');
const S3          = require('./S3');
const Transformer = require('./Transformer');
const BucketConfig = require('./BucketConfig');


class S3Deploy {

  constructor(serverless,options) {

    this.serverless        = serverless;
    this.options           = options;
    this.provider          = this.serverless.getProvider('aws');
    if (!(this.provider.sdk && this.provider.sdk.config && this.provider.sdk.config.region)) {
      this.provider.sdk.config.region = this.serverless.service.provider.region;
    }
    this.s3Facade          = new S3(this.serverless,this.options,this.provider);
    this.lambdaPermissions = new Permissions.Lambda(this.options, this.provider);
    this.transformer       = new Transformer(this.lambdaPermissions);
    this.commands          = {
      s3deploy: {
        lifecycleEvents: [
          'init',
          'functions',
          's3'
        ],
        usage: 'Add lambda notifications to S3 buckets not defined in serverless.yml',
        options: {
          'continue-on-error' : {
            usage: 'Can be used to attempt a partial deploy, where not all functions are available/deployed. They will be skipped and not attmepted.'
          },
          help: {
            usage: 'See https://github.com/matt-filion/serverless-external-s3-event for detailed documentation.'
          }
        }
      },
      s3eventremove: {
        lifecycleEvents: ['remove'],
        usage: 'remove lambda notifications to S3 buckets defined in serverless.yml',
      }
    };

    this.hooks = {
      'before:s3deploy:functions':this.beforeFunctions.bind(this),
      's3deploy:functions': this.functions.bind(this),

      'before:s3deploy:s3':this.beforeS3.bind(this),
      's3deploy:s3': this.s3.bind(this),

      's3eventremove:remove': this.s3remove.bind(this),
    };

    this.bucketNotifications;
    this.currentBucketNotifications;

  }

  /*
   * Looks at the serverless.yml file for the project the plugin is defined within and
   *  builds the AWS payload needed for each S3 bucket configured for externalS3 events.
   */
  beforeFunctions(){

    this.serverless.cli.log("beforeFunctions --> building ... ");

    this.events = this.transformer.functionsToEvents(this.serverless.service.functions);

    this.serverless.cli.log(`beforeFunctions <-- Complete, built ${this.events.length} events.`);
  }

  functions(){
    this.serverless.cli.log("functions --> prepare to be executed by s3 buckets ... ");

    let count = 0;

    return Promise.all( this.events )
      .then( results => results.map( result => {

        const event = result.passthrough;

        /*
         * If we get a 'funciton not found' error message then sls deploy has likely not been
         *  executed. I suppose it could also be 'permissions', but that would require someone
         *  create a wonkey AIM definition in serverless.yml.
         */
        if(result.error && result.error.toLowerCase().startsWith('function not found')){
          if(this.options['continue-on-error']) {
            this.serverless.cli.log(`\t ERROR: It looks like the function ${event.name} has not yet beend deployed, it will be excluded.`);
            event.remove = true;
            return Promise.resolve(event);
          } else {
            throw `It looks like the function ${event.name} has not yet beend deployed (it may not be the only one). You must use 'sls deploy' before doing 'sls s3deploy'.`;
          }
        }

        /*
         * No permissions have been added to this function for any S3 bucket, so create the policy
         *  and return the event when it executes successfully.
         */
        if(result.error && 'the resource you requested does not exist.' === result.error.toLowerCase()){
          return this.lambdaPermissions.createPolicy(event.name,event.existingS3.bucket,event);
        }

        /*
         * If there is no policy on the lambda function allowing the S3 bucket to invoke it
         *  then add it. These policies are named specifically for this lambda function so
         *  existing 'should' be sufficient in ensureing its proper.
         */
        if(!result.statement) {
          return this.lambdaPermissions.createPolicy(event.name,event.existingS3.bucket,event);
        }

        return Promise.resolve(result);
      })
      )
      .then( results => Promise.all(results) )

      /*
       * Transform results
       */
      .then( events => this.transformer.eventsToBucketGroups(events) )
      .then( bucketNotifications => {
        this.bucketNotifications = bucketNotifications;
        this.serverless.cli.log(`functions <-- built ${count} events across ${bucketNotifications.length} buckets. `);
      })
  }

  beforeS3(){
    this.serverless.cli.log("beforeS3 --> ");

    /*
     * Load the current notification configruartions for each bucket that is impacted. This will be used
     *  to filter out changes that have already been applied to the bucket.
     */
    const promises = this.bucketNotifications.map( bucketConfiguration => this.s3Facade.getLambdaNotifications(bucketConfiguration.name) )

    return Promise.all(promises)
      .then( results => {
        this.currentBucketNotifications = results;
        this.serverless.cli.log("beforeS3 <-- ");
      });

  }

  s3(){

    if(this.bucketNotifications && this.bucketNotifications.length !== 0) {

      this.serverless.cli.log("s3 --> initiate requests ...");

      const promises = this.bucketNotifications
        .filter( bucketConfig => bucketConfig.events.length !== 0)
        .map( bucketConfigurationFromFile => {

          const existingS3Notifications = this.currentBucketNotifications.find( currentNotification => currentNotification.bucket === bucketConfigurationFromFile.name );

          let bucketConfig = new BucketConfig(existingS3Notifications, this.serverless, this.options)

          bucketConfig.update(bucketConfigurationFromFile)

          return bucketConfig.getConfig()
        })
        .map( bucketConfig => this.s3Facade.putLambdaNotification(bucketConfig) )

      return Promise.all(promises)
        .then( results => this.serverless.cli.log(`s3 <-- Complete ${results.length} updates.`) );

    }
  }

  s3remove() {
    const region = this.provider.sdk.config.region;
    const funcToDelete = Object.values(this.serverless.service.functions)
      .map( funktion => funktion.name );

    this.serverless.cli.log(`remove --> Start`);

    return Promise.resolve(Object.values(this.serverless.service.functions))
      // aggregate from functions to bucket base
      .then( funktions => funktions.reduce((accumulator,current) => accumulator.concat(current.events), [])
        .filter( event => event.existingS3 )
        .map( event => this.s3Facade.getLambdaNotifications(event.existingS3.bucket) )
      )
      .then( results => Promise.all(results) )
      // start remove function notification
      .then( results => results
        .map( bucketNotification => {
          const bucketConfig = new BucketConfig(bucketNotification, this.serverless, this.options)

          const removed = bucketConfig.remove(funcToDelete, region);

          return this.s3Facade.putLambdaNotification(bucketConfig.getConfig());
        })
      )
      .then( puts => Promise.all(puts) )
      .then( () => this.serverless.cli.log(`remove <-- Done`) );

  }
}

module.exports = S3Deploy;

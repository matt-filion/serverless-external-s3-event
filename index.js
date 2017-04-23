'use strict';

const Permissions = require('./Permissions');
const S3          = require('./S3');

class S3Deploy {

  constructor(serverless,options) {

    this.serverless        = serverless;
    this.options           = options;
    this.provider          = this.serverless.getProvider('aws');
    this.s3Facade          = new S3(this.serverless,this.options,this.provider);
    this.lambdaPermissions = new Permissions.Lambda(this.provider);

    this.commands   = {
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
    };

    this.hooks = {
      's3deploy:init': this.init.bind(this),

      'before:s3deploy:functions':this.beforeFunctions.bind(this),
      's3deploy:functions': this.functions.bind(this),
      'after:s3deploy:functions': this.afterFunctions.bind(this),

      'before:s3deploy:s3':this.beforeS3.bind(this),
      's3deploy:s3': this.s3.bind(this),
      'after:s3deploy:s3': this.afterS3.bind(this)
    };

    this.bucketNotifications;
    this.currentBucketNotifications;

  }

  init(){
  }

  /*
   * Looks at the serverless.yml file for the project the plugin is defined within and 
   *  builds the AWS payload needed for each S3 bucket configured for externalS3 events.
   */
  beforeFunctions(){

    this.serverless.cli.log("beforeFunctions --> building ... ");

    const functions = this.serverless.service.functions;
    const names     = Object.keys(functions);
    let   count     = 0;
    this.events     = names

      /*
       * Looking at each function defined in the serverless.yml file this will transform/map
       *  into the BucketNotificationConfiguration's that are needed for each S3 bucket
       */
      .map( name => functions[name] )

      /*
       * Each event can be targeted at a different bucket, so here I break them out into their own
       *  item combined with the data from the parent.
       */
      .map( funktion => funktion.events.map( event => Object.assign(event,{handler: funktion.handler,name: funktion.name})) )

      /* 
       * Flatten the nested arrays. 
       */
      .reduce( (accumulator,current) => accumulator.concat(current), [])

      /*
       * Get rid of any event that is not for existingS3, since its not actionable for this plugin. 
       */
      .filter( event => event.existingS3 )

      /*
       * For each defined function, get the current policy defined for that function. The policy of
       *  each function must permit S3 to invoke it.
       */
      .map( event => this.lambdaPermissions.getPolicy(event.name, event) )

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
      .then( events => events
        /*
         * Clear out any events that it has been determined cannot be
         *  attached to S3 buckets.
         */
        .filter( event => !event.remove ) 

        /*
         * Update the ARN for each function using the policies found for each function.
         */
        .map( result => {
          const event = result.passthrough;
          const statement = result.statement;

          event.arn = statement.Resource;
          
          return event;
        })
        /*
         * Merge the events into groups for each bucket, as that will be the unit of work
         *  going forward. 
         */
        .reduce( (accumulator,event) => {
          count ++;
          let bucketGroup = accumulator.find( group => group.name === event.existingS3.bucket )
          if(!bucketGroup) {
            bucketGroup = {
              name: event.existingS3.bucket,
              events: []
            }
            accumulator.push(bucketGroup);
          }
          bucketGroup.events.push(event);
          return accumulator;
        }, [])
      )
      .then( bucketNotifications => {
        this.bucketNotifications = bucketNotifications;
        this.serverless.cli.log(`functions <-- built ${count} events across ${bucketNotifications.length} buckets. `);
      })
  }

  afterFunctions(){
  }

  beforeS3(){
    this.serverless.cli.log("beforeS3 --> ");

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
        .map( bucketConfiguration => {
          
          const s3Notifications = this.currentBucketNotifications.find( currentNotification => currentNotification.bucket === bucketConfiguration.name );

          /*
           * Remove any events that were previously created. No sense in sending them
           *  across again.
           */
          if(s3Notifications && s3Notifications.results.length !== 0) {
            bucketConfiguration.events = bucketConfiguration.events.filter( event => {
              return !s3Notifications.results.find( s3Event => s3Event.Id === this.s3Facade.getId(event) );
            })
          }


          return bucketConfiguration;
        })
        .filter( bucketConfig => bucketConfig.events.length !== 0)
        .map( bucketConfig => this.s3Facade.putLambdaNotification(bucketConfig) )

      return Promise.all(promises)
        .then( results => this.serverless.cli.log(`s3 <-- Complete ${results.length} updates.`) );

    }
  }

  afterS3(){
  }
}

module.exports = S3Deploy;
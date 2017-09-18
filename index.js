'use strict';
var crypto = require('crypto');

class S3Deploy {
  constructor(serverless, options) {
    this.serverless  = serverless;
    this.options     = options;
    this.service     = serverless.service;
    this.provider    = this.serverless.getProvider('aws');
    this.providerConfig = this.service.provider;
    this.functionPolicies = {};

    this.commands    = {
      s3deploy: {
        usage: 'Attaches lambda notification events to existing s3 buckets',
        lifecycleEvents: [
          'events'
        ],
        options: {
          stage: {
            usage: 'Stage of the service',
            shortcut: 's',
            required: false,
          },
          region: {
            usage: 'Region of the service',
            shortcut: 'r',
            required: false,
          },
        },
      },
      s3remove: {
        usage: 'Removes lambda notification events from existing s3 buckets',
        lifecycleEvents: [
          'events'
        ],
        options: {
          stage: {
            usage: 'Stage of the service',
            shortcut: 's',
            required: false,
          },
          region: {
            usage: 'Region of the service',
            shortcut: 'r',
            required: false,
          },
        },
      },
    };
    this.hooks = {

      // Serverless framework event hooks
      'before:deploy:deploy': this.checkBucketsExist.bind(this),
      'after:deploy:deploy': this.afterS3DeployFunctions.bind(this),
      'before:remove:remove': this.s3BucketRemoveEvent.bind(this),

      // External S3 event hooks
      'after:s3deploy:events': this.afterS3DeployFunctions.bind(this),
      'after:s3remove:events': this.s3BucketRemoveEvent.bind(this)

    };
  }

  checkBucketsExist() {

    this.serverless.cli.log(`Checking existing buckets actually exist`);

    let bucketNotifications = this.getBucketNotifications();
    
    //skip empty configs
    if (bucketNotifications.length === 0) {
      return Promise.resolve();
    }

    
    return this.provider.request('S3', 'listBuckets', {}, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`)
      .then((returnedBuckets)=>{

        if(!returnedBuckets.Buckets) {
          return Promise.reject('No buckets returned');  
        }

        const existingBuckets = returnedBuckets.Buckets.reduce((allBuckets, thisBucket) => {
          allBuckets.push(thisBucket.Name);
          return allBuckets;
        }, []);

        const expectedBuckets = bucketNotifications.reduce((allBuckets, thisBucket) => {
          allBuckets.push(thisBucket.Bucket);
          return allBuckets;
        }, []);

        const missingBuckets = expectedBuckets.filter(function (elem) {
            return existingBuckets.indexOf(elem) < 0;
        });

        if(missingBuckets.length > 0) {
          return Promise.reject(`Missing the following buckets: ${missingBuckets.join(',')}`);
        }

        return this.serverless.cli.log('All existing buckets actually exist');

      });
  }

  getBucketNotifications() {

    let funcObjs = this.service.getAllFunctions().map(name => this.service.getFunction(name));
    
    //turn functions into the config objects (flattened)
    let lambdaConfigs = funcObjs.map(obj => this.getLambdaFunctionConfigurationsFromFunction(obj))
    .reduce((flattened, c) => flattened = flattened.concat(c), []);

    //collate by bucket
    return lambdaConfigs.reduce((buckets, c) => {
      // TODO simplify this
      //find existing array with bucket name
      let bucketLambdaConfigs = buckets.find(existing => existing.Bucket === c.bucket);
      //otherwise create it
      if (!bucketLambdaConfigs) {
        bucketLambdaConfigs = { Bucket: c.bucket, NotificationConfiguration: { LambdaFunctionConfigurations: [] } };
        buckets.push(bucketLambdaConfigs);
      }
      //add config to notification
      bucketLambdaConfigs.NotificationConfiguration.LambdaFunctionConfigurations.push(c.config);
      return buckets;
    }, []);

  }

  getFunctionArnFromDeployedStack(info, deployedName) {

    let output = info.gatheredData.outputs.find((out) => {
      return out.OutputValue.indexOf(deployedName) !== -1;
    });

    if(output) {
      return Promise.resolve(output.OutputValue.replace(/:\d+$/, '')); //unless using qualifier?
    }

    // Unable to find the function in the output
    // Check if they explicitly stopped function versioning
    if(info.serverless.service.provider.versionFunctions === false) {
      
      return this.provider.request('Lambda', 'getFunction', {FunctionName: deployedName}, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`).then((functionInfo) => {
        return functionInfo.Configuration.FunctionArn;
      });

    }

    return Promise.reject('Unable to retreive function arn');
  }

  getLambdaFunctionConfigurationFromDeployedStack(info, bucket, cfg) {

    // TODO make this a separate method
    let results = info.gatheredData.info;

    let deployed = results.functions.find((fn) => fn.deployedName === cfg.LambdaFunctionArn);

    if (!deployed) {
      throw new Error("It looks like the function has not yet been deployed. You must use 'sls deploy' before doing 'sls s3deploy.");
    }
  
    return this.getFunctionArnFromDeployedStack(info, deployed.deployedName).then((arn) => {

      // Build our object we hash to use in the statement id, and for informational text output
      var filterText = "", hashObj = {bucket: bucket['Bucket'], Events: cfg['Events']}
      if ("Filter" in cfg) { 
        hashObj['Filter'] = cfg['Filter'];
        filterText = "for" 
        if (cfg['Filter']['Key']['FilterRules'][0]['Name'] == 'prefix') {
          filterText += " prefix: " + cfg['Filter']['Key']['FilterRules'][0]['Value']
        }
        if (cfg['Filter']['Key']['FilterRules'][0]['Name'] == 'suffix') {
          filterText += " suffix: " + cfg['Filter']['Key']['FilterRules'][0]['Value']
        }
        if (cfg['Filter']['Key']['FilterRules'].length > 1) {
          if (cfg['Filter']['Key']['FilterRules'][1]['Name'] == 'prefix') {
            filterText += " prefix: " + cfg['Filter']['Key']['FilterRules'][1]['Value']
          }
          if (cfg['Filter']['Key']['FilterRules'][1]['Name'] == 'suffix') {
            filterText += " suffix: " + cfg['Filter']['Key']['FilterRules'][1]['Value']
          }
        }
      }

      //replace placeholder ARN with final
      cfg.LambdaFunctionArn = arn;
      this.serverless.cli.log(`Attaching ${deployed.deployedName} to ${bucket.Bucket} ${cfg.Events} ${filterText} ...`);
      
      //attach the bucket permission to the lambda
      return {
        Action: "lambda:InvokeFunction",
        FunctionName: deployed.deployedName,
        Principal: 's3.amazonaws.com',
        StatementId: `${deployed.deployedName}-` + crypto.createHash('md5').update(JSON.stringify(hashObj)).digest("hex"),
        //Qualifier to point at alias or version
        SourceArn: `arn:aws:s3:::${bucket.Bucket}`
      };

    });
  }

  afterS3DeployFunctions() {
    
    let bucketNotifications = this.getBucketNotifications();

    //skip empty configs
    if (bucketNotifications.length === 0) {
      return Promise.resolve();
    }

    //find the info plugin
    let info = this.serverless.pluginManager.getPlugins().find(i => i.constructor.name === 'AwsInfo');

    //use it to get deployed functions to check for things to attach to
    return info.getStackInfo().then(() => {

      let permsPromises = [];
      let buckets = [];
      let configPromises = [];

      bucketNotifications.forEach((bucket) => {

        //check this buckets notifications and replace the arn with the real one
        bucket.NotificationConfiguration.LambdaFunctionConfigurations.forEach((cfg) => {
          configPromises.push(this.getLambdaFunctionConfigurationFromDeployedStack(info, bucket, cfg));
        });

        //attach the event notification to the bucket
        buckets.push(bucket);

      });

      //run permsPromises before buckets
      return Promise.all(configPromises)
      .then((permConfigs) => { 
        permConfigs.map((permConfig) => {
          permsPromises.push(this.lambdaPermApi(permConfig));
        });
        return Promise.all(permsPromises);
      }).then(() => Promise.all(buckets.map((b) => this.s3EventApi(b))));
    })
    .then(() => this.serverless.cli.log('Done.'));
  }

  getLambdaFunctionConfigurationsFromFunction(functionObj) {
    return functionObj.events
    .filter(event => event.existingS3)
    .map(event => {
      let bucketEvents = event.existingS3.events || event.existingS3.bucketEvents || ['s3:ObjectCreated:*'];
      let eventRules = event.existingS3.rules || event.existingS3.eventRules || [];

      const returnObject = {
        bucket: event.existingS3.bucket,
        config: {
          Id: 'trigger-' + functionObj.name + '-when-' + bucketEvents.join().replace(/[\.\:\*]/g,'') + '-' + crypto.createHash('md5').update(JSON.stringify({bucketEvents, eventRules})).digest("hex"),
          LambdaFunctionArn: functionObj.name,
          Events: bucketEvents
        }
      };

      if (eventRules.length > 0) {
        returnObject.config.Filter = {};
        returnObject.config.Filter.Key = {};
        returnObject.config.Filter.Key.FilterRules = [];
      }

      eventRules.forEach(rule => {
        Object.keys(rule).forEach(key => {
          returnObject.config.Filter.Key.FilterRules.push({
            Name: key,
            Value: rule[key]
          });
        });
      });

      return returnObject;
    })
  }

  s3EventApi(cfg) {
    //this is read/modify/put
    return this.provider.request('S3', 'getBucketNotificationConfiguration', { Bucket: cfg.Bucket }, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`)
    .then((bucketConfig) => {
      // This updates existing S3 notifications (or it tries to)
      var servicePrefix = "", found = false;
      for (var i = 0; i < cfg['NotificationConfiguration']['LambdaFunctionConfigurations'].length; i++) {
        // This is something we use below to detect whether existing notifications came from us, so we don't delete others notifications
        servicePrefix = cfg['NotificationConfiguration']['LambdaFunctionConfigurations'][i]['Id'].slice(0, -32)
        // And to track if we found it
        found = false;
        for (var j = 0; j < bucketConfig['LambdaFunctionConfigurations'].length; j++) {
          if (bucketConfig['LambdaFunctionConfigurations'][j]['Id'] == cfg['NotificationConfiguration']['LambdaFunctionConfigurations'][i]['Id']) {
            found = true; bucketConfig['LambdaFunctionConfigurations'][j] = cfg['NotificationConfiguration']['LambdaFunctionConfigurations'][i];
          }
        }
        if (!found) { bucketConfig['LambdaFunctionConfigurations'].push(cfg['NotificationConfiguration']['LambdaFunctionConfigurations'][i]) }
      }
      
      // This removes entries that are no longer in your notifications config
      var deleteIndexes = []
      for (var j = 0; j < bucketConfig['LambdaFunctionConfigurations'].length; j++) {
        found = false;
        for (var i = 0; i < cfg['NotificationConfiguration']['LambdaFunctionConfigurations'].length; i++) {
          if (bucketConfig['LambdaFunctionConfigurations'][j]['Id'] == cfg['NotificationConfiguration']['LambdaFunctionConfigurations'][i]['Id']) {
            found = true;
          }
        }
        // Check if this has a prefix of our service name before removing this from the notification configuration, so we don't accidentally delete notifications from other systems/stacks/people
        if (!found && bucketConfig['LambdaFunctionConfigurations'][j]['Id'].startsWith(servicePrefix)) {
          deleteIndexes.push(j)
        }
      }
      // Have to do this separately, can't do it within' the for loop above or the for loop fails
      deleteIndexes.forEach(function (index) {
        bucketConfig['LambdaFunctionConfigurations'].splice(index, 1);
      })
      
      return { Bucket: cfg.Bucket, NotificationConfiguration: bucketConfig };

    }).then((cfg) => {
      return this.provider.request('S3', 'putBucketNotificationConfiguration', cfg, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`);
    });
  }

  lambdaPermApi(cfg) {
    //detect existing config with a read call
    //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#getPolicy-property
    var existingPolicyPromise = null;
    if (this.functionPolicies[cfg.FunctionName]) {
      existingPolicyPromise = Promise.resolve(this.functionPolicies[cfg.FunctionName]);
    } else {
      existingPolicyPromise = this.provider.request('Lambda', 'getPolicy', { FunctionName: cfg.FunctionName }, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`)
      .then((result) => {
        let policy = JSON.parse(result.Policy);
        this.functionPolicies[cfg.FunctionName] = policy;
        return policy;
      })
      .catch((err) => {
        if(err.statusCode === 404){
          return Promise.resolve();
        }else{
          throw err;
        }
      });
    }

    return existingPolicyPromise.then((policy) => {
      //find our id
      let ourStatement = policy && policy.Statement.find((stmt) => stmt.Sid === cfg.StatementId);
      if (ourStatement) {
        //delete the statement before adding a new one
        return this.provider.request('Lambda', 'removePermission', { FunctionName: cfg.FunctionName, StatementId: cfg.StatementId }, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`);
      } else {
        //just resolve
        return Promise.resolve();
      }
    })
    .catch((err) => {
      //this one is going to handle the issue when Policy Permission not found.
      if(err.statusCode === 404 && err.toString() === 'ServerlessError: The resource you requested does not exist.'){
        return Promise.resolve();
      } else {
        return Promise.reject(err);
      }
    })
    .then(() => {
      //put the new policy
      return this.provider.request('Lambda', 'addPermission', cfg, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`);
    });
  }

  s3BucketRemoveEvent () {

    let bucketNotifications = this.getBucketNotifications();

    //skip if there are no configurations
    if (bucketNotifications.length === 0) {
      return Promise.resolve();
    }

    return Promise.all(bucketNotifications.map((cfg) => {

      return this.provider.request('S3', 'getBucketNotificationConfiguration', { Bucket: cfg.Bucket }, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`)
          .then((bucketConfig) => {

            let notificationConfig = {remove: false, params: {}};

            //find lambda with our ARN or ID, replace it or add a new one
            cfg.NotificationConfiguration.LambdaFunctionConfigurations.forEach((ourcfg) => {
              
              this.serverless.cli.log(`Removing ${ourcfg.LambdaFunctionArn} from ${cfg.Bucket} ${ourcfg.Events}...`);

              let currentConfigIndex = bucketConfig.LambdaFunctionConfigurations.findIndex((s3cfg) => ourcfg.LambdaFunctionArn === s3cfg.LambdaFunctionArn || ourcfg.Id === s3cfg.Id);
              if (currentConfigIndex !== -1) {

                //just remove it
                bucketConfig.LambdaFunctionConfigurations.splice(currentConfigIndex, 1);
                notificationConfig.remove = true;
              }

            });

            notificationConfig.params = { Bucket: cfg.Bucket, NotificationConfiguration: bucketConfig };

            return notificationConfig;

          })
          .then((cfg) => {
            
            if(!cfg.remove) {
              return;
            }

            return this.provider.request('S3', 'putBucketNotificationConfiguration', cfg.params, `${this.serverless.service.provider.stage}`, `${this.serverless.service.provider.region}`);
            
          });

      }))
      .then(() => this.serverless.cli.log('Removed all existing bucket events'));

  }

}

module.exports = S3Deploy;

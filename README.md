# Why?
Overcomes the CloudFormation limitation on attaching an event to an uncontrolled bucket, for Serverless.com 1.0+. See [this stackoverflow issue](http://serverfault.com/questions/610788/using-cloudformation-with-an-existing-s3-bucket) for more information.

# What?
Attach an S3 event to a function defined within your Serverless.com 1.0+ service. Executed via ```sls s3deploy```.

# How?

**NPM dependency**
_Looking to eliminate this step, as it will place the dependency within your deployed code._
```
> npm install serverless-external-s3-event
```

**Declare the plugin in your serverless.yml**
```serverless.yml

plugins:
 - serverless-external-s3-event

```

**Give your deploy permission to access the bucket.**
The BUCKET_NAME variable within provider.iamRoleStatements.Resource.Fn::Join needs to be replaced with the name of the bucket you want to attach your event(s) to.  If there are multiple buckets you want to attach events to add a new item for each bucket.

```serverless.yml

provider:
  name: aws
  runtime: nodejs4.3
  iamRoleStatements:
    -  Effect: "Allow"
       Action:
         - "s3:ListBucket"
         - "s3:PutObject"
       Resource:
         Fn::Join:
           - ""
           - - "arn:aws:s3:::"
             - "Ref" : "ServerlessDeploymentBucket"
    -  Effect: "Allow"
       Action:
         - "s3:PutBucketNotification"
       Resource:
         Fn::Join:
           - ""
           - - "arn:aws:s3:::BUCKET_NAME" 
           - - "arn:aws:s3:::BUCKET_OTHERNAME" 
```

**Attach an event to your target function.**
Add an -existingS3 event definition under 'events' of your function declaration. The bucketEvents value is optional. If omitted it will default to a single entry for "s3:ObjectCreated:*".

```serverless.yml

functions:
  someFunction:
    handler: index.handler
    timeout: 60
    events:
      - existingS3:
          bucket: BUCKET_NAME
          bucketEvents: 
            - s3:ObjectCreated:*
```

**Run the command.**
_I could not figure out how to hook into the existing deploy behaviors built into Serverless.com's deploy command. So as a result you have to run a separate command AFTER you do ```sls deploy```._

```
> sls deploy
Serverless: Zipping service...
Serverless: Uploading CloudFormation file to S3...
Serverless: Removing old service versions...
Serverless: Uploading .zip file to S3...
Serverless: Updating Stack...
Serverless: Checking stack update progress...
..
Serverless: Deployment successful!

Service Information
service: service-name
stage: stage
region: region
endpoints:
  None
functions:
  someFunction: arn:aws:lambda:region:accountid:function:service-name-stage-someFunction

> sls s3deploy
Attaching event(s) to: someFunction
Done.

```

**I haz an error**
The only one I see, and quite regularly during my testing, is a result of having the wrong bucket name configured in the serverless.yml, either in the IAM configuration providing permissions or in the function definition where I'm attaching the event. Make sure your bucket names are right.

```
>sls s3deploy

Attaching event(s) to: BUCKET_NAME

  Invalid Argument ---------------------------------------

     Unable to validate the following destination configurations

     For debugging logs, run again after setting SLS_DEBUG env var.

  Get Support --------------------------------------------
     Docs:          docs.serverless.com
     Bugs:          github.com/serverless/serverless/issues

     Please report this error. We think it might be a bug.
```
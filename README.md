# Why?
Overcomes the CloudFormation limitation on attaching an event to an uncontrolled bucket, for Serverless.com 1.11.0+. See [this stackoverflow issue](http://serverfault.com/questions/610788/using-cloudformation-with-an-existing-s3-bucket) for more information.

# How?

**1. NPM dependency**
_Looking to eliminate this step, as it will place the dependency within your deployed code._
```
> npm install serverless-plugin-existing-s3
```

**Declare the plugin in your serverless.yml**
```serverless.yml

plugins:
 - serverless-plugin-existing-s3

```

**2. Give your deploy permission to access the bucket.**
The BUCKET_NAME variable within provider.iamRoleStatements.Resource.Fn::Join needs to be replaced with the name of the bucket you want to attach your event(s) to.  If there are multiple buckets you want to attach events to add a new item for each bucket.

```serverless.yml
provider:
  name: aws
  runtime: nodejs4.3
  iamRoleStatements:
    ...
    -  Effect: "Allow"
       Action:
         - "s3:PutBucketNotification"
       Resource:
         Fn::Join:
           - ""
           - - "arn:aws:s3:::BUCKET_NAME or *"
```

**3. Attach an event to your target function.**
Add an -existingS3 event definition under 'events' of your function declaration. The 'events' value is optional under your -existingS3 event and if omitted, it will default to a single entry for "s3:ObjectCreated:*".

The rules property is optional and can contain either a prefix, suffix or both of these properties as a rule for when the event will trigger.

Note: The bucketEvents and eventRules attributes introduced in 1.0.1 will still work, but will likely be deprecated in the future.

```serverless.yml

functions:
  someFunction:
    handler: index.handler
    events:
      - existingS3:
          bucket: BUCKET_NAME
          events:
            - s3:ObjectCreated:*
          rules:
            - prefix: images/
            - suffix: .jpg
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

# I haz an errawr

The only one I see, and quite regularly during my testing, is a result of having the wrong bucket name configured in the serverless.yml, either in the IAM configuration providing permissions or in the function definition where I'm attaching the event. Make sure your bucket names are right.

If you are really stuck, open an issue at https://github.com/matt-filion/serverless-external-s3-event/issues


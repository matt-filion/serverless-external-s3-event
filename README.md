# Why?
Overcomes the CloudFormation limitation on attaching an event to an uncontrolled bucket, for Serverless.com 1.9+. See [this stackoverflow issue](http://serverfault.com/questions/610788/using-cloudformation-with-an-existing-s3-bucket) for more information.

The serverless deploy command (```sls deploy```) will trigger a check to ensure the buckets already exist before deployment.
Post successfull deployment, the bucket event will be attached.

The serverless remove command (```sls remove```) will remove the bucket event before removing the cloudformation stack

# How?

**1. NPM dependency**
_Looking to eliminate this step, as it will place the dependency within your deployed code._
```
> npm install serverless-external-s3-event
```

**Declare the plugin in your serverless.yml**
```serverless.yml

plugins:
 - serverless-external-s3-event

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
           - - "arn:aws:s3:::BUCKET_NAME"
           - - "arn:aws:s3:::BUCKET_OTHERNAME"
```

**3. Attach an event to your target function.**
Add an -existingS3 event definition under 'events' of your function declaration. The 'events' value is optional under your -existingS3 event and if omitted, it will default to a single entry for "s3:ObjectCreated:*".

The rules property is optional and can contain either a prefix, suffix or both of these properties as a rule for when the event will trigger.

Note: The bucketEvents and eventRules attributes introduced in 1.0.1 will still work, but will likely be deprecated in the future.

```serverless.yml

functions:
  someFunction:
    handler: index.handler
    timeout: 60
    events:
      - existingS3:
          bucket: BUCKET_NAME
          events:
            - s3:ObjectCreated:*
          rules:
            - prefix: images/
            - suffix: .jpg
```

**Manually invoking the deploy command.**
_To manually attach the event, you can run ```sls s3deploy```._
_To manually remove the event, you can run ```sls s3remove```._


```

> sls s3deploy
Attaching event(s) to: someFunction
Done.

```
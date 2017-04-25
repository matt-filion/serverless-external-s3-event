'use strict'

// Called when file is uploaded to S3
module.exports.onS3Upload = (event, context, callback) => {
  console.log('File uploaded to', process.env.S3_BUCKET_NAME, ':', event.Records && event.Records[0] && event.Records[0].s3)
  callback(null, {})
}

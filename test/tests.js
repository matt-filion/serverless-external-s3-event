'use strict'

/**
 * Test script for serverless-plugin-external-s3-event
 * Kenneth Falck <kennu@sc5.io> 2017
 *
 * You should set AWS_DEFAULT_PROFILE and AWS_REGION before running this.
 */

const AWS = require('aws-sdk')
const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const childProcess = require('child_process')
const path = require('path')
const chalk = require('chalk')

chai.use(chaiAsPromised)
const assert = chai.assert
const CLOUDFORMATION_STACK = 'serverless-external-s3-event-test-test'
const cloudformation = new AWS.CloudFormation()
const s3 = new AWS.S3()
const SLS = path.join(__dirname, '/node_modules', '.bin', 'sls')

function sls(args) {
  console.log('   ', chalk.gray.dim('$'), chalk.gray.dim('sls ' + args.join(' ')))
  const dir = path.join(__dirname, 'service')
  return new Promise((resolve, reject) => {
    const child = childProcess.execFile(SLS, args, {
      cwd: dir,
    }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve(stdout)
    })
    child.stdout.on('data', data => {
      process.stdout.write(chalk.gray.dim(data))
    })
    child.stderr.on('data', data => {
      process.stderr.write(chalk.red(data))
    })
  })
}

describe('Service Deployment', () => {
  let stackInfo = null
  let s3BucketName = null

  before(() => {
    // Deploy Serverless stack before tests
    return sls(['deploy', '-r', process.env.AWS_REGION])
  })
  after(() => {
    // Remove Serverless stack after tests
    return sls(['remove', '-r', process.env.AWS_REGION])
  })
  it('creates CloudFormation stack', () => {
    return Promise.resolve()
    .then(() => {
      return cloudformation.describeStacks({
        StackName: CLOUDFORMATION_STACK,
      })
      .promise()
    })
    .then(response => {
      assert.equal(response.Stacks[0].StackStatus, 'UPDATE_COMPLETE')
      stackInfo = response.Stacks[0]
    })
  })
  it('creates S3 bucket', () => {
    stackInfo.Outputs.map(output => {
      if (output.OutputKey === 'TestBucket') {
        s3BucketName = output.OutputValue
      }
    })
    assert.isOk(s3BucketName)
    assert.equal(s3BucketName, 'serverless-external-s3-event-test-test-' + process.env.AWS_REGION)
  })
  it('creates S3 event subscription', () => {
    return Promise.resolve()
    .then(() => {
      return sls(['s3deploy', '-r', process.env.AWS_REGION])
    })
    .then(() => {
      return s3.getBucketNotificationConfiguration({
        Bucket: s3BucketName,
      })
      .promise()
    })
    .then(response => {
      assert.equal(response.LambdaFunctionConfigurations.length, 1)
      const config = response.LambdaFunctionConfigurations[0]
      assert.isOk(config.Id)
      assert.isOk(config.LambdaFunctionArn)
      assert.equal(config.Events[0], 's3:ObjectCreated:*')
      assert.equal(config.Filter.Key.FilterRules.length, 2)
      assert.equal(config.Filter.Key.FilterRules.filter(rule => rule.Name === 'Prefix')[0].Value, 'images/')
      assert.equal(config.Filter.Key.FilterRules.filter(rule => rule.Name === 'Suffix')[0].Value, '.jpg')
    })
  })
})

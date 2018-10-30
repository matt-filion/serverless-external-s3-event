'use strict';

class LambdaPermissions {

  constructor(provider) {
    this.provider = provider;
  }

  getId(functionName,bucketName) {
    const id = `exS3-v2-${functionName}-${bucketName.replace(/[\.\:\*]/g,'')}`;
    if (id.length < 100) { return id }
    return id.substring(0,68) + require('crypto').createHash('md5').update(id).digest("hex")
  }

  createPolicy(functionName,bucketName,passthrough){
    let region = (this.provider.sdk && this.provider.sdk.config && this.provider.sdk.config.region) || undefined;
    const payload = {
      Action: "lambda:InvokeFunction",
      FunctionName: functionName,
      Principal: 's3.amazonaws.com',
      StatementId: this.getId(functionName,bucketName),
      SourceArn: `arn:${(region && /^cn\-/.test(region)) ? 'aws-cn' : 'aws'}:s3:::${bucketName}`
    }
    return this.provider.request('Lambda', 'addPermission', payload)
      .then( () => this.getPolicy(functionName, passthrough) )
  }

  getPolicy(functionName,passthrough) {
    return this.provider.request('Lambda', 'getPolicy', { FunctionName: functionName })
      .then( results => Object.assign({},{ statement: this.getStatement(this.asJson(results.Policy),passthrough), passthrough }) )
      .catch( error => Object.assign({}, { error:error.message, passthrough } ) );
  }

  getStatement(policy,event) {
    const policyId = this.getId(event.name, event.existingS3.bucket); 
    console.log("policyId",policyId);
    return policy.Statement.find( statement => statement.Sid === policyId );
  }

  asJson(value){
    return typeof value === 'string' ? JSON.parse(value) : value
  }
}

module.exports.Lambda = LambdaPermissions;

'use strict';

class LambdaPermissions {

  constructor(options, provider) {
    this.options = options;
    this.provider = provider;
  }

  getId(functionName,bucketName) {
    const id = `exS3-v2-${functionName}-${bucketName.replace(/[\.\:\*]/g,'')}`;
    if (id.length < 100) { return id }
    return id.substring(0,68) + require('crypto').createHash('md5').update(id).digest("hex")
  }

  createPolicy(functionName,bucketName,passthrough){
    const payload = {
      Action: "lambda:InvokeFunction",
      FunctionName: functionName,
      Principal: 's3.amazonaws.com',
      StatementId: this.getId(functionName,bucketName),
      SourceArn: `arn:aws:s3:::${bucketName}`
    };
    if (this.options.alias) {
      payload['Qualifier'] = this.options.alias;
    }
    return this.provider.request('Lambda', 'addPermission', payload)
      .then( () => this.getPolicy(functionName, passthrough) )
  }

  getPolicy(functionName,passthrough) {
    const payload = {FunctionName: functionName};
    if (this.options.alias) {
      payload['Qualifier'] = this.options.alias;
    }
    return this.provider.request('Lambda', 'getPolicy', payload)
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


/*
 * Get it, cuz he is a 'transformer'....
 */
class OptimusPrime {
  constructor(lambdaPermissions){
    this.lambdaPermissions = lambdaPermissions;
  }

  functionsToEvents(functions) {
    const names = Object.keys(functions);
    return names

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
  }

  eventsToBucketGroups(events){
    return events
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
  }

}


module.exports = OptimusPrime;
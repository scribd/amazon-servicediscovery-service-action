const core = require('@actions/core');
const {ServiceDiscoveryClient, CreateServiceCommand, DeleteServiceCommand, ListServicesCommand} = require('@aws-sdk/client-servicediscovery');
const _ = require('lodash');


/**
 *
 * ERRORS
 * Provides signals for controlling application behavior.
 *
 *****************************************************************************************/

/**
 * An error type representing a failure to find a service
 * @extends Error
 */
class NotFoundException extends Error {
  /**
   * @param {String} message Error message
   */
  constructor(message) {
    super(message);
    this.name = 'NotFoundException';
    this.message = message;
    this.stack = (new Error()).stack;
  }
}


/**
 *
 * PARAMETER CONVERSION
 * Converts the supplied (create) parameters into the formats for describe, update, and delete.
 *
 *****************************************************************************************/

/**
 * return only defined properties
 * @param {Object} obj
 * @return {Object} sans keynames with 'undefined' values'
 */
function omitUndefined(obj) {
  return _.pickBy(obj, (value, key) => {
    return value !== undefined;
  });
}

/**
 * Filter parameters according to createService API
 * @param {Object} parameters All the parameters
 * @return {Object} Filtered parameters
 */
function createServiceInputs(parameters) {
  return omitUndefined(
      {
        Name: parameters.Name,
        Description: parameters.Description,
        DnsConfig: parameters.DnsConfig,
        HealthCheckConfig: parameters.HealthCheckConfig,
        HealthCheckCustomConfig: parameters.HealthCheckCustomConfig,
        NamespaceId: parameters.NamespaceId,
        Tags: parameters.Tags,
        Type: parameters.Type,
      },
  );
}

/**
 * Filter parameters according to deleteService API
 * @param {Object} parameters All the parameters
 * @return {Object} Filtered parameters
 */
function deleteServiceInputs(parameters) {
  return {Id: parameters.Id};
}

/**
 * get the Namespace Id
 * @param {Object} parameters
 * @return {String} NamespaceId
 * @throws {Error}
 */
function getNamespaceId(parameters) {
  const root = parameters.NamespaceId;
  const dnsConfig = parameters.DnsConfig ? parameters.DnsConfig.NamespaceId : undefined;
  switch ([!!root, !!dnsConfig].toString()) {
    case 'true,false':
      return root;
    case 'false,true':
      return dnsConfig;
    case 'true,true':
      throw new Error('`namespace-id` must be defined either as an input, or as part of `dns-config` (not both).');
    default:
      core.debug(`Error: parsing namespace id from ${JSON.stringify(parameters)}`);
      throw new Error('`namespace-id` must be defined either as an input, or as part of `dns-config`.');
  }
}


/**
 *
 * AWS CALLS
 * Take the supplied parameters and send them to AWS
 *
 *****************************************************************************************/

/**
 * List Services
 * @param {@aws-sdk/client-servicediscovery/ServiceDiscoveryClient} client client
 * @param {String} NamespaceId Namespace ID of the services
 * @param {String} NextToken NextToken (optional)
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/ListServicesResponse}
 * @throws {NotFoundException}
 */
async function listServices(client, NamespaceId, NextToken) {
  const input = {
    Filters: [{Condition: 'EQ', Name: 'NAMESPACE_ID', Values: [NamespaceId]}],
  };
  if (NextToken) {
    Object.assign(input, {NextToken: NextToken});
  }
  const command = new ListServicesCommand(input);
  const response = await client.send(command);
  return response;
}

/**
 * Find Service
 * @param {Array} serviceList List of services
 * @param {String} Name Name of the service
 * @return {@aws-sdk/client-servicediscovery/ServiceSummary} or undefined
 */
function findService(serviceList, Name) {
  return serviceList.find((service) => service.Name === Name);
}

/**
 * Fetch Service or throw an error
 * @param {@aws-sdk/client-servicediscovery/ServiceDiscoveryClient} client client
 * @param {Object} parameters Parameters describing the Service
 * @param {Object} NextToken Recurse with the next token
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/ServiceSummary} or {@aws-sdk/client-servicediscovery/ListServicesCommandOutput}
 */
async function describeService(client, parameters, NextToken) {
  let response;
  if (NextToken) {
    response = await listServices(client, getNamespaceId(parameters), NextToken);
  } else {
    response = await listServices(client, getNamespaceId(parameters));
  }

  if (response && response.Services) {
    const found = findService(response.Services, parameters.Name);
    if (found) {
      return found;
    } else if (response.NextToken) {
      return describeService(client, parameters, NextToken);
    } else {
      throw new NotFoundException(`Service with Name: ${parameters.Name} not found.`);
    }
  } else {
    throw new Error(`Error searching for Service: Response: ${JSON.stringify(response)}`);
  }
}

/**
 * Create Service or throw an error
 * @param {@aws-sdk/client-servicediscovery/ServiceDiscoveryClient} client client
 * @param {Object} parameters Parameters describing the Service
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/CreateServiceCommandOutput}
 */
async function createService(client, parameters) {
  const command = new CreateServiceCommand(parameters);
  const response = await client.send(command);
  return response;
}

/**
 * Create Service or throw an error
 * @param {@aws-sdk/client-servicediscovery/ServiceDiscoveryClient} client client
 * @param {Object} parameters Parameters describing the Service
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/DeleteServiceCommandOutput}
 */
async function deleteService(client, parameters) {
  const command = new DeleteServiceCommand(parameters);
  const response = await client.send(command);
  return response;
}


/**
 *
 * UPDATE UTILS
 * Utility functions for updating the Service
 *
 *****************************************************************************************/


/**
 *
 * FIND/CREATE/DELETE BUSINESS LOGIC
 *
 *****************************************************************************************/

/**
 * Find or create the Service
 * @param {@aws-sdk/client-servicediscovery/ServiceDiscoveryClient} client client
 * @param {Object} parameters Parameters describing the Service
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/ServiceSummary} or {@aws-sdk/client-servicediscovery/CreateServiceCommandOutput}
 */
async function createDescribeService(client, parameters) {
  try {
    const found = await describeService(client, parameters);
    core.info(`Found ${parameters.Name}`);
    return found;
  } catch (err) {
    if (err.name === 'NotFoundException') {
      core.info(`Unable to find ${parameters.Name}. Creating newly.`);
      return await createService(client, createServiceInputs(parameters));
    } else {
      throw err;
    }
  }
}

/**
 *
 * GITHUB ACTIONS INTERFACE
 * - Gets parameters from the user.
 * - Posts results as output.
 *
 *****************************************************************************************/

/**
 * @param {Error} err The original error
 * @param {String} param The parameter that was being evaluated
 * @param {String} s The supplied string
 * @return {Error} The Error indicating invalid JSON, if JSON, else err.
 */
function handleGetParameterErrors(err, param, s) {
  if (err instanceof SyntaxError) {
    return new Error(`Invalid JSON for ${param}: ${err.message}: ${s}`);
  } else {
    return err;
  }
}

/**
 * Fetch parameters from environment
 * @return {Object} parameters
 */
function getParameters() {
  const parameters = {
    Name: core.getInput('name', {required: false}),
    Description: core.getInput('description', {required: false}),
    NamespaceId: core.getInput('namespace-id', {required: false}),
    Type: core.getInput('type', {required: false}),
    action: core.getInput('action', {required: false}) || 'create',
    Id: core.getInput('id', {required: false}),
  };

  Object.entries({
    DnsConfig: 'dns-config',
    HealthCheckConfig: 'health-check-config',
    HealthCheckCustomConfig: 'health-check-custom-config',
    Tags: 'Tags',
  }).forEach(([key, value]) => {
    const s = core.getInput(value, {required: false});
    if (s) {
      let t;
      try {
        t = JSON.parse(s);
      } catch (err) {
        throw handleGetParameterErrors(err, key, s);
      }
      Object.assign(parameters, {[key]: t});
    }
  });

  return _.pickBy(
      parameters,
      (value, key) => {
        return value !== '';
      },
  );
}

/**
 * Posts the results of the action to GITHUB_ENV
 * @param {Object} response Response response
 */
function postToGithub(response) {
  let arn;
  if (response.Arn) {
    arn = response.Arn;
  } else if (response.Service && response.Service.Arn) {
    arn = response.Service.Arn;
  } else {
    throw new Error('Unable to determine ARN');
  }
  const id = arn.match(/^arn:aws:servicediscovery:[\w-]*:[0-9]*:service\/(srv-[\w]+)?/)[1];
  core.info('ARN found or created: ' + arn);
  core.setOutput('response', response);
  core.setOutput('arn', arn);
  core.setOutput('id', id);
}


/**
 *
 * ENTRYPOINT
 *
 *****************************************************************************************/

/**
 * Executes the action
 * @return {Promise} that resolves to {@aws-sdk/client-servicediscovery/ServiceSummary} or {@aws-sdk/client-servicediscovery/CreateServiceCommandOutput}
 */
async function run() {
  const client = new ServiceDiscoveryClient({
    customUserAgent: 'amazon-servicediscovery-service-for-github-actions',
  });

  client.middlewareStack.add((next, context) => (args) => {
    core.debug(`Middleware sending ${context.commandName} to ${context.clientName} with: ${JSON.stringify(Object.assign({}, args.request, {body: JSON.parse(args.request.body)}))}`);
    return next(args);
  },
  {
    step: 'build', // add to `finalize` or `deserialize` for greater verbosity
  },
  );

  // Get input parameters
  const parameters = getParameters();
  let response;
  if (parameters.action == 'delete') {
    response = await deleteService(client, deleteServiceInputs(parameters));

    core.setOutput('response', response);
    if (response.$metadata.httpStatusCode === 200) {
      core.info(`Successfully deleted service with Id: ${parameters.Id}`);
    } else {
      throw new Error(`Failed to delete service: ${JSON.stringify(response)}`);
    }
  } else {
    response = await createDescribeService(client, parameters);
    postToGithub(response);
  }

  return response;
}

/* istanbul ignore next */
if (require.main === module) {
  run().catch((err) => {
    const httpStatusCode = err.$metadata ? err.$metadata.httpStatusCode : undefined;
    core.setFailed(`${err.name} (Status code: ${httpStatusCode}): ${err.message}`);
    core.debug(`Received error: ${JSON.stringify(err)}`).catch(() => { return err });
    core.debug(err.stack);
    process.exit(1);
  });
}

/* For testing */
module.exports = {
  createDescribeService,
  createService,
  createServiceInputs,
  deleteService,
  deleteServiceInputs,
  describeService,
  findService,
  getNamespaceId,
  getParameters,
  listServices,
  postToGithub,
  run,
  NotFoundException,
};

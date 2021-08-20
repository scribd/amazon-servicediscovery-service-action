const i = require('./index');

jest.mock('@actions/core');
const core = require('@actions/core');

jest.mock('@aws-sdk/client-servicediscovery');
const {ServiceDiscoveryClient, ListServicesCommand, Service} = require('@aws-sdk/client-servicediscovery');
ServiceDiscoveryClient.send = jest.fn();


/**
 *
 * PARAMETER DEFINITIONS
 *
 *****************************************************************************************/

const mockDnsConfig = JSON.stringify(
    {
      'DnsRecords': [
        {
          'TTL': 10,
          'Type': 'SRV',
        },
      ],
      // 'NamespaceId': String, // Do not specify if also specified as a parameter
      'RoutingPolicy': 'WEIGHTED', // The routing policy that you want to apply to all Route 53 DNS records that AWS Cloud Map creates when you register an instance and specify this service.
    },
);

const mockHealthCheckConfig = JSON.stringify(
    {
      'FailureThreshold': 3,
      'ResourcePath': '/',
      'Type': 'HTTP', // HTTP is the only valid value for this property.
    },
);

const parameters = {
  Name: 'my-service',
  Description: 'description',
  DnsConfig: mockDnsConfig,
  HealthCheckConfig: mockHealthCheckConfig,
  NamespaceId: 'ns-examplenamespace',
  Tags: [{key: 'test', value: 'test'}],
  Type: 'HTTP',
  action: 'create',
  Id: 'srv-abc12345',
};

const createServiceInputs = {
  Name: 'my-service',
  Description: 'description',
  DnsConfig: mockDnsConfig,
  HealthCheckConfig: mockHealthCheckConfig,
  NamespaceId: 'ns-examplenamespace',
  Tags: [{key: 'test', value: 'test'}],
  Type: 'HTTP',
};

const deleteServiceInputs = {
  Id: 'srv-abc12345',
};

/**
 *
 * MOCKED RESPONSES
 *
 *****************************************************************************************/

const createdOrFoundService = {
  Arn: 'arn:aws:servicediscovery:us-east-1:1234567890:service/srv-abc12345',
  Create: new Date(),
  Description: 'Description',
  DnsConfig: mockDnsConfig,
  HealthCheckConfig: mockHealthCheckConfig,
  Id: 'srv-abc12345',
  Name: 'my-service',
  Type: 'HTTP',
};

const notMyService = {
  Arn: 'arn:aws:servicediscovery:us-east-1:1234567890:service/srv-xyz12345',
  Create: new Date(),
  Description: 'Description',
  DnsConfig: mockDnsConfig,
  HealthCheckConfig: mockHealthCheckConfig,
  Id: 'srv-xyz12345',
  Name: 'not-my-service',
  Type: 'HTTP',
};

// ListService response with my-service.
const createdOrFoundResponse = {
  $metadata: {
    httpStatusCode: 200,
  },
  NextToken: 'nextToken',
  Services: [notMyService, createdOrFoundService, notMyService],
};

const createdResponse = {
  $metadata: {
    httpStatusCode: 201,
  },
  Service: createdOrFoundService,
};

// ListServices response without my-service.
// Filter currently only supports NAMESPACE_ID.
const missingResponse = {
  $metadata: {
    httpStatusCode: 200,
  },
  Services: [notMyService],
};

const deletedResponse = {
  $metadata: {
    httpStatusCode: 200,
  },
};

const genericFailureResponse = {
  $metadata: {
    httpStatusCode: 500,
  },
  name: 'NotARealException',
  $fault: 'client',
  message: 'Not A Real Exception. Only used for testing.',
};

/**
 *
 * PARAMETER CONVERSION
 * Converts the supplied (create) parameters into the formats for describe, update, and delete.
 *
 *****************************************************************************************/

describe('getNamespaceId', () => {
  test('returns from parameters when specified there', () => {
    expect(i.getNamespaceId({NamespaceId: 'abc123'})).toEqual('abc123');
  });

  test('returns from DnsConfig when specified there', () => {
    expect(i.getNamespaceId({DnsConfig: {NamespaceId: 'abc123'}})).toEqual('abc123');
  });

  test('throws an error when specified in both DnsConfig and in the root level parameters', () => {
    expect(() => {
      i.getNamespaceId({NamespaceId: 'xyz456', DnsConfig: {NamespaceId: 'abc123'}});
    }).toThrow('`namespace-id` must be defined either as an input, or as part of `dns-config` (not both).');
  });

  test('throws an error when not specified', () => {
    expect(() => {
      i.getNamespaceId({});
    }).toThrow('`namespace-id` must be defined either as an input, or as part of `dns-config`.');
  });
});

describe('createServiceInputs', () => {
  test('only returns valid elements', () => {
    expect(i.createServiceInputs(parameters)).toStrictEqual(createServiceInputs);
  });
});


describe('deleteServiceInputs', () => {
  test('only returns valid elements', () => {
    expect(i.deleteServiceInputs(parameters)).toStrictEqual(deleteServiceInputs);
  });
});


/**
 *
 * AWS CALLS
 * Take the supplied parameters and send them to AWS
 *
 *****************************************************************************************/

describe('listServices', () => {
  beforeEach(() => {
    ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(createdOrFoundResponse);
  });

  test('returns a list of matching services', async () => {
    await expect(i.listServices(ServiceDiscoveryClient, 'ns-examplenamespace')).resolves.toEqual(createdOrFoundResponse);
    expect(ListServicesCommand).toBeCalledWith(expect.objectContaining(
        {
          Filters: [{Condition: 'EQ', Name: 'NAMESPACE_ID', Values: ['ns-examplenamespace']}],
        },
    ));
  });

  test('adds NextToken to the request when supplied', async () => {
    await expect(i.listServices(ServiceDiscoveryClient, 'ns-examplenamespace', 'token123')).resolves.toEqual(createdOrFoundResponse);
    expect(ListServicesCommand).toBeCalledWith(expect.objectContaining(
        {
          Filters: [{Condition: 'EQ', Name: 'NAMESPACE_ID', Values: ['ns-examplenamespace']}],
          NextToken: 'token123',
        },
    ));
  });
});

describe('describeService', () => {
  describe('when there is a match on the second page', () => {
    beforeEach(() => {
      ServiceDiscoveryClient.send = jest.fn()
          .mockResolvedValueOnce({Services: [], NextToken: 'token456'})
          .mockResolvedValueOnce(createdOrFoundResponse);
    });

    test('it resolves', async () => {
      await expect(i.describeService(ServiceDiscoveryClient, parameters)).resolves.toEqual(createdOrFoundService);
    });
  });
  describe('when there no match and no NextToken supplied', () => {
    beforeEach(() => {
      ServiceDiscoveryClient.send = jest.fn()
          .mockResolvedValueOnce(missingResponse);
    });

    test('it raises a not found error', async () => {
      await expect(i.describeService(ServiceDiscoveryClient, parameters)).rejects.toEqual(new i.NotFoundException('Service with Name: my-service not found.'));
    });
  });

  describe('when there is no match', () => {
    beforeEach(() => {
      ServiceDiscoveryClient.send = jest.fn()
          .mockResolvedValueOnce({Services: [], NextToken: 'token456'})
          .mockResolvedValueOnce(missingResponse);
    });

    test('it raises a not found error', async () => {
      await expect(i.describeService(ServiceDiscoveryClient, parameters)).rejects.toEqual(new i.NotFoundException('Service with Name: my-service not found.'));
    });
  });
  describe('when there is an immmediate match', () => {
    beforeEach(() => {
      ServiceDiscoveryClient.send = jest.fn()
          .mockResolvedValueOnce(createdOrFoundResponse);
    });

    test('it returns with the match', async () => {
      await expect(i.describeService(ServiceDiscoveryClient, parameters)).resolves.toEqual(createdOrFoundService);
    });
  });

  describe('when there is a failure', () => {
    beforeEach(() => {
      ServiceDiscoveryClient.send = jest.fn().mockRejectedValue(genericFailureResponse);
    });

    test('it raises a generic error', async () => {
      await expect(i.describeService(ServiceDiscoveryClient, parameters)).rejects.toEqual(genericFailureResponse);
    });
  });
});


describe('createService', () => {
  describe('when succeeds', () => {
    test('returns the successful response', async () => {
      ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(createdResponse);
      await expect(i.createService(ServiceDiscoveryClient, parameters)).resolves.toEqual(createdResponse);
    });
  });
  describe('when fails', () => {
    test('returns the failure response', async () => {
      ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(genericFailureResponse);
      await expect(i.createService(ServiceDiscoveryClient, parameters)).resolves.toEqual(genericFailureResponse);
    });
  });
});


describe('deleteService', () => {
  describe('when succeeds', () => {
    test('returns the successful response', async () => {
      ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(deletedResponse);
      await expect(i.deleteService(ServiceDiscoveryClient, {id: 'srv-abc12345'})).resolves.toEqual(deletedResponse);
    });
  });
  describe('when fails', () => {
    test('returns the failure response', async () => {
      ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(genericFailureResponse);
      await expect(i.deleteService(ServiceDiscoveryClient, {id: 'srv-abc12345'})).resolves.toEqual(genericFailureResponse);
    });
  });
});

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

describe('createDescribeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates the Service when none exists already', async () => {
    ServiceDiscoveryClient.send = jest.fn()
        .mockResolvedValueOnce(missingResponse)
        .mockResolvedValueOnce(createdResponse);
    await expect(i.createDescribeService(ServiceDiscoveryClient, parameters)).resolves.toEqual(createdResponse);
  });

  test('returns the Service when one exists and it is active', async () => {
    ServiceDiscoveryClient.send = jest.fn().mockResolvedValue(createdOrFoundResponse); // DescribeServiceCommand
    await expect(i.createDescribeService(ServiceDiscoveryClient, parameters)).resolves.toEqual(createdOrFoundService);
  });

  test('throws an error when a generic error occurs', async () => {
    ServiceDiscoveryClient.send = jest.fn().mockRejectedValueOnce(genericFailureResponse); // CreateServiceCommand
    await expect(i.createDescribeService(ServiceDiscoveryClient, parameters)).rejects.toEqual(genericFailureResponse);
  });
});


/**
 *
 * GITHUB ACTIONS INTERFACE
 * - Gets parameters from the user.
 * - Posts results as output.
 *
 *****************************************************************************************/

describe('getParameters', () => {
  describe('when there is not DnsConfig', () => {
    test('it does not include DnsConfig', () => {
      core.getInput = jest
          .fn()
          .mockReturnValueOnce('name') // first call is to get the Name
          .mockReturnValueOnce('Description') // second call is to get the Description
          .mockReturnValueOnce('NamespaceId') // third call is to get the NamespaceId
          .mockReturnValueOnce('Type') // fourth call is to get the Type
          .mockReturnValueOnce('') // fifth call is to get the action
          .mockReturnValueOnce('') // sixth call is to get the id
          .mockReturnValueOnce('') // seventh call is to get the name of the DnsConfig
          .mockReturnValueOnce(mockHealthCheckConfig) // eighth is to get the HealthCheckConfig
          .mockReturnValueOnce('') // ninth call is to get the name of the HealthCheckCustomConfig
          .mockReturnValueOnce('[{"key": "key", "value": "value"}]'); // tenth call is to get the Tags

      expect(i.getParameters({})).toStrictEqual(
          {
            Name: 'name',
            Description: 'Description',
            NamespaceId: 'NamespaceId',
            Type: 'Type',
            action: 'create',
            HealthCheckConfig: JSON.parse(mockHealthCheckConfig),
            Tags: [{key: 'key', value: 'value'}],
          },
      );
    });
  });


  describe('when there is not DnsConfig', () => {
    test('it does not include Empty parameters', () => {
      core.getInput = jest
          .fn()
          .mockReturnValueOnce('name') // first call is to get the Name
          .mockReturnValueOnce('Description') // second call is to get the Description
          .mockReturnValueOnce('NamespaceId') // third call is to get the NamespaceId
          .mockReturnValueOnce('') // fourth call is to get the Type
          .mockReturnValueOnce('') // fifth call is to get the action
          .mockReturnValueOnce('') // sixth call is to get the id
          .mockReturnValueOnce('') // seventh call is to get the name of the DnsConfig
          .mockReturnValueOnce(mockHealthCheckConfig) // eighth is to get the HealthCheckConfig
          .mockReturnValueOnce('') // ninth call is to get the name of the HealthCheckCustomConfig
          .mockReturnValueOnce('[{"key": "key", "value": "value"}]'); // tenth call is to get the Tags

      expect(i.getParameters({})).toStrictEqual(
          {
            Name: 'name',
            Description: 'Description',
            NamespaceId: 'NamespaceId',
            action: 'create',
            HealthCheckConfig: JSON.parse(mockHealthCheckConfig),
            Tags: [{key: 'key', value: 'value'}],
          },
      );
    });
  });


  describe('when there is a typo in the spec', () => {
    test('it throws an error', () => {
      core.getInput = jest
          .fn()
          .mockReturnValueOnce('name') // first call is to get the Name
          .mockReturnValueOnce('Description') // second call is to get the Description
          .mockReturnValueOnce('NamespaceId') // third call is to get the NamespaceId
          .mockReturnValueOnce('Type') // fourth call is to get the Type
          .mockReturnValueOnce('') // fifth call is to get the action
          .mockReturnValueOnce('') // sixth call is to get the id
          .mockReturnValueOnce('{') // seventh call is to get the name of the DnsConfig
          .mockReturnValueOnce(mockHealthCheckConfig) // eighth is to get the HealthCheckConfig
          .mockReturnValueOnce('') // ninth call is to get the name of the HealthCheckCustomConfig
          .mockReturnValueOnce('[{"key": "key", "value": "value"}]'); // tenth call is to get the Tags

      expect(() => i.getParameters()).toThrow('Invalid JSON for DnsConfig: Unexpected end of JSON input: {');
    });
  });
});


describe('postToGithub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sets response, arn, id when created', () => {
    i.postToGithub(createdResponse);
    expect(core.setOutput).toHaveBeenNthCalledWith(1, 'response', createdResponse);
    expect(core.setOutput).toHaveBeenNthCalledWith(2, 'arn', 'arn:aws:servicediscovery:us-east-1:1234567890:service/srv-abc12345');
    expect(core.setOutput).toHaveBeenNthCalledWith(3, 'id', 'srv-abc12345');
  });
  test('sets response, arn, id when found', () => {
    i.postToGithub(createdOrFoundService);
    expect(core.setOutput).toHaveBeenNthCalledWith(1, 'response', createdOrFoundService);
    expect(core.setOutput).toHaveBeenNthCalledWith(2, 'arn', 'arn:aws:servicediscovery:us-east-1:1234567890:service/srv-abc12345');
    expect(core.setOutput).toHaveBeenNthCalledWith(3, 'id', 'srv-abc12345');
  });
});

## Amazon ServiceDiscovery Service Action for GitHub Actions

Creates an Amazon ServiceDiscovery Service

**Table of Contents**

<!-- toc -->

- [Amazon ServiceDiscovery Service Action for GitHub Actions](#amazon-servicediscovery-service-action-for-github-actions)
- [Usage](#usage)
  - [Service Creation](#service-creation)
  - [Service Deletion](#service-deletion)
- [Credentials and Region](#credentials-and-region)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)

<!-- tocstop -->

## Usage

### Service Creation

Create a ServiceDiscovery Service. At the minimum, supply `name`, and `dns-config` with an entry for `NamespaceId`. 

parameter              | description                                 | default
-----------------------|---------------------------------------------|----------
`name` | The name that you want to assign to the service. | 
`namespace-id` | The ID of the namespace that you want to use to create the service. The namespace ID must be specified, but it can be specified either here or in the DnsConfig object. |
`description` | A description for the service. | `undefined`
`dns-config` | A complex type that contains information about the Amazon Route 53 records that you want Cloud Map to create when you register an instance. | {}
`health-check-config` | Public DNS and HTTP namespaces only. A complex type that contains settings for an optional Route 53 health check. If you specify settings for a health check, Cloud Map associates the health check with all the Route 53 DNS records that you specify in DnsConfig. | {}
`health-check-custom-config` | A complex type that contains information about an optional custom health check. | {}
`tags` | The tags to add to the service. Each Tag consists of a key and a value that you define(`[{Key: my-key, Value: my-value}]`). | []
`type` | If present, specifies that the service instances are only discoverable using the DiscoverInstances API operation. No DNS records is registered for the service instances. The only valid value is HTTP. | `HTTP_DNS`


```yaml
- name: ServiceDiscovery Service
  id: create-servicediscovery-service
  uses: scribd/amazon-servicediscovery-service@master
  with:
    name: my-service
    dns-config: |
        {
          "NamespaceId": "ns-namespacename",
          "RoutingPolicy": "MULTIVALUE",
          "DnsRecords": [
              {
                  "Type": "SRV",
                  "TTL": 10
              }
          ]
        }
    tags: |
      [
        {
          "Key": "tags-must",
          "Value": "be-passed-in-as-a-json-string"
        },
        {
          "Key": "this-is-because",
          "Value": "GitHub Actions translates these values into Environment Variables"
        }
      ]
```

### Service Deletion

The only value necessary to delete a service is the ID of the service. You can also specify the other inputs, but they will be ignored.

Note: This command will fail if there are still instances registered to the service.

```yaml
- name: Delete ServiceDiscovery Service
  uses: scribd/amazon-servicediscovery-service@master
  with:
    action: delete
    id: ${{ steps.create-servicediscovery-service.outputs.id }}
```

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.


## Credentials and Region

This action relies on the [default behavior of the AWS SDK for Javascript](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) to determine AWS credentials and region.
Use [the `aws-actions/configure-aws-credentials` action](https://github.com/aws-actions/configure-aws-credentials) to configure the GitHub Actions environment with environment variables containing AWS credentials and your desired region.

We recommend following [Amazon IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) for the AWS credentials used in GitHub Actions workflows, including:
* Do not store credentials in your repository's code.  You may use [GitHub Actions secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets) to store credentials and redact credentials from GitHub Actions workflow logs.
* [Create an individual IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#create-iam-users) with an access key for use in GitHub Actions workflows, preferably one per repository. Do not use the AWS account root user access key.
* [Grant least privilege](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege) to the credentials used in GitHub Actions workflows.  Grant only the permissions required to perform the actions in your GitHub Actions workflows.  See the Permissions section below for the permissions required by this action.
* [Rotate the credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#rotate-credentials) used in GitHub Actions workflows regularly.
* [Monitor the activity](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#keep-a-log) of the credentials used in GitHub Actions workflows.

## Permissions

This action requires the following minimum set of permissions:

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"DeployService",
      "Effect":"Allow",
      "Action":[
        "servicediscovery:ListServices",
        "servicediscovery:CreateService",
        "servicediscvoery:DeleteService",
        "servicediscovery:TagResource"
      ],
      "Resource":[
        "arn:aws:servicediscovery:us-east-1:1234567890:namespace/ns-abc123"
      ]
    }
  ]
}
```


## Troubleshooting

To see the debug logs, create a secret named `ACTIONS_STEP_DEBUG` with value `true` in your repository.

To run this action from your workstation, you have to take into account the following bug: BASH doesn't think dashes are valid in environment variables, but Node does. You should therefore supply your environment variables with the `env` command.

Please include output from the following commands when submitting issues, it'll help greatly! Don't forget to redact any sensitive data from your submission. 

See this example: 

```bash
❯  env "ACTIONS_STEP_DEBUG=true" "GITHUB_WORKSPACE=$(pwd)" 'AWS_REGION=us-east-1' 'INPUT_DNS-CONFIG={"NamespaceId": "ns-abc123", "RoutingPolicy": "MULTIVALUE", "DnsRecords":[{"Type": "SRV","TTL": 10}]}' "INPUT_NAME=my-service" 'INPUT_TAGS=[{"Key": "hello", "Value": "world"}]' node  index.js
```
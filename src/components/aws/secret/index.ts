import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as SecretManager from '@aws-sdk/client-secrets-manager';

const awsRegion = aws.config.region || 'us-east-1';

export interface ManagedSecretArgs {
    secretId: string; // The name of the secret
    description?: string;
    kmsKeyId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    automatedValues: { [key: string]: any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manualValues?: { [key: string]: any };
}

type ManagedSecretInputs = ManagedSecretArgs;
interface ManagedSecretOutputs extends ManagedSecretInputs {
    arn: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    secretValues: { [key: string]: any };
}

class ManagedSecretProvider implements pulumi.dynamic.ResourceProvider {
    private getSecretsManagerClient() {
        return new SecretManager.SecretsManager({ region: awsRegion });
    }

    async check(
        _olds: ManagedSecretInputs,
        news: ManagedSecretInputs,
    ): Promise<pulumi.dynamic.CheckResult> {
        const failures: pulumi.dynamic.CheckFailure[] = [];
        if (!news.secretId) {
            failures.push({
                property: 'secretId',
                reason: 'SecretId is required and must be a non-empty string.',
            });
        }
        if (news.automatedValues && typeof news.automatedValues !== 'object') {
            failures.push({
                property: 'automatedValues',
                reason: 'automatedValues must be an object.',
            });
        }
        return { inputs: news, failures };
    }

    async create(inputs: ManagedSecretInputs): Promise<pulumi.dynamic.CreateResult> {
        const sm = this.getSecretsManagerClient();
        const { secretId, description, kmsKeyId, automatedValues, manualValues } = inputs;
        const secretValues = { ...automatedValues, ...manualValues };

        try {
            const result = await sm.createSecret({
                Name: secretId,
                Description: description,
                KmsKeyId: kmsKeyId,
                SecretString: JSON.stringify(secretValues, null, 4),
            });

            return {
                id: result.ARN || '',
                outs: {
                    ...inputs,
                    arn: result.ARN || '',
                    secretValues,
                },
            };
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to create secret: ${error.message}`);
            } else {
                throw new Error('Failed to create secret: Unknown error');
            }
        }
    }

    async diff(
        _id: string,
        olds: ManagedSecretOutputs,
        news: ManagedSecretInputs,
    ): Promise<pulumi.dynamic.DiffResult> {
        const changes =
            JSON.stringify(olds.automatedValues) !== JSON.stringify(news.automatedValues);
        const replaces = changes ? ['automatedValues'] : [];
        return { changes, replaces, stables: ['arn', 'secretId'] };
    }

    async update(
        id: string,
        olds: ManagedSecretOutputs,
        news: ManagedSecretInputs,
    ): Promise<pulumi.dynamic.UpdateResult> {
        const sm = this.getSecretsManagerClient();
        const updatedValues = { ...olds.secretValues, ...news.automatedValues };

        try {
            await sm.updateSecret({
                SecretId: id,
                SecretString: JSON.stringify(updatedValues, null, 4),
                Description: news.description,
                KmsKeyId: news.kmsKeyId,
            });

            return {
                outs: {
                    ...news,
                    arn: olds.arn,
                    secretValues: updatedValues,
                },
            };
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to update secret: ${error.message}`);
            } else {
                throw new Error('Failed to update secret: Unknown error');
            }
        }
    }

    async delete(id: string): Promise<void> {
        const sm = this.getSecretsManagerClient();

        try {
            await sm.deleteSecret({
                SecretId: id,
                ForceDeleteWithoutRecovery: true,
            });
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to delete secret: ${error.message}`);
            } else {
                throw new Error('Failed to delete secret: Unknown error');
            }
        }
    }

    async read(id: string, props: ManagedSecretOutputs): Promise<pulumi.dynamic.ReadResult> {
        const sm = this.getSecretsManagerClient();

        try {
            const result = await sm.describeSecret({ SecretId: id });
            const secretValue = await sm.getSecretValue({ SecretId: id });
            const currentValues = JSON.parse(secretValue.SecretString || '{}');

            return {
                id: result.ARN,
                props: {
                    ...props,
                    arn: result.ARN,
                    secretValues: currentValues,
                },
            };
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`Failed to read secret: ${error.message}`);
            } else {
                throw new Error('Failed to read secret: Unknown error');
            }
        }
    }
}

export class ManagedSecret extends pulumi.dynamic.Resource {
    public readonly arn: pulumi.Output<string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public readonly secretValues: pulumi.Output<{ [key: string]: any }>;

    constructor(name: string, args: ManagedSecretArgs, opts?: pulumi.CustomResourceOptions) {
        super(new ManagedSecretProvider(), `custom:aws:ManagedSecret:${name}`, args, opts);
        this.arn = pulumi.output(this.id);
        this.secretValues = pulumi.output(args.automatedValues);
    }

    static grantFullAccessToSecrets(
        policyName: string,
        roleArn: string,
        secrets: pulumi.Input<string>[],
    ) {
        const policy = new aws.iam.Policy(policyName, {
            description: `Grant full access to specific secrets`,
            policy: JSON.stringify({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: [
                            'secretsmanager:GetSecretValue',
                            'secretsmanager:DescribeSecret',
                            'secretsmanager:ListSecrets',
                            'secretsmanager:PutSecretValue',
                            'secretsmanager:DeleteSecret',
                        ],
                        Resource: secrets,
                    },
                ],
            }),
        });

        new aws.iam.RolePolicyAttachment(`${policyName}-attachment`, {
            role: roleArn,
            policyArn: policy.arn,
        });
    }
}

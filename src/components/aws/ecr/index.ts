import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface EcrArgs {
    name: pulumi.Input<string>;
    imageTagMutability?: pulumi.Input<string>;
    encryptionKeyId?: pulumi.Input<string>;
    policy?: pulumi.Input<string>;
}

export class Ecr extends pulumi.ComponentResource {
    public readonly repository: aws.ecr.Repository;
    public readonly repositoryPolicy?: aws.ecr.RepositoryPolicy;
    public readonly arn: pulumi.Output<string>;

    constructor(resourceName: string, args: EcrArgs, opts?: pulumi.ComponentResourceOptions) {
        super('mtx:aws:ecr', resourceName, {}, opts);

        this.repository = new aws.ecr.Repository(
            resourceName,
            {
                name: args.name,
                encryptionConfigurations: args.encryptionKeyId
                    ? [
                          {
                              encryptionType: 'KMS',
                              kmsKey: args.encryptionKeyId,
                          },
                      ]
                    : [
                          {
                              encryptionType: 'AES256',
                          },
                      ],
                imageTagMutability: args.imageTagMutability || 'IMMUTABLE',
                imageScanningConfiguration: {
                    scanOnPush: true,
                },
            },
            { parent: this },
        );

        if (args.policy) {
            this.repositoryPolicy = new aws.ecr.RepositoryPolicy(
                `${resourceName}-policy`,
                {
                    repository: this.repository.name,
                    policy: args.policy,
                },
                { parent: this },
            );
        }

        this.arn = this.repository.arn;

        this.registerOutputs({
            repository: this.repository,
            repositoryPolicy: this.repositoryPolicy,
            arn: this.arn,
        });
    }
}

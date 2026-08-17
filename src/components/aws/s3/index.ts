import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface S3BucketArgs {
    name: pulumi.Input<string>;
    acl?: pulumi.Input<aws.s3.CannedAcl>;
    lifeCycleRules?: pulumi.Input<aws.types.input.s3.BucketLifecycleRule[]>;

    intelligentTiering?: pulumi.Input<aws.types.input.s3.BucketIntelligentTieringConfigurationTiering>[];
    versioning?: pulumi.Input<boolean>;
    kmsKeyId?: pulumi.Input<string>;
    cors?: pulumi.Input<aws.types.input.s3.BucketCorsConfigurationV2CorsRule>[];
    readAccessRoleArns?: pulumi.Input<string>[];
    readWriteAccessRoleArns?: pulumi.Input<string>[];
}

export class S3Bucket extends pulumi.ComponentResource {
    public readonly bucket: aws.s3.Bucket;

    public readonly name: string;

    constructor(resourceName: string, args: S3BucketArgs, opts?: pulumi.ComponentResourceOptions) {
        super('mtx:aws:s3', resourceName, {}, opts);
        this.name = args.name as string;

        // Create the S3 bucket
        this.bucket = new aws.s3.Bucket(
            resourceName,
            {
                bucket: this.name.toLowerCase(),
                acl: args.acl || 'private',
                lifecycleRules: args.lifeCycleRules,
                versioning: args.versioning ? { enabled: args.versioning } : undefined,
                serverSideEncryptionConfiguration: {
                    rule: {
                        applyServerSideEncryptionByDefault: {
                            sseAlgorithm: args.kmsKeyId ? 'aws:kms' : 'AES256',
                            kmsMasterKeyId: args.kmsKeyId,
                        },
                    },
                },
                corsRules: args.cors,
            },
            {
                parent: this,
            },
        );

        // Enforce bucket ownership
        new aws.s3.BucketOwnershipControls(
            resourceName,
            {
                bucket: this.bucket.id,
                rule: { objectOwnership: 'BucketOwnerEnforced' },
            },
            { parent: this },
        );

        // Optional add cors configuration
        if (args.cors) {
            new aws.s3.BucketCorsConfigurationV2(
                resourceName,
                {
                    bucket: this.bucket.id,
                    corsRules: args.cors,
                },
                { parent: this },
            );
        }

        // Optionally add intelligent tiering configuration
        if (args.intelligentTiering) {
            new aws.s3.BucketIntelligentTieringConfiguration(
                resourceName,
                {
                    bucket: this.bucket.id,
                    tierings: args.intelligentTiering,
                },
                { parent: this },
            );
        }

        // Optionally add bucket policy
        if (args.readAccessRoleArns || args.readWriteAccessRoleArns) {
            const accessRoleArns = [
                ...(args.readAccessRoleArns || []),
                ...(args.readWriteAccessRoleArns || []),
            ];
            const statements: aws.iam.PolicyStatement[] = [
                {
                    Sid: 'AllowReadAccess',
                    Effect: 'Allow',
                    Principal: {
                        AWS: accessRoleArns,
                    },
                    Action: [
                        's3:AbortMultipartUpload',
                        's3:GetBucketLocation',
                        's3:GetObject',
                        's3:ListBucket',
                        's3:ListBucketMultipartUploads',
                    ],
                    Resource: [this.bucket.arn, pulumi.interpolate`${this.bucket.arn}/*`],
                },
            ];

            if (args.readWriteAccessRoleArns) {
                statements.push({
                    Sid: 'AllowWriteAccess',
                    Effect: 'Allow',
                    Principal: {
                        AWS: args.readWriteAccessRoleArns,
                    },
                    Action: ['s3:PutObject'],
                    Resource: [this.bucket.arn, pulumi.interpolate`${this.bucket.arn}/*`],
                });
            }

            new aws.s3.BucketPolicy(
                `${resourceName}-policy`,
                {
                    bucket: this.bucket.id,
                    policy: {
                        Version: '2012-10-17',
                        Statement: statements,
                    },
                },
                { parent: this },
            );
        }

        this.registerOutputs();
    }
}

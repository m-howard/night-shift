import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config as stackConfigs } from '../config';
import { DefaultConfig, ConfigLoader, StackOutputs } from '../components';
import { registerAutoTags } from '../helpers';

/**
 * Foundation Stack Outputs - Extends base StackOutputs with foundation-specific outputs
 */
export interface FoundationStackOutputs extends StackOutputs {
    /**
     * ARN of the data encryption KMS key
     */
    dataEncryptionKeyArn: pulumi.Output<string>;
}

/**
 * Foundation Stack - Establishes foundational account-wide controls and guardrails.
 *
 * This stack provisions global AWS account resources such as S3 public access blocks, DNS settings, etc.
 * It is the root of the dependency graph and must be deployed before all other stacks.
 *
 * @param envConfigName - The deployment environment (dev, val, prd)
 * @returns Pulumi outputs for the foundation stack
 */
export async function createStack(envConfigName: string): Promise<FoundationStackOutputs> {
    pulumi.log.info(`[foundation] Deploying foundation stack for environment: ${envConfigName}`);
    // Load the configuration for the current environment
    const config = ConfigLoader.loadConfig<DefaultConfig>(stackConfigs, envConfigName);

    // Automatically inject tags to all taggable resources
    registerAutoTags(config.tags as unknown as Record<string, string>);

    // =========================================================================
    // S3 ACCOUNT PUBLIC ACCESS BLOCK
    // =========================================================================
    // Blocks public access to all S3 buckets in the AWS account.
    // This is a security best practice to prevent accidental public exposure.
    new aws.s3.AccountPublicAccessBlock(
        'foundation-s3-block-public-access',
        {
            blockPublicAcls: true, // Block public ACLs on buckets and objects
            ignorePublicAcls: true, // Ignore existing public ACLs
            blockPublicPolicy: true, // Block public bucket policies
            restrictPublicBuckets: true, // Restrict cross-account access via public policies
        },
        { retainOnDelete: true }, // Keep the setting if stack is destroyed
    );

    // =========================================================================
    // EBS ENCRYPTION BY DEFAULT
    // =========================================================================
    // Enables encryption by default for all new EBS volumes in the region.
    // Uses AWS-managed keys unless you specify a custom KMS key.
    new aws.ebs.EncryptionByDefault(
        'foundation-ebs-encryption',
        {
            enabled: true,
        },
        { retainOnDelete: true },
    );

    // =========================================================================
    // KMS KEYS (Example)
    // =========================================================================
    // Create customer-managed KMS keys for encrypting sensitive data.
    const dataEncryptionKey = new aws.kms.Key('foundation-data-encryption-key', {
        description: 'KMS key for encrypting Coder workspace data',
        deletionWindowInDays: 30,
        enableKeyRotation: true,
        tags: config.tags as unknown as { [key: string]: string },
    });

    new aws.kms.Alias('foundation-data-encryption-key-alias', {
        name: `alias/${envConfigName}-github-runner-eks`,
        targetKeyId: dataEncryptionKey.keyId,
    });

    return {
        message: pulumi.output(`Foundation stack deployed for environment: ${envConfigName}`),
        // Export outputs for StackReference consumption by other stacks
        dataEncryptionKeyArn: dataEncryptionKey.arn,
    };
}

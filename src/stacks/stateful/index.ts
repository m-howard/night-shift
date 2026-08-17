import * as _ from 'lodash';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config as stackConfigs } from '../config';
import {
    DefaultConfig,
    ConfigLoader,
    StackOutputs,
    Ecr as EcrRepository,
    ManagedSecret,
} from '../components';
import { registerAutoTags } from '../helpers';

/**
 * Stateful Data Stack - Manages regional data storage and persistence services.
 *
 * This stack provisions stateful AWS resources that persist data across deployments.
 * It depends on the foundation stack and provides outputs to compute/workload stacks.
 *
 * @param envConfigName - The deployment environment (dev, val, prd)
 * @returns Pulumi outputs for the stateful data stack
 */
export interface StatefulDataStackOutputs extends StackOutputs {
    ecrRepositoryUrl: pulumi.Output<string>;
    ecrRepositoryArn: pulumi.Output<string>;
    buildCacheEcrRepositoryUrl: pulumi.Output<string>;
    buildCacheEcrArn: pulumi.Output<string>;
    githubEcrOidcRoleArn: pulumi.Output<string>;
    secretName: string;
    secretArn: pulumi.Output<string>;
}

export async function createStack(envConfigName: string): Promise<StatefulDataStackOutputs> {
    pulumi.log.info(
        `[stateful-data] Deploying stateful data stack for environment: ${envConfigName}`,
    );
    // Load the configuration for the current environment
    const config = ConfigLoader.loadConfig<DefaultConfig>(stackConfigs, envConfigName);

    // Automatically inject tags to all taggable resources
    registerAutoTags(config.tags as unknown as Record<string, string>);

    // Application name derived from config tags
    const appName = _.kebabCase(config.tags['application-name']);

    // -------------------------------------------------------------------------
    // ECR REPOSITORY
    // -------------------------------------------------------------------------
    // Container registry for storing application Docker images
    let appEcr: EcrRepository | undefined;
    if (config.ecr) {
        appEcr = new EcrRepository(`${appName}-ecr-repo`, {
            name: `${appName}`,
            imageTagMutability: 'IMMUTABLE',
            ...config.ecr,
        });
    }

    // -------------------------------------------------------------------------
    // BUILDKIT CACHE ECR REPOSITORY
    // -------------------------------------------------------------------------
    // Dedicated ECR repository used as the BuildKit registry cache backend for
    // build runner classes. The repository URL is exported and injected into
    // build runner pods as BUILDKIT_CACHE_REGISTRY.
    const buildCacheEcr = new EcrRepository(`${appName}-build-cache-ecr-repo`, {
        name: `${appName}-build-cache`,
        imageTagMutability: 'MUTABLE',
    });

    // -------------------------------------------------------------------------
    // MANAGED SECRET
    // -------------------------------------------------------------------------
    // AWS Secrets Manager secret for application credentials
    const managedSecret = new ManagedSecret(`${appName}-secrets`, {
        secretId: config.coreSecretName,
        description: `Managed secret for ${appName} (${envConfigName})`,
        automatedValues: {}, // Add Pulumi-managed values here
        manualValues: {}, // Add manually-managed values here
    });

    // -------------------------------------------------------------------------
    // GITHUB ECR OIDC ROLE
    // -------------------------------------------------------------------------
    // IAM role that allows GitHub Actions to push images to ECR.
    let githubEcrOidcRoleArn = pulumi.output('');
    if (appEcr && config.githubEcrOidcRole) {
        const callerIdentity = aws.getCallerIdentityOutput({});
        const { githubOrg, githubRepo } = config.githubEcrOidcRole;

        const assumeRolePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: 'Allow',
                    actions: ['sts:AssumeRoleWithWebIdentity'],
                    principals: [
                        {
                            type: 'Federated',
                            identifiers: [
                                pulumi.interpolate`arn:aws:iam::${callerIdentity.accountId}:oidc-provider/token.actions.githubusercontent.com`,
                            ],
                        },
                    ],
                    conditions: [
                        {
                            test: 'StringEquals',
                            variable: 'token.actions.githubusercontent.com:aud',
                            values: ['sts.amazonaws.com'],
                        },
                        {
                            test: 'StringLike',
                            variable: 'token.actions.githubusercontent.com:sub',
                            values: [`repo:${githubOrg}/${githubRepo}:*`],
                        },
                    ],
                },
            ],
        });

        const githubEcrOidcRole = new aws.iam.Role(`${appName}-github-ecr-role`, {
            name: `${appName}-${envConfigName}-github-ecr`,
            assumeRolePolicy: assumeRolePolicy.json,
            description: `GitHub Actions OIDC role for pushing images to ${appName} ECR`,
            tags: config.tags as unknown as Record<string, string>,
        });

        const ecrPushPolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: 'Allow',
                    actions: ['ecr:GetAuthorizationToken'],
                    resources: ['*'],
                },
                {
                    effect: 'Allow',
                    actions: [
                        'ecr:BatchCheckLayerAvailability',
                        'ecr:BatchGetImage',
                        'ecr:CompleteLayerUpload',
                        'ecr:DescribeRepositories',
                        'ecr:InitiateLayerUpload',
                        'ecr:PutImage',
                        'ecr:UploadLayerPart',
                    ],
                    resources: [appEcr.arn],
                },
            ],
        });

        new aws.iam.RolePolicy(
            `${appName}-github-ecr-policy`,
            {
                role: githubEcrOidcRole.id,
                policy: ecrPushPolicy.json,
            },
            { parent: githubEcrOidcRole },
        );

        githubEcrOidcRoleArn = githubEcrOidcRole.arn;
    }

    return {
        message: pulumi.output(`Stateful data stack deployed for environment: ${envConfigName}`),
        ecrRepositoryUrl: appEcr ? appEcr.repository.repositoryUrl : pulumi.output(''),
        ecrRepositoryArn: appEcr ? appEcr.arn : pulumi.output(''),
        buildCacheEcrRepositoryUrl: buildCacheEcr.repository.repositoryUrl,
        buildCacheEcrArn: buildCacheEcr.arn,
        githubEcrOidcRoleArn,
        secretName: config.coreSecretName,
        secretArn: managedSecret.arn,
    };
}

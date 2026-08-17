import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { RunnerClassConfig, sanitizeKubernetesName } from '../../types';

const IRSA_AUDIENCE = 'sts.amazonaws.com';

const buildServiceAccountName = (runnerClassName: string): string => {
    const baseName = `${sanitizeKubernetesName(runnerClassName)}-runner`;

    if (baseName.length <= 63) {
        return baseName;
    }

    return baseName.slice(0, 63).replace(/-+$/g, '');
};

const buildTrustPolicy = (
    namespace: string,
    serviceAccountName: string,
    oidcProviderArn: pulumi.Input<string>,
    oidcProviderUrl: pulumi.Input<string>,
): ReturnType<typeof aws.iam.getPolicyDocumentOutput> => {
    const oidcProviderConditionPrefix = pulumi
        .output(oidcProviderUrl)
        .apply((url) => `${url.replace(/^https:\/\//, '')}:`);

    return aws.iam.getPolicyDocumentOutput({
        statements: [
            {
                effect: 'Allow',
                actions: ['sts:AssumeRoleWithWebIdentity'],
                principals: [{ identifiers: [oidcProviderArn], type: 'Federated' }],
                conditions: [
                    {
                        test: 'StringEquals',
                        variable: oidcProviderConditionPrefix.apply((prefix) => `${prefix}sub`),
                        values: [`system:serviceaccount:${namespace}:${serviceAccountName}`],
                    },
                    {
                        test: 'StringEquals',
                        variable: oidcProviderConditionPrefix.apply((prefix) => `${prefix}aud`),
                        values: [IRSA_AUDIENCE],
                    },
                ],
            },
        ],
    });
};

export interface WorkloadIdentityArgs {
    runnerClasses: RunnerClassConfig[];
    oidcProviderArn: pulumi.Input<string>;
    oidcProviderUrl: pulumi.Input<string>;
    namespaceResources?: Record<string, k8s.core.v1.Namespace>;
    /**
     * ARN of the ECR repository used as the BuildKit registry cache backend.
     * When provided, inline push/pull policies are attached to IRSA roles for
     * runner classes that have a `buildEngine` configured.
     */
    buildCacheEcrArn?: pulumi.Input<string>;
    tags?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}

/**
 * WorkloadIdentity provisions dedicated IRSA roles and service accounts for ARC runner classes.
 */
export class WorkloadIdentity extends pulumi.ComponentResource {
    public readonly roles: Record<string, aws.iam.Role>;
    public readonly serviceAccounts: Record<string, k8s.core.v1.ServiceAccount>;
    public readonly roleArnsByRunnerClass: pulumi.Output<Record<string, string>>;
    public readonly roleNamesByRunnerClass: pulumi.Output<Record<string, string>>;
    public readonly serviceAccountNamesByRunnerClass: pulumi.Output<Record<string, string>>;

    constructor(name: string, args: WorkloadIdentityArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:kubernetes:WorkloadIdentity', name, {}, opts);

        this.roles = Object.fromEntries(
            args.runnerClasses.map((runnerClass) => {
                const serviceAccountName = buildServiceAccountName(runnerClass.name);
                const role = new aws.iam.Role(
                    `${name}-${runnerClass.name}-role`,
                    {
                        assumeRolePolicy: buildTrustPolicy(
                            runnerClass.namespace,
                            serviceAccountName,
                            args.oidcProviderArn,
                            args.oidcProviderUrl,
                        ).json,
                        description: `IRSA role for runner class ${runnerClass.name} (${runnerClass.namespace}/${serviceAccountName})`,
                        tags: args.tags,
                    },
                    { parent: this },
                );

                if (runnerClass.buildEngine && args.buildCacheEcrArn) {
                    const ecrCachePolicy = aws.iam.getPolicyDocumentOutput({
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
                                    'ecr:GetDownloadUrlForLayer',
                                    'ecr:InitiateLayerUpload',
                                    'ecr:PutImage',
                                    'ecr:UploadLayerPart',
                                ],
                                resources: [args.buildCacheEcrArn],
                            },
                        ],
                    });

                    new aws.iam.RolePolicy(
                        `${name}-${runnerClass.name}-ecr-cache-policy`,
                        {
                            role: role.id,
                            policy: ecrCachePolicy.json,
                        },
                        { parent: this },
                    );
                }

                return [runnerClass.name, role];
            }),
        );

        this.serviceAccounts = Object.fromEntries(
            args.runnerClasses.map((runnerClass) => {
                const serviceAccountName = buildServiceAccountName(runnerClass.name);
                const serviceAccount = new k8s.core.v1.ServiceAccount(
                    `${name}-${runnerClass.name}-service-account`,
                    {
                        metadata: {
                            name: serviceAccountName,
                            namespace: runnerClass.namespace,
                            annotations: {
                                'eks.amazonaws.com/role-arn': this.roles[runnerClass.name].arn,
                            },
                            labels: {
                                'github-runners-eks/runner-class': runnerClass.name,
                            },
                        },
                    },
                    {
                        parent: this,
                        dependsOn: args.namespaceResources?.[runnerClass.namespace]
                            ? [
                                  args.namespaceResources[runnerClass.namespace],
                                  this.roles[runnerClass.name],
                              ]
                            : [this.roles[runnerClass.name]],
                    },
                );

                return [runnerClass.name, serviceAccount];
            }),
        );

        this.roleArnsByRunnerClass = pulumi
            .all(
                Object.entries(this.roles).map(([runnerClassName, role]) =>
                    role.arn.apply((roleArn) => [runnerClassName, roleArn] as const),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.roleNamesByRunnerClass = pulumi
            .all(
                Object.entries(this.roles).map(([runnerClassName, role]) =>
                    role.name.apply((roleName) => [runnerClassName, roleName] as const),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.serviceAccountNamesByRunnerClass = pulumi
            .all(
                Object.entries(this.serviceAccounts).map(([runnerClassName, serviceAccount]) =>
                    pulumi
                        .output(serviceAccount.metadata.name)
                        .apply(
                            (resolvedName) =>
                                [
                                    runnerClassName,
                                    resolvedName || buildServiceAccountName(runnerClassName),
                                ] as const,
                        ),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.registerOutputs({
            roleArnsByRunnerClass: this.roleArnsByRunnerClass,
            roleNamesByRunnerClass: this.roleNamesByRunnerClass,
            serviceAccountNamesByRunnerClass: this.serviceAccountNamesByRunnerClass,
        });
    }
}

export default WorkloadIdentity;

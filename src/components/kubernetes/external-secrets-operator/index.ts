import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';

const ESO_CHART_REPO = 'https://charts.external-secrets.io';
const ESO_CHART_NAME = 'external-secrets';
/** Pinned chart version — conditions.namespaces enforcement is confirmed in v2.2.0+. */
const ESO_CHART_VERSION = '2.2.0';
const IRSA_AUDIENCE = 'sts.amazonaws.com';

/** Arguments for the {@link ExternalSecretsOperator} component. */
export interface ExternalSecretsOperatorArgs {
    /** Kubernetes namespace to deploy ESO into (typically `arc-system`). */
    namespace: string;
    /** Helm chart version for external-secrets. */
    chartVersion?: string;
    /** OIDC provider ARN for IRSA trust policy. */
    oidcProviderArn: pulumi.Input<string>;
    /** OIDC provider URL for IRSA trust policy. */
    oidcProviderUrl: pulumi.Input<string>;
    /**
     * ARN of the Secrets Manager secret containing the GitHub installation token.
     * The IRSA role is scoped to read only this secret.
     */
    tokenSecretArn: pulumi.Input<string>;
    /**
     * Runner namespaces where `ExternalSecret` resources should be created.
     * Each namespace gets its own ExternalSecret that targets a K8s Secret with
     * the name specified by `targetSecretName`.
     */
    runnerNamespaces: string[];
    /** Name of the K8s Secret created in each runner namespace (e.g. `arc-github-auth`). */
    targetSecretName: string;
    /** How often ESO refreshes the token from Secrets Manager. Default: `5m`. */
    refreshInterval?: string;
    /**
     * Changes after the token broker generates a bootstrap token. ESO treats
     * the `force-sync` annotation as an immediate reconciliation request.
     */
    syncTrigger?: pulumi.Input<string>;
    /** AWS region for the Secrets Manager backend. Defaults to `us-east-1`. */
    awsRegion?: string;
    /** Optional pre-existing namespace resources to depend on. */
    namespaceResources?: Record<string, k8s.core.v1.Namespace>;
    /** Tags applied to all created AWS resources. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * ExternalSecretsOperator — Deploys ESO and ExternalSecret resources for token-based ARC auth.
 *
 * Installs the External Secrets Operator via Helm, creates a `ClusterSecretStore`
 * backed by AWS Secrets Manager (authenticated via IRSA), and provisions one
 * `ExternalSecret` per runner namespace that maps the `github_token` key from
 * Secrets Manager into the `arc-github-auth` K8s Secret.
 */
export class ExternalSecretsOperator extends pulumi.ComponentResource {
    /** The ESO Helm release. */
    public readonly release: k8s.helm.v3.Release;
    /** The ClusterSecretStore resource. */
    public readonly secretStore: k8s.apiextensions.CustomResource;
    /** Map of runner namespace → ExternalSecret resource. */
    public readonly externalSecrets: Record<string, k8s.apiextensions.CustomResource>;
    /** Map of runner namespace → target K8s Secret name. */
    public readonly secretNamesByNamespace: pulumi.Output<Record<string, string>>;
    /** IRSA role ARN used by ESO to read from Secrets Manager. */
    public readonly serviceAccountRoleArn: pulumi.Output<string>;

    constructor(
        name: string,
        args: ExternalSecretsOperatorArgs,
        opts?: pulumi.ComponentResourceOptions,
    ) {
        super('github-runners-eks:kubernetes:ExternalSecretsOperator', name, {}, opts);

        const refreshInterval = args.refreshInterval ?? '5m';
        const awsRegion = args.awsRegion ?? 'us-east-1';
        const serviceAccountName = `${name}-eso`;

        // -----------------------------------------------------------------
        // IRSA Role — ESO reads only the token secret, never the private key
        // -----------------------------------------------------------------
        const oidcProviderConditionPrefix = pulumi
            .output(args.oidcProviderUrl)
            .apply((url) => `${url.replace(/^https:\/\//, '')}:`);

        const trustPolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: 'Allow',
                    actions: ['sts:AssumeRoleWithWebIdentity'],
                    principals: [{ identifiers: [args.oidcProviderArn], type: 'Federated' }],
                    conditions: [
                        {
                            test: 'StringEquals',
                            variable: oidcProviderConditionPrefix.apply((prefix) => `${prefix}sub`),
                            values: [
                                `system:serviceaccount:${args.namespace}:${serviceAccountName}`,
                            ],
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

        const irsaRole = new aws.iam.Role(
            `${name}-eso-role`,
            {
                assumeRolePolicy: trustPolicy.json,
                description:
                    'IRSA role for ESO to read GitHub installation tokens from Secrets Manager',
                tags: args.tags,
            },
            { parent: this },
        );

        const secretReadPolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    sid: 'ReadTokenSecret',
                    effect: 'Allow',
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [args.tokenSecretArn],
                },
            ],
        });

        new aws.iam.RolePolicy(
            `${name}-eso-secret-read-policy`,
            {
                role: irsaRole.id,
                policy: secretReadPolicy.json,
            },
            { parent: this },
        );

        this.serviceAccountRoleArn = irsaRole.arn;

        // -----------------------------------------------------------------
        // Helm Release — External Secrets Operator
        // -----------------------------------------------------------------
        this.release = new k8s.helm.v3.Release(
            `${name}-eso-release`,
            {
                chart: ESO_CHART_NAME,
                repositoryOpts: { repo: ESO_CHART_REPO },
                namespace: args.namespace,
                createNamespace: false,
                cleanupOnFail: true,
                atomic: true,
                timeout: 600,
                version: args.chartVersion ?? ESO_CHART_VERSION,
                values: {
                    serviceAccount: {
                        create: true,
                        name: serviceAccountName,
                        annotations: {
                            'eks.amazonaws.com/role-arn': irsaRole.arn,
                        },
                    },
                    installCRDs: true,
                },
            },
            {
                parent: this,
                dependsOn: args.namespaceResources?.[args.namespace]
                    ? [args.namespaceResources[args.namespace]]
                    : undefined,
            },
        );

        // -----------------------------------------------------------------
        // ClusterSecretStore — AWS Secrets Manager backend
        // -----------------------------------------------------------------
        // A generous create timeout is applied here because the ESO Helm chart
        // installs CRDs as part of the same deployment.  On a fresh install the
        // Kubernetes API server may not have registered the CRDs yet by the time
        // Pulumi first attempts to create this resource.  The provider retries with
        // exponential backoff; a 10-minute timeout gives enough headroom for image
        // pulls and CRD propagation on the first deploy of the cluster.
        this.secretStore = new k8s.apiextensions.CustomResource(
            `${name}-cluster-secret-store`,
            {
                apiVersion: 'external-secrets.io/v1',
                kind: 'ClusterSecretStore',
                metadata: {
                    name: `${name}-aws-sm`,
                },
                spec: {
                    conditions: [
                        {
                            namespaces: args.runnerNamespaces,
                        },
                    ],
                    provider: {
                        aws: {
                            service: 'SecretsManager',
                            region: awsRegion,
                            auth: {
                                jwt: {
                                    serviceAccountRef: {
                                        name: serviceAccountName,
                                        namespace: args.namespace,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            {
                parent: this,
                dependsOn: [this.release],
                customTimeouts: { create: '10m' },
            },
        );

        // -----------------------------------------------------------------
        // ExternalSecret per runner namespace
        // -----------------------------------------------------------------
        this.externalSecrets = Object.fromEntries(
            args.runnerNamespaces.map((runnerNamespace) => {
                const externalSecret = new k8s.apiextensions.CustomResource(
                    `${name}-external-secret-${runnerNamespace}`,
                    {
                        apiVersion: 'external-secrets.io/v1',
                        kind: 'ExternalSecret',
                        metadata: {
                            name: args.targetSecretName,
                            namespace: runnerNamespace,
                            annotations: {
                                'pulumi.com/waitFor': 'condition=Ready',
                                ...(args.syncTrigger
                                    ? {
                                          'force-sync': args.syncTrigger,
                                      }
                                    : {}),
                            },
                        },
                        spec: {
                            refreshInterval,
                            secretStoreRef: {
                                name: `${name}-aws-sm`,
                                kind: 'ClusterSecretStore',
                            },
                            target: {
                                name: args.targetSecretName,
                                creationPolicy: 'Owner',
                            },
                            data: [
                                {
                                    secretKey: 'github_token',
                                    remoteRef: {
                                        key: args.tokenSecretArn,
                                        property: 'github_token',
                                    },
                                },
                            ],
                        },
                    },
                    {
                        parent: this,
                        dependsOn: [
                            this.secretStore,
                            ...(args.namespaceResources?.[runnerNamespace]
                                ? [args.namespaceResources[runnerNamespace]]
                                : []),
                        ],
                        customTimeouts: { create: '10m', update: '10m' },
                    },
                );

                return [runnerNamespace, externalSecret];
            }),
        );

        this.secretNamesByNamespace = pulumi.output(
            Object.fromEntries(args.runnerNamespaces.map((ns) => [ns, args.targetSecretName])),
        );

        this.registerOutputs({
            secretNamesByNamespace: this.secretNamesByNamespace,
            serviceAccountRoleArn: this.serviceAccountRoleArn,
        });
    }
}

export default ExternalSecretsOperator;

import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { ArcProxyEnvConfig } from '../../types';

const ARC_CONTROLLER_NAMESPACE = 'arc-system';
const ARC_CONTROLLER_CHART_REFERENCE =
    'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller';
const DEFAULT_ARC_CONTROLLER_RELEASE_NAME = 'arc-controller';

const isNonEmptyString = (value: string | null | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const resolveNonEmptyString = (
    value: string | null | undefined,
    fallback: string,
    fieldName: string,
): string => {
    if (value === undefined || value === null) {
        return fallback;
    }

    if (!isNonEmptyString(value)) {
        throw new Error(`ArcController ${fieldName} must be a non-empty string when provided`);
    }

    return value.trim();
};

const buildDefaultServiceAccountName = (releaseName: string): string =>
    `${releaseName}-gha-rs-controller`;

export interface ArcControllerArgs {
    chartVersion?: string | null;
    namespace?: string | null;
    releaseName?: string | null;
    serviceAccountName?: string | null;
    oidcProviderArn: pulumi.Input<string>;
    oidcProviderUrl: pulumi.Input<string>;
    namespaceResource?: k8s.core.v1.Namespace;
    tags?: pulumi.Input<Record<string, pulumi.Input<string>>>;
    /**
     * Optional proxy environment variables to inject into the controller manager pod.
     * When provided, HTTP_PROXY, HTTPS_PROXY, NO_PROXY (and lowercase variants) are
     * set on the controller container via the Helm chart `env` values key.
     */
    proxyEnv?: ArcProxyEnvConfig;
    /**
     * Enable HA constraints: a PodDisruptionBudget (minAvailable: 1) targeting
     * the controller manager pod. Recommended for production environments.
     */
    enableHaConstraints?: boolean;
}

/**
 * ArcController deploys the GitHub ARC scale-set controller into the cluster.
 */
export class ArcController extends pulumi.ComponentResource {
    public readonly release: k8s.helm.v3.Release;
    public readonly serviceAccountRole: aws.iam.Role;
    public readonly controllerNamespace: pulumi.Output<string>;
    public readonly releaseName: pulumi.Output<string>;
    public readonly serviceAccountName: pulumi.Output<string>;
    public readonly serviceAccountRoleArn: pulumi.Output<string>;
    public readonly ready: pulumi.Output<boolean>;
    /** PodDisruptionBudget for the ARC controller pod. Present only when enableHaConstraints is true. */
    public readonly podDisruptionBudget?: k8s.policy.v1.PodDisruptionBudget;

    constructor(name: string, args: ArcControllerArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:kubernetes:ArcController', name, {}, opts);

        const namespace = resolveNonEmptyString(
            args.namespace,
            ARC_CONTROLLER_NAMESPACE,
            'namespace',
        );
        const releaseName = resolveNonEmptyString(
            args.releaseName,
            DEFAULT_ARC_CONTROLLER_RELEASE_NAME,
            'releaseName',
        );
        const serviceAccountName = resolveNonEmptyString(
            args.serviceAccountName,
            buildDefaultServiceAccountName(releaseName),
            'serviceAccountName',
        );

        const oidcProviderConditionPrefix = pulumi
            .output(args.oidcProviderUrl)
            .apply((url) => `${url.replace(/^https:\/\//, '')}:`);

        const assumeRolePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    actions: ['sts:AssumeRoleWithWebIdentity'],
                    conditions: [
                        {
                            test: 'StringEquals',
                            values: [`system:serviceaccount:${namespace}:${serviceAccountName}`],
                            variable: oidcProviderConditionPrefix.apply((prefix) => `${prefix}sub`),
                        },
                        {
                            test: 'StringEquals',
                            values: ['sts.amazonaws.com'],
                            variable: oidcProviderConditionPrefix.apply((prefix) => `${prefix}aud`),
                        },
                    ],
                    effect: 'Allow',
                    principals: [{ identifiers: [args.oidcProviderArn], type: 'Federated' }],
                },
            ],
        });

        this.serviceAccountRole = new aws.iam.Role(
            `${name}-service-account-role`,
            {
                assumeRolePolicy: assumeRolePolicy.json,
                description: `IRSA role for ARC controller service account ${namespace}/${serviceAccountName}`,
                tags: args.tags,
            },
            { parent: this },
        );

        this.release = new k8s.helm.v3.Release(
            name,
            {
                name: releaseName,
                chart: ARC_CONTROLLER_CHART_REFERENCE,
                namespace,
                createNamespace: false,
                cleanupOnFail: true,
                atomic: true,
                timeout: 600,
                version: args.chartVersion ?? undefined,
                values: {
                    serviceAccount: {
                        create: true,
                        name: serviceAccountName,
                        annotations: {
                            'eks.amazonaws.com/role-arn': this.serviceAccountRole.arn,
                        },
                    },
                    ...(args.proxyEnv
                        ? {
                              env: [
                                  { name: 'HTTP_PROXY', value: args.proxyEnv.httpProxy },
                                  { name: 'HTTPS_PROXY', value: args.proxyEnv.httpsProxy },
                                  { name: 'NO_PROXY', value: args.proxyEnv.noProxy },
                                  { name: 'http_proxy', value: args.proxyEnv.httpProxy },
                                  { name: 'https_proxy', value: args.proxyEnv.httpsProxy },
                                  { name: 'no_proxy', value: args.proxyEnv.noProxy },
                              ],
                          }
                        : {}),
                },
            },
            {
                parent: this,
                dependsOn: args.namespaceResource
                    ? [args.namespaceResource, this.serviceAccountRole]
                    : [this.serviceAccountRole],
                deleteBeforeReplace: true,
            },
        );

        this.controllerNamespace = this.release.namespace;
        this.releaseName = this.release.name;
        this.serviceAccountName = pulumi.output(serviceAccountName);
        this.serviceAccountRoleArn = this.serviceAccountRole.arn;
        this.ready = this.release.status.apply((status) => status.status === 'deployed');

        if (args.enableHaConstraints) {
            // The gha-runner-scale-set-controller chart sets app.kubernetes.io/name=gha-rs-controller
            // and app.kubernetes.io/instance=<releaseName> on controller pods.
            this.podDisruptionBudget = new k8s.policy.v1.PodDisruptionBudget(
                `${name}-pdb`,
                {
                    metadata: {
                        name: `${releaseName}-pdb`,
                        namespace,
                    },
                    spec: {
                        minAvailable: 1,
                        selector: {
                            matchLabels: {
                                'app.kubernetes.io/name': 'gha-rs-controller',
                                'app.kubernetes.io/instance': releaseName,
                            },
                        },
                    },
                },
                { parent: this, dependsOn: [this.release] },
            );
        }

        this.registerOutputs({
            namespace: this.controllerNamespace,
            releaseName: this.releaseName,
            serviceAccountName: this.serviceAccountName,
            serviceAccountRoleArn: this.serviceAccountRoleArn,
            ready: this.ready,
        });
    }
}

export default ArcController;

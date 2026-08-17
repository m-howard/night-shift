import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { BaseK8sComponent, BaseK8sComponentArgs, NodeGroupToleration } from '../../types';

/**
 * Interface for the arguments accepted by the Dynatrace class.
 */
export interface DynatraceArgs extends BaseK8sComponentArgs {
    /** The name of the Kubernetes cluster. */
    clusterName: pulumi.Input<string>;
    /** The tolerations for the Kubernetes nodes. */
    nodeTolerations?: pulumi.Input<NodeGroupToleration[]>;
    /** The API token for Dynatrace. */
    apiToken: pulumi.Input<string>;
    /** The data ingest token for Dynatrace. */
    dataIngestToken: pulumi.Input<string>;
    /** The base URL for Dynatrace. */
    baseUrl: pulumi.Input<string>;
}

/**
 * Dynatrace is a Pulumi ComponentResource that deploys the dynatrace
 * to a Kubernetes cluster using a Helm chart.
 */
export class Dynatrace extends BaseK8sComponent {
    public readonly chartDynatraceUrn: pulumi.Output<string>;

    /**
     * Creates a new instance of the Dynatrace.
     *
     * @param name - The unique name of the resource.
     * @param args - The arguments to configure the dynatrace.
     * @param opts - Options for the resource.
     */
    constructor(name: string, args: DynatraceArgs, opts?: pulumi.ComponentResourceOptions) {
        super('mtx:k8s:Dynatrace', name, args, opts);

        const config = new pulumi.Config('k8sDynatrace');

        const clusterName = args.clusterName;
        const nodeTolerations = args.nodeTolerations || [];

        const dtApiToken = args.apiToken || config.get('apiToken') || '';
        const dtDataIngestToken = args.dataIngestToken || config.get('dataIngestToken') || '';
        const dtBaseUrl = args.baseUrl || config.get('baseUrl') || '';

        const apiUrl = pulumi.interpolate`${dtBaseUrl}/api`;

        const k8sNamespace = new k8s.core.v1.Namespace(
            name,
            {
                metadata: {
                    name: this.namespace,
                },
            },
            {
                parent: this,
            },
        );

        const k8sChart = new k8s.helm.v3.Release(
            name,
            {
                chart: 'dynatrace-operator',
                version: this.version,
                namespace: k8sNamespace.metadata.name,
                createNamespace: false,
                cleanupOnFail: true,
                recreatePods: true,
                timeout: 600,
                repositoryOpts: {
                    repo: 'https://raw.githubusercontent.com/Dynatrace/dynatrace-operator/main/config/helm/repos/stable',
                },
                values: {
                    platform: 'kubernetes',
                    installCRD: true,
                    csidriver: {
                        enabled: true,
                        tolerations: nodeTolerations,
                    },
                },
            },
            {
                parent: this,
                dependsOn: [k8sNamespace],
                deleteBeforeReplace: true,
            },
        );

        const k8sSecret = new k8s.core.v1.Secret(
            name,
            {
                metadata: {
                    namespace: this.namespace,
                    name: clusterName,
                },
                type: 'Opaque',
                data: {
                    apiToken: dtApiToken,
                    dataIngestToken: dtDataIngestToken,
                },
            },
            {
                parent: this,
                dependsOn: [k8sNamespace, k8sChart],
                deletedWith: k8sNamespace,
            },
        );

        pulumi
            .all([k8sNamespace.metadata.name, k8sSecret, k8sChart.urn])
            .apply(([namespaceName]) => {
                new k8s.apiextensions.CustomResource(
                    `${name}-dynakube`,
                    {
                        apiVersion: 'dynatrace.com/v1beta1',
                        kind: 'DynaKube',
                        metadata: {
                            namespace: namespaceName,
                            name: clusterName,
                            annotations: {
                                'feature.dynatrace.com/automatic-kubernetes-api-monitoring': 'true',
                            },
                        },
                        spec: {
                            apiUrl: apiUrl,
                            skipCertCheck: false,
                            oneAgent: {
                                cloudNativeFullStack: {
                                    tolerations: nodeTolerations,
                                },
                            },
                            activeGate: {
                                capabilities: ['routing', 'kubernetes-monitoring', 'dynatrace-api'],
                                image: undefined,
                                resources: {
                                    requests: {
                                        cpu: '500m',
                                        memory: '512Mi',
                                    },
                                    limits: {
                                        cpu: '1000m',
                                        memory: '1.5Gi',
                                    },
                                },
                            },
                            namespaceSelector: {
                                matchExpressions: [
                                    {
                                        key: 'kubernetes.io/metadata.name',
                                        operator: 'NotIn',
                                        values: ['default', 'gha', 'crowdstrike', 'monitoring'],
                                    },
                                ],
                            },
                        },
                    },
                    {
                        parent: this,
                        deletedWith: k8sNamespace,
                    },
                );
            });

        this.chartDynatraceUrn = k8sChart.urn;

        this.registerOutputs({
            chartFalconUrn: this.chartDynatraceUrn,
        });
    }
}

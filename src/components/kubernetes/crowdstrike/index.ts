import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { BaseK8sComponent, BaseK8sComponentArgs, NodeGroupToleration } from '../../types';

/**
 * Interface for the arguments accepted by the Crowdstrike class.
 */
export interface CrowdstrikeArgs extends BaseK8sComponentArgs {
    /** Enable CrowdStrike deployment for the cluster. */
    enabled?: boolean;
    /** The Helm chart version for the Falcon sensor release. */
    sensorChartVersion?: pulumi.Input<string>;
    /** The tolerations for the nodes in the Kubernetes cluster. */
    nodeTolerations?: pulumi.Input<NodeGroupToleration[]>;
    /** The API token for Crowdstrike, used to derive the Falcon CID. */
    apiToken: pulumi.Input<string>;
    /** The Docker API token for Crowdstrike image registry authentication. */
    dockerApiToken: pulumi.Input<string>;
}

/**
 * Crowdstrike is a Pulumi ComponentResource that deploys the crowdstrike
 * to a Kubernetes cluster using a Helm chart.
 */
export class Crowdstrike extends BaseK8sComponent {
    public readonly chartFalconUrn?: pulumi.Output<string>;

    /**
     * Creates a new instance of the Crowdstrike.
     *
     * @param name - The unique name of the resource.
     * @param args - The arguments to configure the crowdstrike.
     * @param opts - Options for the resource.
     */
    constructor(name: string, args: CrowdstrikeArgs, opts?: pulumi.ComponentResourceOptions) {
        super('mtx:k8s:Crowdstrike', name, args, opts);

        if (args.enabled === false) {
            this.registerOutputs({});
            return;
        }

        const config = new pulumi.Config('k8sCrowdstrike');

        const nodeTolerations = args.nodeTolerations || [];

        const csApiToken = args.apiToken || config.get('apiToken') || '';
        const csDockerApiToken = args.dockerApiToken || config.get('dockerApiToken') || '';
        const sensorChartVersion = args.sensorChartVersion || this.version || '1.35.0';
        const falconCid = pulumi
            .output(csApiToken)
            .apply((token) => (token.includes('-') ? token : `${token}-9B`));
        const falconRegistryAuth = pulumi
            .all([falconCid, pulumi.output(csDockerApiToken)])
            .apply(([cid, dockerApiToken]) => {
                const registryUsername = `fc-${cid.split('-')[0].toLowerCase()}`;
                const registryHost = 'registry.crowdstrike.com';
                const auth = Buffer.from(`${registryUsername}:${dockerApiToken}`).toString(
                    'base64',
                );

                return Buffer.from(
                    JSON.stringify({
                        auths: {
                            [registryHost]: {
                                auth,
                                password: dockerApiToken,
                                username: registryUsername,
                            },
                        },
                    }),
                ).toString('base64');
            });

        // The Falcon sensor needs privileged pod security labels on its namespace.
        const k8sNamespace = new k8s.core.v1.Namespace(
            name,
            {
                metadata: {
                    name: this.namespace,
                    annotations: {
                        'kubernetes.io/metadata.name': this.namespace,
                        'pod-security.kubernetes.io/warn': 'privileged',
                        'pod-security.kubernetes.io/audit': 'privileged',
                        'pod-security.kubernetes.io/enforce': 'privileged',
                    },
                },
            },
            {
                parent: this,
            },
        );

        const falconChart = new k8s.helm.v3.Release(
            `${name}-fs`,
            {
                name: 'falcon-helm',
                chart: 'falcon-sensor',
                version: sensorChartVersion,
                namespace: this.namespace,
                createNamespace: false,
                recreatePods: true,
                timeout: 120,
                cleanupOnFail: true,
                repositoryOpts: {
                    repo: 'https://crowdstrike.github.io/falcon-helm',
                },
                values: {
                    message_log: true,
                    falcon: {
                        cid: falconCid,
                    },
                    node: {
                        enabled: true,
                        image: {
                            repository: 'registry.crowdstrike.com/falcon-node-sensor',
                            registryConfigJSON: falconRegistryAuth,
                        },
                        daemonset: {
                            podAnnotationKey: 'sensor.falcon-system.crowdstrike.com/injection',
                            tolerations: nodeTolerations,
                        },
                    },
                    container: {
                        enabled: false,
                    },
                },
            },
            {
                parent: this,
                dependsOn: [k8sNamespace],
                deleteBeforeReplace: true,
                deletedWith: k8sNamespace,
            },
        );

        this.chartFalconUrn = falconChart.urn;

        this.registerOutputs({
            chartFalconUrn: this.chartFalconUrn,
        });
    }
}

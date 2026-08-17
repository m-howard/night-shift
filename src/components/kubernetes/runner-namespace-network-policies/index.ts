import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {
    NamespaceEgressRuleConfig,
    RunnerClassConfig,
    RunnerNamespaceNetworkPolicyConfig,
} from '../../types';

export interface RunnerNamespaceNetworkPoliciesArgs {
    runnerClasses: RunnerClassConfig[];
    config: RunnerNamespaceNetworkPolicyConfig;
}

export interface RunnerNamespaceNetworkPolicySpec {
    namespace: string;
    name: string;
    spec: pulumi.Input<k8s.types.input.networking.v1.NetworkPolicySpec>;
}

const KUBERNETES_NAMESPACE_LABEL = 'kubernetes.io/metadata.name';

const toKubernetesNameFragment = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 40);

export const getRunnerNamespaceNames = (runnerClasses: RunnerClassConfig[]): string[] =>
    Array.from(new Set(runnerClasses.map((runnerClass) => runnerClass.namespace)));

const buildNamespacePeer = (
    namespaceName: string,
    podLabels: Record<string, string> = {},
): k8s.types.input.networking.v1.NetworkPolicyPeer => ({
    namespaceSelector: {
        matchLabels: {
            [KUBERNETES_NAMESPACE_LABEL]: namespaceName,
        },
    },
    podSelector: {
        matchLabels: podLabels,
    },
});

const buildAdditionalEgressSpec = (
    rule: NamespaceEgressRuleConfig,
): pulumi.Input<k8s.types.input.networking.v1.NetworkPolicySpec> => ({
    podSelector: {},
    policyTypes: ['Egress'],
    egress: [
        {
            to: rule.cidrs.map((cidr) => ({
                ipBlock: {
                    cidr,
                },
            })),
            ports: rule.ports.map((portConfig) => ({
                port: portConfig.port,
                protocol: portConfig.protocol || 'TCP',
            })),
        },
    ],
});

export const getNetworkPolicyNamespaceNames = (runnerClasses: RunnerClassConfig[]): string[] =>
    Array.from(
        new Set(
            runnerClasses
                .filter((runnerClass) => runnerClass.networkPolicy === true)
                .map((runnerClass) => runnerClass.namespace),
        ),
    );

export const buildRunnerNamespaceNetworkPolicySpecs = (args: {
    runnerClasses: RunnerClassConfig[];
    config: RunnerNamespaceNetworkPolicyConfig;
    clusterApiServerCidr: pulumi.Input<string>;
}): RunnerNamespaceNetworkPolicySpec[] => {
    if (!args.config.enabled) {
        return [];
    }

    return getNetworkPolicyNamespaceNames(args.runnerClasses).flatMap((namespaceName) => {
        const additionalRules = args.config.additionalEgressRules[namespaceName] || [];
        const isDirectEgress = (args.config.directEgressNamespaces ?? []).includes(namespaceName);

        return [
            {
                namespace: namespaceName,
                name: 'default-deny-ingress',
                spec: {
                    podSelector: {},
                    policyTypes: ['Ingress'],
                },
            },
            {
                namespace: namespaceName,
                name: 'default-deny-egress',
                spec: {
                    podSelector: {},
                    policyTypes: ['Egress'],
                },
            },
            {
                namespace: namespaceName,
                name: 'allow-dns-egress',
                spec: {
                    podSelector: {},
                    policyTypes: ['Egress'],
                    egress: [
                        {
                            to: [
                                buildNamespacePeer(
                                    args.config.dnsNamespace,
                                    args.config.dnsPodLabels,
                                ),
                            ],
                            ports: [
                                {
                                    port: 53,
                                    protocol: 'UDP',
                                },
                                {
                                    port: 53,
                                    protocol: 'TCP',
                                },
                            ],
                        },
                    ],
                },
            },
            {
                namespace: namespaceName,
                name: 'allow-kubernetes-api-egress',
                spec: {
                    podSelector: {},
                    policyTypes: ['Egress'],
                    egress: [
                        {
                            to: [
                                {
                                    ipBlock: {
                                        cidr: args.clusterApiServerCidr,
                                    },
                                },
                            ],
                            ports: [
                                {
                                    port: 443,
                                    protocol: 'TCP',
                                },
                            ],
                        },
                    ],
                },
            },
            // Namespaces whose runner classes all opt out of proxying receive
            // direct internet egress (TCP 80/443) instead of proxy-only egress.
            ...(isDirectEgress
                ? [
                      {
                          namespace: namespaceName,
                          name: 'allow-direct-internet-egress',
                          spec: {
                              podSelector: {},
                              policyTypes: ['Egress'],
                              egress: [
                                  {
                                      to: [{ ipBlock: { cidr: '0.0.0.0/0' } }],
                                      ports: [
                                          { port: 80, protocol: 'TCP' },
                                          { port: 443, protocol: 'TCP' },
                                      ],
                                  },
                              ],
                          },
                      },
                  ]
                : [
                      {
                          namespace: namespaceName,
                          name: 'allow-egress-proxy-egress',
                          spec: {
                              podSelector: {},
                              policyTypes: ['Egress'],
                              egress: [
                                  {
                                      to: [
                                          buildNamespacePeer(
                                              args.config.proxyNamespace,
                                              args.config.proxyPodLabels,
                                          ),
                                      ],
                                      ports: [
                                          {
                                              port: args.config.proxyPort,
                                              protocol: 'TCP',
                                          },
                                      ],
                                  },
                              ],
                          },
                      },
                  ]),
            ...additionalRules.map((rule) => ({
                namespace: namespaceName,
                name: `allow-additional-egress-${toKubernetesNameFragment(rule.name)}`,
                spec: buildAdditionalEgressSpec(rule),
            })),
        ];
    });
};

/**
 * Creates default-deny runner namespace NetworkPolicies with DNS, Kubernetes API,
 * proxy, and configurable namespace-specific egress exceptions.
 */
export class RunnerNamespaceNetworkPolicies extends pulumi.ComponentResource {
    public readonly policies: Record<string, k8s.networking.v1.NetworkPolicy>;
    public readonly policyNamesByNamespace: pulumi.Output<Record<string, string[]>>;

    constructor(
        name: string,
        args: RunnerNamespaceNetworkPoliciesArgs,
        opts?: pulumi.ComponentResourceOptions,
    ) {
        super('github-runners-eks:kubernetes:RunnerNamespaceNetworkPolicies', name, {}, opts);

        if (!args.config.enabled) {
            this.policies = {};
            this.policyNamesByNamespace = pulumi.output({} as Record<string, string[]>);
            this.registerOutputs({
                policyNamesByNamespace: this.policyNamesByNamespace,
            });
            return;
        }

        const kubernetesApiService = k8s.core.v1.Service.get(
            `${name}-kubernetes-api`,
            'default/kubernetes',
            {
                parent: this,
                provider: opts?.provider,
            },
        );

        const clusterApiServerCidr = pulumi
            .output(kubernetesApiService.spec.clusterIP)
            .apply((clusterIp) => {
                if (!clusterIp) {
                    throw new Error('default/kubernetes service did not expose a clusterIP');
                }

                return `${clusterIp}/32`;
            });

        const specs = buildRunnerNamespaceNetworkPolicySpecs({
            runnerClasses: args.runnerClasses,
            config: args.config,
            clusterApiServerCidr,
        });

        this.policies = Object.fromEntries(
            specs.map((policySpec) => {
                const resourceKey = `${policySpec.namespace}/${policySpec.name}`;
                const resource = new k8s.networking.v1.NetworkPolicy(
                    `${name}-${policySpec.namespace}-${policySpec.name}`,
                    {
                        metadata: {
                            namespace: policySpec.namespace,
                            name: policySpec.name,
                        },
                        spec: policySpec.spec,
                    },
                    {
                        parent: this,
                    },
                );

                return [resourceKey, resource];
            }),
        );

        this.policyNamesByNamespace = pulumi.output(
            specs.reduce<Record<string, string[]>>((accumulator, policySpec) => {
                accumulator[policySpec.namespace] = accumulator[policySpec.namespace] || [];
                accumulator[policySpec.namespace].push(policySpec.name);
                return accumulator;
            }, {}),
        );

        this.registerOutputs({
            policyNamesByNamespace: this.policyNamesByNamespace,
        });
    }
}

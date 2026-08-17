import { createHash } from 'node:crypto';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/** Configuration for the SquidProxy Pulumi component. */
export interface SquidProxyArgs {
    /** Kubernetes namespace where the proxy will be deployed. */
    namespace: string;
    /** Domain and IP allowlist entries used to generate Squid ACLs. */
    allowlist: string[];
    /** Number of Squid pod replicas. */
    replicas?: number;
    /** ClusterIP service name. */
    serviceName?: string;
    /** Squid listening port. */
    port?: number;
    /** Squid container image. */
    image?: string;
    /** CPU request for each Squid pod. */
    cpuRequest?: string;
    /** Memory request for each Squid pod. */
    memoryRequest?: string;
    /** CPU limit for each Squid pod. */
    cpuLimit?: string;
    /** Memory limit for each Squid pod. */
    memoryLimit?: string;
    /**
     * Enable HA constraints: a PodDisruptionBudget (minAvailable: 1) and
     * topology spread constraints for AZ distribution.
     */
    enableHaConstraints?: boolean;
    /** Reference to the namespace resource for dependency ordering. */
    namespaceResource?: k8s.core.v1.Namespace;
}

const DEFAULT_REPLICAS = 2;
const DEFAULT_SERVICE_NAME = 'squid-proxy';
const DEFAULT_PORT = 3128;
const DEFAULT_IMAGE = 'ubuntu/squid:5.2-22.04_beta';
const DEFAULT_CPU_REQUEST = '250m';
const DEFAULT_MEMORY_REQUEST = '256Mi';
const DEFAULT_CPU_LIMIT = '500m';
const DEFAULT_MEMORY_LIMIT = '512Mi';

/**
 * Generates a squid.conf configuration string from the provided allowlist.
 *
 * Entries starting with '.' or '*.' are treated as domain suffixes.
 * Entries containing '/' are treated as CIDR blocks.
 * All other entries are treated as exact domain matches.
 */
export const buildSquidConfig = (allowlist: string[], port: number): string => {
    const domainEntries: string[] = [];
    const cidrEntries: string[] = [];

    for (const entry of allowlist) {
        const trimmed = entry.trim();
        if (!trimmed) {
            continue;
        }
        if (trimmed.includes('/')) {
            cidrEntries.push(trimmed);
        } else {
            // Normalize wildcard patterns to Squid domain notation
            const normalized = trimmed.startsWith('*.') ? trimmed.slice(1) : trimmed;
            if (domainEntries.includes(normalized)) {
                continue;
            }

            const isCoveredByExistingSuffix = domainEntries.some(
                (existingDomain) =>
                    existingDomain.startsWith('.') && normalized.endsWith(existingDomain),
            );
            if (isCoveredByExistingSuffix) {
                continue;
            }

            if (normalized.startsWith('.')) {
                for (let index = domainEntries.length - 1; index >= 0; index -= 1) {
                    if (domainEntries[index].endsWith(normalized)) {
                        domainEntries.splice(index, 1);
                    }
                }
            }

            domainEntries.push(normalized);
        }
    }

    const lines: string[] = [
        '# Squid proxy configuration — managed by Pulumi',
        '',
        '# ACL definitions',
        'acl localnet src 10.0.0.0/8',
        'acl localnet src 100.64.0.0/10',
        'acl localnet src 172.16.0.0/12',
        'acl localnet src 192.168.0.0/16',
        'acl SSL_ports port 443',
        'acl Safe_ports port 80',
        'acl Safe_ports port 443',
        'acl CONNECT method CONNECT',
        '',
    ];

    if (domainEntries.length > 0) {
        lines.push('# Allowed domains');
        for (const domain of domainEntries) {
            lines.push(`acl allowed_domains dstdomain ${domain}`);
        }
        lines.push('');
    }

    if (cidrEntries.length > 0) {
        lines.push('# Allowed CIDRs');
        for (const cidr of cidrEntries) {
            lines.push(`acl allowed_cidrs dst ${cidr}`);
        }
        lines.push('');
    }

    lines.push(
        '# Access rules',
        'http_access deny !Safe_ports',
        'http_access deny CONNECT !SSL_ports',
        'http_access allow localhost manager',
        'http_access deny manager',
    );

    if (domainEntries.length > 0) {
        lines.push('http_access allow localnet allowed_domains');
    }
    if (cidrEntries.length > 0) {
        lines.push('http_access allow localnet allowed_cidrs');
    }

    lines.push('http_access deny all', '');

    lines.push(
        '# Listener',
        `http_port ${port}`,
        '',
        '# Logging',
        'access_log daemon:/var/log/squid/access.log squid',
        'cache_log /var/log/squid/cache.log',
        '',
        '# Cache settings',
        'cache_mem 128 MB',
        'maximum_object_size 256 MB',
        'cache_dir ufs /var/spool/squid 1000 16 256',
        '',
        '# Misc',
        'coredump_dir /var/spool/squid',
        'visible_hostname squid-proxy',
        '',
    );

    return lines.join('\n');
};

/**
 * SquidProxy deploys an in-cluster Squid forward proxy with domain/IP allowlisting.
 *
 * The component creates a ConfigMap with the generated squid.conf, a Deployment
 * with the configured replica count, and a ClusterIP Service for internal access.
 */
export class SquidProxy extends pulumi.ComponentResource {
    /** The generated squid.conf ConfigMap. */
    public readonly configMap: k8s.core.v1.ConfigMap;
    /** The Squid Deployment. */
    public readonly deployment: k8s.apps.v1.Deployment;
    /** The ClusterIP Service fronting the Squid pods. */
    public readonly service: k8s.core.v1.Service;
    /** PodDisruptionBudget ensuring at least one Squid replica is always available. Present only when enableHaConstraints is true. */
    public readonly podDisruptionBudget?: k8s.policy.v1.PodDisruptionBudget;
    /** Fully-qualified in-cluster proxy endpoint URL. */
    public readonly proxyEndpoint: pulumi.Output<string>;

    constructor(name: string, args: SquidProxyArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:kubernetes:SquidProxy', name, {}, opts);

        const namespace = args.namespace;
        const port = args.port ?? DEFAULT_PORT;
        const replicas = args.replicas ?? DEFAULT_REPLICAS;
        const serviceName = args.serviceName ?? DEFAULT_SERVICE_NAME;
        const image = args.image ?? DEFAULT_IMAGE;
        const cpuRequest = args.cpuRequest ?? DEFAULT_CPU_REQUEST;
        const memoryRequest = args.memoryRequest ?? DEFAULT_MEMORY_REQUEST;
        const cpuLimit = args.cpuLimit ?? DEFAULT_CPU_LIMIT;
        const memoryLimit = args.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
        const enableHaConstraints = args.enableHaConstraints ?? false;

        if (args.allowlist.length === 0) {
            throw new Error('SquidProxy requires at least one allowlist entry');
        }

        const appLabels: Record<string, string> = {
            'app.kubernetes.io/name': 'squid-proxy',
            'app.kubernetes.io/managed-by': 'pulumi',
        };

        const squidConf = buildSquidConfig(args.allowlist, port);
        const squidConfigChecksum = createHash('sha256').update(squidConf).digest('hex');

        this.configMap = new k8s.core.v1.ConfigMap(
            `${name}-config`,
            {
                metadata: {
                    name: `${serviceName}-config`,
                    namespace,
                },
                data: {
                    'squid.conf': squidConf,
                },
            },
            { parent: this },
        );

        this.deployment = new k8s.apps.v1.Deployment(
            `${name}-deployment`,
            {
                metadata: {
                    name: serviceName,
                    namespace,
                    labels: appLabels,
                },
                spec: {
                    replicas,
                    selector: {
                        matchLabels: appLabels,
                    },
                    template: {
                        metadata: {
                            labels: appLabels,
                            annotations: {
                                'checksum/squid-config': squidConfigChecksum,
                            },
                        },
                        spec: {
                            topologySpreadConstraints: enableHaConstraints
                                ? [
                                      {
                                          maxSkew: 1,
                                          topologyKey: 'topology.kubernetes.io/zone',
                                          whenUnsatisfiable: 'DoNotSchedule',
                                          labelSelector: { matchLabels: appLabels },
                                      },
                                  ]
                                : undefined,
                            containers: [
                                {
                                    name: 'squid',
                                    image,
                                    ports: [
                                        {
                                            containerPort: port,
                                            protocol: 'TCP',
                                        },
                                    ],
                                    resources: {
                                        requests: {
                                            cpu: cpuRequest,
                                            memory: memoryRequest,
                                        },
                                        limits: {
                                            cpu: cpuLimit,
                                            memory: memoryLimit,
                                        },
                                    },
                                    volumeMounts: [
                                        {
                                            name: 'squid-config',
                                            mountPath: '/etc/squid/squid.conf',
                                            subPath: 'squid.conf',
                                            readOnly: true,
                                        },
                                    ],
                                    readinessProbe: {
                                        tcpSocket: {
                                            port,
                                        },
                                        initialDelaySeconds: 5,
                                        periodSeconds: 10,
                                    },
                                    livenessProbe: {
                                        tcpSocket: {
                                            port,
                                        },
                                        initialDelaySeconds: 10,
                                        periodSeconds: 30,
                                    },
                                },
                            ],
                            volumes: [
                                {
                                    name: 'squid-config',
                                    configMap: {
                                        name: this.configMap.metadata.name,
                                    },
                                },
                            ],
                        },
                    },
                },
            },
            { parent: this, dependsOn: [this.configMap] },
        );

        if (enableHaConstraints) {
            this.podDisruptionBudget = new k8s.policy.v1.PodDisruptionBudget(
                `${name}-pdb`,
                {
                    metadata: {
                        name: `${serviceName}-pdb`,
                        namespace,
                    },
                    spec: {
                        minAvailable: 1,
                        selector: { matchLabels: appLabels },
                    },
                },
                { parent: this, dependsOn: [this.deployment] },
            );
        }

        this.service = new k8s.core.v1.Service(
            `${name}-service`,
            {
                metadata: {
                    name: serviceName,
                    namespace,
                    labels: appLabels,
                },
                spec: {
                    type: 'ClusterIP',
                    selector: appLabels,
                    ports: [
                        {
                            port,
                            targetPort: port,
                            protocol: 'TCP',
                            name: 'squid',
                        },
                    ],
                },
            },
            { parent: this, dependsOn: [this.deployment] },
        );

        this.proxyEndpoint = pulumi.output(
            `http://${serviceName}.${namespace}.svc.cluster.local:${port}`,
        );

        this.registerOutputs({
            proxyEndpoint: this.proxyEndpoint,
        });
    }
}

import * as pulumi from '@pulumi/pulumi';
import net from 'node:net';
import { EcrArgs, NodeGroupToleration } from '..';

// Minimal placeholder types for optional integrations — expand as needed.
export interface CoderLicenseConfig {
    licenseKey?: string;
}

export interface CoderServerEnvConfig {
    [key: string]: string | number | boolean | undefined;
}

export interface S3BucketConfig {
    name?: string;
    acl?: string;
}

/** Base configuration type for all configurations */
export type BaseConfig = object;

export type RunnerArchitecture = 'amd64' | 'arm64';
export type PodSecurityAdmissionProfile = 'baseline' | 'restricted' | 'privileged';

/** Kubernetes-style resource requests and limits for a runner class. */
export interface RunnerResourceSpec {
    cpu: string;
    memory: string;
    ephemeralStorage?: string;
}

/** Resource configuration for an ARC runner class. */
export interface RunnerResourcesConfig {
    requests: RunnerResourceSpec;
    limits?: Partial<RunnerResourceSpec>;
}

/** Additional storage sizing for runner classes that need larger work volumes. */
export interface RunnerStorageConfig {
    workVolumeSizeGiB?: number;
    storageClassName?: string;
}

/** ECR registry cache settings for warm-cache container builds. */
export interface EcrCacheConfig {
    /** Enable ECR registry cache integration. */
    enabled: boolean;
    /** ECR registry URL used as the BuildKit cache backend (type=registry). */
    registryUrl?: string;
    /** Key prefix applied to cache refs to avoid collisions across repos. */
    cachePrefix?: string;
    /** Maximum age in days before cached layers are considered stale (advisory). */
    maxAgeDays?: number;
}

/** Rootless BuildKit sidecar configuration for build runner classes. */
export interface BuildEngineConfig {
    /** Build engine type. Only rootless BuildKit is supported. */
    type: 'buildkit';
    /** Container image for the BuildKit daemon sidecar. */
    image?: string;
    /** Resource requests and limits for the BuildKit sidecar container. */
    resources?: RunnerResourcesConfig;
    /** ECR registry cache backend configuration. */
    ecrCache?: EcrCacheConfig;
}

/**
 * Per-runner-class egress proxy configuration.
 *
 * When omitted, the runner class inherits the global `enableArcProxyEnv` behavior.
 * Set `enabled: false` to opt a runner class out of proxy injection; the runner
 * class must then use a dedicated namespace so that namespace-level network
 * policies can permit direct internet egress instead of proxy-only egress.
 */
export interface RunnerClassProxyConfig {
    /** Whether proxy env vars are injected into this runner class's pods. */
    enabled: boolean;
    /** Additional NO_PROXY entries appended to the global list for this class only. */
    additionalNoProxy?: string[];
}

/** Per-class configuration for runner scale sets. */
export interface RunnerClassConfig {
    name: string;
    namespace: string;
    labels: string[];
    minRunners: number;
    maxRunners: number;
    architecture: RunnerArchitecture;
    resources: RunnerResourcesConfig;
    nodeSelector?: Record<string, string>;
    maxDurationMinutes: number;
    storage?: RunnerStorageConfig;
    /**
     * @deprecated Use `buildEngine` presence to determine Docker build capability.
     * Retained for backward compatibility; ignored by validation and runtime logic.
     */
    supportsDockerBuilds?: boolean;
    /**
     * Build engine sidecar configuration.
     *
     * When present, the runner class receives a rootless BuildKit sidecar,
     * the `BUILDKIT_HOST` env var, and (when ECR cache is enabled) the
     * ECR IRSA policy attachment and `BUILDKIT_CACHE_REGISTRY` env var.
     */
    buildEngine?: BuildEngineConfig;
    /**
     * Container image for the GitHub Actions runner.
     * Defaults to `ghcr.io/actions/actions-runner:latest` when omitted.
     */
    runnerImage?: string;
    /**
     * Per-runner-class egress proxy override.
     * When omitted the class inherits the global `enableArcProxyEnv` default.
     */
    egressProxy?: RunnerClassProxyConfig;
    /**
     * Whether default-deny network policies are applied to this runner class's
     * namespace by the `RunnerNamespaceNetworkPolicies` component.
     *
     * When `true`, the namespace receives default-deny ingress/egress policies
     * plus selective allow rules for DNS, Kubernetes API, and proxy or direct
     * internet egress. When omitted or `false`, no network policies are created
     * for the namespace.
     */
    networkPolicy?: boolean;
    /**
     * Explicit GitHub-visible runner scale set name.
     *
     * When set, this value (after sanitization) becomes the Helm release name and
     * `runnerScaleSetName` registered with GitHub instead of the value derived from
     * `name`. Use this field to rename the scale set that appears in GitHub without
     * changing the logical `name` key used for stack outputs and workload identity.
     *
     * When omitted the scale set name is derived from `name` automatically.
     */
    scaleSetName?: string;
    /**
     * Previous scale set names that this runner class was registered under.
     *
     * Adding entries here is informational only — it is used to detect config
     * mistakes (e.g. two classes claiming the same previous name) and to document
     * the rename history.  ARC registration cleanup for the old name must be
     * performed by the `deleteBeforeReplace` + `replaceOnChanges` mechanism on
     * the Helm release.
     */
    previousScaleSetNames?: string[];
}

/** Namespace metadata created during compute stack bootstrap. */
export interface NamespaceDefinition {
    name: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
}

export type NetworkPolicyProtocol = 'TCP' | 'UDP' | 'SCTP';

/** Port definition for configurable network policy egress rules. */
export interface NetworkPolicyPortConfig {
    port: number;
    protocol?: NetworkPolicyProtocol;
}

/** Additional external egress allowed for a namespace under default-deny policy. */
export interface NamespaceEgressRuleConfig {
    name: string;
    cidrs: string[];
    ports: NetworkPolicyPortConfig[];
}

/** Network policy settings for runner namespaces. */
export interface RunnerNamespaceNetworkPolicyConfig {
    enabled: boolean;
    dnsNamespace: string;
    dnsPodLabels: Record<string, string>;
    proxyNamespace: string;
    proxyPodLabels?: Record<string, string>;
    proxyPort: number;
    additionalEgressRules: Record<string, NamespaceEgressRuleConfig[]>;
    /**
     * Namespaces that should receive direct internet egress rules instead of
     * proxy-only egress. Populated automatically from runner classes whose
     * `egressProxy.enabled` is `false`.
     */
    directEgressNamespaces?: string[];
}

const MAX_SCALE_SET_NAME_LENGTH = 45;

/**
 * Converts a PascalCase or camelCase identifier into a Kubernetes-safe
 * kebab-case name.  Exported so both the ARC component and config validation
 * use the same normalisation logic.
 */
export const sanitizeKubernetesName = (value: string): string =>
    value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

/**
 * Derives the effective GitHub-visible scale set name for a runner class.
 *
 * When `runnerClass.scaleSetName` is set it takes precedence over the
 * automatic derivation from `runnerClass.name`.  The result is sanitised
 * and truncated to 45 characters to satisfy Kubernetes and ARC constraints.
 */
export const resolveScaleSetName = (runnerClass: RunnerClassConfig): string => {
    const raw = runnerClass.scaleSetName ?? runnerClass.name;
    const baseName = sanitizeKubernetesName(raw);

    if (!baseName) {
        throw new Error(
            `Runner class '${runnerClass.name}' must resolve to a non-empty scale set name`,
        );
    }

    if (baseName.length <= MAX_SCALE_SET_NAME_LENGTH) {
        return baseName;
    }

    return baseName.slice(0, MAX_SCALE_SET_NAME_LENGTH).replace(/-+$/g, '');
};

const buildPodSecurityAdmissionLabels = (
    enforce: PodSecurityAdmissionProfile,
    warn: PodSecurityAdmissionProfile,
    audit: PodSecurityAdmissionProfile,
): Record<string, string> => ({
    'pod-security.kubernetes.io/enforce': enforce,
    'pod-security.kubernetes.io/warn': warn,
    'pod-security.kubernetes.io/audit': audit,
});

const DEFAULT_PROXY_NO_PROXY = [
    '127.0.0.1',
    'localhost',
    '::1',
    '.svc',
    '.svc.cluster.local',
    '.cluster.local',
    'kubernetes',
    'kubernetes.default',
    'kubernetes.default.svc',
    '169.254.169.254',
];

// GitHub publishes the Copilot cloud agent allowlist with a mix of host, path, and IP entries.
// Our Squid ACLs are host/CIDR based, so path-scoped entries are widened to the host and literal
// IPs are represented as /32 CIDRs. Keep the existing GitHub runner domains as compatibility
// entries because self-hosted runners still need direct GitHub repo/API access beyond the cloud
// agent firewall defaults.
const DEFAULT_PROXY_ALLOWLIST = Array.from(
    new Set([
        // Core GitHub and Copilot cloud agent endpoints.
        '.github.com',
        '*.actions.githubusercontent.com',
        '*.githubusercontent.com',
        'raw.githubusercontent.com',
        'objects.githubusercontent.com',
        'lfs.github.com',
        'github-cloud.githubusercontent.com',
        'github-cloud.s3.amazonaws.com',
        'codeload.github.com',
        'scanning-api.github.com',
        'api.mcp.github.com',
        'api.business.githubcopilot.com',
        'uploads.github.com',
        'ghcr.io',
        'pkg-containers.githubusercontent.com',

        // Single-host IP entries published in GitHub's recommended allowlist.
        '168.63.129.16/32',

        // Certificate revocation and OCSP responders used during TLS validation.
        'crl3.digicert.com',
        'crl4.digicert.com',
        'ocsp.digicert.com',
        'ts-crl.ws.symantec.com',
        'ts-ocsp.ws.symantec.com',
        's.symcb.com',
        's.symcd.com',
        'crl.geotrust.com',
        'ocsp.geotrust.com',
        'crl.thawte.com',
        'ocsp.thawte.com',
        'crl.verisign.com',
        'ocsp.verisign.com',
        'crl.globalsign.com',
        'ocsp.globalsign.com',
        'crls.ssl.com',
        'ocsp.ssl.com',
        'crl.identrust.com',
        'ocsp.identrust.com',
        'crl.sectigo.com',
        'ocsp.sectigo.com',
        'crl.usertrust.com',
        'ocsp.usertrust.com',

        // Internal bridge and base image endpoints GitHub documents for cloud agent workloads.
        // Risk acceptance: these wildcard entries remain broader than ideal because GitHub's
        // documented cloud-agent dependencies span registries and mirrors that do not publish a
        // stable exact-host allowlist. We rely on ephemeral runners, namespace isolation, and
        // least-privilege job credentials as compensating controls until narrower upstream host
        // sets are available.
        '172.18.0.1/32',
        'registry.hub.docker.com',
        '*.docker.io',
        '*.docker.com',
        'production.cloudflare.docker.com',
        'auth.docker.io',
        'quay.io',
        'mcr.microsoft.com',
        'gcr.io',
        'public.ecr.aws',

        // AWS endpoints required by the shared CodeArtifact authentication action and npm client.
        'sts.us-east-1.amazonaws.com',
        'ix-prod-365831045551.d.codeartifact.us-east-1.amazonaws.com',

        // GitHub Actions artifact/result storage accounts.
        ...Array.from(
            { length: 20 },
            (_unusedValue, index) => `productionresultssa${index}.blob.core.windows.net`,
        ),

        // .NET and Azure package feeds.
        'nuget.org',
        'dist.nuget.org',
        'api.nuget.org',
        'nuget.pkg.github.com',
        'dotnet.microsoft.com',
        'pkgs.dev.azure.com',
        'builds.dotnet.microsoft.com',
        'dotnetcli.blob.core.windows.net',
        'nugetregistryv2prod.blob.core.windows.net',
        'azuresearch-usnc.nuget.org',
        'azuresearch-ussc.nuget.org',
        'dc.services.visualstudio.com',
        'dot.net',
        'download.visualstudio.microsoft.com',
        'dotnetcli.azureedge.net',
        'ci.dot.net',
        'www.microsoft.com',
        'oneocsp.microsoft.com',

        // Dart and Go ecosystem registries.
        'pub.dev',
        'pub.dartlang.org',
        'storage.googleapis.com',
        'go.dev',
        'golang.org',
        'proxy.golang.org',
        'sum.golang.org',
        'pkg.go.dev',
        'goproxy.io',

        // Haskell and JVM ecosystem package repositories.
        'haskell.org',
        '*.hackage.haskell.org',
        'get-ghcup.haskell.org',
        'downloads.haskell.org',
        'www.java.com',
        'jdk.java.net',
        'api.adoptium.net',
        'adoptium.net',
        'search.maven.org',
        'maven.apache.org',
        'repo.maven.apache.org',
        'repo1.maven.org',
        'maven.pkg.github.com',
        'maven-central.storage-download.googleapis.com',
        'maven.google.com',
        'maven.oracle.com',
        'jcenter.bintray.com',
        'oss.sonatype.org',
        'repo.spring.io',
        'gradle.org',
        'services.gradle.org',
        'plugins.gradle.org',
        'plugins-artifacts.gradle.org',
        'repo.grails.org',
        'download.eclipse.org',
        'download.oracle.com',

        // JavaScript package registries and runtime installers.
        'npmjs.org',
        'npmjs.com',
        'registry.npmjs.com',
        'registry.npmjs.org',
        'skimdb.npmjs.com',
        'npm.pkg.github.com',
        'api.npms.io',
        'nodejs.org',
        'yarnpkg.com',
        'registry.yarnpkg.com',
        'repo.yarnpkg.com',
        'deb.nodesource.com',
        'get.pnpm.io',
        'bun.sh',
        'deno.land',
        'registry.bower.io',
        'binaries.prisma.sh',

        // Perl, PHP, and Python package registries.
        'cpan.org',
        'www.cpan.org',
        'metacpan.org',
        'cpan.metacpan.org',
        'repo.packagist.org',
        'packagist.org',
        'getcomposer.org',
        'pypi.python.org',
        'pypi.org',
        'pip.pypa.io',
        '*.pythonhosted.org',
        'files.pythonhosted.org',
        'bootstrap.pypa.io',
        'conda.binstar.org',
        'conda.anaconda.org',
        'binstar.org',
        'anaconda.org',
        'download.pytorch.org',
        'repo.continuum.io',
        'repo.anaconda.com',

        // Ruby, Rust, Swift, and CocoaPods package sources.
        'rubygems.org',
        'api.rubygems.org',
        'rubygems.pkg.github.com',
        'bundler.rubygems.org',
        'gems.rubyforge.org',
        'gems.rubyonrails.org',
        'index.rubygems.org',
        'cache.ruby-lang.org',
        '*.rvm.io',
        'crates.io',
        'index.crates.io',
        'static.crates.io',
        'sh.rustup.rs',
        'static.rust-lang.org',
        'download.swift.org',
        'swift.org',
        'cocoapods.org',
        'cdn.cocoapods.org',

        // Infrastructure tooling and browser automation downloads.
        'releases.hashicorp.com',
        'apt.releases.hashicorp.com',
        'yum.releases.hashicorp.com',
        'registry.terraform.io',
        'json-schema.org',
        'json.schemastore.org',
        'playwright.download.prss.microsoft.com',
        'cdn.playwright.dev',
        'playwright.azureedge.net',
        'playwright-akamai.azureedge.net',
        'playwright-verizon.azureedge.net',

        // Linux distribution package repositories and OS-level dependencies.
        'archive.ubuntu.com',
        'security.ubuntu.com',
        'ppa.launchpad.net',
        'keyserver.ubuntu.com',
        'azure.archive.ubuntu.com',
        'api.snapcraft.io',
        'deb.debian.org',
        'security.debian.org',
        'keyring.debian.org',
        'packages.debian.org',
        'debian.map.fastlydns.net',
        'apt.llvm.org',
        'dl.fedoraproject.org',
        'mirrors.fedoraproject.org',
        'download.fedoraproject.org',
        'mirror.centos.org',
        'vault.centos.org',
        'dl-cdn.alpinelinux.org',
        'pkg.alpinelinux.org',
        'mirror.archlinux.org',
        'archlinux.org',
        'download.opensuse.org',
        'cdn.redhat.com',
        'packagecloud.io',
        'packages.cloud.google.com',
        'packages.microsoft.com',

        // Kubernetes package repositories.
        'dl.k8s.io',
        'pkgs.k8s.io',
    ]),
);

const DEFAULT_RUNNER_NAMESPACE_NETWORK_POLICY_CONFIG: RunnerNamespaceNetworkPolicyConfig = {
    enabled: true,
    dnsNamespace: 'kube-system',
    dnsPodLabels: {
        'k8s-app': 'kube-dns',
    },
    proxyNamespace: 'egress-proxy',
    proxyPodLabels: {},
    proxyPort: 3128,
    additionalEgressRules: {},
};

const cloneNetworkPolicyPortConfig = (port: NetworkPolicyPortConfig): NetworkPolicyPortConfig => ({
    ...port,
});

const cloneNamespaceEgressRuleConfig = (
    rule: NamespaceEgressRuleConfig,
): NamespaceEgressRuleConfig => ({
    ...rule,
    cidrs: [...rule.cidrs],
    ports: rule.ports.map(cloneNetworkPolicyPortConfig),
});

const cloneRunnerNamespaceNetworkPolicyConfig = (
    config: RunnerNamespaceNetworkPolicyConfig,
): RunnerNamespaceNetworkPolicyConfig => ({
    ...config,
    dnsPodLabels: { ...config.dnsPodLabels },
    proxyPodLabels: config.proxyPodLabels ? { ...config.proxyPodLabels } : undefined,
    additionalEgressRules: Object.fromEntries(
        Object.entries(config.additionalEgressRules).map(([namespaceName, rules]) => [
            namespaceName,
            rules.map(cloneNamespaceEgressRuleConfig),
        ]),
    ),
    directEgressNamespaces: config.directEgressNamespaces
        ? [...config.directEgressNamespaces]
        : undefined,
});

/**
 * Resolved proxy environment variables to inject into ARC controller and runner pods.
 * Set http_proxy / HTTP_PROXY and their HTTPS and NO_PROXY counterparts so that
 * both case-sensitive and case-insensitive consumers pick up the configuration.
 */
export interface ArcProxyEnvConfig {
    /** HTTP proxy URL, e.g. http://squid-proxy.egress-proxy.svc.cluster.local:3128 */
    httpProxy: pulumi.Input<string>;
    /** HTTPS proxy URL — typically the same endpoint when using a CONNECT-capable proxy. */
    httpsProxy: pulumi.Input<string>;
    /** Comma-separated list of hosts and domains that bypass the proxy. */
    noProxy: pulumi.Input<string>;
}

/** Default proxy exclusions for cluster-local ARC traffic. */
export const buildDefaultNoProxy = (): string[] => [...DEFAULT_PROXY_NO_PROXY];

/** Default allowlist for outbound proxy destinations needed by GitHub runners. */
export const buildDefaultProxyAllowlist = (): string[] => [...DEFAULT_PROXY_ALLOWLIST];

/** Default network policy settings for runner namespaces. */
export const buildDefaultRunnerNamespaceNetworkPolicyConfig =
    (): RunnerNamespaceNetworkPolicyConfig =>
        cloneRunnerNamespaceNetworkPolicyConfig(DEFAULT_RUNNER_NAMESPACE_NETWORK_POLICY_CONFIG);

/** Default platform namespaces derived from the runner catalog plus control-plane namespaces. */
export const buildDefaultNamespaceDefinitions = (
    runnerClasses: RunnerClassConfig[],
): NamespaceDefinition[] => {
    const namespaceNames = new Set<string>(['arc-system', 'egress-proxy']);

    runnerClasses.forEach((runnerClass) => {
        namespaceNames.add(runnerClass.namespace);
    });

    return Array.from(namespaceNames).map((namespaceName) => ({
        name: namespaceName,
    }));
};

/** Pod Security Admission labels applied to hardened runner and proxy namespaces. */
export const getPodSecurityAdmissionLabels = (
    psaProfile: PodSecurityAdmissionProfile,
): Record<string, string> => {
    switch (psaProfile) {
        case 'baseline':
            return buildPodSecurityAdmissionLabels('baseline', 'restricted', 'restricted');
        case 'restricted':
            return buildPodSecurityAdmissionLabels('restricted', 'restricted', 'restricted');
        case 'privileged':
            return buildPodSecurityAdmissionLabels('privileged', 'privileged', 'privileged');
        default: {
            const unreachableProfile: never = psaProfile;
            throw new Error(`Unsupported PSA profile: ${unreachableProfile}`);
        }
    }
};

/**
 * Applies Pod Security Admission labels to namespace definitions when namespace hardening is enabled.
 * Generated PSA labels are authoritative for hardened namespaces and override conflicting PSA inputs.
 */
export const applyPodSecurityAdmissionLabels = (
    namespaceDefinitions: NamespaceDefinition[],
    hardenRunnerNamespaces: boolean,
    psaProfile: PodSecurityAdmissionProfile,
): NamespaceDefinition[] => {
    return namespaceDefinitions.map((namespaceDefinition) => {
        const clonedDefinition: NamespaceDefinition = {
            ...namespaceDefinition,
            annotations: namespaceDefinition.annotations
                ? { ...namespaceDefinition.annotations }
                : undefined,
            labels: namespaceDefinition.labels ? { ...namespaceDefinition.labels } : undefined,
        };

        if (!hardenRunnerNamespaces) {
            return clonedDefinition;
        }

        return {
            ...clonedDefinition,
            labels: {
                ...(clonedDefinition.labels || {}),
                ...getPodSecurityAdmissionLabels(psaProfile),
            },
        };
    });
};

/**
 * Scaling SLO thresholds for runner workloads.
 *
 * These values drive CloudWatch alarm thresholds and serve as documented SLO targets
 * for runner startup latency and queue depth.
 */
export interface ScalingSlOs {
    /**
     * Maximum acceptable runner startup latency in seconds from job queue to runner ready.
     * Jobs that exceed this threshold trigger an alarm. Default: 120 seconds.
     */
    runnerStartupLatencySeconds: number;
    /**
     * Number of consecutively queued jobs that triggers a scale-out alarm.
     * Indicates that the runner pool is undersized for demand. Default: 5.
     */
    queuedJobThreshold: number;
    /**
     * Duration in minutes a runner pod may be pending before an alarm fires.
     * Catches scheduling failures or resource exhaustion. Default: 10 minutes.
     */
    pendingPodThresholdMinutes: number;
}

/** Base configuration type that varies based on compute feature flag selection */
export type DefaultConfig = {
    /** Backward-compatible alias for the original ARC feature flag. */
    arcEnabled?: boolean;
    /** Enable or disable ARC controller deployment. */
    deployArc: boolean;
    /** Enable or disable ARC runner scale set deployment. */
    deployArcRunnerScaleSets: boolean;
    /** Helm chart version override for ARC components. */
    arcChartVersion: string | null;
    /** Optional Helm release name override for the ARC controller. */
    arcControllerReleaseName?: string | null;
    /** Optional service account name override for the ARC controller. */
    arcControllerServiceAccountName?: string | null;
    /** GitHub organization that owns the runner registration targets. */
    githubOrg: string | null;
    /** Name of the core secret for the Maglev infrastructure */
    coreSecretName: string;
    /** Secret name used by ARC controller and runner namespaces for GitHub App credentials. */
    arcAuthSecretName: string;
    /** Optional AWS Secrets Manager secret ID or ARN override for the GitHub App credentials source. */
    secretsManagerArn: string | null;
    /** Domain name for the application (e.g., 'dev.btp.modernatx.net') */
    domainName: string;
    /** Route53 hosted zone ID for the domain */
    hostedZoneId: string;
    /** Optional IAM role ARN for EKS cluster admin access */
    clusterAdminRoleArn?: string;
    /** Networking information for compute and datastore resources */
    networking: VpcInfo;
    /** Optional DNS configuration to use for all applications */
    dns?: DnsConfig | DnsConfig[];
    /** ECR repository configuration */
    ecr?: Omit<EcrArgs, 'name'>;
    /** Optional GitHub ECR OIDC role configuration */
    githubEcrOidcRole?: GitHubEcrOidcRoleConfig;
    /** Name of the secret containing application-specific credentials */
    secretName?: string;
    /** Runner class definitions for ARC runner scale sets. */
    runnerClasses: RunnerClassConfig[];
    /** Kubernetes namespaces created during compute stack bootstrap. */
    namespaceDefinitions: NamespaceDefinition[];
    /** Enable or disable Squid proxy deployment. */
    deploySquidProxy: boolean;
    /** Enable or disable HTTP(S) proxy environment variable injection into ARC runner pods (global default). */
    enableArcProxyEnv: boolean;
    /** Explicit HTTP proxy URL override for ARC runner pods. */
    arcProxyHttpUrl: string | null;
    /** Explicit HTTPS proxy URL override for ARC runner pods. */
    arcProxyHttpsUrl: string | null;
    /** Explicit NO_PROXY entries for ARC runner pods. */
    arcProxyNoProxy: string[];
    /**
     * Enable or disable proxy environment variable injection into the ARC controller pod.
     * Independent of runner proxy settings so the controller can be proxied even when
     * some runner classes opt out.
     */
    enableControllerProxyEnv: boolean;
    /** Explicit HTTP proxy URL override for the ARC controller. Defaults to the Squid endpoint when deploySquidProxy is true. */
    controllerProxyHttpUrl: string | null;
    /** Explicit HTTPS proxy URL override for the ARC controller. */
    controllerProxyHttpsUrl: string | null;
    /** Explicit NO_PROXY entries for the ARC controller. Defaults to the global arcProxyNoProxy list. */
    controllerProxyNoProxy: string[];
    /**
     * Domain and IP allowlist used by the Squid proxy ACLs.
     *
     * Risk acceptance: environment-specific overrides are currently treated as trusted
     * operator-authored repository config, not untrusted end-user input. Entries are
     * expected to come from reviewed changes in `src/config/*` and are not yet validated
     * against Squid directive injection patterns beyond normal TypeScript string handling.
     */
    proxyAllowlist: string[];
    /** Default-deny network policy settings for runner namespaces. */
    runnerNamespaceNetworkPolicies: RunnerNamespaceNetworkPolicyConfig;
    /** Enable or disable observability resources. */
    deployObservability: boolean;
    /** SNS topic ARN for alarm notifications. */
    alarmSnsTopicArn: string | null;
    /**
     * When true, create and use a dedicated SNS topic for observability alarms.
     * This is useful when the environment should own its own alarm destination
     * instead of referencing a pre-existing shared topic ARN.
     */
    createAlarmSnsTopic?: boolean;
    /** Optional SNS topic name to use when `createAlarmSnsTopic` is enabled. */
    alarmSnsTopicName?: string | null;
    /** Runbook URL included with alarm metadata and outputs. */
    runbookUrl: string | null;
    /**
     * Enable CrowdStrike Falcon sensor deployment.
     * When true, credentials are read from the core secret (coreSecretName) using keys
     * crowdstrike_api_token and crowdstrike_docker_api_token.
     */
    deployCrowdstrikeFalconSensor: boolean;
    /** CrowdStrike Falcon sensor configuration (chart versions, namespace, tolerations). */
    crowdstrike?: CrowdstrikeConfig;
    /**
     * Enable Dynatrace operator deployment.
     * When true, credentials are read from the core secret (coreSecretName) using keys
     * dynatrace_api_token and dynatrace_data_ingest_token.
     * Requires dynatrace.baseUrl to be set.
     */
    deployDynatraceOperator: boolean;
    /** Dynatrace operator configuration (chart version, base URL, namespace, tolerations). */
    dynatrace?: DynatraceConfig;
    /** Enable or disable namespace hardening for runner workloads. */
    hardenRunnerNamespaces: boolean;
    /** Pod Security Admission profile applied to runner namespaces. */
    psaProfile: PodSecurityAdmissionProfile;
    /**
     * Enable HA constraints (PodDisruptionBudgets and topology spread) for critical components.
     * When true, PDBs with minAvailable: 1 are created for the ARC controller and Squid proxy,
     * and AZ topology spread constraints are applied to the Squid proxy deployment.
     * Recommended for production environments.
     */
    enableHaConstraints?: boolean;
    /**
     * Enable the centralized GitHub App token broker.
     *
     * When true, a Lambda function reads the GitHub App private key from Secrets
     * Manager, generates short-lived installation tokens, and stores them in a
     * dedicated token secret.  External Secrets Operator syncs the token into
     * runner namespaces as the `arc-github-auth` K8s Secret, replacing direct
     * private key distribution.
     *
     * When false (default), the legacy `ArcAuthSecretSync` component materialises
     * the full GitHub App credentials directly into runner namespaces.
     */
    deployTokenBroker?: boolean;
    /**
     * How often the token broker Lambda runs, in minutes.
     * Must be less than 60 (GitHub installation tokens expire after 1 hour).
     * Default: 30.
     */
    tokenBrokerRefreshMinutes?: number;
    /**
     * AWS Secrets Manager secret ARN or name where the token broker writes
     * short-lived GitHub installation tokens.
     *
     * When `deployTokenBroker` is true and this is omitted, a new secret is
     * created automatically by the token broker component.
     */
    tokenSecretArn?: string | null;
    /** Scaling SLO thresholds for runner startup latency and queued-job alerting. */
    scalingSlOs?: ScalingSlOs;
    /** Optional default health check path for all services of this app (e.g. '/health') */
    healthCheckPath?: string;
    /** S3 bucket configurations */
    s3?: S3BucketConfig[];
    /** Required AWS resource tags */
    tags: TagsInfo;
};

/** Configuration for enabling/disabling various infrastructure features */
export interface FeatureFlags {
    /** Enable EBS default volume encryption in the region */
    ebsEncryption?: boolean;
    /** Enable S3 bucket public access blocking at the account level */
    s3AccessBlock?: boolean;
}

/** VPC and networking configuration */
export interface VpcInfo {
    /** VPC ID */
    vpcId: string | pulumi.Input<string>;
    /** VPC CIDR ranges */
    vpcCidrs: string[] | pulumi.Input<string[]>;
    /** Public subnet IDs (optional; omit for fully-private clusters) */
    publicSubnetIds?: string[] | pulumi.Input<string[]>;
    /** Private subnet IDs */
    privateSubnetIds: string[] | pulumi.Input<string[]>;
    /** Control plane non-routable subnet IDs */
    cpNonroutableSubnetIds: string[] | pulumi.Input<string[]>;
    /** Data plane non-routable subnet IDs */
    dpNonroutableSubnetIds: string[] | pulumi.Input<string[]>;
    /** Enable public access to the EKS API endpoint. */
    endpointPublicAccess?: boolean;
    /** Enable private access to the EKS API endpoint. */
    endpointPrivateAccess?: boolean;
    /** CIDR blocks allowed to reach the EKS control plane. */
    controlPlaneIngressCidrs?: string[] | pulumi.Input<string[]>;
    /** CIDR blocks the cluster security group can reach. */
    clusterSecurityGroupEgressCidrs?: string[] | pulumi.Input<string[]>;
    /** Optional VPC endpoints configuration */
    vpcEndpoints?: {
        /** List of AWS services to create VPC endpoints for */
        services: string[];
    };
}

/** DNS configuration for the application(s) */
export interface DnsConfig {
    /** Subdomain for the DNS zone */
    zoneSubdomain: string;
    /** Enable internal DNS resolution */
    internal: boolean;
    /** Enable wildcard certificate */
    wildcardCert?: boolean;
    /** Existing hosted zone ID if using an existing zone */
    existingHostedZoneId?: string;
    /** Existing ACM certificate ARN if using an existing certificate */
    existingCertificateArn?: string;
}

/** EKS cluster configuration */
export interface EksConfig {
    /** Kubernetes version */
    version: string;
    /** EKS cluster name */
    clusterName: string;
    /** ARN of the admin IAM role */
    adminRoleArn: string;
    /** CrowdStrike security configuration */
    crowdstrike?: CrowdstrikeConfig;
    /** Dynatrace monitoring configuration */
    dynatrace: DynatraceConfig;
}

/** CrowdStrike security configuration for EKS */
export interface CrowdstrikeConfig {
    /** Enable CrowdStrike deployment in EKS */
    enabled?: boolean;
    /** CrowdStrike version compatibility alias for the Falcon sensor chart */
    version?: string;
    /** Falcon sensor Helm chart version */
    sensorChartVersion?: string;
    /** CrowdStrike API token used to derive the Falcon CID */
    apiToken?: string;
    /** CrowdStrike Docker API token used for registry authentication */
    dockerApiToken?: string;
    /** Node tolerations for CrowdStrike Falcon sensor */
    nodeTolerations?: NodeGroupToleration[];
    /** AWS Secrets Manager secret ID containing CrowdStrike credentials */
    secretId?: string;
}

/** Dynatrace monitoring configuration for EKS */
export interface DynatraceConfig {
    /** Dynatrace operator version */
    version: string;
    /** Dynatrace environment URL */
    baseUrl: string;
    /** Dynatrace API token */
    apiToken?: string;
    /** Dynatrace data ingest token */
    dataIngestToken?: string;
    /** Node tolerations for Dynatrace operator */
    nodeTolerations?: NodeGroupToleration[];
    /** AWS Secrets Manager secret ID containing Dynatrace credentials */
    secretId?: string;
}

/** GitHub OIDC role configuration for ECR access */
export interface GitHubEcrOidcRoleConfig {
    /** GitHub organization name */
    githubOrg: string;
    /** GitHub repository name */
    githubRepo: string;
}

/** AWS resource tagging configuration */
export type DataClassificationType = 'PUBLIC' | 'CONFIDENTIAL' | 'RESTRICTED' | 'SENSITIVE';
export interface TagsInfo {
    /** Resource owner name/team */
    owner: string;
    /** Project sponsor */
    sponsor: string;
    /** Department responsible for the resource */
    department: string;
    /** Team support distribution list */
    'team-support-dl': string;
    /** Deployment environment */
    environment: 'dev' | 'val' | 'prd';
    /** Compliance level for the resource */
    compliance: 'NONE' | 'SOX' | 'PHI' | 'PCI' | 'PII' | 'GXP';
    /** Data classification level */
    'data-classification': DataClassificationType;
    /** Service tier level */
    'service-tier': 'tier1' | 'tier2' | 'tier3';
    /** Application name */
    'application-name': string;
}

/** Environment-specific configuration mapping */
export interface EnvironmentConfig {
    /** Map of environment names to their configurations */
    [key: string]: BaseConfig | (() => BaseConfig);
}

const CPU_QUANTITY_PATTERN = /^(?:\d+(?:\.\d+)?|\d+m)$/;
const BYTE_QUANTITY_PATTERN = /^(?:\d+(?:\.\d+)?)(?:Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|k)?$/;

const isNonEmptyString = (value: string | null | undefined): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

const isValidPortNumber = (value: number): boolean =>
    Number.isInteger(value) && value >= 1 && value <= 65535;

const isValidCidr = (value: string): boolean => {
    const [ip, prefixLength] = value.split('/');

    if (!ip || !prefixLength || !/^\d+$/.test(prefixLength)) {
        return false;
    }

    const normalizedIp = ip.trim();
    const normalizedPrefix = Number.parseInt(prefixLength, 10);
    const family = net.isIP(normalizedIp);

    if (family === 4) {
        return normalizedPrefix >= 0 && normalizedPrefix <= 32;
    }

    if (family === 6) {
        return normalizedPrefix >= 0 && normalizedPrefix <= 128;
    }

    return false;
};

const validateQuantity = (
    value: string | undefined,
    path: string,
    pattern: RegExp,
    typeLabel: string,
    errors: string[],
): void => {
    if (!isNonEmptyString(value)) {
        errors.push(`${path} must be a non-empty string`);
        return;
    }

    if (!pattern.test(value.trim())) {
        errors.push(`${path} must be a valid Kubernetes ${typeLabel} quantity`);
    }
};

const validateRunnerResourceSpec = (
    spec: Partial<RunnerResourceSpec>,
    path: string,
    errors: string[],
): void => {
    if (spec.cpu !== undefined) {
        validateQuantity(spec.cpu, `${path}.cpu`, CPU_QUANTITY_PATTERN, 'CPU', errors);
    }

    if (spec.memory !== undefined) {
        validateQuantity(spec.memory, `${path}.memory`, BYTE_QUANTITY_PATTERN, 'memory', errors);
    }

    if (spec.ephemeralStorage !== undefined) {
        validateQuantity(
            spec.ephemeralStorage,
            `${path}.ephemeralStorage`,
            BYTE_QUANTITY_PATTERN,
            'storage',
            errors,
        );
    }
};

const validateRunnerClassConfig = (
    runnerClass: RunnerClassConfig,
    index: number,
    errors: string[],
): void => {
    const path = `runnerClasses[${index}]`;

    if (!isNonEmptyString(runnerClass.name)) {
        errors.push(`${path}.name must be a non-empty string`);
    }

    if (!isNonEmptyString(runnerClass.namespace)) {
        errors.push(`${path}.namespace must be a non-empty string`);
    }

    if (runnerClass.labels.length === 0) {
        errors.push(`${path}.labels must contain at least one label`);
    }

    runnerClass.labels.forEach((label, labelIndex) => {
        if (!isNonEmptyString(label)) {
            errors.push(`${path}.labels[${labelIndex}] must be a non-empty string`);
        }
    });

    if (!isNonNegativeInteger(runnerClass.minRunners)) {
        errors.push(`${path}.minRunners must be a non-negative integer`);
    }

    if (!isNonNegativeInteger(runnerClass.maxRunners)) {
        errors.push(`${path}.maxRunners must be a non-negative integer`);
    }

    if (runnerClass.minRunners > runnerClass.maxRunners) {
        errors.push(`${path}.minRunners must be less than or equal to maxRunners`);
    }

    if (!isPositiveInteger(runnerClass.maxDurationMinutes)) {
        errors.push(`${path}.maxDurationMinutes must be a positive integer`);
    }

    if (runnerClass.resources.requests.cpu === undefined) {
        errors.push(`${path}.resources.requests.cpu must be set`);
    }

    if (runnerClass.resources.requests.memory === undefined) {
        errors.push(`${path}.resources.requests.memory must be set`);
    }

    validateRunnerResourceSpec(
        runnerClass.resources.requests,
        `${path}.resources.requests`,
        errors,
    );

    if (runnerClass.resources.limits) {
        validateRunnerResourceSpec(
            runnerClass.resources.limits,
            `${path}.resources.limits`,
            errors,
        );
    }

    if (runnerClass.storage?.workVolumeSizeGiB !== undefined) {
        if (!isPositiveInteger(runnerClass.storage.workVolumeSizeGiB)) {
            errors.push(`${path}.storage.workVolumeSizeGiB must be a positive integer`);
        }
    }

    if (runnerClass.buildEngine) {
        const bePath = `${path}.buildEngine`;

        if (runnerClass.buildEngine.type !== 'buildkit') {
            errors.push(`${bePath}.type must be 'buildkit'`);
        }

        if (
            runnerClass.buildEngine.image !== undefined &&
            !isNonEmptyString(runnerClass.buildEngine.image)
        ) {
            errors.push(`${bePath}.image must be a non-empty string when provided`);
        }

        if (runnerClass.buildEngine.resources) {
            validateRunnerResourceSpec(
                runnerClass.buildEngine.resources.requests,
                `${bePath}.resources.requests`,
                errors,
            );

            if (runnerClass.buildEngine.resources.limits) {
                validateRunnerResourceSpec(
                    runnerClass.buildEngine.resources.limits,
                    `${bePath}.resources.limits`,
                    errors,
                );
            }
        }

        if (runnerClass.buildEngine.ecrCache) {
            if (
                runnerClass.buildEngine.ecrCache.registryUrl !== undefined &&
                !isNonEmptyString(runnerClass.buildEngine.ecrCache.registryUrl)
            ) {
                errors.push(
                    `${bePath}.ecrCache.registryUrl must be a non-empty string when provided`,
                );
            }

            if (
                runnerClass.buildEngine.ecrCache.maxAgeDays !== undefined &&
                !isPositiveInteger(runnerClass.buildEngine.ecrCache.maxAgeDays)
            ) {
                errors.push(`${bePath}.ecrCache.maxAgeDays must be a positive integer`);
            }
        }
    }

    if (runnerClass.scaleSetName !== undefined && !isNonEmptyString(runnerClass.scaleSetName)) {
        errors.push(`${path}.scaleSetName must be a non-empty string when provided`);
    }

    if (runnerClass.scaleSetName !== undefined) {
        const sanitized = sanitizeKubernetesName(runnerClass.scaleSetName);
        if (!sanitized) {
            errors.push(
                `${path}.scaleSetName '${runnerClass.scaleSetName}' must produce a valid Kubernetes name after sanitization`,
            );
        }
    }

    if (runnerClass.previousScaleSetNames !== undefined) {
        if (!Array.isArray(runnerClass.previousScaleSetNames)) {
            errors.push(`${path}.previousScaleSetNames must be an array when provided`);
        } else {
            const seenPrevious = new Set<string>();
            runnerClass.previousScaleSetNames.forEach((prev, prevIndex) => {
                if (!isNonEmptyString(prev)) {
                    errors.push(
                        `${path}.previousScaleSetNames[${prevIndex}] must be a non-empty string`,
                    );
                } else if (seenPrevious.has(prev)) {
                    errors.push(
                        `${path}.previousScaleSetNames[${prevIndex}] '${prev}' is a duplicate`,
                    );
                } else {
                    seenPrevious.add(prev);
                }
            });
        }
    }
};

const validateLabelMap = (
    labels: Record<string, string> | undefined,
    path: string,
    errors: string[],
): void => {
    if (!labels) {
        return;
    }

    Object.entries(labels).forEach(([key, value]) => {
        if (!isNonEmptyString(key)) {
            errors.push(`${path} contains an empty label key`);
        }

        if (!isNonEmptyString(value)) {
            errors.push(`${path}.${key} must be a non-empty string`);
        }
    });
};

const validateRunnerNamespaceNetworkPolicyConfig = (
    config: RunnerNamespaceNetworkPolicyConfig,
    runnerNamespaces: Set<string>,
    errors: string[],
): void => {
    const path = 'runnerNamespaceNetworkPolicies';

    if (!isNonEmptyString(config.dnsNamespace)) {
        errors.push(`${path}.dnsNamespace must be a non-empty string`);
    }

    validateLabelMap(config.dnsPodLabels, `${path}.dnsPodLabels`, errors);

    if (!isNonEmptyString(config.proxyNamespace)) {
        errors.push(`${path}.proxyNamespace must be a non-empty string`);
    }

    validateLabelMap(config.proxyPodLabels, `${path}.proxyPodLabels`, errors);

    if (!isValidPortNumber(config.proxyPort)) {
        errors.push(`${path}.proxyPort must be an integer between 1 and 65535`);
    }

    Object.entries(config.additionalEgressRules).forEach(([namespaceName, rules]) => {
        const rulePath = `${path}.additionalEgressRules.${namespaceName}`;

        if (!runnerNamespaces.has(namespaceName)) {
            errors.push(`${rulePath} references an unknown runner namespace`);
        }

        if (!Array.isArray(rules)) {
            errors.push(`${rulePath} must be an array`);
            return;
        }

        const seenRuleNames = new Set<string>();

        rules.forEach((rule, ruleIndex) => {
            const namespaceRulePath = `${rulePath}[${ruleIndex}]`;

            if (!isNonEmptyString(rule.name)) {
                errors.push(`${namespaceRulePath}.name must be a non-empty string`);
            } else if (seenRuleNames.has(rule.name)) {
                errors.push(`${namespaceRulePath}.name must be unique within the namespace`);
            } else {
                seenRuleNames.add(rule.name);
            }

            if (rule.cidrs.length === 0) {
                errors.push(`${namespaceRulePath}.cidrs must contain at least one CIDR`);
            }

            rule.cidrs.forEach((cidr, cidrIndex) => {
                if (!isValidCidr(cidr)) {
                    errors.push(`${namespaceRulePath}.cidrs[${cidrIndex}] must be a valid CIDR`);
                }
            });

            if (rule.ports.length === 0) {
                errors.push(`${namespaceRulePath}.ports must contain at least one port`);
            }

            rule.ports.forEach((portConfig, portIndex) => {
                if (!isValidPortNumber(portConfig.port)) {
                    errors.push(
                        `${namespaceRulePath}.ports[${portIndex}].port must be an integer between 1 and 65535`,
                    );
                }

                if (
                    portConfig.protocol !== undefined &&
                    !['TCP', 'UDP', 'SCTP'].includes(portConfig.protocol)
                ) {
                    errors.push(
                        `${namespaceRulePath}.ports[${portIndex}].protocol must be one of TCP, UDP, or SCTP`,
                    );
                }
            });
        });
    });
};

const isDefaultConfig = (config: BaseConfig): config is DefaultConfig => {
    if (typeof config !== 'object' || config === null) {
        return false;
    }

    const candidate = config as Partial<DefaultConfig>;
    return (
        typeof candidate.deployArc === 'boolean' &&
        typeof candidate.deployArcRunnerScaleSets === 'boolean' &&
        Array.isArray(candidate.runnerClasses)
    );
};

/** Returns true when the required Pulumi secret config keys for ARC auth are all set. */
export const hasArcAuthPulumiSecretConfig = (
    pulumiConfig: pulumi.Config = new pulumi.Config(),
): boolean => {
    return (
        pulumiConfig.getSecret('githubAppId') !== undefined &&
        pulumiConfig.getSecret('githubAppInstallationId') !== undefined &&
        pulumiConfig.getSecret('githubAppPrivateKey') !== undefined
    );
};

/** Resolves the AWS Secrets Manager secret ID used for ARC auth credentials. */
export const getArcAuthSecretSourceId = (config: DefaultConfig): string | null => {
    if (isNonEmptyString(config.secretsManagerArn)) {
        return config.secretsManagerArn;
    }

    if (config.deployArc && isNonEmptyString(config.coreSecretName)) {
        return config.coreSecretName;
    }

    return null;
};

/** Returns true when ARC auth secret sync has a configured source and the token broker is not enabled. */
export const shouldDeployArcAuthSecretSync = (
    config: DefaultConfig,
    pulumiConfig: pulumi.Config = new pulumi.Config(),
): boolean => {
    if (config.deployTokenBroker) {
        return false;
    }

    return (
        isNonEmptyString(getArcAuthSecretSourceId(config)) ||
        hasArcAuthPulumiSecretConfig(pulumiConfig)
    );
};

/** Returns true when the token broker should be deployed for centralized short-lived token auth. */
export const shouldDeployTokenBroker = (config: DefaultConfig): boolean => {
    return config.deployTokenBroker === true && config.deployArc;
};

/** Validates DefaultConfig combinations before any stack provisions resources. */
export const validateDefaultConfig = (config: DefaultConfig, env: string): void => {
    const errors: string[] = [];
    const runnerNamespaces = new Set(
        config.runnerClasses.map((runnerClass) => runnerClass.namespace),
    );
    const namespaceNames = new Set(
        config.namespaceDefinitions.map((definition) => definition.name),
    );
    const arcAuthSecretSyncEnabled = shouldDeployArcAuthSecretSync(config);

    if (config.deployArcRunnerScaleSets && !config.deployArc) {
        errors.push('deployArcRunnerScaleSets requires deployArc=true');
    }

    if (config.deployArc && !isNonEmptyString(config.githubOrg)) {
        errors.push('githubOrg must be set when deployArc=true');
    }

    if (config.arcChartVersion !== null && !isNonEmptyString(config.arcChartVersion)) {
        errors.push('arcChartVersion must be a non-empty string when provided');
    }

    if (
        config.arcControllerReleaseName !== undefined &&
        config.arcControllerReleaseName !== null &&
        !isNonEmptyString(config.arcControllerReleaseName)
    ) {
        errors.push('arcControllerReleaseName must be a non-empty string when provided');
    }

    if (
        config.arcControllerServiceAccountName !== undefined &&
        config.arcControllerServiceAccountName !== null &&
        !isNonEmptyString(config.arcControllerServiceAccountName)
    ) {
        errors.push('arcControllerServiceAccountName must be a non-empty string when provided');
    }

    if (!isNonEmptyString(config.coreSecretName)) {
        errors.push('coreSecretName must be a non-empty string');
    }

    if (config.secretsManagerArn !== null && !isNonEmptyString(config.secretsManagerArn)) {
        errors.push('secretsManagerArn must be a non-empty string when provided');
    }

    if (config.alarmSnsTopicArn !== null && !isNonEmptyString(config.alarmSnsTopicArn)) {
        errors.push('alarmSnsTopicArn must be a non-empty string when provided');
    }

    if (
        config.alarmSnsTopicName !== undefined &&
        config.alarmSnsTopicName !== null &&
        !isNonEmptyString(config.alarmSnsTopicName)
    ) {
        errors.push('alarmSnsTopicName must be a non-empty string when provided');
    }

    if (config.runbookUrl !== null && !isNonEmptyString(config.runbookUrl)) {
        errors.push('runbookUrl must be a non-empty string when provided');
    }

    if (config.createAlarmSnsTopic && config.alarmSnsTopicArn !== null) {
        errors.push(
            'createAlarmSnsTopic=true cannot be combined with alarmSnsTopicArn; choose either a managed topic or an existing topic ARN',
        );
    }

    if (
        (config.deployArc || arcAuthSecretSyncEnabled) &&
        !isNonEmptyString(config.arcAuthSecretName)
    ) {
        errors.push('arcAuthSecretName must be set when ARC auth secret sync is enabled');
    }

    if (config.deployArc && !arcAuthSecretSyncEnabled && !config.deployTokenBroker) {
        errors.push(
            'deployArc=true requires coreSecretName or secretsManagerArn to reference a Secrets Manager secret, or Pulumi secret config values githubAppId, githubAppInstallationId, and githubAppPrivateKey',
        );
    }

    if (config.deployArc && !namespaceNames.has('arc-system')) {
        errors.push('deployArc=true requires namespaceDefinitions to include arc-system');
    }

    if (config.deployDynatraceOperator && !config.dynatrace?.baseUrl) {
        errors.push('dynatrace.baseUrl must be set when deployDynatraceOperator=true');
    }

    if (config.deployCrowdstrikeFalconSensor && !isNonEmptyString(config.coreSecretName)) {
        errors.push(
            'coreSecretName must be set when deployCrowdstrikeFalconSensor=true (credentials are read from the core secret)',
        );
    }

    if (config.deployDynatraceOperator && !isNonEmptyString(config.coreSecretName)) {
        errors.push(
            'coreSecretName must be set when deployDynatraceOperator=true (credentials are read from the core secret)',
        );
    }

    if (config.deployTokenBroker) {
        if (!config.deployArc) {
            errors.push('deployTokenBroker requires deployArc=true');
        }

        if (
            !isNonEmptyString(config.coreSecretName) &&
            !isNonEmptyString(config.secretsManagerArn)
        ) {
            errors.push(
                'deployTokenBroker=true requires coreSecretName or secretsManagerArn to reference the GitHub App private key secret',
            );
        }

        if (
            config.tokenBrokerRefreshMinutes !== undefined &&
            (!isPositiveInteger(config.tokenBrokerRefreshMinutes) ||
                config.tokenBrokerRefreshMinutes >= 60)
        ) {
            errors.push(
                'tokenBrokerRefreshMinutes must be a positive integer less than 60 (GitHub installation tokens expire after 1 hour)',
            );
        }

        if (
            config.tokenSecretArn !== undefined &&
            config.tokenSecretArn !== null &&
            !isNonEmptyString(config.tokenSecretArn)
        ) {
            errors.push('tokenSecretArn must be a non-empty string when provided');
        }
    }

    if (config.runnerClasses.length === 0) {
        errors.push('runnerClasses must contain at least one runner class');
    }

    const seenRunnerClassNames = new Set<string>();
    const seenEffectiveScaleSetNames = new Set<string>();
    const allPreviousScaleSetNames = new Set<string>();
    config.runnerClasses.forEach((runnerClass, index) => {
        if (seenRunnerClassNames.has(runnerClass.name)) {
            errors.push(`runnerClasses[${index}].name '${runnerClass.name}' is a duplicate`);
        } else {
            seenRunnerClassNames.add(runnerClass.name);
        }

        // Detect duplicate effective scale set names across all runner classes.
        try {
            const effectiveName = resolveScaleSetName(runnerClass);
            if (seenEffectiveScaleSetNames.has(effectiveName)) {
                errors.push(
                    `runnerClasses[${index}] effective scale set name '${effectiveName}' is a duplicate`,
                );
            } else {
                seenEffectiveScaleSetNames.add(effectiveName);
            }

            // Detect collisions between an active name and another class's previous name.
            if (allPreviousScaleSetNames.has(effectiveName)) {
                errors.push(
                    `runnerClasses[${index}] effective scale set name '${effectiveName}' collides with a previousScaleSetNames entry from another class`,
                );
            }
        } catch {
            // resolveScaleSetName already throws for empty results; per-class
            // validation in validateRunnerClassConfig will report the details.
        }

        // Track previous names for cross-class collision detection.
        runnerClass.previousScaleSetNames?.forEach((prev) => {
            const sanitizedPrev = sanitizeKubernetesName(prev);
            if (seenEffectiveScaleSetNames.has(sanitizedPrev)) {
                errors.push(
                    `runnerClasses[${index}].previousScaleSetNames entry '${prev}' collides with an active scale set name`,
                );
            }
            allPreviousScaleSetNames.add(sanitizedPrev);
        });

        if (isNonEmptyString(runnerClass.namespace) && !namespaceNames.has(runnerClass.namespace)) {
            errors.push(
                `runnerClasses[${index}].namespace '${runnerClass.namespace}' is not present in namespaceDefinitions`,
            );
        }

        validateRunnerClassConfig(runnerClass, index, errors);
    });

    // Validate that proxied and non-proxied runner classes do not share a namespace.
    // Network policies are namespace-scoped, so mixing proxy modes within a single
    // namespace would leave one group with incorrect egress rules.
    const proxiedNamespaces = new Set<string>();
    const directEgressNamespaces = new Set<string>();
    config.runnerClasses.forEach((runnerClass) => {
        const proxyEnabled = runnerClass.egressProxy?.enabled ?? config.enableArcProxyEnv;
        if (proxyEnabled) {
            proxiedNamespaces.add(runnerClass.namespace);
        } else {
            directEgressNamespaces.add(runnerClass.namespace);
        }
    });
    for (const ns of proxiedNamespaces) {
        if (directEgressNamespaces.has(ns)) {
            errors.push(
                `namespace '${ns}' contains both proxied and non-proxied runner classes; ` +
                    'each proxy mode must use a dedicated namespace',
            );
        }
    }

    validateRunnerNamespaceNetworkPolicyConfig(
        config.runnerNamespaceNetworkPolicies,
        runnerNamespaces,
        errors,
    );

    if (errors.length > 0) {
        throw new Error(`Invalid config for environment ${env}: ${errors.join('; ')}`);
    }
};

/** Configuration loader utility class */
export class ConfigLoader {
    /**
     * Loads environment-specific configuration
     * @param config The environment configuration mapping
     * @param env The environment to load configuration for
     * @returns The typed configuration for the specified environment
     */
    public static loadConfig<T extends BaseConfig>(config: EnvironmentConfig, env: string): T {
        const envConfig = config[env];

        if (!envConfig) {
            throw new Error(`Config for environment ${env} not found`);
        }

        const resolvedConfig =
            typeof envConfig === 'function' ? (envConfig as () => T)() : (envConfig as T);

        this.validateLoadedConfig(resolvedConfig, env);

        return resolvedConfig;
    }

    private static validateLoadedConfig(config: BaseConfig, env: string): void {
        if (isDefaultConfig(config)) {
            validateDefaultConfig(config, env);
        }
    }
}

export default ConfigLoader;

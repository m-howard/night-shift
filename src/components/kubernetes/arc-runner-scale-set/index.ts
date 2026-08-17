import { createHash } from 'crypto';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {
    RunnerClassConfig,
    RunnerResourceSpec,
    BuildEngineConfig,
    ArcProxyEnvConfig,
    resolveScaleSetName,
} from '../../types';

const ARC_RUNNER_SCALE_SET_CHART_REFERENCE =
    'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set';
const DEFAULT_GITHUB_URL_PREFIX = 'https://github.com';
const DEFAULT_RUNNER_IMAGE = 'ghcr.io/actions/actions-runner:2.336.0';
const DEFAULT_BUILDKIT_IMAGE = 'moby/buildkit:v0.28.1-rootless';
const BUILDKIT_ADDR = 'unix:///run/user/1000/buildkit/buildkitd.sock';
const ARC_REGISTRATION_TRIGGER_LABEL = 'github-runners-eks/registration-trigger';

const buildGitHubConfigUrl = (githubOrg: string): string =>
    `${DEFAULT_GITHUB_URL_PREFIX}/${githubOrg.trim()}`;

const buildPodResourceSpec = (spec: Partial<RunnerResourceSpec>): Record<string, string> => {
    const resources: Record<string, string> = {};

    if (spec.cpu) {
        resources.cpu = spec.cpu;
    }

    if (spec.memory) {
        resources.memory = spec.memory;
    }

    if (spec.ephemeralStorage) {
        resources['ephemeral-storage'] = spec.ephemeralStorage;
    }

    return resources;
};

const buildWorkVolume = (runnerClass: RunnerClassConfig): Record<string, unknown>[] | undefined => {
    if (runnerClass.storage?.workVolumeSizeGiB === undefined) {
        return undefined;
    }

    return [
        {
            name: 'work',
            ephemeral: {
                volumeClaimTemplate: {
                    spec: {
                        accessModes: ['ReadWriteOnce'],
                        resources: {
                            requests: {
                                storage: `${runnerClass.storage.workVolumeSizeGiB}Gi`,
                            },
                        },
                        storageClassName: runnerClass.storage.storageClassName,
                    },
                },
            },
        },
    ];
};

/**
 * Builds the rootless BuildKit sidecar container spec for build runner classes.
 *
 * Runs as non-root uid 1000 with no privilege escalation and exposes a Unix
 * domain socket via an emptyDir volume shared with the runner container.
 *
 * @param config - Build engine config from the runner class definition.
 * @param buildCacheEcrUrl - ECR repository URL for the registry cache backend,
 *   sourced from the stateful-data stack output. Takes precedence over any
 *   URL specified in config.ecrCache.registryUrl.
 */
const buildBuildKitSidecar = (
    config: BuildEngineConfig,
    buildCacheEcrUrl?: pulumi.Input<string>,
): { container: Record<string, unknown>; volume: Record<string, unknown> } => {
    const image = config.image ?? DEFAULT_BUILDKIT_IMAGE;

    const sidecarResources: Record<string, unknown> = {};

    if (config.resources?.requests) {
        sidecarResources.requests = buildPodResourceSpec(config.resources.requests);
    }

    if (config.resources?.limits) {
        const limits = buildPodResourceSpec(config.resources.limits);

        if (Object.keys(limits).length > 0) {
            sidecarResources.limits = limits;
        }
    }

    const env: Record<string, pulumi.Input<string>>[] = [
        { name: 'BUILDKITD_FLAGS', value: '--oci-worker-no-process-sandbox' },
    ];

    const effectiveEcrUrl: pulumi.Input<string> | undefined =
        buildCacheEcrUrl ?? config.ecrCache?.registryUrl;

    if (config.ecrCache?.enabled && effectiveEcrUrl) {
        env.push({
            name: 'BUILDKIT_CACHE_REGISTRY',
            value: effectiveEcrUrl,
        });
    }

    const container: Record<string, unknown> = {
        name: 'buildkit',
        image,
        env,
        securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: false,
            seccompProfile: { type: 'RuntimeDefault' },
        },
        volumeMounts: [
            {
                name: 'buildkit-sock',
                mountPath: '/run/user/1000/buildkit',
            },
        ],
        readinessProbe: {
            exec: {
                command: ['buildctl', 'debug', 'workers'],
            },
            initialDelaySeconds: 5,
            periodSeconds: 10,
        },
    };

    if (Object.keys(sidecarResources).length > 0) {
        container.resources = sidecarResources;
    }

    const volume: Record<string, unknown> = {
        name: 'buildkit-sock',
        emptyDir: {},
    };

    return { container, volume };
};

/**
 * Validates that the runner class does not attempt to mount the host Docker socket.
 * This guard enforces rootless, sidecar-only container builds.
 */
const assertNoDockerSocketMount = (runnerClass: RunnerClassConfig): void => {
    const dockerSocketPaths = ['/var/run/docker.sock', '/run/docker.sock'];

    if (runnerClass.storage && 'hostPath' in runnerClass.storage) {
        const hostPath = (runnerClass.storage as Record<string, unknown>).hostPath as string;

        if (dockerSocketPaths.includes(hostPath)) {
            throw new Error(
                `Runner class ${runnerClass.name} must not mount the host Docker socket. ` +
                    'Use the rootless BuildKit sidecar instead.',
            );
        }
    }
};

const buildRunnerTemplateSpec = (
    runnerClass: RunnerClassConfig,
    serviceAccountName: pulumi.Input<string>,
    buildCacheEcrUrl?: pulumi.Input<string>,
    proxyEnv?: ArcProxyEnvConfig,
): Record<string, unknown> => {
    assertNoDockerSocketMount(runnerClass);

    const limits = runnerClass.resources.limits
        ? buildPodResourceSpec(runnerClass.resources.limits)
        : undefined;
    const resources: Record<string, unknown> = {
        requests: buildPodResourceSpec(runnerClass.resources.requests),
    };

    if (Object.keys(limits || {}).length > 0) {
        resources.limits = limits;
    }

    const nodeSelector: Record<string, string> = {
        'kubernetes.io/arch': runnerClass.architecture,
        'kubernetes.io/os': 'linux',
        ...(runnerClass.nodeSelector || {}),
    };

    // Build the combined env array for the runner container.
    // BuildKit address and proxy vars are merged so both are present when applicable.
    const runnerEnv: Record<string, pulumi.Input<string>>[] = [];

    if (runnerClass.buildEngine) {
        runnerEnv.push({ name: 'BUILDKIT_HOST', value: BUILDKIT_ADDR });
    }

    if (proxyEnv) {
        runnerEnv.push(
            { name: 'HTTP_PROXY', value: proxyEnv.httpProxy },
            { name: 'HTTPS_PROXY', value: proxyEnv.httpsProxy },
            { name: 'NO_PROXY', value: proxyEnv.noProxy },
            { name: 'http_proxy', value: proxyEnv.httpProxy },
            { name: 'https_proxy', value: proxyEnv.httpsProxy },
            { name: 'no_proxy', value: proxyEnv.noProxy },
        );
    }

    const runnerImage = runnerClass.runnerImage ?? DEFAULT_RUNNER_IMAGE;

    const containers: Record<string, unknown>[] = [
        {
            name: 'runner',
            image: runnerImage,
            command: ['/home/runner/run.sh'],
            resources,
            securityContext: {
                runAsUser: 1000,
                runAsGroup: 1000,
                runAsNonRoot: true,
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: false,
                seccompProfile: { type: 'RuntimeDefault' },
            },
            ...(runnerEnv.length > 0 ? { env: runnerEnv } : {}),
            ...(runnerClass.buildEngine
                ? {
                      volumeMounts: [
                          {
                              name: 'buildkit-sock',
                              mountPath: '/run/user/1000/buildkit',
                          },
                      ],
                  }
                : {}),
        },
    ];

    const volumes: Record<string, unknown>[] = [];

    if (runnerClass.buildEngine) {
        const sidecar = buildBuildKitSidecar(runnerClass.buildEngine, buildCacheEcrUrl);
        containers.push(sidecar.container);
        volumes.push(sidecar.volume);
    }

    const workVolumes = buildWorkVolume(runnerClass);

    if (workVolumes) {
        volumes.push(...workVolumes);
    }

    const spec: Record<string, unknown> = {
        activeDeadlineSeconds: runnerClass.maxDurationMinutes * 60,
        containers,
        nodeSelector,
        serviceAccountName,
    };

    if (volumes.length > 0) {
        spec.volumes = volumes;
    }

    return spec;
};

export interface ArcRunnerScaleSetArgs {
    runnerClass: RunnerClassConfig;
    githubOrg: string;
    authSecretName: string;
    controllerNamespace: pulumi.Input<string>;
    controllerServiceAccountName: pulumi.Input<string>;
    serviceAccountName: pulumi.Input<string>;
    chartVersion?: string | null;
    namespaceResource?: k8s.core.v1.Namespace;
    authSecretResource?: pulumi.Resource;
    /**
     * Changes when ARC authentication has been bootstrapped. The value is
     * hashed into an AutoscalingRunnerSet label so ARC includes it in its
     * rollout hash and reconciles registration after credentials are ready.
     */
    registrationTrigger?: pulumi.Input<string>;
    /**
     * ECR repository URL for the BuildKit registry cache backend.
     * Sourced from the stateful-data stack output and injected as
     * BUILDKIT_CACHE_REGISTRY into build runner pods.
     */
    buildCacheEcrUrl?: pulumi.Input<string>;
    /**
     * Optional proxy environment variables to inject into the runner pod template.
     * When provided, HTTP_PROXY, HTTPS_PROXY, NO_PROXY (and lowercase variants) are
     * set on the runner container so all outbound traffic routes through the proxy.
     */
    proxyEnv?: ArcProxyEnvConfig;
}

/**
 * Converts an arbitrary registration trigger into a Kubernetes-safe label value.
 */
const buildRegistrationTriggerLabelValue = (trigger: pulumi.Input<string>): pulumi.Output<string> =>
    pulumi
        .output(trigger)
        .apply((value) => createHash('sha256').update(value).digest('hex').slice(0, 63));

/**
 * ArcRunnerScaleSet deploys a single ARC runner scale set release for one runner class.
 */
export class ArcRunnerScaleSet extends pulumi.ComponentResource {
    public readonly release: k8s.helm.v3.Release;
    /** Waits for ARC to register the scale set and start its listener resources. */
    public readonly registrationWaiter: k8s.apiextensions.CustomResourcePatch;
    public readonly namespace: pulumi.Output<string>;
    public readonly releaseName: pulumi.Output<string>;
    public readonly scaleSetName: pulumi.Output<string>;
    public readonly ready: pulumi.Output<boolean>;

    constructor(name: string, args: ArcRunnerScaleSetArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:kubernetes:ArcRunnerScaleSet', name, {}, opts);

        const scaleSetName = resolveScaleSetName(args.runnerClass);
        const registrationTriggerLabelValue = args.registrationTrigger
            ? buildRegistrationTriggerLabelValue(args.registrationTrigger)
            : undefined;

        this.release = new k8s.helm.v3.Release(
            name,
            {
                name: scaleSetName,
                chart: ARC_RUNNER_SCALE_SET_CHART_REFERENCE,
                namespace: args.runnerClass.namespace,
                createNamespace: false,
                cleanupOnFail: true,
                atomic: true,
                timeout: 600,
                version: args.chartVersion ?? undefined,
                values: {
                    controllerServiceAccount: {
                        name: args.controllerServiceAccountName,
                        namespace: args.controllerNamespace,
                    },
                    githubConfigSecret: args.authSecretName,
                    githubConfigUrl: buildGitHubConfigUrl(args.githubOrg),
                    maxRunners: args.runnerClass.maxRunners,
                    minRunners: args.runnerClass.minRunners,
                    runnerScaleSetName: scaleSetName,
                    scaleSetLabels: args.runnerClass.labels,
                    ...(registrationTriggerLabelValue
                        ? {
                              resourceMeta: {
                                  autoscalingRunnerSet: {
                                      labels: {
                                          [ARC_REGISTRATION_TRIGGER_LABEL]:
                                              registrationTriggerLabelValue,
                                      },
                                  },
                              },
                          }
                        : {}),
                    template: {
                        metadata: {
                            labels: {
                                'github-runners-eks/runner-class': args.runnerClass.name,
                            },
                        },
                        spec: buildRunnerTemplateSpec(
                            args.runnerClass,
                            args.serviceAccountName,
                            args.buildCacheEcrUrl,
                            args.proxyEnv,
                        ),
                    },
                },
            },
            {
                parent: this,
                dependsOn: [
                    ...(args.namespaceResource ? [args.namespaceResource] : []),
                    ...(args.authSecretResource ? [args.authSecretResource] : []),
                ],
                deleteBeforeReplace: true,
                // ARC registers the scale set name and labels with the GitHub
                // broker at creation time and never patches them afterward.
                // Marking these inputs as replacement triggers forces Pulumi to
                // delete the old Helm release (which invokes the ARC finalizer
                // to unregister the old GitHub registration) and then install a
                // fresh release with the updated identity.
                replaceOnChanges: ['name', 'values.runnerScaleSetName', 'values.scaleSetLabels'],
            },
        );

        this.registrationWaiter = new k8s.apiextensions.CustomResourcePatch(
            `${name}-registration-waiter`,
            {
                apiVersion: 'actions.github.com/v1alpha1',
                kind: 'AutoscalingRunnerSet',
                metadata: {
                    name: scaleSetName,
                    namespace: args.runnerClass.namespace,
                    ...(registrationTriggerLabelValue
                        ? {
                              labels: {
                                  [ARC_REGISTRATION_TRIGGER_LABEL]: registrationTriggerLabelValue,
                              },
                          }
                        : {}),
                    annotations: {
                        'pulumi.com/patchForce': 'true',
                        'pulumi.com/timeoutSeconds': '600',
                        'pulumi.com/waitFor': 'jsonpath={.status.phase}=Running',
                    },
                },
            },
            {
                parent: this,
                dependsOn: [this.release],
                customTimeouts: { create: '10m', update: '10m' },
            },
        );

        this.namespace = pulumi.output(args.runnerClass.namespace);
        this.releaseName = this.release.name;
        this.scaleSetName = pulumi.output(scaleSetName);
        this.ready = pulumi
            .all([this.release.status, this.registrationWaiter.id])
            .apply(([status]) => status.status === 'deployed');

        this.registerOutputs({
            namespace: this.namespace,
            releaseName: this.releaseName,
            scaleSetName: this.scaleSetName,
            ready: this.ready,
        });
    }
}

export default ArcRunnerScaleSet;

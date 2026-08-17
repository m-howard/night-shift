import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { config as stackConfigs } from '../config';
import {
    DefaultConfig,
    ConfigLoader,
    StackOutputs,
    EksCluster,
    ArcController,
    ArcRunnerScaleSet,
    ArcAuthSecretSync,
    Crowdstrike,
    Dynatrace,
    NamespaceBootstrap,
    Observability,
    RunnerNamespaceNetworkPolicies,
    SquidProxy,
    WorkloadIdentity,
    GitHubTokenBroker,
    ExternalSecretsOperator,
    ArcProxyEnvConfig,
    applyPodSecurityAdmissionLabels,
    getArcAuthSecretSourceId,
    shouldDeployArcAuthSecretSync,
    shouldDeployTokenBroker,
} from '../components';
import { registerAutoTags, getVerifiedOutput } from '../helpers';

export interface SvcComputeStackOutputs extends StackOutputs {
    message: pulumi.Output<string>;
    deploymentMode: pulumi.Output<string>;
    clusterName?: pulumi.Output<string>;
    clusterEndpoint?: pulumi.Output<string>;
    clusterCertificateAuthority?: pulumi.Output<string>;
    clusterSecurityGroupId?: pulumi.Output<string>;
    kubernetesProviderConfig?: pulumi.Output<string>;
    namespaceNames?: pulumi.Output<string[]>;
    namespaceNameMap?: pulumi.Output<Record<string, string>>;
    networkPolicyNamesByNamespace?: pulumi.Output<Record<string, string[]>>;
    arcAuthSecretNamesByNamespace?: pulumi.Output<Record<string, string>>;
    arcControllerNamespace?: pulumi.Output<string>;
    arcControllerReleaseName?: pulumi.Output<string>;
    arcControllerServiceAccountName?: pulumi.Output<string>;
    arcControllerServiceAccountRoleArn?: pulumi.Output<string>;
    arcControllerReady?: pulumi.Output<boolean>;
    workloadIdentityRoleArnsByRunnerClass?: pulumi.Output<Record<string, string>>;
    workloadIdentityRoleNamesByRunnerClass?: pulumi.Output<Record<string, string>>;
    workloadIdentityServiceAccountNamesByRunnerClass?: pulumi.Output<Record<string, string>>;
    arcRunnerScaleSetNamespacesByRunnerClass?: pulumi.Output<Record<string, string>>;
    arcRunnerScaleSetNamesByRunnerClass?: pulumi.Output<Record<string, string>>;
    arcRunnerScaleSetReleaseNamesByRunnerClass?: pulumi.Output<Record<string, string>>;
    arcRunnerScaleSetReadyByRunnerClass?: pulumi.Output<Record<string, boolean>>;
    squidProxyEndpoint?: pulumi.Output<string>;
    observabilityAlarmNames?: pulumi.Output<Record<string, string>>;
    observabilityAlarmArns?: pulumi.Output<Record<string, string>>;
    observabilityAlarmTopicArn?: pulumi.Output<string>;
    observabilityRunbookUrl?: pulumi.Output<string>;
    crowdstrikeFalconChartUrn?: pulumi.Output<string>;
    dynatraceChartUrn?: pulumi.Output<string>;
    tokenBrokerLambdaName?: pulumi.Output<string>;
    tokenBrokerSecretArn?: pulumi.Output<string>;
    tokenBrokerFailureAlarmName?: pulumi.Output<string>;
    esoServiceAccountRoleArn?: pulumi.Output<string>;
}

/**
 * Service Compute Stack - EKS cluster for GitHub Self-Hosted Runners.
 *
 * Provisions the compute resources for hosting GitHub Runners.
 * - EKS cluster with Auto Mode for production-ready Coder deployment (default)
 */
export async function createStack(envConfigName: string): Promise<SvcComputeStackOutputs> {
    pulumi.log.info(`[svc-compute] Deploying for environment: ${envConfigName}`);

    const config = ConfigLoader.loadConfig<DefaultConfig>(stackConfigs, envConfigName);
    registerAutoTags(config.tags as unknown as Record<string, string>);

    const clusterName = `github-runners-eks-${envConfigName}`;

    // -------------------------------------------------------------------------
    // CROSS-STACK REFERENCE: stateful-data
    // -------------------------------------------------------------------------
    // Read the BuildKit cache ECR repository outputs from the stateful-data
    // stack so they can be injected into build runner Helm values and IRSA
    // policies without duplicating resource ownership.
    const pulumiOrg = process.env.PULUMI_ORG ?? 'moderna';
    const statefulDataRef = new pulumi.StackReference(
        `${pulumiOrg}/github-runners-eks-stateful-data/${envConfigName}`,
    );
    const buildCacheEcrRepositoryUrl = getVerifiedOutput(
        statefulDataRef,
        'buildCacheEcrRepositoryUrl',
    );
    const buildCacheEcrArn = getVerifiedOutput(statefulDataRef, 'buildCacheEcrArn');

    const eksCluster = new EksCluster(
        'eks-cluster',
        {
            name: clusterName,
            version: '1.35',
            vpcId: config.networking.vpcId,
            // Control-plane ENIs are placed in the non-routable CP subnets.
            privateSubnetIds: config.networking.cpNonroutableSubnetIds,
            // Data-plane (node) subnets — tagged by EksCluster for Karpenter discovery.
            nodeSubnetIds: config.networking.dpNonroutableSubnetIds,
            endpointPublicAccess: config.networking.endpointPublicAccess,
            endpointPrivateAccess: config.networking.endpointPrivateAccess,
            controlPlaneIngressCidrs: config.networking.controlPlaneIngressCidrs,
            clusterSecurityGroupEgressCidrs: config.networking.clusterSecurityGroupEgressCidrs,
            kmsKey: {
                description: `KMS key for EKS cluster ${clusterName} encryption`,
                deletionWindowInDays: 30,
            },
            tags: config.tags as unknown as { [key: string]: string },
        },
        { customTimeouts: { create: '30m', delete: '30m' } },
    );

    const namespaceBootstrap = new NamespaceBootstrap(
        'namespace-bootstrap',
        {
            definitions: applyPodSecurityAdmissionLabels(
                config.namespaceDefinitions,
                config.hardenRunnerNamespaces,
                config.psaProfile,
            ),
        },
        {
            parent: eksCluster,
            provider: eksCluster.k8sProvider,
            dependsOn: [eksCluster.cluster],
        },
    );

    const arcSystemNamespace = namespaceBootstrap.namespaces['arc-system'];

    if (config.deployArc && !arcSystemNamespace) {
        throw new Error('ARC controller deployment requires the arc-system namespace');
    }

    const runnerNamespaceNetworkPolicies = new RunnerNamespaceNetworkPolicies(
        'runner-namespace-network-policies',
        {
            runnerClasses: config.runnerClasses,
            config: {
                ...config.runnerNamespaceNetworkPolicies,
                directEgressNamespaces: Array.from(
                    new Set(
                        config.runnerClasses
                            .filter(
                                (rc) =>
                                    (rc.egressProxy?.enabled ?? config.enableArcProxyEnv) === false,
                            )
                            .map((rc) => rc.namespace),
                    ),
                ),
            },
        },
        {
            parent: namespaceBootstrap,
            provider: eksCluster.k8sProvider,
            dependsOn: Object.values(namespaceBootstrap.namespaces),
        },
    );

    const egressProxyNamespace = namespaceBootstrap.namespaces['egress-proxy'];

    const squidProxy =
        config.deploySquidProxy && egressProxyNamespace
            ? new SquidProxy(
                  'squid-proxy',
                  {
                      namespace: 'egress-proxy',
                      allowlist: config.proxyAllowlist,
                      namespaceResource: egressProxyNamespace,
                      enableHaConstraints: config.enableHaConstraints,
                  },
                  {
                      parent: eksCluster,
                      provider: eksCluster.k8sProvider,
                      dependsOn: [egressProxyNamespace],
                  },
              )
            : undefined;

    // -------------------------------------------------------------------------
    // ARC PROXY ENVIRONMENT VARIABLES
    // -------------------------------------------------------------------------
    // Proxy configuration is split into two independent paths:
    //   1. Controller proxy — controlled by enableControllerProxyEnv and its
    //      dedicated URL/NO_PROXY fields.
    //   2. Runner proxy — controlled by the global enableArcProxyEnv default,
    //      with per-runner-class overrides via runnerClass.egressProxy.

    // Shared helper: resolve the Squid service endpoint when available.
    const squidEndpoint: pulumi.Input<string> | undefined =
        config.deploySquidProxy && squidProxy ? squidProxy.proxyEndpoint : undefined;

    // Append the EKS cluster service CIDR to NO_PROXY so the in-cluster
    // Kubernetes API client can bypass the proxy when using the ClusterIP
    // directly (KUBERNETES_SERVICE_HOST). Go resolves the hostname to an IP
    // before making the connection, so hostname-suffix patterns like ".svc"
    // do not match — only an explicit CIDR or exact IP bypass is effective.
    const anyProxyEnabled =
        config.enableControllerProxyEnv ||
        config.enableArcProxyEnv ||
        config.runnerClasses.some((rc) => rc.egressProxy?.enabled === true);
    const eksServiceCidr: pulumi.Output<string> = anyProxyEnabled
        ? eksCluster.cluster.eksCluster.kubernetesNetworkConfig.apply(
              (netConfig) => netConfig?.serviceIpv4Cidr ?? '',
          )
        : pulumi.output('');

    // --- Controller proxy env ---
    const resolvedControllerProxyHttpUrl: pulumi.Input<string> | undefined =
        config.enableControllerProxyEnv
            ? (config.controllerProxyHttpUrl ?? config.arcProxyHttpUrl ?? squidEndpoint)
            : undefined;

    const controllerProxyEnv: ArcProxyEnvConfig | undefined =
        config.enableControllerProxyEnv && resolvedControllerProxyHttpUrl !== undefined
            ? {
                  httpProxy: resolvedControllerProxyHttpUrl,
                  httpsProxy:
                      (config.controllerProxyHttpsUrl as pulumi.Input<string> | null) ??
                      (config.arcProxyHttpsUrl as pulumi.Input<string> | null) ??
                      resolvedControllerProxyHttpUrl,
                  noProxy: eksServiceCidr.apply((serviceCidr) =>
                      [
                          ...config.controllerProxyNoProxy,
                          ...(serviceCidr ? [serviceCidr] : []),
                      ].join(','),
                  ),
              }
            : undefined;

    // --- Per-runner-class proxy env builder ---
    const buildRunnerProxyEnv = (runnerClass: {
        egressProxy?: { enabled: boolean; additionalNoProxy?: string[] };
    }): ArcProxyEnvConfig | undefined => {
        const proxyEnabled = runnerClass.egressProxy?.enabled ?? config.enableArcProxyEnv;
        if (!proxyEnabled) {
            return undefined;
        }

        const resolvedHttpUrl: pulumi.Input<string> | undefined =
            config.arcProxyHttpUrl ?? squidEndpoint;
        if (resolvedHttpUrl === undefined) {
            return undefined;
        }

        const additionalNoProxy = runnerClass.egressProxy?.additionalNoProxy ?? [];
        return {
            httpProxy: resolvedHttpUrl,
            httpsProxy: (config.arcProxyHttpsUrl as pulumi.Input<string> | null) ?? resolvedHttpUrl,
            noProxy: eksServiceCidr.apply((serviceCidr) =>
                [
                    ...config.arcProxyNoProxy,
                    ...additionalNoProxy,
                    ...(serviceCidr ? [serviceCidr] : []),
                ].join(','),
            ),
        };
    };

    // -------------------------------------------------------------------------
    // OBSERVABILITY — CloudWatch Alarms
    // -------------------------------------------------------------------------
    const observabilityAlarmTopic =
        config.deployObservability && config.createAlarmSnsTopic
            ? new aws.sns.Topic(
                  'observability-alarm-topic',
                  {
                      name: config.alarmSnsTopicName ?? `${clusterName}-observability-alarms`,
                      tags: config.tags as unknown as { [key: string]: string },
                  },
                  { parent: eksCluster },
              )
            : undefined;

    const observability = config.deployObservability
        ? new Observability(
              'observability',
              {
                  clusterName,
                  namespaces: namespaceBootstrap.namespaceNames,
                  snsTopicArn: config.alarmSnsTopicArn ?? observabilityAlarmTopic?.arn ?? undefined,
                  runbookUrl: config.runbookUrl ?? undefined,
                  tags: config.tags as unknown as { [key: string]: string },
              },
              {
                  parent: eksCluster,
                  dependsOn: [eksCluster.cluster],
              },
          )
        : undefined;

    // -------------------------------------------------------------------------
    // SECURITY INTEGRATIONS — CrowdStrike & Dynatrace
    // -------------------------------------------------------------------------
    // When either integration is enabled, read the corresponding credential keys
    // from the core AWS Secrets Manager secret (coreSecretName).
    //
    // Expected keys in the core secret JSON for CrowdStrike:
    //   crowdstrike_api_token, crowdstrike_docker_api_token
    //
    // Expected keys in the core secret JSON for Dynatrace:
    //   dynatrace_api_token, dynatrace_data_ingest_token
    const coreSecretString: pulumi.Output<string> | undefined =
        (config.deployCrowdstrikeFalconSensor || config.deployDynatraceOperator) &&
        config.coreSecretName
            ? aws.secretsmanager.getSecretVersionOutput({ secretId: config.coreSecretName })
                  .secretString
            : undefined;

    /**
     * Extracts a required string value from the parsed core secret JSON and wraps
     * the result as a Pulumi secret output so credentials are never logged.
     */
    const extractCoreSecretKey = (key: string): pulumi.Output<string> =>
        pulumi.secret(
            coreSecretString!.apply((s) => {
                const parsed = JSON.parse(s ?? '{}') as Record<string, unknown>;
                const value = parsed[key];
                if (typeof value !== 'string' || !value) {
                    throw new Error(
                        `Core secret '${config.coreSecretName}' is missing required key '${key}'`,
                    );
                }
                return value;
            }),
        );

    const crowdstrike = config.deployCrowdstrikeFalconSensor
        ? new Crowdstrike(
              'crowdstrike',
              {
                  namespace: 'crowdstrike',
                  version: config.crowdstrike?.version,
                  sensorChartVersion: config.crowdstrike?.sensorChartVersion,
                  nodeTolerations: config.crowdstrike?.nodeTolerations,
                  apiToken: extractCoreSecretKey('crowdstrike_api_token'),
                  dockerApiToken: extractCoreSecretKey('crowdstrike_docker_api_token'),
              },
              {
                  parent: eksCluster,
                  provider: eksCluster.k8sProvider,
                  dependsOn: [eksCluster.cluster],
              },
          )
        : undefined;

    const dynatrace = config.deployDynatraceOperator
        ? new Dynatrace(
              'dynatrace',
              {
                  clusterName,
                  namespace: 'dynatrace',
                  version: config.dynatrace?.version,
                  nodeTolerations: config.dynatrace?.nodeTolerations,
                  baseUrl: config.dynatrace?.baseUrl ?? '',
                  apiToken: extractCoreSecretKey('dynatrace_api_token'),
                  dataIngestToken: extractCoreSecretKey('dynatrace_data_ingest_token'),
              },
              {
                  parent: eksCluster,
                  provider: eksCluster.k8sProvider,
                  dependsOn: [eksCluster.cluster],
              },
          )
        : undefined;

    const arcAuthSecretSync = shouldDeployArcAuthSecretSync(config)
        ? new ArcAuthSecretSync(
              'arc-auth-secret-sync',
              {
                  runnerNamespaces: Array.from(
                      new Set(config.runnerClasses.map((runnerClass) => runnerClass.namespace)),
                  ),
                  secretName: config.arcAuthSecretName,
                  sourceSecretId: getArcAuthSecretSourceId(config),
                  namespaceResources: namespaceBootstrap.namespaces,
              },
              {
                  parent: eksCluster,
                  provider: eksCluster.k8sProvider,
                  dependsOn: Object.values(namespaceBootstrap.namespaces),
              },
          )
        : undefined;

    // -------------------------------------------------------------------------
    // TOKEN BROKER — Centralised short-lived GitHub App installation tokens
    // -------------------------------------------------------------------------
    // When enabled, the token broker Lambda reads the GitHub App private key
    // from Secrets Manager, generates a short-lived installation token, and
    // writes it to a dedicated token secret.  ESO then syncs the token into
    // each runner namespace as the `arc-github-auth` K8s Secret.  The private
    // key never enters the Kubernetes cluster.
    const runnerNamespaces = Array.from(
        new Set(config.runnerClasses.map((runnerClass) => runnerClass.namespace)),
    );

    const tokenBroker = shouldDeployTokenBroker(config)
        ? new GitHubTokenBroker(
              'github-token-broker',
              {
                  sourceSecretId: getArcAuthSecretSourceId(config) ?? config.coreSecretName,
                  tokenSecretArn: config.tokenSecretArn ?? undefined,
                  refreshMinutes: config.tokenBrokerRefreshMinutes ?? 30,
                  tags: config.tags as unknown as { [key: string]: string },
              },
              { parent: eksCluster },
          )
        : undefined;

    const externalSecretsOperator =
        shouldDeployTokenBroker(config) && tokenBroker
            ? new ExternalSecretsOperator(
                  'external-secrets-operator',
                  {
                      namespace: 'arc-system',
                      oidcProviderArn: eksCluster.cluster.oidcProviderArn,
                      oidcProviderUrl: eksCluster.cluster.oidcProviderUrl,
                      tokenSecretArn: tokenBroker.tokenSecretArn,
                      runnerNamespaces,
                      targetSecretName: config.arcAuthSecretName,
                      refreshInterval: '5m',
                      syncTrigger: tokenBroker.initialInvocation.id,
                      awsRegion: 'us-east-1',
                      namespaceResources: namespaceBootstrap.namespaces,
                      tags: config.tags as unknown as { [key: string]: string },
                  },
                  {
                      parent: eksCluster,
                      provider: eksCluster.k8sProvider,
                      dependsOn: [
                          arcSystemNamespace,
                          tokenBroker.initialInvocation,
                          ...Object.values(namespaceBootstrap.namespaces),
                      ],
                  },
              )
            : undefined;

    const workloadIdentity = config.deployArc
        ? new WorkloadIdentity(
              'workload-identity',
              {
                  runnerClasses: config.runnerClasses,
                  oidcProviderArn: eksCluster.cluster.oidcProviderArn,
                  oidcProviderUrl: eksCluster.cluster.oidcProviderUrl,
                  namespaceResources: namespaceBootstrap.namespaces,
                  buildCacheEcrArn,
                  tags: config.tags as unknown as { [key: string]: string },
              },
              {
                  parent: eksCluster,
                  provider: eksCluster.k8sProvider,
                  dependsOn: Object.values(namespaceBootstrap.namespaces),
              },
          )
        : undefined;

    const arcController = config.deployArc
        ? new ArcController(
              'arc-controller',
              {
                  chartVersion: config.arcChartVersion,
                  namespace: 'arc-system',
                  releaseName: config.arcControllerReleaseName,
                  serviceAccountName: config.arcControllerServiceAccountName,
                  oidcProviderArn: eksCluster.cluster.oidcProviderArn,
                  oidcProviderUrl: eksCluster.cluster.oidcProviderUrl,
                  namespaceResource: arcSystemNamespace,
                  tags: config.tags as unknown as { [key: string]: string },
                  proxyEnv: controllerProxyEnv,
                  enableHaConstraints: config.enableHaConstraints,
              },
              {
                  parent: eksCluster,
                  provider: eksCluster.k8sProvider,
                  dependsOn: [arcSystemNamespace],
              },
          )
        : undefined;

    // Auth prerequisites: either legacy ArcAuthSecretSync or token broker + ESO must be present.
    const hasAuthPrerequisite = arcAuthSecretSync || externalSecretsOperator;

    if (
        config.deployArcRunnerScaleSets &&
        (!arcController || !workloadIdentity || !hasAuthPrerequisite)
    ) {
        throw new Error(
            'ARC runner scale sets require the ARC controller, workload identity, and either ARC auth secret sync or token broker prerequisites',
        );
    }

    const arcRunnerScaleSets =
        config.deployArcRunnerScaleSets && arcController && workloadIdentity && hasAuthPrerequisite
            ? Object.fromEntries(
                  config.runnerClasses.map((runnerClass) => {
                      // Build auth secret dependency based on which auth mode is active.
                      const authSecretDeps: pulumi.Resource[] = [];
                      if (arcAuthSecretSync) {
                          authSecretDeps.push(arcAuthSecretSync.secrets[runnerClass.namespace]);
                      }
                      if (externalSecretsOperator) {
                          authSecretDeps.push(
                              externalSecretsOperator.externalSecrets[runnerClass.namespace],
                          );
                      }

                      const runnerScaleSet = new ArcRunnerScaleSet(
                          `arc-runner-scale-set-${runnerClass.name}`,
                          {
                              runnerClass,
                              githubOrg: config.githubOrg || '',
                              authSecretName: config.arcAuthSecretName,
                              controllerNamespace: arcController.controllerNamespace,
                              controllerServiceAccountName: arcController.serviceAccountName,
                              serviceAccountName:
                                  workloadIdentity.serviceAccounts[runnerClass.name].metadata.name,
                              chartVersion: config.arcChartVersion,
                              namespaceResource:
                                  namespaceBootstrap.namespaces[runnerClass.namespace],
                              authSecretResource:
                                  arcAuthSecretSync?.secrets[runnerClass.namespace] ??
                                  externalSecretsOperator?.externalSecrets[runnerClass.namespace],
                              registrationTrigger: tokenBroker?.initialInvocation.id,
                              ...(runnerClass.buildEngine
                                  ? { buildCacheEcrUrl: buildCacheEcrRepositoryUrl }
                                  : {}),
                              proxyEnv: buildRunnerProxyEnv(runnerClass),
                          },
                          {
                              parent: eksCluster,
                              provider: eksCluster.k8sProvider,
                              dependsOn: [
                                  arcController.release,
                                  workloadIdentity.serviceAccounts[runnerClass.name],
                                  ...authSecretDeps,
                              ],
                          },
                      );

                      return [runnerClass.name, runnerScaleSet];
                  }),
              )
            : undefined;

    const arcRunnerScaleSetNamespacesByRunnerClass = arcRunnerScaleSets
        ? pulumi
              .all(
                  Object.entries(arcRunnerScaleSets).map(([runnerClassName, runnerScaleSet]) =>
                      runnerScaleSet.namespace.apply(
                          (namespace) => [runnerClassName, namespace] as const,
                      ),
                  ),
              )
              .apply((entries) => Object.fromEntries(entries))
        : undefined;

    const arcRunnerScaleSetNamesByRunnerClass = arcRunnerScaleSets
        ? pulumi
              .all(
                  Object.entries(arcRunnerScaleSets).map(([runnerClassName, runnerScaleSet]) =>
                      runnerScaleSet.scaleSetName.apply(
                          (scaleSetName) => [runnerClassName, scaleSetName] as const,
                      ),
                  ),
              )
              .apply((entries) => Object.fromEntries(entries))
        : undefined;

    const arcRunnerScaleSetReleaseNamesByRunnerClass = arcRunnerScaleSets
        ? pulumi
              .all(
                  Object.entries(arcRunnerScaleSets).map(([runnerClassName, runnerScaleSet]) =>
                      runnerScaleSet.releaseName.apply(
                          (releaseName) => [runnerClassName, releaseName] as const,
                      ),
                  ),
              )
              .apply((entries) => Object.fromEntries(entries))
        : undefined;

    const arcRunnerScaleSetReadyByRunnerClass = arcRunnerScaleSets
        ? pulumi
              .all(
                  Object.entries(arcRunnerScaleSets).map(([runnerClassName, runnerScaleSet]) =>
                      runnerScaleSet.ready.apply((ready) => [runnerClassName, ready] as const),
                  ),
              )
              .apply((entries) => Object.fromEntries(entries))
        : undefined;

    return {
        message: pulumi.output(`EKS cluster deployed for: ${envConfigName}`),
        deploymentMode: pulumi.output('eks'),
        clusterName: eksCluster.clusterName,
        clusterEndpoint: eksCluster.clusterEndpoint,
        clusterCertificateAuthority: eksCluster.clusterCertificateAuthority,
        clusterSecurityGroupId: eksCluster.clusterSecurityGroupId,
        kubernetesProviderConfig: eksCluster.cluster.kubeconfigJson,
        namespaceNames: namespaceBootstrap.namespaceNames,
        namespaceNameMap: namespaceBootstrap.namespaceNameMap,
        networkPolicyNamesByNamespace: runnerNamespaceNetworkPolicies.policyNamesByNamespace,
        arcAuthSecretNamesByNamespace:
            arcAuthSecretSync?.secretNamesByNamespace ??
            externalSecretsOperator?.secretNamesByNamespace,
        arcControllerNamespace: arcController?.controllerNamespace,
        arcControllerReleaseName: arcController?.releaseName,
        arcControllerServiceAccountName: arcController?.serviceAccountName,
        arcControllerServiceAccountRoleArn: arcController?.serviceAccountRoleArn,
        arcControllerReady: arcController?.ready,
        workloadIdentityRoleArnsByRunnerClass: workloadIdentity?.roleArnsByRunnerClass,
        workloadIdentityRoleNamesByRunnerClass: workloadIdentity?.roleNamesByRunnerClass,
        workloadIdentityServiceAccountNamesByRunnerClass:
            workloadIdentity?.serviceAccountNamesByRunnerClass,
        arcRunnerScaleSetNamespacesByRunnerClass,
        arcRunnerScaleSetNamesByRunnerClass,
        arcRunnerScaleSetReleaseNamesByRunnerClass,
        arcRunnerScaleSetReadyByRunnerClass,
        squidProxyEndpoint: squidProxy?.proxyEndpoint,
        observabilityAlarmNames: observability?.alarmNames,
        observabilityAlarmArns: observability?.alarmArns,
        observabilityAlarmTopicArn: observabilityAlarmTopic?.arn,
        observabilityRunbookUrl: observability?.runbookUrl,
        crowdstrikeFalconChartUrn: crowdstrike?.chartFalconUrn,
        dynatraceChartUrn: dynatrace?.chartDynatraceUrn,
        tokenBrokerLambdaName: tokenBroker?.lambdaFunction.name,
        tokenBrokerSecretArn: tokenBroker?.tokenSecretArn,
        tokenBrokerFailureAlarmName: tokenBroker?.failureAlarm.name,
        esoServiceAccountRoleArn: externalSecretsOperator?.serviceAccountRoleArn,
    };
}

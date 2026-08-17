import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as eks from '@pulumi/eks';
import * as k8s from '@pulumi/kubernetes';

/**
 * Arguments for creating an EKS cluster with Auto Mode for Coder
 */
export interface EksClusterArgs {
    /** Name of the EKS cluster */
    name: string;
    /** Kubernetes version (default: '1.34') */
    version?: string;
    /** VPC ID where the EKS cluster will be deployed */
    vpcId: pulumi.Input<string>;
    /** Public subnet IDs used for internet-facing load balancers */
    publicSubnetIds?: pulumi.Input<string[]>;
    /** Private subnet IDs for the cluster control plane */
    privateSubnetIds: pulumi.Input<string[]>;
    /** Private subnet IDs for EKS Auto Mode worker nodes */
    nodeSubnetIds?: pulumi.Input<string[]>;
    /** Enable EKS Auto Mode (default: true) */
    autoModeEnabled?: boolean;
    /** Enable public access to the EKS API endpoint (default: true) */
    endpointPublicAccess?: boolean;
    /** Enable private access to the EKS API endpoint (default: true) */
    endpointPrivateAccess?: boolean;
    /** CIDR blocks allowed to access the EKS API endpoint */
    publicAccessCidrs?: string[];
    /** CIDR blocks allowed to reach the control plane security group on port 443 */
    controlPlaneIngressCidrs?: pulumi.Input<string[]>;
    /** CIDR blocks the control plane security group can reach */
    clusterSecurityGroupEgressCidrs?: pulumi.Input<string[]>;
    /** Enable control plane logging to CloudWatch (default: true) */
    enableControlPlaneLogs?: boolean;
    /** Specific control plane log types to enable */
    controlPlaneLogTypes?: string[];
    /** Enable CloudWatch Container Insights (default: true) */
    enableContainerInsights?: boolean;
    /** Enable VPC CNI network observability (default: true) */
    enableNetworkObservability?: boolean;
    /** KMS key configuration for cluster encryption */
    kmsKey?: {
        keyArn?: pulumi.Input<string>;
        description?: string;
        deletionWindowInDays?: number;
    };
    /** Optional IAM role ARN to use for cluster admin access and kubeconfig authentication. */
    clusterAdminRoleArn?: pulumi.Input<string>;
    /** Tags to apply to all resources */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * EKS Cluster Component - Production-ready EKS cluster with Auto Mode for Coder
 *
 * Creates an EKS cluster optimized for Coder deployments with:
 * - EKS Auto Mode for automated compute provisioning
 * - KMS encryption for cluster secrets
 * - Control plane logging to CloudWatch
 * - CloudWatch Container Insights
 * - EBS CSI driver for persistent volumes
 *
 * Ref: https://coder.com/docs/admin/infrastructure/validated-architectures
 */
export class EksCluster extends pulumi.ComponentResource {
    public readonly cluster: eks.Cluster;
    public readonly clusterSecurityGroup: aws.ec2.SecurityGroup | undefined;
    public readonly kmsKey: aws.kms.Key;
    public readonly kmsKeyAlias: aws.kms.Alias;
    public readonly clusterName: pulumi.Output<string>;
    public readonly clusterEndpoint: pulumi.Output<string>;
    public readonly clusterCertificateAuthority: pulumi.Output<string>;
    public readonly clusterSecurityGroupId: pulumi.Output<string>;
    public readonly k8sProvider?: k8s.Provider;
    public readonly ebsCsiDriverAddon?: aws.eks.Addon;

    constructor(name: string, args: EksClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super('custom:aws:EksCluster', name, {}, opts);

        const defaultOpts = { parent: this };

        // Validate required inputs
        if (!args.name) throw new Error('Cluster name is required');
        if (!args.vpcId) throw new Error('VPC ID is required');
        if (!args.privateSubnetIds) throw new Error('Private subnet IDs are required');

        // KMS key for cluster encryption
        if (args.kmsKey?.keyArn) {
            this.kmsKey = aws.kms.Key.get(`${name}-kms-key`, args.kmsKey.keyArn, {}, defaultOpts);
        } else {
            this.kmsKey = new aws.kms.Key(
                `${name}-kms-key`,
                {
                    description:
                        args.kmsKey?.description ||
                        `KMS key for EKS cluster ${args.name} encryption`,
                    deletionWindowInDays: args.kmsKey?.deletionWindowInDays || 30,
                    enableKeyRotation: true,
                    tags: args.tags,
                },
                defaultOpts,
            );
        }

        this.kmsKeyAlias = new aws.kms.Alias(
            `${name}-kms-alias`,
            { name: `alias/eks-${args.name}`, targetKeyId: this.kmsKey.id },
            defaultOpts,
        );

        if (args.clusterSecurityGroupEgressCidrs) {
            this.clusterSecurityGroup = new aws.ec2.SecurityGroup(
                `${name}-cluster-sg`,
                {
                    description: `Security group for EKS cluster ${args.name}`,
                    vpcId: args.vpcId,
                    tags: pulumi.output(args.tags).apply((tags) => ({
                        ...(tags ?? {}),
                        Name: `${args.name}-cluster-sg`,
                    })),
                },
                defaultOpts,
            );

            new aws.ec2.SecurityGroupRule(
                `${name}-cluster-sg-egress`,
                {
                    type: 'egress',
                    fromPort: 0,
                    toPort: 0,
                    protocol: '-1',
                    cidrBlocks: args.clusterSecurityGroupEgressCidrs,
                    securityGroupId: this.clusterSecurityGroup.id,
                    description: 'Allow configured outbound access from the EKS cluster',
                },
                { parent: this.clusterSecurityGroup },
            );
        }

        // EKS Cluster
        this.cluster = new eks.Cluster(
            `${name}-cluster`,
            {
                name: args.name,
                version: args.version || '1.35',
                vpcId: args.vpcId,
                // Only pass public subnets when the API endpoint has public access enabled.
                // For fully-private clusters this must be omitted so the control-plane ENIs
                // are placed only in the private subnets.
                publicSubnetIds:
                    args.endpointPublicAccess !== false ? args.publicSubnetIds : undefined,
                privateSubnetIds: args.privateSubnetIds,
                autoMode: args.autoModeEnabled !== false ? { enabled: true } : undefined,
                endpointPublicAccess: args.endpointPublicAccess !== false,
                endpointPrivateAccess: args.endpointPrivateAccess !== false,
                publicAccessCidrs:
                    args.endpointPublicAccess !== false
                        ? args.publicAccessCidrs || ['0.0.0.0/0']
                        : undefined,
                authenticationMode: args.autoModeEnabled !== false ? 'API' : 'API_AND_CONFIG_MAP',
                // Auto Mode with Pod Identity does not require an IRSA OIDC provider.
                // createOidcProvider: autoModeEnabled ? false : true,
                createOidcProvider: true,
                encryptionConfigKeyArn: this.kmsKey.arn,
                clusterSecurityGroup: this.clusterSecurityGroup,
                enabledClusterLogTypes:
                    args.enableControlPlaneLogs !== false
                        ? args.controlPlaneLogTypes || [
                              'api',
                              'audit',
                              'authenticator',
                              'controllerManager',
                              'scheduler',
                          ]
                        : [],
                skipDefaultNodeGroup: true,
                tags: args.tags,
            },
            defaultOpts,
        );

        // Tag data-plane (node) subnets so EKS Auto Mode / Karpenter can discover them
        // and the AWS Load Balancer Controller knows to use them for internal ELBs.
        // These IDs come from static config arrays so it is safe to cast and iterate.
        if (args.nodeSubnetIds) {
            const nodeSubnetIdList = args.nodeSubnetIds as string[];
            nodeSubnetIdList.forEach((subnetId, idx) => {
                new aws.ec2.Tag(
                    `${name}-node-subnet-${idx}-cluster-tag`,
                    {
                        resourceId: subnetId,
                        key: `kubernetes.io/cluster/${args.name}`,
                        value: 'shared',
                    },
                    { parent: this },
                );
                new aws.ec2.Tag(
                    `${name}-node-subnet-${idx}-internal-elb-tag`,
                    {
                        resourceId: subnetId,
                        key: 'kubernetes.io/role/internal-elb',
                        value: '1',
                    },
                    { parent: this },
                );
            });
        }

        // Cluster outputs
        this.clusterName = this.cluster.eksCluster.name;
        this.clusterEndpoint = this.cluster.eksCluster.endpoint;
        this.clusterCertificateAuthority = this.cluster.eksCluster.certificateAuthority.apply(
            (ca) => ca.data,
        );
        this.clusterSecurityGroupId = this.cluster.clusterSecurityGroup
            ? this.cluster.clusterSecurityGroup.apply(
                  (sg) => sg?.id || this.cluster.eksCluster.vpcConfig.clusterSecurityGroupId,
              )
            : this.cluster.eksCluster.vpcConfig.clusterSecurityGroupId;

        // Allow HTTPS access to the private EKS API server from the specified CIDRs.
        // The private API endpoint ENIs are attached to the EKS-created cluster
        // security group exposed through vpcConfig.clusterSecurityGroupId, even
        // when the Pulumi EKS component also manages a custom cluster SG.
        const controlPlaneSecurityGroupId =
            this.cluster.eksCluster.vpcConfig.clusterSecurityGroupId;
        if (args.controlPlaneIngressCidrs) {
            new aws.ec2.SecurityGroupRule(
                `${name}-control-plane-https-ingress`,
                {
                    type: 'ingress',
                    fromPort: 443,
                    toPort: 443,
                    protocol: 'tcp',
                    cidrBlocks: args.controlPlaneIngressCidrs as pulumi.Input<string[]>,
                    securityGroupId: controlPlaneSecurityGroupId,
                    description: 'Allow HTTPS access to the EKS API server',
                },
                { parent: this, dependsOn: [this.cluster] },
            );
        }

        // Kubernetes provider
        this.k8sProvider = new k8s.Provider(
            `${name}-k8s-provider`,
            { kubeconfig: this.getKubeconfig(), enableServerSideApply: true },
            { parent: this, dependsOn: [this.cluster] },
        );

        if (args.enableContainerInsights !== false) {
            new aws.eks.Addon(
                `${name}-container-insights`,
                {
                    clusterName: this.cluster.eksCluster.name,
                    addonName: 'amazon-cloudwatch-observability',
                    resolveConflictsOnCreate: 'OVERWRITE',
                    resolveConflictsOnUpdate: 'OVERWRITE',
                    tags: args.tags,
                },
                { parent: this, dependsOn: [this.cluster] },
            );
        }

        if (args.enableNetworkObservability !== false) {
            new aws.eks.Addon(
                `${name}-vpc-cni`,
                {
                    clusterName: this.cluster.eksCluster.name,
                    addonName: 'vpc-cni',
                    configurationValues: JSON.stringify({
                        enableNetworkPolicy: 'true',
                        nodeAgent: {
                            enabled: true,
                        },
                        env: {
                            NETWORK_POLICY_ENFORCING_MODE: 'strict',
                        },
                    }),
                    resolveConflictsOnCreate: 'OVERWRITE',
                    resolveConflictsOnUpdate: 'OVERWRITE',
                    tags: args.tags,
                },
                { parent: this, dependsOn: [this.cluster] },
            );
        }

        const autoModeEnabled = args.autoModeEnabled !== false;

        // The manual EBS CSI addon is only needed when Auto Mode is disabled.
        // Auto Mode provides native EBS support via the ebs.csi.eks.amazonaws.com
        // provisioner, and Karpenter cannot validate PVCs against the standalone
        // ebs.csi.aws.com driver during scheduling simulation.
        if (!autoModeEnabled) {
            this.ebsCsiDriverAddon = this.installEbsCsiDriver(name, args.tags);
        }

        new k8s.storage.v1.StorageClass(
            `${name}-gp3-storage-class`,
            {
                metadata: {
                    name: 'gp3',
                    annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' },
                },
                provisioner: autoModeEnabled ? 'ebs.csi.eks.amazonaws.com' : 'ebs.csi.aws.com',
                parameters: { type: 'gp3', encrypted: 'true' },
                volumeBindingMode: 'WaitForFirstConsumer',
                allowVolumeExpansion: true,
                reclaimPolicy: 'Delete',
            },
            {
                provider: this.k8sProvider,
                parent: this,
                dependsOn: this.ebsCsiDriverAddon ? [this.ebsCsiDriverAddon] : [this.cluster],
            },
        );

        // EKS Auto Mode creates a `general-purpose` NodePool that only schedules
        // amd64 workloads.  Create a companion NodePool for arm64 (Graviton) so
        // runner pods requesting `kubernetes.io/arch: arm64` can be provisioned.
        if (autoModeEnabled) {
            new k8s.apiextensions.CustomResource(
                `${name}-arm64-nodepool`,
                {
                    apiVersion: 'karpenter.sh/v1',
                    kind: 'NodePool',
                    metadata: { name: 'general-purpose-arm64' },
                    spec: {
                        template: {
                            spec: {
                                nodeClassRef: {
                                    group: 'eks.amazonaws.com',
                                    kind: 'NodeClass',
                                    name: 'default',
                                },
                                requirements: [
                                    {
                                        key: 'karpenter.sh/capacity-type',
                                        operator: 'In',
                                        values: ['on-demand'],
                                    },
                                    {
                                        key: 'eks.amazonaws.com/instance-category',
                                        operator: 'In',
                                        values: ['c', 'm', 'r'],
                                    },
                                    {
                                        key: 'eks.amazonaws.com/instance-generation',
                                        operator: 'Gt',
                                        values: ['4'],
                                    },
                                    {
                                        key: 'kubernetes.io/arch',
                                        operator: 'In',
                                        values: ['arm64'],
                                    },
                                    {
                                        key: 'kubernetes.io/os',
                                        operator: 'In',
                                        values: ['linux'],
                                    },
                                ],
                                expireAfter: '336h',
                                terminationGracePeriod: '24h',
                            },
                        },
                        disruption: {
                            consolidationPolicy: 'WhenEmptyOrUnderutilized',
                            consolidateAfter: '30s',
                            budgets: [{ nodes: '10%' }],
                        },
                    },
                },
                {
                    provider: this.k8sProvider,
                    parent: this,
                    dependsOn: [this.cluster],
                },
            );
        }

        this.registerOutputs({
            clusterName: this.clusterName,
            clusterEndpoint: this.clusterEndpoint,
            clusterCertificateAuthority: this.clusterCertificateAuthority,
            clusterSecurityGroupId: this.clusterSecurityGroupId,
            kmsKeyId: this.kmsKey.id,
            kmsKeyArn: this.kmsKey.arn,
        });
    }

    private installEbsCsiDriver(
        name: string,
        tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>,
    ): aws.eks.Addon {
        const ebsCsiPolicy = new aws.iam.Policy(
            `${name}-ebs-csi-policy`,
            {
                policy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Action: [
                                'ec2:CreateSnapshot',
                                'ec2:AttachVolume',
                                'ec2:DetachVolume',
                                'ec2:ModifyVolume',
                                'ec2:DescribeAvailabilityZones',
                                'ec2:DescribeInstances',
                                'ec2:DescribeSnapshots',
                                'ec2:DescribeTags',
                                'ec2:DescribeVolumes',
                                'ec2:DescribeVolumesModifications',
                            ],
                            Resource: '*',
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:CreateTags'],
                            Resource: ['arn:aws:ec2:*:*:volume/*', 'arn:aws:ec2:*:*:snapshot/*'],
                            Condition: {
                                StringEquals: {
                                    'ec2:CreateAction': ['CreateVolume', 'CreateSnapshot'],
                                },
                            },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteTags'],
                            Resource: ['arn:aws:ec2:*:*:volume/*', 'arn:aws:ec2:*:*:snapshot/*'],
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:CreateVolume'],
                            Resource: '*',
                            Condition: {
                                StringLike: { 'aws:RequestTag/ebs.csi.aws.com/cluster': 'true' },
                            },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:CreateVolume'],
                            Resource: '*',
                            Condition: { StringLike: { 'aws:RequestTag/CSIVolumeName': '*' } },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteVolume'],
                            Resource: '*',
                            Condition: {
                                StringLike: { 'ec2:ResourceTag/ebs.csi.aws.com/cluster': 'true' },
                            },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteVolume'],
                            Resource: '*',
                            Condition: { StringLike: { 'ec2:ResourceTag/CSIVolumeName': '*' } },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteVolume'],
                            Resource: '*',
                            Condition: {
                                StringLike: {
                                    'ec2:ResourceTag/kubernetes.io/created-for/pvc/name': '*',
                                },
                            },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteSnapshot'],
                            Resource: '*',
                            Condition: {
                                StringLike: { 'ec2:ResourceTag/CSIVolumeSnapshotName': '*' },
                            },
                        },
                        {
                            Effect: 'Allow',
                            Action: ['ec2:DeleteSnapshot'],
                            Resource: '*',
                            Condition: {
                                StringLike: { 'ec2:ResourceTag/ebs.csi.aws.com/cluster': 'true' },
                            },
                        },
                    ],
                }),
                tags,
            },
            { parent: this },
        );

        const ebsCsiRole = new aws.iam.Role(
            `${name}-ebs-csi-role`,
            {
                // EKS Pod Identity roles are assumed by the Pod Identity agent, not via OIDC/IRSA.
                assumeRolePolicy: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                Service: 'pods.eks.amazonaws.com',
                            },
                            Action: ['sts:AssumeRole', 'sts:TagSession'],
                        },
                    ],
                }),
                tags,
            },
            { parent: this },
        );

        const ebsCsiPolicyAttachment = new aws.iam.RolePolicyAttachment(
            `${name}-ebs-csi-policy-attachment`,
            { role: ebsCsiRole.name, policyArn: ebsCsiPolicy.arn },
            { parent: this },
        );

        const addon = new aws.eks.Addon(
            `${name}-ebs-csi-driver`,
            {
                clusterName: this.cluster.eksCluster.name,
                addonName: 'aws-ebs-csi-driver',
                podIdentityAssociations: [
                    {
                        roleArn: ebsCsiRole.arn,
                        serviceAccount: 'ebs-csi-controller-sa',
                    },
                ],
                resolveConflictsOnCreate: 'OVERWRITE',
                resolveConflictsOnUpdate: 'OVERWRITE',
                tags,
            },
            {
                parent: this.cluster,
                dependsOn: [this.cluster, ebsCsiRole, ebsCsiPolicyAttachment],
                customTimeouts: { create: '10m', update: '10m', delete: '10m' },
            },
        );

        return addon;
    }

    public getKubeconfig(): pulumi.Output<string> {
        return pulumi
            .all([this.clusterName, this.clusterEndpoint, this.clusterCertificateAuthority])
            .apply(([clusterName, endpoint, ca]) =>
                JSON.stringify({
                    apiVersion: 'v1',
                    kind: 'Config',
                    clusters: [
                        {
                            cluster: { server: endpoint, 'certificate-authority-data': ca },
                            name: 'kubernetes',
                        },
                    ],
                    contexts: [{ context: { cluster: 'kubernetes', user: 'aws' }, name: 'aws' }],
                    'current-context': 'aws',
                    users: [
                        {
                            name: 'aws',
                            user: {
                                exec: {
                                    apiVersion: 'client.authentication.k8s.io/v1beta1',
                                    command: 'aws',
                                    args: ['eks', 'get-token', '--cluster-name', clusterName],
                                },
                            },
                        },
                    ],
                }),
            );
    }
}

export default EksCluster;

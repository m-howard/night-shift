import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

/**
 * Configuration for a single CloudWatch metric alarm.
 * Used internally to generate the three default alarm definitions.
 */
interface AlarmDefinition {
    /** Suffix appended to the component name for the alarm resource name. */
    suffix: string;
    /** Human-readable description surfaced in CloudWatch. */
    description: string;
    /** CloudWatch metric namespace (Container Insights by default). */
    metricNamespace: string;
    /** CloudWatch metric name. */
    metricName: string;
    /** CloudWatch metric statistic (e.g. "Sum", "Average"). */
    statistic: string;
    /** Evaluation period in seconds. */
    period: number;
    /** Number of consecutive periods that must breach before alarming. */
    evaluationPeriods: number;
    /** Threshold value that triggers the alarm. */
    threshold: number;
    /** CloudWatch comparison operator. */
    comparisonOperator: string;
    /** How to treat missing data ("notBreaching" is safe for intermittent metrics). */
    treatMissingData: string;
    /** CloudWatch dimensions map. */
    dimensions: Record<string, pulumi.Input<string>>;
}

/** Arguments for the {@link Observability} component. */
export interface ObservabilityArgs {
    /** EKS cluster name used as the CloudWatch Container Insights dimension. */
    clusterName: pulumi.Input<string>;
    /** Namespace names to monitor (used in alarm descriptions for operator context). */
    namespaces: pulumi.Input<string[]>;
    /** Optional SNS topic ARN to receive alarm notifications. */
    snsTopicArn?: pulumi.Input<string>;
    /** Optional runbook URL included in alarm descriptions and exported as an output. */
    runbookUrl?: pulumi.Input<string>;
    /** Tags applied to all created AWS resources. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * Observability Component — CloudWatch alarms for GitHub runner infrastructure.
 *
 * Creates metric alarms for pod failure count, pending pod count, and failed
 * node count using Container Insights metrics from the target EKS cluster.
 * Alarms can optionally notify an SNS topic and include a runbook URL.
 */
export class Observability extends pulumi.ComponentResource {
    /** Map of alarm logical names to their CloudWatch alarm resources. */
    public readonly alarms: Record<string, aws.cloudwatch.MetricAlarm>;
    /** Map of alarm logical names to their CloudWatch alarm names. */
    public readonly alarmNames: pulumi.Output<Record<string, string>>;
    /** Map of alarm logical names to their CloudWatch alarm ARNs. */
    public readonly alarmArns: pulumi.Output<Record<string, string>>;
    /** Runbook URL passed through for downstream consumption. */
    public readonly runbookUrl: pulumi.Output<string>;

    constructor(name: string, args: ObservabilityArgs, opts?: pulumi.ComponentResourceOptions) {
        super('mtx:aws:observability', name, {}, opts);

        const clusterName = pulumi.output(args.clusterName);
        const snsTopicArn = args.snsTopicArn ? pulumi.output(args.snsTopicArn) : undefined;
        const runbookUrl = args.runbookUrl ? pulumi.output(args.runbookUrl) : pulumi.output('');
        const tags = args.tags;

        const runbookSuffix = runbookUrl.apply((url) => (url ? ` | Runbook: ${url}` : ''));

        const alarmDefinitions: AlarmDefinition[] = [
            {
                suffix: 'pod-failure-count',
                description: 'Alerts when runner pod failures exceed threshold.',
                metricNamespace: 'ContainerInsights',
                metricName: 'pod_number_of_container_restarts',
                statistic: 'Sum',
                period: 300,
                evaluationPeriods: 2,
                threshold: 5,
                comparisonOperator: 'GreaterThanOrEqualToThreshold',
                treatMissingData: 'notBreaching',
                dimensions: { ClusterName: clusterName },
            },
            {
                suffix: 'pending-pod-count',
                description: 'Alerts when pending pods exceed threshold.',
                metricNamespace: 'ContainerInsights',
                metricName: 'cluster_failed_node_count',
                statistic: 'Average',
                period: 300,
                evaluationPeriods: 3,
                threshold: 1,
                comparisonOperator: 'GreaterThanOrEqualToThreshold',
                treatMissingData: 'notBreaching',
                dimensions: { ClusterName: clusterName },
            },
            {
                suffix: 'failed-node-count',
                description: 'Alerts when failed node count exceeds threshold.',
                metricNamespace: 'ContainerInsights',
                metricName: 'cluster_failed_node_count',
                statistic: 'Maximum',
                period: 300,
                evaluationPeriods: 2,
                threshold: 1,
                comparisonOperator: 'GreaterThanOrEqualToThreshold',
                treatMissingData: 'notBreaching',
                dimensions: { ClusterName: clusterName },
            },
        ];

        // Use the correct pending pod metric name from Container Insights.
        alarmDefinitions[1].metricName = 'namespace_number_of_running_pods';

        this.alarms = {};

        for (const def of alarmDefinitions) {
            const alarmName = `${name}-${def.suffix}`;

            const alarmActions: pulumi.Input<string>[] = [];
            if (snsTopicArn) {
                alarmActions.push(snsTopicArn);
            }

            this.alarms[def.suffix] = new aws.cloudwatch.MetricAlarm(
                alarmName,
                {
                    name: alarmName,
                    alarmDescription: runbookSuffix.apply(
                        (suffix) => `${def.description}${suffix}`,
                    ),
                    namespace: def.metricNamespace,
                    metricName: def.metricName,
                    statistic: def.statistic,
                    period: def.period,
                    evaluationPeriods: def.evaluationPeriods,
                    threshold: def.threshold,
                    comparisonOperator: def.comparisonOperator,
                    treatMissingData: def.treatMissingData,
                    dimensions: def.dimensions,
                    alarmActions,
                    okActions: alarmActions,
                    tags,
                },
                { parent: this },
            );
        }

        this.alarmNames = pulumi
            .all(
                Object.entries(this.alarms).map(([key, alarm]) =>
                    alarm.name.apply((alarmName) => [key, alarmName] as const),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.alarmArns = pulumi
            .all(
                Object.entries(this.alarms).map(([key, alarm]) =>
                    alarm.arn.apply((arn) => [key, arn] as const),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.runbookUrl = runbookUrl;

        this.registerOutputs({
            alarmNames: this.alarmNames,
            alarmArns: this.alarmArns,
            runbookUrl: this.runbookUrl,
        });
    }
}

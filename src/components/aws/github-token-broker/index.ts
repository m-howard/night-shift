import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

/**
 * Lambda function inline code for the GitHub App token broker.
 *
 * The handler:
 * 1. Reads the GitHub App private key from AWS Secrets Manager.
 * 2. Generates a JWT (RS256) using the private key.
 * 3. Exchanges the JWT for a short-lived GitHub installation token.
 * 4. Writes the installation token to a dedicated Secrets Manager secret.
 *
 * Dependencies are available in the Lambda Node.js 20 runtime (crypto, https).
 */
const LAMBDA_HANDLER_CODE = `
const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const crypto = require('crypto');
const https = require('https');

const sm = new SecretsManagerClient({});

function base64url(buf) {
    return buf.toString('base64').replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
}

function buildJwt(appId, privateKeyPem) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const payload = base64url(Buffer.from(JSON.stringify({ iss: appId, iat: now - 60, exp: now + 600 })));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(header + '.' + payload), { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_v1_5 });
    return header + '.' + payload + '.' + base64url(signature);
}

function httpsPost(url, token) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': 'Bearer ' + token,
                'User-Agent': 'github-runners-eks-token-broker',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(body));
                } else {
                    reject(new Error('GitHub API ' + res.statusCode + ': ' + body));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

exports.handler = async () => {
    const sourceSecretId = process.env.SOURCE_SECRET_ID;
    const tokenSecretId = process.env.TOKEN_SECRET_ID;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

    const { SecretString: secretPayload } = await sm.send(new GetSecretValueCommand({ SecretId: sourceSecretId }));
    const parsed = JSON.parse(secretPayload);

    const appId = parsed.github_app_id || parsed.githubAppId;
    let privateKey = parsed.github_app_private_key || parsed.githubAppPrivateKey || parsed.github_app_private_key_base64 || parsed.githubAppPrivateKeyBase64 || '';

    if (!privateKey.includes('-----BEGIN')) {
        privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
    }

    const effectiveInstallationId = installationId || parsed.github_app_installation_id || parsed.githubAppInstallationId;

    if (!appId) { throw new Error('Missing github_app_id in source secret'); }
    if (!privateKey || !privateKey.includes('-----BEGIN')) { throw new Error('Missing or invalid private key in source secret'); }
    if (!effectiveInstallationId) { throw new Error('Missing installation ID — set GITHUB_APP_INSTALLATION_ID env var or include github_app_installation_id in source secret'); }
    if (!/^\\d+$/.test(String(effectiveInstallationId))) { throw new Error('Installation ID must be numeric, got non-numeric value'); }

    const jwt = buildJwt(appId, privateKey);
    const tokenResponse = await httpsPost(
        'https://api.github.com/app/installations/' + effectiveInstallationId + '/access_tokens',
        jwt,
    );

    await sm.send(new PutSecretValueCommand({
        SecretId: tokenSecretId,
        SecretString: JSON.stringify({ github_token: tokenResponse.token }),
    }));

    return { statusCode: 200, body: 'Token refreshed, expires at ' + tokenResponse.expires_at };
};
`;

/** Arguments for the {@link GitHubTokenBroker} component. */
export interface GitHubTokenBrokerArgs {
    /** AWS Secrets Manager secret ID or ARN containing the GitHub App private key. */
    sourceSecretId: pulumi.Input<string>;
    /**
     * Optional AWS Secrets Manager secret ARN where the broker writes installation tokens.
     * When omitted, a new secret is created automatically.
     */
    tokenSecretArn?: pulumi.Input<string>;
    /** GitHub App installation ID. When omitted, read from the source secret at runtime. */
    installationId?: pulumi.Input<string>;
    /** How often the broker runs, in minutes. Default: 30. */
    refreshMinutes?: number;
    /** Tags applied to all created AWS resources. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * GitHubTokenBroker — Lambda-based centralized token broker for ARC authentication.
 *
 * Reads the GitHub App private key from Secrets Manager, generates a short-lived
 * GitHub installation token (1 hour), and stores it in a dedicated Secrets Manager
 * secret.  An EventBridge schedule triggers the Lambda at a configurable interval.
 *
 * The private key never leaves Secrets Manager + Lambda memory. Runner namespaces
 * only ever receive the short-lived installation token via External Secrets Operator.
 */
export class GitHubTokenBroker extends pulumi.ComponentResource {
    /** The Secrets Manager secret that holds the short-lived installation token. */
    public readonly tokenSecret: aws.secretsmanager.Secret;
    /** ARN of the token secret. */
    public readonly tokenSecretArn: pulumi.Output<string>;
    /** The Lambda function that performs the token refresh. */
    public readonly lambdaFunction: aws.lambda.Function;
    /** Initial synchronous invocation that makes a token available during deployment. */
    public readonly initialInvocation: aws.lambda.Invocation;
    /** The EventBridge schedule rule. */
    public readonly scheduleRule: aws.cloudwatch.EventRule;
    /** CloudWatch alarm that fires when the Lambda fails. */
    public readonly failureAlarm: aws.cloudwatch.MetricAlarm;

    constructor(name: string, args: GitHubTokenBrokerArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:aws:GitHubTokenBroker', name, {}, opts);

        const refreshMinutes = args.refreshMinutes ?? 30;

        // -----------------------------------------------------------------
        // Token Secret — destination for short-lived installation tokens
        // -----------------------------------------------------------------
        const tokenSecret = args.tokenSecretArn
            ? aws.secretsmanager.Secret.get(`${name}-token-secret-ref`, args.tokenSecretArn, {})
            : new aws.secretsmanager.Secret(
                  `${name}-token-secret`,
                  {
                      description:
                          'Short-lived GitHub App installation token generated by the token broker Lambda',
                      tags: args.tags,
                  },
                  { parent: this },
              );

        this.tokenSecret = tokenSecret;
        this.tokenSecretArn = tokenSecret.arn;

        // Seed the secret with a placeholder value so ESO ExternalSecret resources
        // can reference it immediately (avoids "secret version not found" errors
        // during first deploy before the Lambda has run).
        const tokenSecretSeed = !args.tokenSecretArn
            ? new aws.secretsmanager.SecretVersion(
                  `${name}-token-secret-seed`,
                  {
                      secretId: tokenSecret.id,
                      secretString: JSON.stringify({ github_token: '' }),
                  },
                  { parent: this },
              )
            : undefined;

        // -----------------------------------------------------------------
        // IAM Role for the Lambda function
        // -----------------------------------------------------------------
        const assumeRolePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: 'Allow',
                    actions: ['sts:AssumeRole'],
                    principals: [
                        {
                            type: 'Service',
                            identifiers: ['lambda.amazonaws.com'],
                        },
                    ],
                },
            ],
        });

        const lambdaRole = new aws.iam.Role(
            `${name}-lambda-role`,
            {
                assumeRolePolicy: assumeRolePolicy.json,
                description: 'Execution role for the GitHub App token broker Lambda',
                tags: args.tags,
            },
            { parent: this },
        );

        // Attach basic Lambda execution for CloudWatch Logs
        const lambdaBasicExecution = new aws.iam.RolePolicyAttachment(
            `${name}-lambda-basic-execution`,
            {
                role: lambdaRole.name,
                policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            },
            { parent: this },
        );

        // Inline policy: read source secret + write token secret
        const inlinePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    sid: 'ReadSourceSecret',
                    effect: 'Allow',
                    actions: ['secretsmanager:GetSecretValue'],
                    resources: [
                        pulumi
                            .all([
                                pulumi.output(args.sourceSecretId),
                                aws.getCallerIdentity(),
                                aws.getRegion(),
                            ])
                            .apply(([id, identity, region]) => {
                                if (id.startsWith('arn:')) {
                                    return id;
                                }
                                return `arn:aws:secretsmanager:${region.name}:${identity.accountId}:secret:${id}-??????`;
                            }),
                    ],
                },
                {
                    sid: 'WriteTokenSecret',
                    effect: 'Allow',
                    actions: ['secretsmanager:PutSecretValue'],
                    resources: [tokenSecret.arn],
                },
            ],
        });

        const lambdaSecretsPolicy = new aws.iam.RolePolicy(
            `${name}-lambda-secrets-policy`,
            {
                role: lambdaRole.id,
                policy: inlinePolicy.json,
            },
            { parent: this },
        );

        // -----------------------------------------------------------------
        // Lambda Function
        // -----------------------------------------------------------------
        this.lambdaFunction = new aws.lambda.Function(
            `${name}-lambda`,
            {
                runtime: 'nodejs20.x',
                handler: 'index.handler',
                role: lambdaRole.arn,
                timeout: 30,
                memorySize: 128,
                code: new pulumi.asset.AssetArchive({
                    'index.js': new pulumi.asset.StringAsset(LAMBDA_HANDLER_CODE),
                }),
                environment: {
                    variables: {
                        SOURCE_SECRET_ID: pulumi.output(args.sourceSecretId).apply((v) => v),
                        TOKEN_SECRET_ID: tokenSecret.name,
                        ...(args.installationId
                            ? {
                                  GITHUB_APP_INSTALLATION_ID: pulumi
                                      .output(args.installationId)
                                      .apply((v) => v),
                              }
                            : {}),
                    },
                },
                tags: args.tags,
            },
            { parent: this },
        );

        // EventBridge does not invoke a new schedule immediately. Generate the
        // first token synchronously so dependent ExternalSecrets and ARC scale
        // sets cannot start with the placeholder token.
        this.initialInvocation = new aws.lambda.Invocation(
            `${name}-initial-invocation`,
            {
                functionName: this.lambdaFunction.name,
                input: JSON.stringify({}),
                triggers: {
                    functionLastModified: this.lambdaFunction.lastModified,
                },
            },
            {
                parent: this,
                dependsOn: [
                    this.lambdaFunction,
                    lambdaBasicExecution,
                    lambdaSecretsPolicy,
                    ...(tokenSecretSeed ? [tokenSecretSeed] : []),
                ],
            },
        );

        // -----------------------------------------------------------------
        // EventBridge Schedule
        // -----------------------------------------------------------------
        this.scheduleRule = new aws.cloudwatch.EventRule(
            `${name}-schedule`,
            {
                description: `Triggers the GitHub App token broker Lambda every ${refreshMinutes} minutes`,
                scheduleExpression: `rate(${refreshMinutes} minutes)`,
                tags: args.tags,
            },
            { parent: this },
        );

        new aws.cloudwatch.EventTarget(
            `${name}-schedule-target`,
            {
                rule: this.scheduleRule.name,
                arn: this.lambdaFunction.arn,
            },
            { parent: this },
        );

        new aws.lambda.Permission(
            `${name}-event-permission`,
            {
                action: 'lambda:InvokeFunction',
                function: this.lambdaFunction.name,
                principal: 'events.amazonaws.com',
                sourceArn: this.scheduleRule.arn,
            },
            { parent: this },
        );

        // -----------------------------------------------------------------
        // CloudWatch Alarm — fires when the Lambda errors
        // -----------------------------------------------------------------
        this.failureAlarm = new aws.cloudwatch.MetricAlarm(
            `${name}-failure-alarm`,
            {
                alarmDescription:
                    'GitHub App token broker Lambda is failing — runner auth tokens will expire within 1 hour if not resolved',
                namespace: 'AWS/Lambda',
                metricName: 'Errors',
                dimensions: {
                    FunctionName: this.lambdaFunction.name,
                },
                statistic: 'Sum',
                period: 300,
                evaluationPeriods: 2,
                threshold: 1,
                comparisonOperator: 'GreaterThanOrEqualToThreshold',
                treatMissingData: 'notBreaching',
                tags: args.tags,
            },
            { parent: this },
        );

        this.registerOutputs({
            tokenSecretArn: this.tokenSecretArn,
            lambdaFunctionName: this.lambdaFunction.name,
            initialInvocationId: this.initialInvocation.id,
            scheduleRuleName: this.scheduleRule.name,
            failureAlarmName: this.failureAlarm.name,
        });
    }
}

export default GitHubTokenBroker;

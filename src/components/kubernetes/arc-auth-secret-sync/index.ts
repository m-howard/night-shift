import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

export interface ArcAuthSecretSyncArgs {
    runnerNamespaces: string[];
    secretName: string;
    sourceSecretId?: string | null;
    namespaceResources?: Record<string, k8s.core.v1.Namespace>;
}

type ArcAuthSecretKey = 'github_app_id' | 'github_app_installation_id' | 'github_app_private_key';

type ArcAuthSecretValues = Record<ArcAuthSecretKey, string>;

type PulumiArcAuthSecretConfig = {
    githubAppId?: string;
    githubAppInstallationId?: string;
    githubAppPrivateKey?: string;
};

const ARC_AUTH_SECRET_KEY_ALIASES: Record<ArcAuthSecretKey, readonly string[]> = {
    github_app_id: ['github_app_id', 'githubAppId'],
    github_app_installation_id: ['github_app_installation_id', 'githubAppInstallationId'],
    github_app_private_key: [
        'github_app_private_key',
        'githubAppPrivateKey',
        'github_app_private_key_base64',
        'githubAppPrivateKeyBase64',
    ],
};

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const ARC_PRIVATE_KEY_PEM_MARKER = '-----BEGIN';

const decodeBase64PrivateKey = (value: string, sourceDescription: string): string => {
    try {
        const decodedValue = Buffer.from(value, 'base64').toString('utf8').trim();

        if (!decodedValue.includes(ARC_PRIVATE_KEY_PEM_MARKER)) {
            throw new Error('Decoded value does not contain a PEM private key marker');
        }

        return decodedValue;
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown decode error';
        throw new Error(
            `ARC auth private key from ${sourceDescription} must be valid base64-encoded PEM content: ${reason}`,
        );
    }
};

const normalizeArcAuthSecretValue = (
    targetKey: ArcAuthSecretKey,
    alias: string,
    value: string,
    sourceDescription: string,
): string => {
    const trimmedValue = value.trim();

    if (targetKey !== 'github_app_private_key') {
        return trimmedValue;
    }

    if (alias.endsWith('_base64') || alias.endsWith('Base64')) {
        return decodeBase64PrivateKey(trimmedValue, `${sourceDescription} key '${alias}'`);
    }

    if (trimmedValue.includes(ARC_PRIVATE_KEY_PEM_MARKER)) {
        return trimmedValue;
    }

    try {
        return decodeBase64PrivateKey(trimmedValue, `${sourceDescription} key '${alias}'`);
    } catch {
        return trimmedValue;
    }
};

const validateRunnerNamespaces = (runnerNamespaces: string[]): string[] => {
    if (runnerNamespaces.length === 0) {
        throw new Error('ArcAuthSecretSync requires at least one runner namespace');
    }

    const uniqueNamespaces = new Set<string>();

    for (const runnerNamespace of runnerNamespaces) {
        const trimmedNamespace = runnerNamespace.trim();

        if (!trimmedNamespace) {
            throw new Error('ArcAuthSecretSync runner namespaces must be non-empty strings');
        }

        uniqueNamespaces.add(trimmedNamespace);
    }

    return Array.from(uniqueNamespaces);
};

export const parseArcAuthSecretPayload = (
    secretPayload: string | undefined,
    sourceDescription: string,
): Record<string, unknown> => {
    if (!isNonEmptyString(secretPayload)) {
        throw new Error(
            `ARC auth secret payload from ${sourceDescription} must be a non-empty JSON object`,
        );
    }

    let parsedPayload: unknown;

    try {
        parsedPayload = JSON.parse(secretPayload);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown parse error';
        throw new Error(
            `ARC auth secret payload from ${sourceDescription} must be valid JSON: ${reason}`,
        );
    }

    if (
        typeof parsedPayload !== 'object' ||
        parsedPayload === null ||
        Array.isArray(parsedPayload)
    ) {
        throw new Error(`ARC auth secret payload from ${sourceDescription} must be a JSON object`);
    }

    return parsedPayload as Record<string, unknown>;
};

const resolveArcAuthSecretValue = (
    values: Record<string, unknown>,
    targetKey: ArcAuthSecretKey,
    sourceDescription: string,
): string => {
    for (const alias of ARC_AUTH_SECRET_KEY_ALIASES[targetKey]) {
        const value = values[alias];

        if (value === undefined || value === null) {
            continue;
        }

        if (!isNonEmptyString(value)) {
            throw new Error(
                `ARC auth secret key '${targetKey}' from ${sourceDescription} must be a non-empty string`,
            );
        }

        return normalizeArcAuthSecretValue(targetKey, alias, value, sourceDescription);
    }

    throw new Error(
        `ARC auth secret key '${targetKey}' is missing from ${sourceDescription}. Expected one of: ${ARC_AUTH_SECRET_KEY_ALIASES[targetKey].join(', ')}`,
    );
};

export const resolveArcAuthSecretValues = (
    values: Record<string, unknown>,
    sourceDescription: string,
): ArcAuthSecretValues => ({
    github_app_id: resolveArcAuthSecretValue(values, 'github_app_id', sourceDescription),
    github_app_installation_id: resolveArcAuthSecretValue(
        values,
        'github_app_installation_id',
        sourceDescription,
    ),
    github_app_private_key: resolveArcAuthSecretValue(
        values,
        'github_app_private_key',
        sourceDescription,
    ),
});

const resolvePulumiArcAuthSecretValues = (
    configValues: PulumiArcAuthSecretConfig,
): ArcAuthSecretValues => {
    const sourceDescription = 'Pulumi secret config';

    return resolveArcAuthSecretValues(
        {
            githubAppId: configValues.githubAppId,
            githubAppInstallationId: configValues.githubAppInstallationId,
            githubAppPrivateKey: configValues.githubAppPrivateKey,
        },
        sourceDescription,
    );
};

/**
 * ArcAuthSecretSync materializes GitHub App credentials into runner namespaces.
 */
export class ArcAuthSecretSync extends pulumi.ComponentResource {
    public readonly secrets: Record<string, k8s.core.v1.Secret>;
    public readonly secretNamesByNamespace: pulumi.Output<Record<string, string>>;

    constructor(name: string, args: ArcAuthSecretSyncArgs, opts?: pulumi.ComponentResourceOptions) {
        super('github-runners-eks:kubernetes:ArcAuthSecretSync', name, {}, opts);

        const runnerNamespaces = validateRunnerNamespaces(args.runnerNamespaces);
        const secretName = args.secretName.trim();

        if (!secretName) {
            throw new Error('ArcAuthSecretSync requires a non-empty secretName');
        }

        const projectConfig = new pulumi.Config();

        const secretValues = pulumi.secret(
            args.sourceSecretId
                ? pulumi
                      .all([
                          pulumi.output(args.sourceSecretId),
                          aws.secretsmanager.getSecretVersionOutput({
                              secretId: args.sourceSecretId,
                          }).secretString,
                      ])
                      .apply(([secretId, secretPayload]) =>
                          resolveArcAuthSecretValues(
                              parseArcAuthSecretPayload(
                                  secretPayload,
                                  `Secrets Manager secret ${secretId}`,
                              ),
                              `Secrets Manager secret ${secretId}`,
                          ),
                      )
                : pulumi
                      .all([
                          pulumi.output(projectConfig.getSecret('githubAppId')),
                          pulumi.output(projectConfig.getSecret('githubAppInstallationId')),
                          pulumi.output(projectConfig.getSecret('githubAppPrivateKey')),
                      ])
                      .apply(([githubAppId, githubAppInstallationId, githubAppPrivateKey]) =>
                          resolvePulumiArcAuthSecretValues({
                              githubAppId,
                              githubAppInstallationId,
                              githubAppPrivateKey,
                          }),
                      ),
        );

        this.secrets = Object.fromEntries(
            runnerNamespaces.map((runnerNamespace) => {
                const secret = new k8s.core.v1.Secret(
                    `${name}-${runnerNamespace}-secret`,
                    {
                        metadata: {
                            name: secretName,
                            namespace: runnerNamespace,
                        },
                        stringData: secretValues,
                        type: 'Opaque',
                    },
                    {
                        parent: this,
                        dependsOn: args.namespaceResources?.[runnerNamespace]
                            ? [args.namespaceResources[runnerNamespace]]
                            : undefined,
                    },
                );

                return [runnerNamespace, secret];
            }),
        );

        this.secretNamesByNamespace = pulumi
            .all(
                Object.entries(this.secrets).map(([runnerNamespace, secret]) =>
                    pulumi
                        .output(secret.metadata.name)
                        .apply(
                            (resolvedSecretName) =>
                                [runnerNamespace, resolvedSecretName || secretName] as const,
                        ),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.registerOutputs({
            secretNamesByNamespace: this.secretNamesByNamespace,
        });
    }
}

export default ArcAuthSecretSync;

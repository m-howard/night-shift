import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { NamespaceDefinition } from '../../types';

export interface NamespaceBootstrapArgs {
    definitions: NamespaceDefinition[];
}

/**
 * NamespaceBootstrap creates the platform namespaces required by the compute stack.
 */
export class NamespaceBootstrap extends pulumi.ComponentResource {
    public readonly namespaces: Record<string, k8s.core.v1.Namespace>;
    public readonly namespaceNames: pulumi.Output<string[]>;
    public readonly namespaceNameMap: pulumi.Output<Record<string, string>>;

    constructor(
        name: string,
        args: NamespaceBootstrapArgs,
        opts?: pulumi.ComponentResourceOptions,
    ) {
        super('github-runners-eks:kubernetes:NamespaceBootstrap', name, {}, opts);

        const definitions = args.definitions;

        if (definitions.length === 0) {
            throw new Error('NamespaceBootstrap requires at least one namespace definition');
        }

        const seenNames = new Set<string>();
        for (const definition of definitions) {
            const trimmedName = definition.name.trim();

            if (!trimmedName) {
                throw new Error('Namespace definitions must include a non-empty name');
            }

            if (seenNames.has(trimmedName)) {
                throw new Error(`Namespace definition '${trimmedName}' is duplicated`);
            }

            seenNames.add(trimmedName);
        }

        this.namespaces = Object.fromEntries(
            definitions.map((definition) => {
                const namespace = new k8s.core.v1.Namespace(
                    `${name}-${definition.name}`,
                    {
                        metadata: {
                            name: definition.name,
                            labels: {
                                'kubernetes.io/metadata.name': definition.name,
                                ...(definition.labels || {}),
                            },
                            annotations: definition.annotations,
                        },
                    },
                    {
                        parent: this,
                    },
                );

                return [definition.name, namespace];
            }),
        );

        const namespaceEntries = Object.entries(this.namespaces);

        this.namespaceNames = pulumi
            .all(namespaceEntries.map(([, namespace]) => namespace.metadata.name))
            .apply((names) =>
                names.filter((namespaceName): namespaceName is string => Boolean(namespaceName)),
            );

        this.namespaceNameMap = pulumi
            .all(
                namespaceEntries.map(([namespaceKey, namespace]) =>
                    pulumi
                        .output(namespace.metadata.name)
                        .apply(
                            (namespaceName) =>
                                [namespaceKey, namespaceName || namespaceKey] as const,
                        ),
                ),
            )
            .apply((entries) => Object.fromEntries(entries));

        this.registerOutputs({
            namespaceNames: this.namespaceNames,
            namespaceNameMap: this.namespaceNameMap,
        });
    }
}

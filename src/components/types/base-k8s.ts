import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface BaseK8sComponentArgs {
    version?: pulumi.Input<string>;
    namespace?: pulumi.Input<string>;
}

export abstract class BaseK8sComponent extends pulumi.ComponentResource {
    public readonly namespace: string;
    public readonly version: string;

    constructor(
        type: string,
        name: string,
        args: BaseK8sComponentArgs,
        opts?: pulumi.ComponentResourceOptions,
    ) {
        super(type, name, {}, opts);

        const config = new pulumi.Config(type);
        const namespace = args.namespace || config.get('namespace') || 'default';
        const version = args.version || config.get('version') || 'latest';

        this.namespace = namespace as string;
        this.version = version as string;
    }

    protected createOidcRole(
        name: string,
        namespace: string,
        oidcUrl: string,
        oidcArn: string,
        policyArn?: pulumi.Output<string>,
    ): pulumi.Output<aws.iam.Role> {
        // Create the policy allowing a K8s service account to assume an IAM Role
        const saAssumeRolePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    actions: ['sts:AssumeRoleWithWebIdentity'],
                    conditions: [
                        {
                            test: 'StringEquals',
                            values: [`system:serviceaccount:${namespace}:${name}`],
                            variable: `${oidcUrl.replace('https://', '')}:sub`,
                        },
                        {
                            test: 'StringEquals',
                            values: ['sts.amazonaws.com'],
                            variable: `${oidcUrl.replace('https://', '')}:aud`,
                        },
                    ],
                    effect: 'Allow',
                    principals: [{ identifiers: [oidcArn], type: 'Federated' }],
                },
            ],
        });

        // Create service account IAM role
        const saRole = new aws.iam.Role(name, {
            assumeRolePolicy: saAssumeRolePolicy.json,
        });

        // Attach service account IAM policy if provided
        if (policyArn) {
            new aws.iam.RolePolicyAttachment(name, {
                role: saRole.name,
                policyArn,
            });
        }

        return pulumi.output(saRole);
    }
}

export interface NodeGroupToleration {
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    tolerationSeconds?: number;
}

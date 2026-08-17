import * as pulumi from '@pulumi/pulumi';

export interface StackOutputs {
    /**
     * Informational message about the stack deployment.
     */
    message: pulumi.Output<string>;
}

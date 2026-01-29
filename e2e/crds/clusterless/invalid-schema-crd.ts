import { V1CustomResourceDefinition } from "@kubernetes/client-node";

export const invalidSchemaCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "invalidschema.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "InvalidSchema", plural: "invalidschemas" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        // Intentionally missing schema.openAPIV3Schema to validate type-gen failure behavior
      },
    ],
  },
};

import { V1CustomResourceDefinition } from "@kubernetes/client-node";

export const widgetsCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "widgets.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Widget", plural: "widgets" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              apiVersion: { type: "string" },
              kind: { type: "string" },
              metadata: { type: "object" },
              spec: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  replicas: { type: "integer" },
                },
                required: ["name"],
              },
            },
          },
        },
      },
    ],
  },
};

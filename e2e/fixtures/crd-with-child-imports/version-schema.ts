// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

/**
 * Fixture: CRD version schema (child module).
 *
 * Mirrors the pattern used by projects like uds-core where version schemas
 * are defined in separate files and imported by a parent module that
 * assembles the full CRD.  The parent imports this file using a `.ts`
 * extension, which exercises tsx's loader for child module resolution.
 */

import type { V1CustomResourceDefinitionVersion, V1JSONSchemaProps } from "@kubernetes/client-node";

import { sharedDescription } from "./shared-metadata.ts";

const specSchema: V1JSONSchemaProps = {
  type: "object",
  properties: {
    spec: {
      type: "object",
      description: sharedDescription,
      properties: {
        name: {
          type: "string",
          description: "Name of the widget",
        },
        replicas: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 1,
          description: "Number of replicas",
        },
      },
      required: ["name"],
    },
  },
};

export const v1alpha1: V1CustomResourceDefinitionVersion = {
  name: "v1alpha1",
  served: true,
  storage: true,
  schema: {
    openAPIV3Schema: specSchema,
  },
};

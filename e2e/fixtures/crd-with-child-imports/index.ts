// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

/**
 * Fixture: Parent module that assembles a full CRD from child TS imports.
 *
 * This mirrors the uds-core pattern:
 *   - `version-schema.ts`  exports a V1CustomResourceDefinitionVersion
 *   - `shared-metadata.ts` is a transitive `.ts` import from the version schema
 *   - This file composes the version into a complete V1CustomResourceDefinition
 *
 * The import chain (index.ts → version-schema.ts → shared-metadata.ts) uses
 * explicit `.ts` extensions, which requires tsx's ESM loader for resolution.
 */

import type { V1CustomResourceDefinition } from "@kubernetes/client-node";

import { v1alpha1 } from "./version-schema.ts";

export const widgetCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "widgets.example.com" },
  spec: {
    group: "example.com",
    scope: "Namespaced",
    names: {
      plural: "widgets",
      singular: "widget",
      kind: "Widget",
      listKind: "WidgetList",
    },
    versions: [v1alpha1],
  },
};

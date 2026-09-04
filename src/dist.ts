// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

process.emitWarning(
  "Importing from 'kubernetes-fluent-client/dist' is deprecated and will be removed in a future release. Import from 'kubernetes-fluent-client' instead.",
  { code: "KFC_LEGACY_IMPORT", type: "DeprecationWarning" },
);

export * from "./index.js";

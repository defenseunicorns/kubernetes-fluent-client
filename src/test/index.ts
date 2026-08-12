// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

export {
  collectDiagnostics,
  type DiagnosticCollector,
  type DiagnosticEntry,
  type DiagnosticReport,
} from "./diagnostics.js";
export {
  DEFAULT_TEST_INTERVAL_MS,
  DEFAULT_TEST_TIMEOUT_MS,
  TEST_INTERVAL_ENV,
  TEST_TIMEOUT_ENV,
  env,
  type KubernetesTestEnvironment,
  type KubernetesTestEnvironmentOverrides,
} from "./environment.js";
export { preflight, type PreflightOptions, type PreflightResult } from "./preflight.js";
export {
  TEST_OWNERSHIP_LABEL,
  applyWithOwnership,
  deleteAllByOwnership,
  deleteIgnoringNotFound,
  ownershipLabel,
  waitForResource,
  type ApplyWithOwnershipOptions,
  type DeleteAllByOwnershipOptions,
  type OwnershipLabel,
  type OwnershipOptions,
  type ResourceReference,
  type WaitForResourceOptions,
} from "./resources.js";
export {
  WaitForTimeoutError,
  classifyKubernetesError,
  waitFor,
  type ErrorClassifier,
  type ErrorDisposition,
  type WaitForOptions,
  type WaitForTimeoutDetails,
} from "./wait.js";

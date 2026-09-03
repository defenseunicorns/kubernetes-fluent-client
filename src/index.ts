// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import "./patch.js";

// Export kinds as a single object
import * as kind from "./upstream.js";

/** kind is a collection of K8s types to be used within a K8s call: `K8s(kind.Secret).Apply({})`. */
export { kind };

// Export the node-fetch wrapper
export { fetch } from "./fetch.js";

// Export the HTTP status codes
export { StatusCodes as fetchStatus } from "http-status-codes";

// Export watch types used by clients that reconcile Kubernetes resources.
export { WatchCfg, WatchEvent, Watcher } from "./fluent/watch.js";
export { WatchPhase } from "./fluent/shared-types.js";

// Export the fluent API entrypoint
export { K8s } from "./fluent/index.js";

// Export types used in the fluent API's public method signatures
export type { K8sInit, Operation, PartialDeep, WatcherType } from "./fluent/types.js";

// Export helpers for working with K8s types
export { RegisterKind, modelToGroupVersionKind } from "./kinds.js";

// Export the GenericKind interface for CRD registration
export { GenericKind } from "./types.js";

export * from "./types.js";

// Export the upstream raw models
export * as models from "@kubernetes/client-node/dist/gen/models/all.js";

export { fromEnv, waitForCluster } from "./helpers.js";

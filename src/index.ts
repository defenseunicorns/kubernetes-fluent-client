// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

// Export kinds as a single object
import * as kind from "./upstream";

/** given is a collection of K8s types to be used within a Kube call: `Kube(kind.Secret).Apply({})`. `a` may also be used in it's place */
export { kind };

// Export the node-fetch wrapper
export { fetch } from "./fetch";

// Export the fluent API entrypoint
export { Kube } from "./fluent/kube";

// Export helpers for working with K8s types
export { modelToGroupVersionKind, RegisterKind } from "./kinds";

export * from "./types";

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

// Export kinds as a single object
import * as kind from "./upstream";

/** given is a collection of K8s types to be used within a Kube call: `Kube(Secret).Apply({})`. `a` may also be used in it's place */
export { kind };

// export { Kube } from "./fluent/kube";

export { modelToGroupVersionKind, gvkMap, RegisterKind } from "./kinds";

export * from "./types";

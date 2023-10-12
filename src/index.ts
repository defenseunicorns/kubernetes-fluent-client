// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

// Export kinds as a single object
import * as kind from "./upstream";

/** kind is a collection of K8s types to be used within a K8s call: `K8s(kind.Secret).Apply({})`. */
export { kind };

// Export the node-fetch wrapper
export { fetch } from "./fetch";

// Export the HTTP status codes
export { StatusCodes as fetchStatus } from "http-status-codes";

// Export the fluent API entrypoint
export { K8s } from "./fluent";

// Export helpers for working with K8s types
export { RegisterKind, modelToGroupVersionKind } from "./kinds";

// Export the GenericKind interface for CRD registration
export { GenericKind } from "./types";

export * from "./types";

export * as K8sClientNode from "@kubernetes/client-node";

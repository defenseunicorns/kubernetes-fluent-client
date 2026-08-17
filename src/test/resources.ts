// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubernetesObject } from "@kubernetes/client-node";

import { K8s } from "../fluent/index.js";
import { FetchMethods } from "../fluent/shared-types.js";
import type { PartialDeep } from "../fluent/types.js";
import { k8sExec } from "../fluent/utils.js";
import type { GenericClass } from "../types.js";
import { waitFor, type WaitForOptions } from "./wait.js";

/** Default label used to identify resources created by integration tests. */
export const TEST_OWNERSHIP_LABEL = "test.defenseunicorns.dev/source";

/** Default label used to isolate one execution of an integration test suite. */
export const TEST_RUN_ID_LABEL = "test.defenseunicorns.dev/run-id";

/** Label identity shared by apply and cleanup operations. */
export interface OwnershipOptions {
  /** Stable value identifying the test suite that owns the resource. */
  owner: string;
  /** Optional value isolating one execution of the test suite. */
  runId?: string;
  /** Label key override for repositories with an existing convention. */
  labelKey?: string;
  /** Run-ID label key override for repositories with an existing convention. */
  runIdLabelKey?: string;
}

/** Resolved Kubernetes ownership labels. */
export interface OwnershipLabels {
  /** Kubernetes metadata label key-value pairs. */
  [key: string]: string;
}

/** Options accepted by {@link applyWithOwnership}. */
export interface ApplyWithOwnershipOptions extends OwnershipOptions {
  /** Forwarded to KFC server-side apply. */
  force?: boolean;
}

/** Options accepted by {@link deleteAllByOwnership}. */
export interface DeleteAllByOwnershipOptions
  extends OwnershipOptions, Pick<WaitForOptions, "timeoutMs" | "intervalMs" | "signal"> {
  /** Restrict discovery and deletion to one namespace. */
  namespace?: string;
  /** Wait until no resources carry the exact ownership labels. */
  waitForDeletion?: boolean;
}

/** Name and optional namespace identifying one Kubernetes resource. */
export interface ResourceReference {
  /** Resource name. */
  name: string;
  /** Namespace for namespaced resources; omit for cluster-scoped resources. */
  namespace?: string;
}

/** Options accepted by {@link waitForResource}. */
export interface WaitForResourceOptions<TDiagnostics = unknown>
  extends ResourceReference, WaitForOptions<TDiagnostics> {
  /** Override the human-readable timeout description. */
  description?: string;
}

const LABEL_NAME_PATTERN = /^[A-Za-z0-9](?:[-_.A-Za-z0-9]{0,61}[A-Za-z0-9])?$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/**
 * Determine whether a string is a valid Kubernetes label name.
 *
 * @param value - Label name or label value to inspect.
 * @returns True when the value follows Kubernetes label-name syntax.
 */
function isLabelName(value: string): boolean {
  return value.length <= 63 && LABEL_NAME_PATTERN.test(value);
}

/**
 * Determine whether a string is a valid optional DNS label-key prefix.
 *
 * @param value - DNS prefix to inspect.
 * @returns True when every segment follows Kubernetes DNS syntax.
 */
function isDnsPrefix(value: string): boolean {
  return value.length <= 253 && value.split(".").every(segment => DNS_LABEL_PATTERN.test(segment));
}

/**
 * Determine whether a string is a valid Kubernetes label key.
 *
 * @param value - Label key to inspect.
 * @returns True when the key has a valid optional prefix and name.
 */
function isLabelKey(value: string): boolean {
  const parts = value.split("/");
  if (parts.length === 1) return isLabelName(parts[0]);
  if (parts.length !== 2) return false;
  return isDnsPrefix(parts[0]) && isLabelName(parts[1]);
}

/**
 * Resolve and validate the exact labels used by ownership-aware helpers.
 *
 * Run IDs use a separate label so owner and execution identities cannot
 * produce ambiguous composite values.
 *
 * @param options - Stable owner, optional run ID, and optional label key.
 * @returns Validated Kubernetes label key-value pairs.
 */
export function ownershipLabels(options: OwnershipOptions): OwnershipLabels {
  const key = options.labelKey ?? TEST_OWNERSHIP_LABEL;
  if (!isLabelKey(key)) throw new Error(`Invalid Kubernetes ownership label key: ${key}`);
  if (!isLabelName(options.owner)) {
    throw new Error(`Invalid Kubernetes ownership label value: ${options.owner}`);
  }

  const labels: OwnershipLabels = { [key]: options.owner };
  if (options.runId !== undefined) {
    const runIdKey = options.runIdLabelKey ?? TEST_RUN_ID_LABEL;
    if (!isLabelKey(runIdKey)) {
      throw new Error(`Invalid Kubernetes run-ID label key: ${runIdKey}`);
    }
    if (runIdKey === key) throw new Error("Ownership and run-ID label keys must be different");
    if (!isLabelName(options.runId)) {
      throw new Error(`Invalid Kubernetes run-ID label value: ${options.runId}`);
    }
    labels[runIdKey] = options.runId;
  }
  return labels;
}

/**
 * Create a fluent client with an optional namespace filter.
 *
 * @param model - KFC model for the resource kind.
 * @param namespace - Optional namespace for namespaced resources.
 * @returns A fluent resource client.
 */
function resourceClient<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  namespace?: string,
) {
  const client = K8s<T, K>(model);
  return namespace ? client.InNamespace(namespace) : client;
}

/**
 * Create a fluent client filtered by every ownership label.
 *
 * @param model - KFC model for the resource kind.
 * @param options - Ownership identity and optional namespace.
 * @returns A fluent resource client with exact label selectors.
 */
function ownedResourceClient<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  options: DeleteAllByOwnershipOptions,
) {
  let client = resourceClient<T, K>(model, options.namespace);
  for (const [key, value] of Object.entries(ownershipLabels(options))) {
    client = client.WithLabel(key, value);
  }
  return client;
}

/**
 * Validate a resource reference before it can affect a Kubernetes request path.
 *
 * @param reference - Resource name and optional namespace.
 */
function validateResourceReference(reference: ResourceReference): void {
  if (!reference.name.trim()) throw new Error("Resource name must not be blank");
  if (reference.namespace !== undefined && !reference.namespace.trim()) {
    throw new Error("Resource namespace must not be blank when provided");
  }
}

/**
 * Determine whether an error carries one HTTP status.
 *
 * @param error - Error raised by a Kubernetes request.
 * @param status - HTTP status to match.
 * @returns True when the error has the requested status.
 */
function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" && error !== null && "status" in error && error.status === status
  );
}

interface DeletionIdentity {
  name: string;
  namespace?: string;
  resourceVersion: string;
  uid: string;
}

/**
 * Read the metadata required for a preconditioned deletion.
 *
 * @param model - KFC model for the resource kind.
 * @param resource - Resource returned by an exact-label list operation.
 * @returns The resource identity and version used by the delete request.
 */
function deletionIdentity<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  resource: K,
): DeletionIdentity {
  const { name, namespace, resourceVersion, uid } = resource.metadata ?? {};
  if (!name || !uid || !resourceVersion) {
    throw new Error(
      `Cannot safely delete owned ${model.name}: metadata.name, uid, and resourceVersion are required`,
    );
  }
  return { name, namespace, resourceVersion, uid };
}

/**
 * Delete one listed resource only if its identity and version have not changed.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param resource - Resource returned by an exact-label list operation.
 * @param namespace - Optional namespace restriction supplied by the caller.
 */
async function deleteWithPreconditions<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  resource: K,
  namespace?: string,
): Promise<void> {
  const identity = deletionIdentity(model, resource);

  try {
    await k8sExec<T, void>(
      model,
      { name: identity.name, namespace: namespace ?? identity.namespace },
      {
        method: FetchMethods.DELETE,
        payload: {
          apiVersion: "v1",
          kind: "DeleteOptions",
          preconditions: {
            resourceVersion: identity.resourceVersion,
            uid: identity.uid,
          },
        },
      },
    );
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
  }
}

/**
 * Safely delete labeled resources for APIs without collection deletion.
 *
 * UID and resource-version preconditions prevent deletion if a listed object
 * is re-created, re-labeled, or otherwise modified before the delete request.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param options - Ownership identity and optional namespace restriction.
 */
async function deleteWithoutCollectionSupport<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  options: DeleteAllByOwnershipOptions,
): Promise<void> {
  await waitFor(
    `safe deletion of ${model.name} resources with the requested ownership labels`,
    async () => {
      const list = await ownedResourceClient<T, K>(model, options).Get();
      if (list.items.length === 0) return true;
      await Promise.all(
        list.items.map(resource =>
          deleteWithPreconditions<T, K>(model, resource, options.namespace),
        ),
      );
      return true;
    },
    options,
  );
}

/**
 * Apply a resource after stamping a stable ownership label.
 *
 * The input object is not mutated. Any existing labels are preserved unless
 * they use a selected ownership key.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param resource - Resource body to server-side apply.
 * @param options - Ownership labels and apply configuration.
 * @returns The resource returned by Kubernetes.
 */
export function applyWithOwnership<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
>(model: T, resource: PartialDeep<K>, options: ApplyWithOwnershipOptions): Promise<K> {
  const labels = ownershipLabels(options);
  const owned = {
    ...resource,
    metadata: {
      ...resource.metadata,
      labels: {
        ...resource.metadata?.labels,
        ...labels,
      },
    },
  } as PartialDeep<K>;

  return K8s<T, K>(model).Apply(owned, { force: options.force });
}

/**
 * Delete every resource carrying the exact ownership labels.
 *
 * Kubernetes evaluates the exact label selectors when collection deletion is
 * supported. Other APIs use UID and resource-version preconditions so a
 * re-labeled or re-created resource cannot be deleted after discovery.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param options - Ownership identity and optional namespace restriction.
 */
export async function deleteAllByOwnership<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
>(model: T, options: DeleteAllByOwnershipOptions): Promise<void> {
  if (options.namespace !== undefined && !options.namespace.trim()) {
    throw new Error("Resource namespace must not be blank when provided");
  }
  try {
    await ownedResourceClient<T, K>(model, options).Delete();
  } catch (error) {
    if (!hasStatus(error, 405)) throw error;
    await deleteWithoutCollectionSupport<T, K>(model, options);
  }
  if (options.waitForDeletion) {
    await waitFor(
      `${model.name} resources with the requested ownership labels to be deleted`,
      async () => {
        const remaining = await ownedResourceClient<T, K>(model, options).Get();
        return remaining.items.length === 0;
      },
      options,
    );
  }
}

/**
 * Wait for one named Kubernetes resource to exist.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param options - Resource identity plus standard waiter options.
 * @returns The resource read from Kubernetes.
 */
export function waitForResource<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
  TDiagnostics = unknown,
>(model: T, options: WaitForResourceOptions<TDiagnostics>): Promise<K> {
  const { name, namespace, description, ...waitOptions } = options;
  validateResourceReference({ name, namespace });
  const identity = namespace ? `${model.name}/${namespace}/${name}` : `${model.name}/${name}`;
  return waitFor(
    description ?? identity,
    () => resourceClient<T, K>(model, namespace).Get(name),
    waitOptions,
  );
}

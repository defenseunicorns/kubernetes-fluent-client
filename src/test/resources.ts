// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubernetesObject } from "@kubernetes/client-node";

import { K8s } from "../fluent/index.js";
import type { PartialDeep } from "../fluent/types.js";
import type { GenericClass } from "../types.js";
import { waitFor, type WaitForOptions } from "./wait.js";

/** Default label used to identify resources created by integration tests. */
export const TEST_OWNERSHIP_LABEL = "test.defenseunicorns.dev/source";

/** Label identity shared by apply and cleanup operations. */
export interface OwnershipOptions {
  /** Stable value identifying the test suite that owns the resource. */
  owner: string;
  /** Optional value isolating one execution of the test suite. */
  runId?: string;
  /** Label key override for repositories with an existing convention. */
  labelKey?: string;
}

/** Resolved Kubernetes ownership label. */
export interface OwnershipLabel {
  /** Kubernetes metadata label key. */
  key: string;
  /** Kubernetes metadata label value. */
  value: string;
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
  /** Wait until every discovered resource returns not found. */
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
 * Resolve and validate the exact label used by ownership-aware helpers.
 *
 * Run IDs are opt-in. When supplied, the label value is `<owner>.<runId>`;
 * omitting a run ID preserves the stable Phase 1 owner value.
 *
 * @param options - Stable owner, optional run ID, and optional label key.
 * @returns A validated Kubernetes label key and value.
 */
export function ownershipLabel(options: OwnershipOptions): OwnershipLabel {
  const key = options.labelKey ?? TEST_OWNERSHIP_LABEL;
  const value = options.runId === undefined ? options.owner : `${options.owner}.${options.runId}`;

  if (!isLabelKey(key)) throw new Error(`Invalid Kubernetes ownership label key: ${key}`);
  if (!isLabelName(value)) throw new Error(`Invalid Kubernetes ownership label value: ${value}`);
  return { key, value };
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
 * Determine whether an error carries a Kubernetes not-found status.
 *
 * @param error - Error raised by a resource read.
 * @returns True only for HTTP 404.
 */
function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

/**
 * Wait until one deleted resource is no longer readable.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param reference - Resource name and optional namespace.
 * @param options - Cleanup timing and cancellation settings.
 */
async function waitForDeletion<T extends GenericClass, K extends KubernetesObject>(
  model: T,
  reference: ResourceReference,
  options: DeleteAllByOwnershipOptions,
): Promise<void> {
  await waitFor(
    `${model.name}/${reference.namespace ? `${reference.namespace}/` : ""}${reference.name} deletion`,
    async () => {
      try {
        await resourceClient<T, K>(model, reference.namespace).Get(reference.name);
        return false;
      } catch (error) {
        if (isNotFound(error)) return true;
        throw error;
      }
    },
    options,
  );
}

/**
 * Apply a resource after stamping a stable ownership label.
 *
 * The input object is not mutated. Any existing labels are preserved unless
 * they use the selected ownership key.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param resource - Resource body to server-side apply.
 * @param options - Ownership label and apply configuration.
 * @returns The resource returned by Kubernetes.
 */
export function applyWithOwnership<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
>(model: T, resource: PartialDeep<K>, options: ApplyWithOwnershipOptions): Promise<K> {
  const label = ownershipLabel(options);
  const owned = {
    ...resource,
    metadata: {
      ...resource.metadata,
      labels: {
        ...resource.metadata?.labels,
        [label.key]: label.value,
      },
    },
  } as PartialDeep<K>;

  return K8s<T, K>(model).Apply(owned, { force: options.force });
}

/**
 * Delete every resource carrying one exact ownership label.
 *
 * Resources are listed before any deletion begins. Cleanup never touches an
 * unlabeled resource or one owned by another suite or run.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param options - Ownership identity and optional namespace restriction.
 * @returns References for the resources submitted for deletion.
 */
export async function deleteAllByOwnership<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
>(model: T, options: DeleteAllByOwnershipOptions): Promise<ResourceReference[]> {
  const label = ownershipLabel(options);
  const list = await resourceClient<T, K>(model, options.namespace)
    .WithLabel(label.key, label.value)
    .Get();
  const references = list.items.map(item => {
    const name = item.metadata?.name;
    if (!name) throw new Error(`Cannot delete owned ${model.name}: resource has no metadata.name`);
    const namespace = options.namespace ?? item.metadata?.namespace;
    return namespace ? { name, namespace } : { name };
  });

  await Promise.all(references.map(reference => deleteIgnoringNotFound<T, K>(model, reference)));
  if (options.waitForDeletion) {
    await Promise.all(
      references.map(reference => waitForDeletion<T, K>(model, reference, options)),
    );
  }
  return references;
}

/**
 * Delete a resource while treating an already absent resource as success.
 *
 * Other failures, including authentication and authorization errors, are
 * propagated to the caller.
 *
 * @param model - KFC model for the Kubernetes resource kind.
 * @param reference - Resource name and optional namespace.
 */
export async function deleteIgnoringNotFound<
  T extends GenericClass,
  K extends KubernetesObject = InstanceType<T>,
>(model: T, reference: ResourceReference): Promise<void> {
  await resourceClient<T, K>(model, reference.namespace).Delete(reference.name);
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
  const identity = namespace ? `${model.name}/${namespace}/${name}` : `${model.name}/${name}`;
  return waitFor(
    description ?? identity,
    () => resourceClient<T, K>(model, namespace).Get(name),
    waitOptions,
  );
}

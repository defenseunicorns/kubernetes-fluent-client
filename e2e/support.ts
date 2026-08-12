// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { type GenericClass, K8s, type KubernetesObject } from "kubernetes-fluent-client";
import { waitFor, type OwnershipOptions } from "../src/test/index.js";

/** Optional environment variable used to isolate ownership labels by execution. */
export const E2E_RUN_ID_ENV = "KFC_E2E_RUN_ID";

/**
 * Build ownership options for one KFC e2e suite.
 *
 * @param owner - Stable suite identifier.
 * @returns Ownership with an opt-in run ID when `KFC_E2E_RUN_ID` is set.
 */
export function e2eOwnership(owner: string): OwnershipOptions {
  const runId = process.env[E2E_RUN_ID_ENV]?.trim();
  return runId ? { owner, runId } : { owner };
}

/**
 * Wait for a namespaced resource to report one status phase.
 *
 * @param model - KFC model for the resource kind.
 * @param resource - Resource metadata identifying the object.
 * @param phase - Desired status phase.
 */
export async function waitForStatusPhase(
  model: GenericClass,
  resource: KubernetesObject,
  phase: string,
): Promise<void> {
  const name = resource.metadata?.name;
  const namespace = resource.metadata?.namespace;
  if (!name || !namespace) throw new Error("A name and namespace are required to wait for status");

  await waitFor(`${model.name}/${namespace}/${name} phase ${phase}`, async () => {
    const object = await K8s(model).InNamespace(namespace).Get(name);
    return object.status?.phase?.toString() === phase ? object : false;
  });
}

/**
 * Wait for a namespaced resource to enter the Running phase.
 *
 * @param model - KFC model for the resource kind.
 * @param resource - Resource metadata identifying the object.
 */
export async function waitForRunningStatusPhase(
  model: GenericClass,
  resource: KubernetesObject,
): Promise<void> {
  await waitForStatusPhase(model, resource, "Running");
}

/**
 * Check whether one namespaced resource has been deleted.
 *
 * @param model - KFC model for the resource kind.
 * @param resource - Resource metadata identifying the object.
 * @returns True only for a Kubernetes not-found response.
 */
export async function gone(model: GenericClass, resource: KubernetesObject): Promise<boolean> {
  const name = resource.metadata?.name;
  const namespace = resource.metadata?.namespace;
  if (!name || !namespace) throw new Error("A name and namespace are required to check deletion");

  try {
    await K8s(model).InNamespace(namespace).Get(name);
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 404) {
      return true;
    }
    throw error;
  }
}

/**
 * Wait for an asynchronous predicate to become true.
 *
 * @param predicate - Condition to evaluate.
 */
export async function untilTrue(predicate: () => Promise<boolean>): Promise<void> {
  await waitFor("predicate to become true", async () => (await predicate()) || false, {
    intervalMs: 250,
  });
}

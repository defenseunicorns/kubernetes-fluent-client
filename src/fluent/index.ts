// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { KubernetesListObject, KubernetesObject } from "@kubernetes/client-node";
import { Operation } from "fast-json-patch";
import { StatusCodes } from "http-status-codes";
import type { PartialDeep } from "type-fest";

import { fetch } from "../fetch.js";
import { modelToGroupVersionKind } from "../kinds.js";
import { GenericClass } from "../types.js";
import { K8sInit, Paths } from "./types.js";
import { Filters, WatchAction, FetchMethods, ApplyCfg } from "./shared-types.js";
import { k8sCfg, k8sExec } from "./utils.js";
import { WatchCfg, Watcher } from "./watch.js";
import { hasLogs } from "../helpers.js";
import { Pod, type Service, type ReplicaSet } from "../upstream.js";

type FinalizeOperation = "add" | "remove";

/**
 * Kubernetes fluent API inspired by Kubectl. Pass in a model, then call filters and actions on it.
 *
 * @param model - the model to use for the API
 * @param filters - (optional) filter overrides, can also be chained
 * @returns a fluent API for the model
 */
export function K8s<T extends GenericClass, K extends KubernetesObject = InstanceType<T>>(
  model: T,
  filters: Filters = {},
): K8sInit<T, K> {
  const withFilters = {
    WithField,
    WithLabel,
    Get,
    Delete,
    Evict,
    Watch,
    Logs,
    Proxy,
    Scale,
    Finalize,
  };
  const matchedKind = filters.kindOverride || modelToGroupVersionKind(model.name);

  /**
   * @inheritdoc
   * @see {@link K8sInit.InNamespace}
   */
  function InNamespace(namespace: string) {
    if (filters.namespace) {
      throw new Error(`Namespace already specified: ${filters.namespace}`);
    }

    filters.namespace = namespace;
    return withFilters;
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.WithField}
   */
  function WithField<P extends Paths<K>>(key: P, value: string) {
    filters.fields = filters.fields || {};
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    filters.fields[key] = value;
    return withFilters;
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.WithLabel}
   */
  function WithLabel(key: string, value = "") {
    filters.labels = filters.labels || {};
    filters.labels[key] = value;
    return withFilters;
  }

  /**
   * Sync the filters with the provided payload.
   *
   * @param payload - the payload to sync with
   */
  function syncFilters(payload: K) {
    // Ensure the payload has metadata
    payload.metadata = payload.metadata || {};

    if (!filters.namespace) {
      filters.namespace = payload.metadata.namespace;
    }

    if (!filters.name) {
      filters.name = payload.metadata.name;
    }

    if (!payload.apiVersion) {
      payload.apiVersion = [matchedKind.group, matchedKind.version].filter(Boolean).join("/");
    }

    if (!payload.kind) {
      payload.kind = matchedKind.kind;
    }
  }
  async function Logs(name?: string): Promise<string[]>;
  /**
   * @inheritdoc
   * @see {@link K8sInit.Logs}
   */
  async function Logs(name?: string): Promise<string[]> {
    let labels: Record<string, string> = {};
    const { kind } = matchedKind;
    const { namespace } = filters;
    const podList: K[] = [];

    if (name) {
      if (filters.name) {
        throw new Error(`Name already specified: ${filters.name}`);
      }
      filters.name = name;
    }

    if (!namespace) {
      throw new Error("Namespace must be defined");
    }
    if (!hasLogs(kind)) {
      throw new Error("Kind must be Pod or have a selector");
    }

    try {
      const object = await k8sExec<T, K>(model, filters, { method: FetchMethods.GET });

      if (kind !== "Pod") {
        if (kind === "Service") {
          const svc: InstanceType<typeof Service> = object;
          labels = svc.spec!.selector ?? {};
        } else if (
          kind === "ReplicaSet" ||
          kind === "Deployment" ||
          kind === "StatefulSet" ||
          kind === "DaemonSet"
        ) {
          const rs: InstanceType<typeof ReplicaSet> = object;
          labels = rs.spec!.selector.matchLabels ?? {};
        }

        const list = await K8s(Pod, { namespace: filters.namespace, labels }).Get();

        list.items.forEach(item => {
          return podList.push(item as unknown as K);
        });
      } else {
        podList.push(object);
      }
    } catch {
      throw new Error(`Failed to get logs in KFC Logs function`);
    }

    const podModel = { ...model, name: "V1Pod" };
    const logPromises = podList.map(po =>
      k8sExec<T, string>(
        podModel,
        { ...filters, name: po.metadata!.name! },
        { method: FetchMethods.LOG },
      ),
    );

    const responses = await Promise.all(logPromises);

    const combinedString = responses.reduce(
      (accumulator: string[], currentString: string, i: number) => {
        const prefixedLines = currentString
          .split("\n")
          .map(line => {
            return line !== "" ? `[pod/${podList[i].metadata!.name!}] ${line}` : "";
          })
          .filter(str => str !== "");

        return [...accumulator, ...prefixedLines];
      },
      [],
    );

    return combinedString;
  }
  async function Get(): Promise<KubernetesListObject<K>>;
  async function Get(name: string): Promise<K>;
  /**
   * @inheritdoc
   * @see {@link K8sInit.Get}
   */
  async function Get(name?: string) {
    if (name) {
      if (filters.name) {
        throw new Error(`Name already specified: ${filters.name}`);
      }
      filters.name = name;
    }

    return k8sExec<T, K | KubernetesListObject<K>>(model, filters, { method: FetchMethods.GET });
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Delete}
   */
  async function Delete(filter?: K | string): Promise<void> {
    if (typeof filter === "string") {
      filters.name = filter;
    } else if (filter) {
      syncFilters(filter);
    }

    try {
      // Try to delete the resource
      await k8sExec<T, void>(model, filters, { method: FetchMethods.DELETE });
    } catch (e) {
      // If the resource doesn't exist, ignore the error
      if (e.status === StatusCodes.NOT_FOUND) {
        return;
      }

      throw e;
    }
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Apply}
   */
  async function Apply(
    resource: PartialDeep<K>,
    applyCfg: ApplyCfg = { force: false },
  ): Promise<K> {
    syncFilters(resource as K);
    return k8sExec(model, filters, { method: FetchMethods.APPLY, payload: resource }, applyCfg);
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Create}
   */
  async function Create(resource: K): Promise<K> {
    syncFilters(resource);
    return k8sExec(model, filters, { method: FetchMethods.POST, payload: resource });
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Evict}
   */
  async function Evict(filter?: K | string): Promise<void> {
    if (typeof filter === "string") {
      filters.name = filter;
    } else if (filter) {
      syncFilters(filter);
    }

    try {
      const evictionPayload = {
        apiVersion: "policy/v1",
        kind: "Eviction",
        metadata: {
          name: filters.name,
          namespace: filters.namespace,
        },
      };
      // Try to evict the resource
      await k8sExec<T, void>(model, filters, {
        method: FetchMethods.POST,
        payload: evictionPayload,
      });
    } catch (e) {
      // If the resource doesn't exist, ignore the error
      if (e.status === StatusCodes.NOT_FOUND) {
        return;
      }
      throw e;
    }
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Patch}
   */
  async function Patch(payload: Operation[]): Promise<K> {
    // If there are no operations, throw an error
    if (payload.length < 1) {
      throw new Error("No operations specified");
    }

    return k8sExec(model, filters, { method: FetchMethods.PATCH, payload });
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.PatchStatus}
   */
  async function PatchStatus(resource: PartialDeep<K>): Promise<K> {
    syncFilters(resource as K);
    return k8sExec(model, filters, { method: FetchMethods.PATCH_STATUS, payload: resource });
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Watch}
   */
  function Watch(callback: WatchAction<T>, watchCfg?: WatchCfg) {
    return new Watcher(model, filters, callback, watchCfg);
  }

  /**
   * @inheritdoc
   * @see {@link K8sInit.Raw}
   */
  async function Raw(url: string, method: FetchMethods = FetchMethods.GET) {
    const thing = await k8sCfg(method);
    const { opts, serverUrl } = thing;
    const resp = await fetch<K>(`${serverUrl}${url}`, opts);

    if (resp.ok) {
      return resp.data;
    }

    throw resp;
  }

  async function Finalize(
    operation: FinalizeOperation,
    finalizer: string,
    name?: string,
  ): Promise<void>;
  /**
   *
   * @param operation - The operation to perform, either "add" or "remove"
   * @param finalizer - The finalizer to add or remove
   * @param name - (optional) the name of the resource to finalize, if not provided, uses filters
   * @inheritdoc
   * @see {@link K8sInit.Finalize}
   */
  async function Finalize(
    operation: FinalizeOperation,
    finalizer: string,
    name?: string,
  ): Promise<void> {
    if (name) {
      if (filters.name) {
        throw new Error(`Name already specified: ${filters.name}`);
      }
      filters.name = name;
    }
    // need to do a GET to get the array index of the finalizer
    const object = await k8sExec<T, K>(model, filters, { method: FetchMethods.GET });
    if (!object) {
      throw new Error("Resource not found");
    }
    const finalizers = updateFinalizersOrSkip(operation, finalizer, object);
    if (!finalizers) return;
    removeControllerFields(object);

    await k8sExec<T, K>(
      model,
      filters,
      {
        method: FetchMethods.APPLY,
        payload: {
          ...object,
          metadata: {
            ...object.metadata,
            finalizers,
          },
        },
      },
      { force: true },
    );
  }
  async function Scale(replicas: number, name?: string): Promise<void>;
  /**
   *
   * @param replicas - the number of replicas to scale to
   * @param name - (optional) the name of the resource to scale, if not provided, uses filters
   * @inheritdoc
   * @see {@link K8sInit.Scale}
   */
  async function Scale(replicas: number, name?: string): Promise<void> {
    if (name) {
      if (filters.name) {
        throw new Error(`Name already specified: ${filters.name}`);
      }
      filters.name = name;
    }

    await k8sExec<T, K>(
      model,
      filters,
      {
        method: FetchMethods.PATCH,
        payload: [{ op: "replace", path: "/spec/replicas", value: replicas }],
        subResourceConfig: {
          ScaleConfig: {
            replicas,
          },
        },
      },
      {},
    );
  }
  async function Proxy(name?: string, port?: string): Promise<string>;
  /**
   * @inheritdoc
   * @see {@link K8sInit.Proxy}
   */
  async function Proxy(name?: string, port?: string): Promise<string> {
    if (name) {
      if (filters.name) {
        throw new Error(`Name already specified: ${filters.name}`);
      }
      filters.name = name;
    }
    const object = await k8sExec<T, K>(model, filters, {
      method: FetchMethods.GET,
      subResourceConfig: { ProxyConfig: { port: port || "" } },
    });
    return `${object}`;
  }

  return { InNamespace, Apply, Create, Patch, PatchStatus, Raw, ...withFilters };
}
/**
 *
 * Remove controller fields from the Kubernetes object.
 * This is necessary for ensuring that the object can be applied without conflicts.
 *
 * @param object - the Kubernetes object to remove controller fields from
 */
export function removeControllerFields(object: KubernetesObject): void {
  delete object.metadata?.managedFields;
  delete object.metadata?.resourceVersion;
  delete object.metadata?.uid;
  delete object.metadata?.creationTimestamp;
  delete object.metadata?.generation;
  delete object.metadata?.finalizers;
}

/**
 * Mutates the finalizers list based on the operation.
 * Throws or returns early if no update is necessary.
 *
 * @param operation - "add" or "remove"
 * @param finalizer - The finalizer to add/remove
 * @param object - The Kubernetes resource object
 * @returns The updated finalizers list or `null` if no update is needed
 */
export function updateFinalizersOrSkip(
  operation: FinalizeOperation,
  finalizer: string,
  object: KubernetesObject,
): string[] | null {
  const current = object.metadata?.finalizers ?? [];
  const isPresent = current.includes(finalizer);

  if ((operation === "remove" && !isPresent) || (operation === "add" && isPresent)) {
    return null; // no-op
  }

  switch (operation) {
    case "remove":
      return current.filter(f => f !== finalizer);
    case "add":
      return [...current, finalizer];
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
}

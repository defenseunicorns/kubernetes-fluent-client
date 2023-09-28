// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import { KubernetesListObject, KubernetesObject } from "@kubernetes/client-node";
import { Operation } from "fast-json-patch";
import type { PartialDeep } from "type-fest";

import { GenericClass, GroupVersionKind } from "../types";

/**
 * The Phase matched when using the K8s Watch API.
 */
export enum WatchPhase {
  Added = "ADDED",
  Modified = "MODIFIED",
  Deleted = "DELETED",
}

export type FetchMethods =
  | "GET"
  | "APPLY"
  | "FORCEAPPLY"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "WATCH";

export interface Filters {
  kindOverride?: GroupVersionKind;
  fields?: Record<string, string>;
  labels?: Record<string, string>;
  name?: string;
  namespace?: string;
}

export type GetFunction<K extends KubernetesObject> = {
  (): Promise<KubernetesListObject<K>>;
  (name: string): Promise<K>;
};

export type K8sFilteredActions<K extends KubernetesObject> = {
  /**
   * Get the resource or resources matching the filters.
   * If no filters are specified, all resources will be returned.
   * If a name is specified, only a single resource will be returned.
   */
  Get: GetFunction<K>;

  /**
   * Delete the resource if it exists.
   *
   * @param filter - the resource or resource name to delete
   */
  Delete: (filter?: K | string) => Promise<void>;

  /**
   *
   * @param callback
   * @returns
   */
  Watch: (callback: (payload: K, phase: WatchPhase) => void) => Promise<AbortController>;
};

export type K8sUnfilteredActions<K extends KubernetesObject> = {
  /**
   * Perform a server-side apply of the provided K8s resource.
   *
   * @param resource
   * @returns
   */
  Apply: (resource: PartialDeep<K>) => Promise<K>;

  /**
   * Perform a server-side apply of the provided K8s resource (wtth Force flag set to true)
   *
   * @param resource
   * @returns
   */
  ForceApply: (resource: PartialDeep<K>) => Promise<K>;

  /**
   * Create the provided K8s resource or throw an error if it already exists.
   *
   * @param resource
   * @returns
   */
  Create: (resource: K) => Promise<K>;

  /**
   * Advanced JSON Patch operations for when Server Side Apply, K8s().Apply(), is insufficient.
   *
   * Note: Throws an error on an empty list of patch operations.
   *
   * @param payload The patch operations to run
   * @returns The patched resource
   */
  Patch: (payload: Operation[]) => Promise<K>;
};

export type K8sWithFilters<K extends KubernetesObject> = K8sFilteredActions<K> & {
  /**
   * Filter the query by the given field.
   * Note multiple calls to this method will result in an AND condition. e.g.
   *
   * ```ts
   * K8s(kind.Deployment)
   *  .WithField("metadata.name", "bar")
   *  .WithField("metadata.namespace", "qux")
   *  .Delete(...)
   * ```
   *
   * Will only delete the Deployment if it has the `metadata.name=bar` and `metadata.namespace=qux` fields.
   *
   * @param key  The field key
   * @param value The field value
   * @returns
   */
  WithField: <P extends Paths<K>>(key: P, value?: string) => K8sWithFilters<K>;

  /**
   * Filter the query by the given label. If no value is specified, the label simply must exist.
   * Note multiple calls to this method will result in an AND condition. e.g.
   *
   * ```ts
   * K8s(kind.Deployment)
   *   .WithLabel("foo", "bar")
   *   .WithLabel("baz", "qux")
   *   .Delete(...)
   * ```
   *
   * Will only delete the Deployment if it has the`foo=bar` and `baz=qux` labels.
   *
   * @param key The label key
   * @param value (optional) The label value
   */
  WithLabel: (key: string, value?: string) => K8sWithFilters<K>;
};

export type K8sInit<K extends KubernetesObject> = K8sWithFilters<K> &
  K8sUnfilteredActions<K> & {
    /**
     * Filter the query by the given namespace.
     *
     * @param namespace
     * @returns
     */
    InNamespace: (namespace: string) => K8sWithFilters<K>;
  };

export type WatchAction<T extends GenericClass, K extends KubernetesObject = InstanceType<T>> = (
  update: K,
  phase: WatchPhase,
) => Promise<void> | void;

// Special types to handle the recursive keyof typescript lookup
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

export type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
  ? { [K in keyof T]-?: K extends string | number ? `${K}` | Join<K, Paths<T[K]>> : never }[keyof T]
  : "";

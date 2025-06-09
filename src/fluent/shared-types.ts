// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors
import { GenericClass, GroupVersionKind } from "../types.js";
import { RequestInit } from "undici";
import { KubernetesObject } from "@kubernetes/client-node";
/**
 * Fetch options and server URL
 */
export type K8sConfigPromise = Promise<{ opts: RequestInit; serverUrl: string | URL }>;

/**
 * The Phase matched when using the K8s Watch API.
 */
export enum WatchPhase {
  Added = "ADDED",
  Modified = "MODIFIED",
  Deleted = "DELETED",
  Bookmark = "BOOKMARK",
  Error = "ERROR",
}

export type WatchAction<T extends GenericClass, K extends KubernetesObject = InstanceType<T>> = (
  update: K,
  phase: WatchPhase,
) => Promise<void> | void;

export interface Filters {
  kindOverride?: GroupVersionKind;
  fields?: Record<string, string>;
  labels?: Record<string, string>;
  name?: string;
  namespace?: string;
}

/**
 * Configuration for the apply function.
 */
export type ApplyCfg = {
  /**
   * Force the apply to be a create.
   */
  force?: boolean;
};

export enum FetchMethods {
  APPLY = "APPLY",
  DELETE = "DELETE",
  GET = "GET",
  LOG = "LOG",
  PATCH = "PATCH",
  PATCH_STATUS = "PATCH_STATUS",
  POST = "POST",
  PUT = "PUT",
  WATCH = "WATCH",
}

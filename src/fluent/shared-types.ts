// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors
import { GenericClass, GroupVersionKind } from "../types";
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

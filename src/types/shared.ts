// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { KubernetesObject } from "@kubernetes/client-node";
import { GenericClass, GroupVersionKind } from "../types";

/** Configuration for the watch function. */
export type WatchCfg = {
  /** The maximum number of times to retry the watch, the retry count is reset on success. Unlimited retries if not specified. */
  resyncFailureMax?: number;
  /** Seconds between each resync check. Defaults to 5. */
  resyncDelaySec?: number;
  /** Amount of seconds to wait before relisting the watch list. Defaults to 600 (10 minutes). */
  relistIntervalSec?: number;
  /** Max amount of seconds to go without receiving an event before reconciliation starts. Defaults to 300 (5 minutes). */
  lastSeenLimitSeconds?: number;
};

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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { KubeConfig, VersionApi } from "@kubernetes/client-node";

import { waitFor, type WaitForOptions } from "./wait.js";

/** Options accepted by {@link preflight}. */
export interface PreflightOptions extends Pick<
  WaitForOptions,
  "timeoutMs" | "intervalMs" | "signal"
> {
  /** An already configured client, primarily for callers with non-default kubeconfig loading. */
  kubeConfig?: KubeConfig;
}

/** Successfully verified Kubernetes connection details. */
export interface PreflightResult {
  /** Name of the active kubeconfig context. */
  contextName: string;
  /** Name of the cluster selected by that context. */
  clusterName: string;
  /** Kubernetes API server URL. */
  server: string;
  /** Version reported by the authenticated API server. */
  gitVersion: string;
}

/**
 * Use a supplied kubeconfig or load the process default.
 *
 * @param kubeConfig - Optional caller-configured Kubernetes client.
 * @returns The client used by preflight checks.
 */
function loadKubeConfig(kubeConfig?: KubeConfig): KubeConfig {
  if (kubeConfig) return kubeConfig;
  const loaded = new KubeConfig();
  loaded.loadFromDefault();
  return loaded;
}

/**
 * Verify kubeconfig selection and authenticated Kubernetes API connectivity.
 *
 * This intentionally calls the non-privileged `/version` endpoint rather than
 * probing a namespaced resource, so it does not impose additional RBAC needs.
 *
 * @param options - Kubeconfig, timing, and cancellation overrides.
 * @returns The selected context, cluster, server, and Kubernetes version.
 */
export async function preflight(options: PreflightOptions = {}): Promise<PreflightResult> {
  const kubeConfig = loadKubeConfig(options.kubeConfig);
  const contextName = kubeConfig.getCurrentContext();
  const cluster = kubeConfig.getCurrentCluster();

  if (!contextName) throw new Error("Kubernetes preflight failed: no current context is selected");
  if (!cluster) throw new Error("Kubernetes preflight failed: the current context has no cluster");

  const versionApi = kubeConfig.makeApiClient(VersionApi);
  const version = await waitFor(
    `Kubernetes API server ${cluster.server}`,
    () => versionApi.getCode(),
    options,
  );

  return {
    contextName,
    clusterName: cluster.name,
    server: cluster.server,
    gitVersion: version.gitVersion,
  };
}

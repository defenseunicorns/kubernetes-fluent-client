// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubeConfig } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { preflight } from "./preflight.js";

/**
 * Build the minimal kubeconfig surface needed by preflight tests.
 *
 * @param overrides - Values used instead of the default valid configuration.
 * @param overrides.contextName - Current context returned by the mock.
 * @param overrides.cluster - Current cluster returned by the mock.
 * @param overrides.getCode - Version API implementation used by the mock.
 * @returns A kubeconfig test double.
 */
function kubeConfig(
  overrides: {
    contextName?: string;
    cluster?: { name: string; server: string } | null;
    getCode?: () => Promise<{ gitVersion: string }>;
  } = {},
): KubeConfig {
  const getCode = overrides.getCode ?? vi.fn().mockResolvedValue({ gitVersion: "v1.33.1" });
  return {
    getCurrentContext: () => overrides.contextName ?? "k3d-example",
    getCurrentCluster: () =>
      overrides.cluster === undefined
        ? { name: "k3d-example", server: "https://127.0.0.1:6443" }
        : overrides.cluster,
    makeApiClient: () => ({ getCode }),
  } as unknown as KubeConfig;
}

describe("preflight", () => {
  it("returns details from an authenticated version request", async () => {
    await expect(preflight({ kubeConfig: kubeConfig() })).resolves.toEqual({
      contextName: "k3d-example",
      clusterName: "k3d-example",
      server: "https://127.0.0.1:6443",
      gitVersion: "v1.33.1",
    });
  });

  it("fails before making a request when no context is selected", async () => {
    await expect(preflight({ kubeConfig: kubeConfig({ contextName: "" }) })).rejects.toThrow(
      "no current context is selected",
    );
  });

  it("fails before making a request when the context has no cluster", async () => {
    await expect(preflight({ kubeConfig: kubeConfig({ cluster: null }) })).rejects.toThrow(
      "current context has no cluster",
    );
  });

  it("fails immediately when the API rejects authentication", async () => {
    const unauthorized = Object.assign(new Error("unauthorized"), { statusCode: 401 });
    const getCode = vi.fn().mockRejectedValue(unauthorized);

    await expect(preflight({ kubeConfig: kubeConfig({ getCode }) })).rejects.toBe(unauthorized);
    expect(getCode).toHaveBeenCalledOnce();
  });
});

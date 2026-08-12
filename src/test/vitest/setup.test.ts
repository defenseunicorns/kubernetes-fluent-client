// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubeConfig } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";

import { setupKubernetesPreflight } from "./setup.js";

describe("setupKubernetesPreflight", () => {
  const getCode = vi.fn().mockResolvedValue({ gitVersion: "v1.33.1" });
  const kubeConfig = {
    getCurrentContext: () => "k3d-consumer",
    getCurrentCluster: () => ({ name: "k3d-consumer", server: "https://127.0.0.1:6443" }),
    makeApiClient: () => ({ getCode }),
  } as unknown as KubeConfig;

  setupKubernetesPreflight({ kubeConfig });

  it("runs the Kubernetes preflight before tests in the suite", () => {
    expect(getCode).toHaveBeenCalledOnce();
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubeConfig } from "@kubernetes/client-node";
import { setTimeout } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";

import { setupKubernetesPreflight } from "./setup.js";

describe("setupKubernetesPreflight", () => {
  let preflightCalls = 0;
  let preflightCompleted = false;
  const getCode = async () => {
    preflightCalls++;
    await setTimeout(10);
    preflightCompleted = true;
    return { gitVersion: "v1.33.1" };
  };
  const kubeConfig = {
    getCurrentContext: () => "k3d-consumer",
    getCurrentCluster: () => ({ name: "k3d-consumer", server: "https://127.0.0.1:6443" }),
    makeApiClient: () => ({ getCode }),
  } as unknown as KubeConfig;

  setupKubernetesPreflight({ kubeConfig });

  it.each(["first", "second"])("runs preflight once before the %s test", () => {
    expect(preflightCompleted).toBe(true);
    expect(preflightCalls).toBe(1);
  });

  afterAll(() => expect(preflightCalls).toBe(1));
});

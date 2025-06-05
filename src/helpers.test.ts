// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { describe, expect, it, test, vi, afterEach } from "vitest";

import { fromEnv, hasLogs, waitForCluster } from "./helpers.js";

describe("helpers", () => {
  test("fromEnv for NodeJS", () => {
    expect(() => {
      fromEnv("MY_MISSING_ENV_VAR");
    }).toThrowError("Environment variable MY_MISSING_ENV_VAR is not set");

    process.env.MY_ENV_VAR = "my-value";
    expect(fromEnv("MY_ENV_VAR")).toEqual("my-value");
    delete process.env.MY_ENV_VAR;
  });
});

describe("Cluster Wait Function", () => {
  // Mock the KubeConfig class
  vi.mock("@kubernetes/client-node", () => {
    return {
      KubeConfig: vi.fn().mockImplementation(() => ({
        loadFromDefault: vi.fn(),
        getCurrentCluster: vi.fn().mockReturnValue({
          server: "https://jest-test:8080",
        }),
      })),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should resolve if the cluster is already ready", async () => {
    const cluster = await waitForCluster(5);
    expect(cluster).toEqual({ server: "https://jest-test:8080" });
  });
});

describe("hasLogs function", () => {
  it("should return true for known kinds", () => {
    expect(hasLogs("Pod")).toBe(true);
    expect(hasLogs("DaemonSet")).toBe(true);
    expect(hasLogs("ReplicaSet")).toBe(true);
    expect(hasLogs("Service")).toBe(true);
    expect(hasLogs("StatefulSet")).toBe(true);
    expect(hasLogs("Deployment")).toBe(true);
  });

  it("should return false for unknown kinds", () => {
    expect(hasLogs("Unknown")).toBe(false);
    expect(hasLogs("")).toBe(false);
    expect(hasLogs("RandomKind")).toBe(false);
  });
});

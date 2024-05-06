// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { describe, expect, it, test } from "@jest/globals";

import { fromEnv, selectorKind, waitForCluster } from "./helpers";

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
  it("should resolve if the cluster is already ready", async () => {
    const cluster = await waitForCluster(5);
    expect(cluster).toEqual({ server: "http://jest-test:8080" });
  });
});

describe("selectorKind function", () => {
  it("should return true for known kinds", () => {
    expect(selectorKind("Pod")).toBe(true);
    expect(selectorKind("DaemonSet")).toBe(true);
    expect(selectorKind("ReplicaSet")).toBe(true);
    expect(selectorKind("Service")).toBe(true);
    expect(selectorKind("StatefulSet")).toBe(true);
    expect(selectorKind("Deployment")).toBe(true);
  });

  it("should return false for unknown kinds", () => {
    expect(selectorKind("Unknown")).toBe(false);
    expect(selectorKind("")).toBe(false);
    expect(selectorKind("RandomKind")).toBe(false);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { describe, expect, it } from "vitest";

import { KUBERNETES_TEST_TIMEOUT_MS, defineKubernetesTestConfig } from "./config.js";

describe("defineKubernetesTestConfig", () => {
  it("returns the shared Kubernetes integration-test defaults", () => {
    expect(defineKubernetesTestConfig()).toEqual({
      test: {
        include: ["./*.test.ts"],
        testTimeout: KUBERNETES_TEST_TIMEOUT_MS,
        hookTimeout: KUBERNETES_TEST_TIMEOUT_MS,
      },
    });
  });

  it("preserves project configuration while overriding individual test defaults", () => {
    const plugin = { name: "consumer-plugin" };

    expect(
      defineKubernetesTestConfig({
        plugins: [plugin],
        test: {
          hookTimeout: 30_000,
          globals: true,
        },
      }),
    ).toEqual({
      plugins: [plugin],
      test: {
        include: ["./*.test.ts"],
        testTimeout: KUBERNETES_TEST_TIMEOUT_MS,
        hookTimeout: 30_000,
        globals: true,
      },
    });
  });

  it("allows consumers to replace the default include pattern", () => {
    expect(
      defineKubernetesTestConfig({ test: { include: ["integration/**/*.spec.ts"] } }).test?.include,
    ).toEqual(["integration/**/*.spec.ts"]);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { defineConfig, type ViteUserConfig } from "vitest/config";

/** Default timeout used by UDS package integration tests. */
export const KUBERNETES_TEST_TIMEOUT_MS = 120_000;

/**
 * Define a Vitest configuration for Kubernetes integration tests.
 *
 * Consumer values override the shared defaults. Nested `test` options are
 * merged independently so adding one option does not discard the defaults.
 *
 * @param overrides - Project-specific Vite and Vitest configuration.
 * @returns A Vitest configuration with Kubernetes integration-test defaults.
 */
export function defineKubernetesTestConfig(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      include: ["./*.test.ts"],
      testTimeout: KUBERNETES_TEST_TIMEOUT_MS,
      hookTimeout: KUBERNETES_TEST_TIMEOUT_MS,
      ...overrides.test,
    },
  });
}

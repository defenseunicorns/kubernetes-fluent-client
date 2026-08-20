// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

/** Environment variable used to override the default waiter timeout. */
export const TEST_TIMEOUT_ENV = "KFC_TEST_TIMEOUT_MS";

/** Environment variable used to override the default polling interval. */
export const TEST_INTERVAL_ENV = "KFC_TEST_POLL_INTERVAL_MS";

/** Default waiter timeout used by KFC integration tests. */
export const DEFAULT_TEST_TIMEOUT_MS = 60_000;

/** Default polling interval used by KFC integration tests. */
export const DEFAULT_TEST_INTERVAL_MS = 2_000;

/** Timing configuration shared by integration test helpers. */
export interface KubernetesTestEnvironment {
  /** Maximum time to wait for an eventually consistent condition. */
  timeoutMs: number;
  /** Delay between attempts. */
  intervalMs: number;
}

/** Optional timing overrides for {@link env}. */
export type KubernetesTestEnvironmentOverrides = Partial<KubernetesTestEnvironment>;

/**
 * Parse and validate a millisecond value.
 *
 * @param name - Setting name used in validation errors.
 * @param value - Candidate millisecond value.
 * @returns The validated positive integer.
 */
function positiveInteger(name: string, value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received ${String(value)}`);
  }

  return parsed;
}

/**
 * Read an optional timing setting from the process environment.
 *
 * @param name - Environment variable name.
 * @param fallback - Value returned when the variable is unset or empty.
 * @returns The configured or fallback millisecond value.
 */
function environmentValue(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  return value ? positiveInteger(name, value) : fallback;
}

/**
 * Resolve integration-test timing from explicit overrides, environment variables, and defaults.
 *
 * Explicit values take precedence over `KFC_TEST_TIMEOUT_MS` and
 * `KFC_TEST_POLL_INTERVAL_MS`. Values must be positive whole milliseconds.
 *
 * @param overrides - Per-call timing values.
 * @returns Resolved waiter timing.
 */
export function env(overrides: KubernetesTestEnvironmentOverrides = {}): KubernetesTestEnvironment {
  return {
    timeoutMs: positiveInteger(
      "timeoutMs",
      overrides.timeoutMs ?? environmentValue(TEST_TIMEOUT_ENV, DEFAULT_TEST_TIMEOUT_MS),
    ),
    intervalMs: positiveInteger(
      "intervalMs",
      overrides.intervalMs ?? environmentValue(TEST_INTERVAL_ENV, DEFAULT_TEST_INTERVAL_MS),
    ),
  };
}

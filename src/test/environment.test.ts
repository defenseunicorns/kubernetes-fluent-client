// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TEST_INTERVAL_MS,
  DEFAULT_TEST_TIMEOUT_MS,
  TEST_INTERVAL_ENV,
  TEST_TIMEOUT_ENV,
  env,
} from "./environment.js";

afterEach(() => {
  delete process.env[TEST_TIMEOUT_ENV];
  delete process.env[TEST_INTERVAL_ENV];
});

describe("env", () => {
  it("returns the documented defaults", () => {
    expect(env()).toEqual({
      timeoutMs: DEFAULT_TEST_TIMEOUT_MS,
      intervalMs: DEFAULT_TEST_INTERVAL_MS,
    });
  });

  it("reads timing from the environment", () => {
    process.env[TEST_TIMEOUT_ENV] = "1234";
    process.env[TEST_INTERVAL_ENV] = "56";

    expect(env()).toEqual({ timeoutMs: 1234, intervalMs: 56 });
  });

  it("gives explicit overrides precedence", () => {
    process.env[TEST_TIMEOUT_ENV] = "1234";
    process.env[TEST_INTERVAL_ENV] = "56";

    expect(env({ timeoutMs: 10, intervalMs: 2 })).toEqual({
      timeoutMs: 10,
      intervalMs: 2,
    });
  });

  it.each(["0", "-1", "1.5", "not-a-number"])("rejects invalid value %s", value => {
    process.env[TEST_TIMEOUT_ENV] = value;
    expect(() => env()).toThrow(`${TEST_TIMEOUT_ENV} must be a positive integer`);
  });
});

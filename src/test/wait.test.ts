// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { afterEach, describe, expect, it, vi } from "vitest";

import { WaitForTimeoutError, classifyKubernetesError, waitFor } from "./wait.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("classifyKubernetesError", () => {
  it.each([404, 408, 409, 429, 500, 503])("retries HTTP status %s", status => {
    expect(classifyKubernetesError({ status })).toBe("retry");
  });

  it.each([400, 401, 403, 422])("terminates for HTTP status %s", status => {
    expect(classifyKubernetesError({ status })).toBe("terminal");
  });

  it("recognizes a nested transport timeout", () => {
    expect(
      classifyKubernetesError({
        status: 400,
        e: { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } },
      }),
    ).toBe("retry");
  });

  it("treats unknown programming errors as terminal", () => {
    expect(classifyKubernetesError(new TypeError("bad probe"))).toBe("terminal");
  });
});

describe("waitFor", () => {
  it("returns the first truthy probe result", async () => {
    vi.useFakeTimers();
    const probe = vi
      .fn<() => Promise<string | false>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce("ready");
    const pending = waitFor("ready state", probe, { timeoutMs: 100, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe("ready");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("retries a missing resource", async () => {
    vi.useFakeTimers();
    const resource = { metadata: { name: "example" } };
    const probe = vi
      .fn<() => Promise<typeof resource>>()
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(resource);
    const pending = waitFor("resource", probe, { timeoutMs: 100, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe(resource);
  });

  it("immediately rethrows a terminal error", async () => {
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    const probe = vi.fn().mockRejectedValue(forbidden);

    await expect(waitFor("permission", probe, { timeoutMs: 100, intervalMs: 10 })).rejects.toBe(
      forbidden,
    );
    expect(probe).toHaveBeenCalledOnce();
  });

  it("attaches the last retryable error and timeout diagnostics", async () => {
    vi.useFakeTimers();
    const unavailable = Object.assign(new Error("unavailable"), { status: 503 });
    const onTimeout = vi.fn().mockResolvedValue({ pods: [] });
    const pending = waitFor("workload", () => Promise.reject(unavailable), {
      timeoutMs: 25,
      intervalMs: 10,
      onTimeout,
    }).catch(error => error);

    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;

    expect(error).toBeInstanceOf(WaitForTimeoutError);
    expect(error).toMatchObject({
      attempts: 3,
      lastError: unavailable,
      diagnostics: { pods: [] },
    });
    expect(error.message).toContain("Timed out waiting for workload. Last error: unavailable");
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("keeps a diagnostics failure separate from the timeout", async () => {
    vi.useFakeTimers();
    const diagnosticsError = new Error("diagnostics failed");
    const pending = waitFor("workload", async () => false, {
      timeoutMs: 10,
      intervalMs: 5,
      onTimeout: () => Promise.reject(diagnosticsError),
    }).catch(error => error);

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({ diagnosticsError });
  });

  it("enforces the deadline while a probe remains pending", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise<never>(() => undefined));
    const pending = waitFor("pending probe", probe, {
      timeoutMs: 25,
      intervalMs: 10,
    }).catch(error => error);

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({
      name: "WaitForTimeoutError",
      attempts: 1,
      elapsedMs: 25,
    });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("supports caller-directed cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitFor("workload", async () => false, {
      timeoutMs: 100,
      intervalMs: 20,
      signal: controller.signal,
    });

    controller.abort(new Error("test cancelled"));

    await expect(pending).rejects.toThrow("test cancelled");
  });

  it("supports caller cancellation while a probe remains pending", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const probe = vi.fn(() => new Promise<never>(() => undefined));
    const pending = waitFor("pending probe", probe, {
      timeoutMs: 100,
      intervalMs: 20,
      signal: controller.signal,
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("pending probe cancelled"));

    await expect(pending).rejects.toThrow("pending probe cancelled");
    expect(probe).toHaveBeenCalledOnce();
  });
});

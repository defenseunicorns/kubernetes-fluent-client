// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { afterEach, describe, expect, it, vi } from "vitest";

import { WaitForTimeoutError, waitFor } from "./wait.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it.each([404, 408, 409, 429, 500, 503])("retries HTTP status %s", async status => {
    vi.useFakeTimers();
    const resource = { metadata: { name: "example" } };
    const probe = vi
      .fn<() => Promise<typeof resource>>()
      .mockRejectedValueOnce({ status })
      .mockResolvedValueOnce(resource);
    const pending = waitFor("resource", probe, { timeoutMs: 100, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe(resource);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 422])("terminates for HTTP status %s", async status => {
    const error = Object.assign(new Error("terminal"), { status });
    const probe = vi.fn().mockRejectedValue(error);

    await expect(waitFor("resource", probe)).rejects.toBe(error);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("retries a nested transport timeout", async () => {
    vi.useFakeTimers();
    const nestedTimeout = {
      status: 400,
      e: { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } },
    };
    const probe = vi.fn().mockRejectedValueOnce(nestedTimeout).mockResolvedValueOnce("ready");
    const pending = waitFor("connection", probe, { timeoutMs: 100, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe("ready");
  });

  it("treats unknown programming errors as terminal", async () => {
    const error = new TypeError("bad probe");
    await expect(waitFor("program", () => Promise.reject(error))).rejects.toBe(error);
  });

  it("terminates safely for a cyclic error cause", async () => {
    const error: { status: number; cause?: unknown } = { status: 400 };
    error.cause = error;
    const probe = vi.fn().mockRejectedValue(error);

    await expect(waitFor("cyclic error", probe)).rejects.toBe(error);
    expect(probe).toHaveBeenCalledOnce();
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

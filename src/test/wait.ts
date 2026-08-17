// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { env } from "./environment.js";

/** Whether a failed wait attempt should be retried or immediately rethrown. */
export type ErrorDisposition = "retry" | "terminal";

/** Callback that classifies an error raised by a wait attempt. */
export type ErrorClassifier = (error: unknown) => ErrorDisposition;

/** Options accepted by {@link waitFor}. */
export interface WaitForOptions<TDiagnostics = unknown> {
  /** Maximum wait time in milliseconds. */
  timeoutMs?: number;
  /** Delay between attempts in milliseconds. */
  intervalMs?: number;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Override the default Kubernetes-aware error classification. */
  classifyError?: ErrorClassifier;
  /** Collect runner-neutral diagnostics when the wait expires. */
  onTimeout?: () => TDiagnostics | Promise<TDiagnostics>;
}

/** Details attached to a {@link WaitForTimeoutError}. */
export interface WaitForTimeoutDetails<TDiagnostics = unknown> {
  /** Number of probe attempts performed. */
  attempts: number;
  /** Total elapsed time at failure. */
  elapsedMs: number;
  /** Most recent retryable error, if one occurred. */
  lastError?: unknown;
  /** Value returned by the timeout diagnostics callback. */
  diagnostics?: TDiagnostics;
  /** Error raised by the diagnostics callback, if it failed. */
  diagnosticsError?: unknown;
}

/** Error raised when {@link waitFor} does not observe a truthy result in time. */
export class WaitForTimeoutError<TDiagnostics = unknown> extends Error {
  /** Number of probe attempts performed. */
  readonly attempts: number;
  /** Total elapsed time at failure. */
  readonly elapsedMs: number;
  /** Most recent retryable error, if one occurred. */
  readonly lastError?: unknown;
  /** Value returned by the timeout diagnostics callback. */
  readonly diagnostics?: TDiagnostics;
  /** Error raised by the diagnostics callback, if it failed. */
  readonly diagnosticsError?: unknown;

  /**
   * Create a timeout error.
   *
   * @param description - Human-readable condition being awaited.
   * @param details - Attempt, timing, and diagnostics metadata.
   */
  constructor(description: string, details: WaitForTimeoutDetails<TDiagnostics>) {
    const suffix =
      details.lastError instanceof Error ? ` Last error: ${details.lastError.message}` : "";
    super(`Timed out waiting for ${description}.${suffix}`, {
      cause: details.lastError,
    });
    this.name = "WaitForTimeoutError";
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
    this.lastError = details.lastError;
    this.diagnostics = details.diagnostics;
    this.diagnosticsError = details.diagnosticsError;
  }
}

type ErrorLike = {
  status?: number;
  statusCode?: number;
  code?: string | number;
  name?: string;
  cause?: unknown;
  e?: unknown;
};

const RETRYABLE_STATUS_CODES = new Set([404, 408, 409, 429]);
const TERMINAL_STATUS_CODES = new Set([400, 401, 403, 405, 406, 415, 422]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Narrow an unknown value to the error fields used by the classifier.
 *
 * @param value - Candidate error or nested cause.
 * @returns The error-like value when it is an object.
 */
function errorLike(value: unknown): ErrorLike | undefined {
  return typeof value === "object" && value !== null ? (value as ErrorLike) : undefined;
}

/**
 * Find the next nested error exposed by supported clients.
 *
 * @param error - Current error wrapper.
 * @returns Its nested error or cause, if present.
 */
function nestedError(error: ErrorLike): ErrorLike | undefined {
  const wrapper = errorLike(error.e);
  return errorLike(error.cause) ?? errorLike(wrapper?.cause) ?? wrapper;
}

/**
 * Read a numeric HTTP status from common error shapes.
 *
 * @param error - Error-like value to inspect.
 * @returns A numeric HTTP status when present.
 */
function errorStatus(error: ErrorLike): number | undefined {
  const candidates = [error.status, error.statusCode, error.code];
  return candidates.find((candidate): candidate is number => typeof candidate === "number");
}

/**
 * Read a transport error code.
 *
 * @param error - Error-like value to inspect.
 * @returns A string transport code when present.
 */
function errorCode(error: ErrorLike): string | undefined {
  return typeof error.code === "string" ? error.code : undefined;
}

/**
 * Determine whether an HTTP status represents an eventually consistent or transient failure.
 *
 * @param status - Numeric HTTP status, when available.
 * @returns True when the status is safe to retry.
 */
function isRetryableStatus(status: number | undefined): boolean {
  return status !== undefined && (RETRYABLE_STATUS_CODES.has(status) || status >= 500);
}

/**
 * Determine whether an HTTP status should stop polling.
 *
 * Status 400 is inspected for a nested cause because KFC uses it as a
 * transport-error fallback.
 *
 * @param status - Numeric HTTP status, when available.
 * @returns True when the status is known to be terminal.
 */
function isTerminalStatus(status: number | undefined): boolean {
  return status !== undefined && status !== 400 && TERMINAL_STATUS_CODES.has(status);
}

/**
 * Classify one error layer when it contains a recognized signal.
 *
 * @param error - Error-like layer to inspect.
 * @returns A disposition for recognized signals, otherwise undefined.
 */
function recognizedDisposition(error: ErrorLike): ErrorDisposition | undefined {
  const status = errorStatus(error);
  const code = errorCode(error);

  if (isRetryableStatus(status)) return "retry";
  if (code && RETRYABLE_ERROR_CODES.has(code)) return "retry";
  if (error.name?.includes("Timeout")) return "retry";
  if (isTerminalStatus(status)) return "terminal";
  return undefined;
}

/**
 * Classify common Kubernetes and transport failures for polling.
 *
 * Missing/conflicting resources, throttling, request timeouts, server failures,
 * and transient network failures retry. Client/authentication/authorization
 * failures and unknown errors terminate immediately.
 *
 * @param error - Error raised by the probe.
 * @returns Whether the wait should retry the error.
 */
function classifyKubernetesError(error: unknown): ErrorDisposition {
  let current = errorLike(error);
  const visited = new Set<ErrorLike>();

  while (current && !visited.has(current)) {
    visited.add(current);
    const disposition = recognizedDisposition(current);
    if (disposition) return disposition;
    current = nestedError(current);
  }

  return "terminal";
}

/**
 * Convert an aborted signal into its throwable reason.
 *
 * @param signal - Aborted cancellation signal.
 * @returns The signal's error reason or a standard abort error.
 */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

/**
 * Sleep for a bounded polling interval with cancellation support.
 *
 * @param milliseconds - Delay before resolving.
 * @param signal - Optional cancellation signal.
 * @returns A promise that resolves after the delay.
 */
async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type ProbeResult<T> = { timedOut: true } | { timedOut: false; value: T | undefined | null | false };

/**
 * Await one probe without allowing it to outlive the waiter's remaining deadline.
 *
 * The probe itself may continue when it does not support cancellation, but its
 * eventual settlement remains observed and cannot keep the waiter pending.
 *
 * @param probe - Async operation to execute.
 * @param milliseconds - Time remaining before the waiter expires.
 * @param signal - Optional caller cancellation signal.
 * @returns The probe value or an indication that the deadline expired first.
 */
async function boundedProbe<T>(
  probe: () => Promise<T | undefined | null | false>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<ProbeResult<T>> {
  if (signal?.aborted) throw abortError(signal);

  return new Promise<ProbeResult<T>>((resolve, reject) => {
    let settled = false;

    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => finish(() => reject(abortError(signal!)));
    const timer = setTimeout(() => finish(() => resolve({ timedOut: true })), milliseconds);

    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(probe)
      .then(
        value => finish(() => resolve({ timedOut: false, value })),
        error => finish(() => reject(error)),
      );
  });
}

type ProbeAttempt<T> = ProbeResult<T> & { lastError: unknown };

interface ProbeAttemptOptions {
  signal?: AbortSignal;
  classifyError: ErrorClassifier;
  lastError: unknown;
}

/**
 * Execute and classify one bounded polling attempt.
 *
 * @param probe - Async operation to execute.
 * @param milliseconds - Time remaining before the waiter expires.
 * @param options - Cancellation, classification, and previous-error state.
 * @returns The bounded probe result and updated retryable failure.
 */
async function probeAttempt<T>(
  probe: () => Promise<T | undefined | null | false>,
  milliseconds: number,
  options: ProbeAttemptOptions,
): Promise<ProbeAttempt<T>> {
  try {
    return {
      ...(await boundedProbe(probe, milliseconds, options.signal)),
      lastError: options.lastError,
    };
  } catch (error) {
    if (options.signal?.aborted) throw abortError(options.signal);
    if (options.classifyError(error) === "terminal") throw error;
    return { timedOut: false, value: false, lastError: error };
  }
}

/**
 * Run optional timeout diagnostics without replacing the primary failure.
 *
 * @param options - Waiter options containing the diagnostics callback.
 * @param attempts - Number of completed probe attempts.
 * @param elapsedMs - Elapsed wait duration.
 * @param lastError - Most recent retryable error.
 * @returns Metadata used to construct the timeout error.
 */
async function timeoutDetails<TDiagnostics>(
  options: WaitForOptions<TDiagnostics>,
  attempts: number,
  elapsedMs: number,
  lastError: unknown,
): Promise<WaitForTimeoutDetails<TDiagnostics>> {
  try {
    return {
      attempts,
      elapsedMs,
      lastError,
      diagnostics: await options.onTimeout?.(),
    };
  } catch (diagnosticsError) {
    return { attempts, elapsedMs, lastError, diagnosticsError };
  }
}

/**
 * Poll an asynchronous condition until it returns a truthy value.
 *
 * The call shape is compatible with the helpers previously maintained by UDS
 * integration packages. Falsy values retry. Retryable Kubernetes and network
 * errors retry; terminal errors are rethrown immediately.
 *
 * @param description - Human-readable condition being awaited.
 * @param probe - Async operation returning the desired value or a falsy retry signal.
 * @param options - Timing, error classification, cancellation, and diagnostics hooks.
 * @returns The first truthy probe result.
 * @throws {unknown} The terminal probe error, an abort reason, or {@link WaitForTimeoutError}.
 */
export async function waitFor<T, TDiagnostics = unknown>(
  description: string,
  probe: () => Promise<T | undefined | null | false>,
  options: WaitForOptions<TDiagnostics> = {},
): Promise<T> {
  const timing = env(options);
  const classifyError = options.classifyError ?? classifyKubernetesError;
  const start = Date.now();
  let attempts = 0;
  let lastError: unknown;

  while (Date.now() - start < timing.timeoutMs) {
    const remainingBeforeProbe = timing.timeoutMs - (Date.now() - start);
    if (remainingBeforeProbe <= 0) break;

    attempts += 1;
    const attempt = await probeAttempt(probe, remainingBeforeProbe, {
      signal: options.signal,
      classifyError,
      lastError,
    });
    if (attempt.timedOut) break;
    if (attempt.value) return attempt.value;
    lastError = attempt.lastError;

    const remaining = timing.timeoutMs - (Date.now() - start);
    if (remaining > 0) await sleep(Math.min(timing.intervalMs, remaining), options.signal);
  }

  const elapsedMs = Date.now() - start;
  const details = await timeoutDetails(options, attempts, elapsedMs, lastError);
  throw new WaitForTimeoutError(description, details);
}

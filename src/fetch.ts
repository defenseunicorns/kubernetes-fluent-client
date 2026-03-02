// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { StatusCodes } from "http-status-codes";
import { fetch as undiciFetch, RequestInfo, RequestInit } from "undici";

export type FetchResponse<T> = {
  data: T;
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  e?: unknown;
};

/**
 * Perform an async HTTP call and return the parsed JSON response, optionally
 * as a specific type.
 *
 * @example
 * ```ts
 * fetch<string[]>("https://example.com/api/foo");
 * ```
 *
 * @param url The URL or Request object to fetch
 * @param init Additional options for the request
 * @returns The parsed JSON response
 */
export async function fetch<T>(
  url: URL | RequestInfo,
  init?: RequestInit,
): Promise<FetchResponse<T>> {
  let data = undefined as unknown as T;

  // Capture response metadata before body parsing so it survives catch blocks.
  // Without this, a body-parsing failure (e.g. malformed JSON on a 200) loses
  // the real HTTP status and replaces it with a synthetic 400.
  let ok: boolean | undefined;
  let status: number | undefined;
  let statusText: string | undefined;
  let headers: Headers | undefined;

  try {
    const resp = await undiciFetch(url, init);
    ok = resp.ok;
    status = resp.status;
    statusText = resp.statusText;
    headers = resp.headers;

    const contentType = resp.headers.get("content-type") || "";

    // Parse the response as JSON if the content type is JSON
    if (contentType.includes("application/json")) {
      data = (await resp.json()) as T;
    } else {
      // Otherwise, return however the response was read
      data = (await resp.text()) as unknown as T;
    }

    return { data, ok, status, statusText, headers };
  } catch (e) {
    // Always treat a catch as a failure for callers — even when the HTTP
    // transport returned 2xx, a body-parse error means `data` is unusable.
    // We still preserve the real HTTP status/headers so callers can
    // distinguish "server sent 200 with garbage body" from "network error".
    return {
      data,
      ok: false,
      status: status ?? (parseInt(e?.code) || StatusCodes.BAD_REQUEST),
      statusText: statusText ?? (e?.message || "Unknown error"),
      headers: headers ?? new Headers(),
      e,
    };
  }
}

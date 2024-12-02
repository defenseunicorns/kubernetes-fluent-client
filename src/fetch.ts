// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { StatusCodes } from "http-status-codes";
import { fetch as undiciFetch, RequestInfo, RequestInit } from "undici";

export type FetchResponse<T> = {
  data: T;
  ok: boolean;
  status: number;
  statusText: string;
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
  try {
    const resp = await undiciFetch(url, init);
    const contentType = resp.headers.get("content-type") || "";

    // Parse the response as JSON if the content type is JSON
    if (contentType.includes("application/json")) {
      data = (await resp.json()) as T;
    } else {
      // Otherwise, return however the response was read
      data = (await resp.text()) as unknown as T;
    }

    return {
      data,
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
    };
  } catch (e) {
    const status = parseInt(e?.code) || StatusCodes.BAD_REQUEST;
    const statusText = e?.message || "Unknown error";

    return {
      data,
      ok: false,
      status,
      statusText,
    };
  }
}

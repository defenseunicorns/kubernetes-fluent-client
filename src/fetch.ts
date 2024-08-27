// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { StatusCodes } from "http-status-codes";
import fetchRaw, { FetchError, RequestInfo, RequestInit } from "node-fetch";
import * as http2 from "http2";

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
    const resp = await fetchRaw(url, init);
    const contentType = resp.headers.get("content-type") || "";

    // Parse the response as JSON if the content type is JSON
    if (contentType.includes("application/json")) {
      data = await resp.json();
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
    if (e instanceof FetchError) {
      // Parse the error code from the FetchError or default to 400 (Bad Request)
      const status = parseInt(e.code || "400");

      return {
        data,
        ok: false,
        status,
        statusText: e.message,
      };
    }

    return {
      data,
      ok: false,
      status: StatusCodes.BAD_REQUEST,
      statusText: "Unknown error",
    };
  }
}

/**
 * Perform an async HTTP call and return the parsed JSON response, optionally
 * as a specific type.
 *
 * @example
 * ```ts
 * @param options.headers
 * @param options.tlsOptions
 * fetch<string[]>("https://example.com/api/foo");
 * ```
 *
 * @param url The URL or Request object to fetch
 * @param options Additional options for the request
 * @returns The parsed JSON response
 */
// export async function http2Fetch<T>(
//   url: string,
//   options: {
//     headers: http2.OutgoingHttpHeaders;
//     tlsOptions: http2.SecureClientSessionOptions;
//   }
// ): Promise<FetchResponse<T>> {
//   let data = undefined as unknown as T;

//   return new Promise((resolve, reject) => {
//     console.log('Connecting to URL:', url);
//     console.log('Using TLS Options:', options.tlsOptions);
//     console.log('Request Headers:', options.headers);
//     let client: http2.ClientHttp2Session;
//     let req: http2.ClientHttp2Stream
//     client = http2.connect(new URL(url).origin, options.tlsOptions);
//     req = client.request({
//       ...options.headers,
//       ":path": new URL(url).pathname + new URL(url).search,
//     });

//     let responseData = '';

//     req.on('response', (headers) => {
//       console.log('Response Headers:', headers); // Debug log

//       const status = headers[':status'] as number;
//       const contentType = headers['content-type'] as string || '';

//       req.on('data', (chunk) => {
//         responseData += chunk;
//       });

//       req.on('end', () => {
//         client.close();
//         const ok = status >= 200 && status < 300;

//         if (contentType.includes('application/json')) {
//           try {
//             data = JSON.parse(responseData) as T;
//           } catch (e) {
//             reject(new Error(`Failed to parse JSON response: ${e.message}`));
//           }
//         } else {
//           data = responseData as unknown as T;
//         }

//         resolve({
//           data,
//           ok,
//           status,
//           statusText: headers[':statusText'] as string || '',
//         });
//       });

//       req.on('error', (err) => {
//         client.close();
//         reject(err);
//       });
//     });

//     req.end();
//   });
// }
export async function http2Fetch<T>(
  url: string,
  options: {
    headers: http2.OutgoingHttpHeaders;
    tlsOptions: http2.SecureClientSessionOptions;
    maxRetries?: number; // Optional: maximum number of retry attempts
    retryDelay?: number;  // Optional: delay between retries in milliseconds
  }
): Promise<FetchResponse<T>> {
  let data = undefined as unknown as T;
  let retries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 1000;

  return new Promise((resolve, reject) => {
    const makeRequest = () => {
      console.log('Connecting to URL:', url);
      console.log('Using TLS Options:', options.tlsOptions);
      console.log('Request Headers:', options.headers);

      let client: http2.ClientHttp2Session;
      let req: http2.ClientHttp2Stream;

      client = http2.connect(new URL(url).origin, options.tlsOptions);
      req = client.request({
        ...options.headers,
        ":path": new URL(url).pathname + new URL(url).search,
      });

      let responseData = '';

      req.on('response', (headers) => {
        console.log('Response Headers:', headers);

        const status = headers[':status'] as number;
        const contentType = headers['content-type'] as string || '';

        req.on('data', (chunk) => {
          responseData += chunk;
        });

        req.on('end', () => {
          client.close();
          const ok = status >= 200 && status < 300;

          if (contentType.includes('application/json')) {
            try {
              data = JSON.parse(responseData) as T;
            } catch (e) {
              reject(new Error(`Failed to parse JSON response: ${e.message}`));
              return;
            }
          } else {
            data = responseData as unknown as T;
          }

          resolve({
            data,
            ok,
            status,
            statusText: headers[':statusText'] as string || '',
          });
        });

        req.on('error', (err) => {
          console.error('Request error:', err);
          client.close();
          handleRetry(err);
        });
      });

      req.on('error', (err) => {
        console.error('Request error:', err);
        client.close();
        handleRetry(err);
      });

      req.end();
    };

    const handleRetry = (err: Error) => {
      if (retries > 0) {
        retries--;
        console.log(`Retrying request... Attempts left: ${retries}`);
        setTimeout(makeRequest, retryDelay);
      } else {
        reject(err);
      }
    };

    makeRequest();
  });
}

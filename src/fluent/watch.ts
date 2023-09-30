// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import byline from "byline";
import fetch from "node-fetch";

import { Writable } from "type-fest";
import { GenericClass, LogFn } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

export type WatchCfg = {
  retryMax: number;
  retryDelaySec?: number;
  logFn?: LogFn;
  retryFail?: (e: Error) => void;
};

/**
 * Execute a watch on the specified resource.
 */
export async function ExecWatch<T extends GenericClass>(
  model: T,
  filters: Filters,
  callback: WatchAction<T>,
  watchCfg: WatchCfg = { retryMax: 5 },
) {
  watchCfg.logFn?.({ model, filters, watchCfg }, "ExecWatch");

  // Build the path and query params for the resource, excluding the name
  const { opts, serverUrl } = await k8sCfg("GET");
  const url = pathBuilder(serverUrl, model, filters, true);

  // Enable the watch query param
  url.searchParams.set("watch", "true");

  // Allow bookmarks to be used for the watch
  url.searchParams.set("allowWatchBookmarks", "true");

  // If a name is specified, add it to the query params
  if (filters.name) {
    url.searchParams.set("fieldSelector", `metadata.name=${filters.name}`);
  }

  // Set the initial timeout to 15 seconds
  opts.timeout = 15 * 1000;

  // Enable keep alive
  (opts.agent as unknown as { keepAlive: boolean }).keepAlive = true;

  // Track the number of retries
  let retryCount = 0;

  // Create a throwaway AbortController to setup the wrapped AbortController
  let abortController: AbortController;

  // Create a wrapped AbortController to allow the watch to be aborted externally
  const abortWrapper = {} as Writable<AbortController>;

  function bindAbortController() {
    // Create a new AbortController
    abortController = new AbortController();

    // Update the abort wrapper
    abortWrapper.abort = abortController.abort;
    abortWrapper.signal = abortController.signal;

    // Add the abort signal to the request options
    opts.signal = abortController.signal;
  }

  async function runner() {
    let doneCalled = false;

    bindAbortController();

    // Create a stream to read the response body
    const stream = byline.createStream();

    const onError = (err: Error) => {
      watchCfg.logFn?.(err, "stream error");

      if (!doneCalled) {
        doneCalled = true;

        // If the error is not an AbortError, reload the watch
        if (err.name !== "AbortError") {
          stream.removeAllListeners();
          void reload(err);
        }
      }
    };

    const cleanup = () => {
      if (!doneCalled) {
        doneCalled = true;
        stream.removeAllListeners();
      }
    };

    try {
      // Make the actual request
      const response = await fetch(url, { ...opts });

      // If the request is successful, start listening for events
      if (response.ok) {
        const { body } = response;

        // Reset the retry count
        retryCount = 0;

        stream.on("error", onError);
        stream.on("close", cleanup);
        stream.on("finish", cleanup);

        // Listen for events and call the callback function
        stream.on("data", line => {
          try {
            // Parse the event payload
            const { object: payload, type: phase } = JSON.parse(line) as {
              type: WatchPhase;
              object: InstanceType<T>;
            };

            // Call the callback function with the parsed payload
            void callback(payload, phase as WatchPhase);
          } catch (err) {
            watchCfg.logFn?.(err, "watch callback error");
          }
        });

        body.on("error", onError);
        body.on("close", cleanup);
        body.on("finish", cleanup);

        // Pipe the response body to the stream
        body.pipe(stream);
      } else {
        throw new Error(`watch failed: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      onError(e);
    }

    // On unhandled errors, retry the watch
    async function reload(e: Error) {
      // If there are more attempts, retry the watch
      if (watchCfg.retryMax > retryCount) {
        retryCount++;

        watchCfg.logFn?.(e, `retrying watch ${retryCount}/${watchCfg.retryMax}`);

        // Sleep for the specified delay or 5 seconds
        await new Promise(r => setTimeout(r, (watchCfg.retryDelaySec ?? 5) * 1000));

        // Retry the watch after the delay
        await runner();
      } else {
        // Otherwise, call the finally function if it exists
        if (watchCfg.retryFail) {
          watchCfg.retryFail(e);
        }
      }
    }
  }

  await runner();

  return abortWrapper;
}

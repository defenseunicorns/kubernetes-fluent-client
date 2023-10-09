// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import byline from "byline";
import fetch from "node-fetch";

import { GenericClass, LogFn } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

/**
 * Wrapper for the AbortController to allow the watch to be aborted externally.
 */
export type WatchController = {
  /**
   * Abort the watch.
   *
   * @param reason optional reason for aborting the watch
   */
  abort: (reason?: string) => void;
  /**
   * Get the AbortSignal for the watch.
   *
   * @returns the AbortSignal
   */
  signal: () => AbortSignal;
};

/**
 * Configuration for the watch function.
 */
export type WatchCfg = {
  /**
   * The maximum number of times to retry the watch, the retry count is reset on success.
   */
  retryMax?: number;
  /**
   * The delay between retries in seconds.
   */
  retryDelaySec?: number;
  /**
   * A function to log errors.
   */
  logFn?: LogFn;
  /**
   * A function to call when the watch fails after the maximum number of retries.
   */
  retryFail?: (e: Error) => void;
};

/**
 * Execute a watch on the specified resource.
 *
 * @param model - the model to use for the API
 * @param filters - (optional) filter overrides, can also be chained
 * @param callback - the callback function to call when an event is received
 * @param watchCfg - (optional) watch configuration
 * @returns a WatchController to allow the watch to be aborted externally
 */
export async function ExecWatch<T extends GenericClass>(
  model: T,
  filters: Filters,
  callback: WatchAction<T>,
  watchCfg: WatchCfg = {},
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

  // Set the maximum number of retries to 5 if not specified
  watchCfg.retryMax ??= 5;

  // Set the retry delay to 5 seconds if not specified
  watchCfg.retryDelaySec ??= 5;

  // Create a throwaway AbortController to setup the wrapped AbortController
  let abortController: AbortController;

  // Create a wrapped AbortController to allow the watch to be aborted externally
  const abortWrapper = {} as WatchController;

  /**
   * Bind the abort controller to the wrapper.
   */
  function bindAbortController() {
    // Create a new AbortController
    abortController = new AbortController();

    // Update the abort wrapper
    abortWrapper.abort = reason => abortController.abort(reason);
    abortWrapper.signal = () => abortController.signal;

    // Add the abort signal to the request options
    opts.signal = abortController.signal;
  }

  /**
   * The main watch runner. This will run until the process is terminated or the watch is aborted.
   */
  async function runner() {
    let doneCalled = false;

    bindAbortController();

    // Create a stream to read the response body
    const stream = byline.createStream();

    const onError = (err: Error) => {
      stream.removeAllListeners();

      if (!doneCalled) {
        doneCalled = true;

        // If the error is not an AbortError, reload the watch
        if (err.name !== "AbortError") {
          watchCfg.logFn?.(err, "stream error");
          void reload(err);
        } else {
          watchCfg.logFn?.("watch aborted via WatchController.abort()");
        }
      }
    };

    // Cleanup the stream listeners
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

    /**
     * Reload the watch.
     *
     * @param e - the error that caused the reload
     */
    async function reload(e: Error) {
      // If there are more attempts, retry the watch
      if (watchCfg.retryMax! > retryCount) {
        retryCount++;

        watchCfg.logFn?.(`retrying watch ${retryCount}/${watchCfg.retryMax}`);

        // Sleep for the specified delay or 5 seconds
        await new Promise(r => setTimeout(r, watchCfg.retryDelaySec! * 1000));

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

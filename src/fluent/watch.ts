// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import byline from "byline";
import fetch from "node-fetch";

import { GenericClass, LogFn } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

/**
 * Execute a watch on the specified resource.
 *
 * @param model - the model to use for the API
 * @param filters - (optional) filter overrides, can also be chained
 * @param callback - the callback function to call when an event is received
 * @param watchCfg - (optional) watch configuration
 *
 * @deprecated Use {@link Watcher } instead.
 *
 * @returns a promise that resolves when the watch is complete
 */
export async function ExecWatch<T extends GenericClass>(
  model: T,
  filters: Filters,
  callback: WatchAction<T>,
  watchCfg: WatchCfg = {},
) {
  const watch = new Watcher(model, filters, callback, watchCfg);
  return watch.start();
}

/**
 * Configuration for the watch function.
 */
export type WatchCfg = {
  /**
   * The resource version to start the watch at, this will be updated on each event.
   */
  resourceVersion?: string;
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
 * A wrapper around the Kubernetes watch API.
 */
export class Watcher<T extends GenericClass> {
  // User-provided properties
  #model: T;
  #filters: Filters;
  #callback: WatchAction<T>;
  #watchCfg: WatchCfg;

  // Create a wrapped AbortController to allow the watch to be aborted externally
  #abortController: AbortController;

  // Track the number of retries
  #retryCount = 0;

  // Track whether the done function has been called
  #doneCalled = false;

  // Create a stream to read the response body
  #stream?: byline.LineStream;

  /**
   * Setup a Kubernetes watcher for the specified model and filters. The callback function will be called for each event received.
   * The watch can be aborted by calling {@link Watcher.abort} or by calling abort() on the AbortController returned by {@link Watcher.start}.
   * 
   * 
   * Kubernetes API docs: {@link https://kubernetes.io/docs/reference/using-api/api-concepts/#efficient-detection-of-changes}
   *
   * @param model - the model to use for the API
   * @param filters - (optional) filter overrides, can also be chained
   * @param callback - the callback function to call when an event is received
   * @param watchCfg - (optional) watch configuration
   */
  constructor(model: T, filters: Filters, callback: WatchAction<T>, watchCfg: WatchCfg = {}) {
    watchCfg.logFn?.({ model, filters, watchCfg }, "Initializing watch");

    // Set the maximum number of retries to 5 if not specified
    watchCfg.retryMax ??= 5;

    // Set the retry delay to 5 seconds if not specified
    watchCfg.retryDelaySec ??= 5;

    // Bind class properties
    this.#model = model;
    this.#filters = filters;
    this.#callback = callback;
    this.#watchCfg = watchCfg;

    // Create a new AbortController
    this.#abortController = new AbortController();
  }

  /**
   * Start the watch.
   *
   * @returns The AbortController for the watch.
   */
  public async start(): Promise<AbortController> {
    await this.#runner();
    return this.#abortController;
  }

  /**
   * Abort the watch. Also available on the AbortController returned by {@link Watcher.start}.
   */
  public abort() {
    this.#abortController.abort();
  }

  #buildURL = async () => {
    // Build the path and query params for the resource, excluding the name
    const { opts, serverUrl } = await k8sCfg("GET");
    const url = pathBuilder(serverUrl, this.#model, this.#filters, true);

    // Enable the watch query param
    url.searchParams.set("watch", "true");

    // If a name is specified, add it to the query params
    if (this.#filters.name) {
      url.searchParams.set("fieldSelector", `metadata.name=${this.#filters.name}`);
    }

    // If a resource version is specified, add it to the query params
    if (this.#watchCfg.resourceVersion) {
      url.searchParams.set("resourceVersion", this.#watchCfg.resourceVersion);
    }

    // Add the abort signal to the request options
    opts.signal = this.#abortController.signal;

    return { opts, url };
  };

  #runner = async () => {
    try {
      // Build the URL and request options
      const { opts, url } = await this.#buildURL();

      // Make the actual request
      const response = await fetch(url, { ...opts });

      // If the request is successful, start listening for events
      if (response.ok) {
        const { body } = response;

        // Reset the retry count
        this.#retryCount = 0;

        // Create a stream to read the response body
        this.#stream = byline.createStream();

        // Bind the stream events
        this.#stream.on("error", this.#onError);
        this.#stream.on("close", this.#cleanup);
        this.#stream.on("finish", this.#cleanup);

        // Listen for events and call the callback function
        this.#stream.on("data", async line => {
          try {
            // Parse the event payload
            const { object: payload, type: phase } = JSON.parse(line) as {
              type: WatchPhase;
              object: InstanceType<T>;
            };

            // Call the callback function with the parsed payload
            await this.#callback(payload, phase as WatchPhase);

            // Update the resource version if the callback was successful
            this.#watchCfg.resourceVersion = payload.metadata.resourceVersion;
          } catch (err) {
            this.#watchCfg.logFn?.(err, "watch callback error");
          }
        });

        // Bind the body events
        body.on("error", this.#onError);
        body.on("close", this.#cleanup);
        body.on("finish", this.#cleanup);

        // Pipe the response body to the stream
        body.pipe(this.#stream);
      } else {
        throw new Error(`watch failed: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      this.#onError(e);
    }
  };

  #reload = async (e: Error) => {
    const watchCfg = this.#watchCfg;

    // If there are more attempts, retry the watch
    if (watchCfg.retryMax! > this.#retryCount) {
      this.#retryCount++;

      watchCfg.logFn?.(`retrying watch ${this.#retryCount}/${watchCfg.retryMax}`);

      // Sleep for the specified delay or 5 seconds
      await new Promise(r => setTimeout(r, watchCfg.retryDelaySec! * 1000));

      // Retry the watch after the delay
      await this.#runner();
    } else {
      // Otherwise, call the finally function if it exists
      watchCfg.retryFail?.(e);
    }
  };

  /**
   * Handle errors from the stream.
   *
   * @param err - the error that occurred
   */
  #onError = (err: Error) => {
    if (!this.#doneCalled) {
      this.#doneCalled = true;

      // If the error is not an AbortError, reload the watch
      if (err.name !== "AbortError") {
        this.#watchCfg.logFn?.(err, "stream error");
        void this.#reload(err);
      } else {
        this.#watchCfg.logFn?.("watch aborted via AbortController");
      }
    }
  };

  /**
   * Cleanup the stream and listeners.
   */
  #cleanup = () => {
    if (this.#stream) {
      this.#stream.removeAllListeners();
      this.#stream = undefined;
    }
  };
}

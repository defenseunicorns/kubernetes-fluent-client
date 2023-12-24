// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import byline from "byline";
import { EventEmitter } from "events";
import fetch from "node-fetch";

import { GenericClass } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

export enum WatchEvent {
  CONNECT = "connect",
  NETWORK_ERROR = "network_error",
  DATA_ERROR = "data_error",
  RETRY = "retry",
  GIVE_UP = "give_up",
  ABORT = "abort",
  DATA = "data",
  RESOURCE_VERSION = "resource_version",
  OLD_RESOURCE_VERSION = "old_resource_version",
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
   * The maximum number of times to retry the watch, the retry count is reset on success. Unlimited retries if not specified.
   */
  retryMax?: number;
  /**
   * The delay between retries in seconds.
   */
  retryDelaySec?: number;
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

  // Create a stream to read the response body
  #stream?: byline.LineStream;

  // Create an EventEmitter to emit events
  #events = new EventEmitter();

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
    // Set the retry delay to 10 seconds if not specified
    watchCfg.retryDelaySec ??= 10;

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

  /**
   * Subscribe to watch events. This is an EventEmitter that emits the following events:
   *
   * - `connect` - emitted when the watch connects to the API server
   * - `network_error` - emitted when a network error occurs
   * - `data_error` - emitted when an error occurs in the data processing or callback function
   * - `retry` - emitted when the watch is retried after an error
   * - `give_up` - emitted when the watch is aborted after reaching the maximum number of retries
   * - `abort` - emitted when the watch is aborted
   * - `data` - emitted when an event is received from the API server
   * - `resource_version` - emitted when the resource version is updated after successfully processing an event
   * - `old_resource_version` - emitted when the resource version is updated after receiving a 410 Gone error
   *
   * Use {@link WatchEvent} for the event names.
   *
   * @returns an EventEmitter
   */
  public get events(): EventEmitter {
    return this.#events;
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

    // Enable watch bookmarks
    url.searchParams.set("allowWatchBookmarks", "true");

    // Add the abort signal to the request options
    opts.signal = this.#abortController.signal;

    return { opts, url };
  };

  // #initialize = async () => {};

  #runner = async () => {
    try {
      // Build the URL and request options
      const { opts, url } = await this.#buildURL();

      // Create a stream to read the response body
      this.#stream = byline.createStream();

      // Bind the stream events
      this.#stream.on("error", this.#onNetworkError);
      this.#stream.on("close", this.#cleanup);
      this.#stream.on("finish", this.#cleanup);

      // Make the actual request
      const response = await fetch(url, { ...opts });

      // If the request is successful, start listening for events
      if (response.ok) {
        this.#events.emit(WatchEvent.CONNECT);

        const { body } = response;

        // Reset the retry count
        this.#retryCount = 0;

        // Listen for events and call the callback function
        this.#stream.on("data", async line => {
          try {
            // Parse the event payload
            const { object: payload, type: phase } = JSON.parse(line) as {
              type: WatchPhase;
              object: InstanceType<T>;
            };

            // If the watch is bookmarked, update the resourceVersion and return
            if (phase === WatchPhase.Bookmark) {
              this.#setResourceVersion(payload.metadata.resourceVersion);
              return;
            }

            // If the watch is too old, remove the resourceVersion and reload the watch
            if (payload.kind === "Status" && payload.code === 410) {
              throw new Error("resourceVersion too old");
            }

            this.#events.emit(WatchEvent.DATA, payload, phase);

            // Call the callback function with the parsed payload
            await this.#callback(payload, phase as WatchPhase);

            // Update the resource version if the callback was successful
            this.#watchCfg.resourceVersion = payload.metadata.resourceVersion;
            this.#events.emit(WatchEvent.RESOURCE_VERSION, this.#watchCfg.resourceVersion);
          } catch (err) {
            // If the watch is too old, reload the watch
            if (err.message === "resourceVersion too old") {
              this.#events.emit(WatchEvent.OLD_RESOURCE_VERSION, this.#watchCfg.resourceVersion);
              // Remove the resourceVersion to start the watch from the beginning
              this.#setResourceVersion(undefined);
              // Prevent any body events from firing
              body.removeAllListeners();
              // Close the stream
              this.#cleanup();
              // Retry the watch
              await this.#runner();
            }

            this.#events.emit(WatchEvent.DATA_ERROR, err);
          }
        });

        // Bind the body events
        body.on("error", this.#onNetworkError);
        body.on("close", this.#cleanup);
        body.on("finish", this.#cleanup);

        // Pipe the response body to the stream
        body.pipe(this.#stream);
      } else {
        throw new Error(`watch connect failed: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      await this.#onNetworkError(e);
    }
  };

  #setResourceVersion = (resourceVersion?: string) => {
    this.#watchCfg.resourceVersion = resourceVersion;
    this.#events.emit(WatchEvent.RESOURCE_VERSION, this.#watchCfg.resourceVersion);
  };

  #reload = async (e: Error) => {
    const watchCfg = this.#watchCfg;

    // If there are more attempts, retry the watch (undefined is unlimited retries)
    if (watchCfg.retryMax === undefined || watchCfg.retryMax > this.#retryCount) {
      this.#retryCount++;

      this.#events.emit(WatchEvent.RETRY, e, this.#retryCount);

      // Sleep for the specified delay or 5 seconds
      await new Promise(r => setTimeout(r, watchCfg.retryDelaySec! * 1000));

      // Retry the watch after the delay
      await this.#runner();
    } else {
      // Otherwise, call the finally function if it exists
      this.#events.emit(WatchEvent.GIVE_UP, e);
    }
  };

  /**
   * Handle errors from the stream.
   *
   * @param err - the error that occurred
   */
  #onNetworkError = async (err: Error) => {
    if (this.#stream) {
      this.#cleanup();

      // If the error is not an AbortError, reload the watch
      if (err.name !== "AbortError") {
        this.#events.emit(WatchEvent.NETWORK_ERROR, err);
        await this.#reload(err);
      } else {
        this.#events.emit(WatchEvent.ABORT, err);
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

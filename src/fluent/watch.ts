// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import byline from "byline";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import fetch from "node-fetch";

import { GenericClass } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

export enum WatchEvent {
  /** Watch is connected successfully */
  CONNECT = "connect",
  /** Network error occurs */
  NETWORK_ERROR = "network_error",
  /** Error decoding data or running the callback */
  DATA_ERROR = "data_error",
  /** Reconnect is called */
  RECONNECT = "reconnect",
  /** Retry limit is exceeded */
  GIVE_UP = "give_up",
  /** Abort is called */
  ABORT = "abort",
  /** @deprecated */
  RESYNC = "resync",
  /** Data is received and decoded */
  DATA = "data",
  /** Bookmark is received */
  BOOKMARK = "bookmark",
  /** ResourceVersion is updated */
  RESOURCE_VERSION = "resource_version",
  /** 410 (old resource version) occurs */
  OLD_RESOURCE_VERSION = "old_resource_version",
  /** A reconnect is already pending */
  RECONNECT_PENDING = "reconnect_pending",
}

/** Configuration for the watch function. */
export type WatchCfg = {
  /** Whether to use bookmarks with the watch. */
  allowWatchBookmarks?: boolean;
  /** The resource version to start the watch at, this will be updated on each event. */
  resourceVersion?: string;
  /** The maximum number of times to retry the watch, the retry count is reset on success. Unlimited retries if not specified. */
  retryMax?: number;
  /** Seconds between each retry check. Defaults to 5. */
  retryDelaySec?: number;
  /** Amount of seconds to wait before a forced-resyncing of the watch list. Defaults to 300 (5 minutes). */
  resyncIntervalSec?: number;
};

const NONE = 50;
const OVERRIDE = 100;

/** A wrapper around the Kubernetes watch API. */
export class Watcher<T extends GenericClass> {
  // User-provided properties
  #model: T;
  #filters: Filters;
  #callback: WatchAction<T>;
  #watchCfg: WatchCfg;

  // Track the last time data was received
  #lastSeenTime = NONE;
  #lastSeenLimit: number;

  // Create a wrapped AbortController to allow the watch to be aborted externally
  #abortController: AbortController;

  // Track the number of retries
  #retryCount = 0;

  // Create a stream to read the response body
  #stream?: byline.LineStream;

  // Create an EventEmitter to emit events
  #events = new EventEmitter();

  // Create a timer to resync the watch
  #resyncTimer?: NodeJS.Timeout;

  // Track if a reconnect is pending
  #pendingReconnect = false;

  /**
   * Setup a Kubernetes watcher for the specified model and filters. The callback function will be called for each event received.
   * The watch can be aborted by calling {@link Watcher.close} or by calling abort() on the AbortController returned by {@link Watcher.start}.
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
    // Set the retry delay to 5 seconds if not specified
    watchCfg.retryDelaySec ??= 5;

    // Set the resync interval to 5 minutes if not specified
    watchCfg.resyncIntervalSec ??= 300;

    // Enable bookmarks by default
    watchCfg.allowWatchBookmarks ??= true;

    // Set the last seen limit to the resync interval
    this.#lastSeenLimit = watchCfg.resyncIntervalSec * 1000;

    // Check every 5 seconds for resync
    this.#resyncTimer = setInterval(this.#checkResync, watchCfg.retryDelaySec * 1000);

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

  /** Close the watch. Also available on the AbortController returned by {@link Watcher.start}. */
  public close() {
    clearInterval(this.#resyncTimer);
    this.#streamCleanup();
    this.#abortController.abort();
  }

  /**
   * Get a unique ID for the watch based on the model and filters.
   * This is useful for caching the watch data or resource versions.
   *
   * @returns the watch CacheID
   */
  public getCacheID() {
    // Build the URL, we don't care about the server URL or resourceVersion
    const url = pathBuilder("https://ignore", this.#model, this.#filters, false);

    // Hash and truncate the ID to 10 characters, cache the result
    return createHash("sha224")
      .update(url.pathname + url.search)
      .digest("hex")
      .substring(0, 10);
  }

  /**
   * Get the current resource version.
   *
   * @returns the current resource version
   */
  public get resourceVersion() {
    return this.#watchCfg.resourceVersion;
  }

  /**
   * Set the current resource version.
   *
   * @param resourceVersion - the new resource version
   */
  public set resourceVersion(resourceVersion: string | undefined) {
    this.#watchCfg.resourceVersion = resourceVersion;
  }

  /**
   * Subscribe to watch events. This is an EventEmitter that emits the following events:
   *
   * Use {@link WatchEvent} for the event names.
   *
   * @returns an EventEmitter
   */
  public get events(): EventEmitter {
    return this.#events;
  }

  /**
   * Build the URL and request options for the watch.
   *
   * @returns the URL and request options
   */
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
    if (this.#watchCfg.allowWatchBookmarks) {
      url.searchParams.set("allowWatchBookmarks", "true");
    }

    // Add the abort signal to the request options
    opts.signal = this.#abortController.signal;

    return { opts, url };
  };

  /** Run the watch. */
  #runner = async () => {
    try {
      // Build the URL and request options
      const { opts, url } = await this.#buildURL();

      // Create a stream to read the response body
      this.#stream = byline.createStream();

      // Bind the stream events
      this.#stream.on("error", this.#errHandler);
      this.#stream.on("close", this.#streamCleanup);
      this.#stream.on("finish", this.#streamCleanup);

      // Make the actual request
      const response = await fetch(url, { ...opts });

      // Reset the pending reconnect flag
      this.#pendingReconnect = false;

      // If the request is successful, start listening for events
      if (response.ok) {
        this.#events.emit(WatchEvent.CONNECT, url.pathname);

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

            // Update the last seen time
            this.#lastSeenTime = Date.now();

            // If the watch is too old, remove the resourceVersion and reload the watch
            if (phase === WatchPhase.Error && payload.code === 410) {
              throw {
                name: "TooOld",
                message: this.#watchCfg.resourceVersion!,
              };
            }

            // If the event is a bookmark, emit the event and skip the callback
            if (phase === WatchPhase.Bookmark) {
              this.#events.emit(WatchEvent.BOOKMARK, payload);
            } else {
              this.#events.emit(WatchEvent.DATA, payload, phase);

              // Call the callback function with the parsed payload
              await this.#callback(payload, phase as WatchPhase);
            }

            // Update the resource version if the callback was successful
            this.#setResourceVersion(payload.metadata.resourceVersion);
          } catch (err) {
            if (err.name === "TooOld") {
              // Prevent any body events from firing
              body.removeAllListeners();

              // Reload the watch
              void this.#errHandler(err);
              return;
            }
            this.#events.emit(WatchEvent.DATA_ERROR, err);
          }
        });

        // Bind the body events
        body.on("error", this.#errHandler);
        body.on("close", this.#streamCleanup);
        body.on("finish", this.#streamCleanup);

        // Pipe the response body to the stream
        body.pipe(this.#stream);
      } else {
        throw new Error(`watch connect failed: ${response.status} ${response.statusText}`);
      }
    } catch (e) {
      void this.#errHandler(e);
    }
  };

  /**
   * Update the resource version.
   *
   * @param resourceVersion - the new resource version
   */
  #setResourceVersion = (resourceVersion?: string) => {
    this.#watchCfg.resourceVersion = resourceVersion;
    this.#events.emit(WatchEvent.RESOURCE_VERSION, resourceVersion);
  };

  /** Clear the resync timer and schedule a new one. */
  #checkResync = () => {
    // Ignore if the last seen time is not set
    if (this.#lastSeenTime === NONE) {
      return;
    }

    const now = Date.now();

    // If the last seen time is greater than the limit, trigger a resync
    if (this.#lastSeenTime == OVERRIDE || now - this.#lastSeenTime > this.#lastSeenLimit) {
      // Reset the last seen time to now to allow the resync to be called again in case of failure
      this.#lastSeenTime = now;

      // If there are more attempts, retry the watch (undefined is unlimited retries)
      if (this.#watchCfg.retryMax === undefined || this.#watchCfg.retryMax > this.#retryCount) {
        // Increment the retry count
        this.#retryCount++;

        if (this.#pendingReconnect) {
          // wait for the connection to be re-established
          this.#events.emit(WatchEvent.RECONNECT_PENDING);
        } else {
          this.#pendingReconnect = true;
          this.#events.emit(WatchEvent.RECONNECT, this.#retryCount);
          this.#streamCleanup();

          void this.#runner();
        }
      } else {
        // Otherwise, call the finally function if it exists
        this.#events.emit(
          WatchEvent.GIVE_UP,
          new Error(`Retry limit (${this.#watchCfg.retryMax}) exceeded, giving up`),
        );
        this.close();
      }
    }
  };

  /**
   * Handle errors from the stream.
   *
   * @param err - the error that occurred
   */
  #errHandler = async (err: Error) => {
    switch (err.name) {
      case "AbortError":
        clearInterval(this.#resyncTimer);
        this.#streamCleanup();
        this.#events.emit(WatchEvent.ABORT, err);
        return;

      case "TooOld":
        // Purge the resource version if it is too old
        this.#setResourceVersion(undefined);
        this.#events.emit(WatchEvent.OLD_RESOURCE_VERSION, err.message);
        break;

      default:
        this.#events.emit(WatchEvent.NETWORK_ERROR, err);
        break;
    }

    // Force a resync
    this.#lastSeenTime = OVERRIDE;
  };

  /** Cleanup the stream and listeners. */
  #streamCleanup = () => {
    if (this.#stream) {
      this.#stream.removeAllListeners();
      this.#stream.destroy();
    }
  };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import fetch from "node-fetch";
import readline from "readline";

import { GenericClass, LogFn } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

export type RetryCfg = {
  attempts: number;
  delaySeconds?: number;
  logFn?: LogFn;
  finally?: (e: Error) => void;
};

/**
 * Execute a watch on the specified resource.
 */
export async function ExecWatch<T extends GenericClass>(
  model: T,
  filters: Filters,
  callback: WatchAction<T>,
  retryCfg: RetryCfg = { attempts: 5 },
) {
  retryCfg.logFn?.({ model, filters, retryCfg }, "ExecWatch");

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

  try {
    // Make the actual request
    const response = await fetch(url, opts);

    // If the request is successful, start listening for events
    if (response.ok) {
      const { body } = response;

      // Create a readline interface to parse the stream
      const rl = readline.createInterface({
        input: response.body!,
        terminal: false,
      });

      rl.on("error", e => {
        retryCfg.logFn?.(e, "read error");
        body.removeAllListeners();
        void reload(e);
      });

      // Listen for events and call the callback function
      rl.on("line", line => {
        try {
          // Parse the event payload
          const { object: payload, type: phase } = JSON.parse(line) as {
            type: WatchPhase;
            object: InstanceType<T>;
          };

          // Call the callback function with the parsed payload
          void callback(payload, phase as WatchPhase);
        } catch (ignore) {
          // ignore parse errors
        }
      });
    } else {
      // If the request fails, throw an error
      const error = new Error(response.statusText) as Error & {
        statusCode: number | undefined;
      };
      error.statusCode = response.status;
      throw error;
    }
  } catch (e) {
    void reload(e);
  }

  // On unhandled errors, retry the watch
  async function reload(e: Error) {
    // If there are more attempts, retry the watch
    if (retryCfg.attempts > 0) {
      retryCfg.logFn?.(e, "retrying watch");

      retryCfg.attempts--;

      // Sleep for the specified delay or 5 seconds
      await new Promise(r => setTimeout(r, (retryCfg.delaySeconds ?? 5) * 1000));

      // Retry the watch after the delay
      await ExecWatch(model, filters, callback, { ...retryCfg });
    } else {
      // Otherwise, call the finally function if it exists
      if (retryCfg.finally) {
        retryCfg.finally(e);
      }
    }
  }

  return retryCfg;
}

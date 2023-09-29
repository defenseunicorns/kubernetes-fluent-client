// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Pepr Authors

import byline from "byline";
import fetch from "node-fetch";
import { GenericClass } from "../types";
import { Filters, WatchAction, WatchPhase } from "./types";
import { k8sCfg, pathBuilder } from "./utils";

/**
 * Execute a watch on the specified resource.
 */
export async function ExecWatch<T extends GenericClass>(
  model: T,
  filters: Filters,
  callback: WatchAction<T>,
) {
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

  const controller = new AbortController();
  opts.signal = controller.signal as AbortSignal;

  let doneCalled: boolean = false;
  const doneCallOnce = (err: any) => {
    if (!doneCalled) {
      controller.abort();
      doneCalled = true;
    }
  };

  const stream = byline.createStream();
  stream.on("error", doneCallOnce);
  stream.on("close", () => doneCallOnce(null));
  stream.on("finish", () => doneCallOnce(null));
  stream.on("data", line => {
    try {
      const { object: payload, type: phase } = JSON.parse(line) as {
        type: WatchPhase;
        object: InstanceType<T>;
      };
      void callback(payload, phase as WatchPhase);
    } catch (ignore) {
      // ignore parse errors
    }
  });

  await fetch(url, opts)
    .then(response => {
      if (response.status === 200) {
        response.body.on("error", doneCallOnce);
        response.body.on("close", () => doneCallOnce(null));
        response.body.on("finish", () => doneCallOnce(null));
        response.body.pipe(stream);
      } else {
        const error = new Error(response.statusText) as Error & {
          statusCode: number | undefined;
        };
        error.statusCode = response.status;
        throw error;
      }
    })
    .catch(doneCallOnce);

  return controller;
}

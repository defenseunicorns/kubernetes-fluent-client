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

  async function runner() {
    let doneCalled: boolean = false;
    const stream = byline.createStream();

    const errorCalled = (err: Error) => {
      if (!doneCalled) {
        doneCalled = true;
        const remoteClosedTheConnection = err?.message === "Premature close";
        const abortError = err?.name === "AbortError";
        if (remoteClosedTheConnection) {
          stream.removeAllListeners();
          void runner();
        } else if (abortError) {
          // do nothing, this is expected
        } else if (err) {
          // not expected
          throw err;
        }
        // do nothing if err is empty
      }
    };
    const closeCalled = () => {
      if (!doneCalled) {
        doneCalled = true;
        stream.removeAllListeners();
        void runner();
      }
    };

    const finishCalled = () => {
      doneCalled = true;
      stream.removeAllListeners();
    };
    stream.on("error", errorCalled);
    stream.on("close", closeCalled);
    stream.on("finish", finishCalled);
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
          response.body.on("error", errorCalled);
          response.body.on("close", closeCalled);
          response.body.on("finish", finishCalled);
          response.body.pipe(stream);
        } else {
          const error = new Error(response.statusText) as Error & {
            statusCode: number | undefined;
          };
          error.statusCode = response.status;
          throw error;
        }
      })
      .catch(errorCalled);
  }

  await runner();
  return controller;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import nock from "nock";
import { PassThrough } from "readable-stream";

import { K8s } from ".";
import { WatchEvent, kind } from "..";
import { WatchPhase } from "./types";
import { Watcher } from "./watch";

describe("Watcher", () => {
  const evtMock = jest.fn<(update: kind.Pod, phase: WatchPhase) => void>();

  const setupAndStartWatcher = (eventType: WatchEvent, handler: (...args: any[]) => void) => {
    watcher.events.on(eventType, handler);
    watcher.start().catch(jest.fn<(err: Error) => void>());
  };

  let watcher: Watcher<typeof kind.Pod>;

  beforeEach(() => {
    jest.resetAllMocks();
    watcher = K8s(kind.Pod).Watch(evtMock, {
      retryDelaySec: 1,
    });

    nock("http://jest-test:8080")
      .get("/api/v1/pods")
      .query({ watch: "true", allowWatchBookmarks: "true" })
      .reply(200, () => {
        const stream = new PassThrough();

        const resources = [
          { type: "ADDED", object: createMockPod(`pod-0`, `1`) },
          { type: "BOOKMARK", object: { metadata: { resourceVersion: "1" } } },
          { type: "MODIFIED", object: createMockPod(`pod-0`, `2`) },
        ];

        resources.forEach(resource => {
          stream.write(JSON.stringify(resource) + "\n");
        });

        stream.end();

        return stream;
      });
  });

  afterEach(() => {
    watcher.close();
  });

  it("should handle the CONNECT event", done => {
    setupAndStartWatcher(WatchEvent.CONNECT, () => {
      done();
    });
  });

  it("should handle the DATA event", done => {
    setupAndStartWatcher(WatchEvent.DATA, (pod, phase) => {
      expect(pod.metadata?.name).toEqual(`pod-0`);
      expect(phase).toEqual(WatchPhase.Added);
      done();
    });
  });

  it("should handle the BOOKMARK event", done => {
    setupAndStartWatcher(WatchEvent.BOOKMARK, bookmark => {
      expect(bookmark.metadata?.resourceVersion).toEqual("1");
      done();
    });
  });

  it("should handle the NETWORK_ERROR event", done => {
    nock.cleanAll();
    nock("http://jest-test:8080")
      .get("/api/v1/pods")
      .query({ watch: "true", allowWatchBookmarks: "true" })
      .replyWithError("Something bad happened");

    setupAndStartWatcher(WatchEvent.NETWORK_ERROR, error => {
      expect(error.message).toEqual(
        "request to http://jest-test:8080/api/v1/pods?watch=true&allowWatchBookmarks=true failed, reason: Something bad happened",
      );
      done();
    });
  });

  it("should handle the RECONNECT event", done => {
    nock.cleanAll();
    nock("http://jest-test:8080")
      .get("/api/v1/pods")
      .query({ watch: "true", allowWatchBookmarks: "true" })
      .replyWithError("Something bad happened");

    setupAndStartWatcher(WatchEvent.RECONNECT, error => {
      expect(error.message).toEqual(
        "request to http://jest-test:8080/api/v1/pods?watch=true&allowWatchBookmarks=true failed, reason: Something bad happened",
      );
      done();
    });
  });
});

/**
 * Creates a mock pod object
 *
 * @param name The name of the pod
 * @param resourceVersion The resource version of the pod
 * @returns A mock pod object
 */
function createMockPod(name: string, resourceVersion: string): kind.Pod {
  return {
    kind: "Pod",
    apiVersion: "v1",
    metadata: {
      name: name,
      resourceVersion: resourceVersion,
      // ... other metadata fields
    },
    spec: {
      containers: [
        {
          name: "nginx",
          image: "nginx:1.14.2",
          ports: [
            {
              containerPort: 80,
              protocol: "TCP",
            },
          ],
        },
      ],
    },
    status: {
      // ... pod status
    },
  };
}

// const watcher = K8s(kind.Pod).Watch((d, phase) => {
//   console.log(`>-----> ${d.metadata?.name} (${d.metadata?.resourceVersion}) is ${phase}`);
// });

// watcher.events.on(WatchEvent.CONNECT, () => console.log("connected"));

// watcher.events.on(WatchEvent.DATA, (_pod, phase) => {
//   console.log("data received", phase);
// });

// watcher.events.on(WatchEvent.BOOKMARK, bookmark => console.log(`bookmark:`, bookmark));

// watcher.events.on(WatchEvent.NETWORK_ERROR, e => console.error(`network error:`, e));

// watcher.events.on(WatchEvent.RECONNECT, e => console.error(`reconnecting:`, e));

// watcher.events.on(WatchEvent.GIVE_UP, e => console.error(`giving up:`, e));

// watcher.events.on(WatchEvent.ABORT, e => console.error(`aborting:`, e));

// watcher.events.on(WatchEvent.RESYNC, e => console.error(`resyncing:`, e));

// watcher.events.on(WatchEvent.RESOURCE_VERSION, rv => console.log(`resource version:`, rv));

// watcher.events.on(WatchEvent.OLD_RESOURCE_VERSION, rv => console.log(`old resource version:`, rv));

// watcher.events.on(WatchEvent.DATA_ERROR, e => console.error(`data error:`, e));

// watcher.events.on(WatchEvent.RECONNECT_PENDING, () => console.log(`reconnect pending`));

// watcher
//   .start()
//   .then(() => {
//     console.log("started");
//     console.log("cache id: ", watcher.id);
//   })
//   .catch(e => console.error(`failed to start:`, e));

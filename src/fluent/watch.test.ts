/* eslint-disable @typescript-eslint/no-explicit-any */

import { KubeConfig } from "@kubernetes/client-node";
import type { RequestOptions } from "https";
import type { HeadersInit, RequestInit } from "node-fetch";
import { PassThrough } from "stream";
import { Interceptable, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchEvent, kind } from "../index.js";
import { K8s } from "./index.js";
import { WatchPhase } from "./shared-types.js";
import { Watcher } from "./watch.js";

let mockClient: Interceptable;
describe("Watcher", () => {
  const evtMock = vi.fn<(update: kind.Pod, phase: WatchPhase) => void>();
  const errMock = vi.fn<(err: Error) => void>();

  const setupAndStartWatcher = (eventType: WatchEvent, handler: (...args: any[]) => void) => {
    watcher.events.on(eventType, handler);
    watcher.start().catch(errMock);
  };

  let watcher: Watcher<typeof kind.Pod>;
  let mockAgent: MockAgent;

  beforeEach(() => {
    vi.resetAllMocks();

    vi.spyOn(KubeConfig.prototype, "getCurrentCluster").mockReturnValue({
      name: "mock-cluster",
      server: "https://jest-test:8080",
      skipTLSVerify: true,
    });

    vi.spyOn(KubeConfig.prototype, "applyToFetchOptions").mockImplementation(
      async (opts: RequestOptions): Promise<RequestInit> => {
        const safeHeaders: HeadersInit = {
          ...((opts.headers as Record<string, string>) ?? {}),
          Authorization: "Bearer fake-token",
          "Content-Type": "application/json",
          "User-Agent": "kubernetes-fluent-client",
        };

        return {
          method: opts.method,
          headers: safeHeaders,
        };
      },
    );

    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    mockClient = mockAgent.get("https://jest-test:8080");

    // Setup MockAgent from undici
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    mockClient = mockAgent.get("https://jest-test:8080");

    // Mock list operation
    mockClient
      .intercept({
        path: "/api/v1/pods",
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "10",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: "/api/v1/pods?watch=true&resourceVersion=10",
        method: "GET",
      })
      // @ts-expect-error - we are using the response.body as Readable stream
      .reply(200, (_, res) => {
        const stream = new PassThrough();

        const resources = [
          { type: "ADDED", object: createMockPod(`pod-0`, `1`) },
          { type: "MODIFIED", object: createMockPod(`pod-0`, `2`) },
        ];

        resources.forEach(resource => {
          stream.write(JSON.stringify(resource) + "\n");
        });

        stream.end();
        res.body = stream;
      });
  });

  afterEach(async () => {
    watcher.close();
    try {
      await mockAgent.close();
    } catch (error) {
      console.error("Error closing mock agent", error);
    }
  });

  it("should watch named resources", () => {
    mockClient
      .intercept({
        path: "/api/v1/namespaces/tester/pods?fieldSelector=metadata.name=demo",
        method: "GET",
      })
      .reply(200, createMockPod(`demo`, `15`));

    mockClient
      .intercept({
        path: "/api/v1/namespaces/tester/pods?watch=true&fieldSelector=metadata.name=demo&resourceVersion=15",
        method: "GET",
      })
      .reply(200);

    watcher = K8s(kind.Pod, { name: "demo" }).InNamespace("tester").Watch(evtMock);

    setupAndStartWatcher(WatchEvent.CONNECT, () => {});
  });

  it("should handle resource version is too old", () => {
    mockClient
      .intercept({
        path: "/api/v1/pods",
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "25",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: "/api/v1/pods?watch=true&resourceVersion=25",
        method: "GET",
      })
      // @ts-expect-error - need res for the body
      .reply(200, (_, res) => {
        const stream = new PassThrough();
        stream.write(
          JSON.stringify({
            type: "ERROR",
            object: {
              kind: "Status",
              apiVersion: "v1",
              metadata: {},
              status: "Failure",
              message: "too old resource version: 123 (391079)",
              reason: "Gone",
              code: 410,
            },
          }) + "\n",
        );

        stream.end();
        res.body = stream;
      });

    watcher = K8s(kind.Pod).Watch(evtMock);

    setupAndStartWatcher(WatchEvent.OLD_RESOURCE_VERSION, res => {
      expect(res).toEqual("25");
    });
  });

  it("should call the event handler for each event", () => {
    watcher = K8s(kind.Pod).Watch(evt => {
      expect(evt.metadata?.name).toEqual(`pod-0`);
    });

    watcher.start().catch(errMock);
  });

  it("should handle the CONNECT event", () => {
    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncDelaySec: 1,
    });
    setupAndStartWatcher(WatchEvent.CONNECT, () => {});
  });

  it("should handle the DATA event", () => {
    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncDelaySec: 1,
    });
    setupAndStartWatcher(WatchEvent.DATA, (pod, phase) => {
      expect(pod.metadata?.name).toEqual(`pod-0`);
      expect(phase).toEqual(WatchPhase.Added);
    });
  });

  it("should handle the RECONNECT event on an error", () => {
    mockClient = mockAgent.get("https://jest-test:8080");

    mockClient
      .intercept({
        path: "/api/v1/pods",
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "65",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: "/api/v1/pods?watch=true&resourceVersion=65",
        method: "GET",
      })
      .replyWithError(new Error("Something bad happened"));

    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncDelaySec: 0.01,
    });

    setupAndStartWatcher(WatchEvent.RECONNECT, count => {
      expect(count).toEqual(1);
    });
  });

  it("should perform a resync after the resync interval", () => {
    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 0.01,
    });

    setupAndStartWatcher(WatchEvent.RECONNECT, count => {
      expect(count).toEqual(1);
    });
  });

  it("should handle the GIVE_UP event", () => {
    mockClient
      .intercept({
        path: "/api/v1/pods",
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "75",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: "/api/v1/pods?watch=true&resourceVersion=75",
        method: "GET",
      })
      .replyWithError(new Error("Something bad happened"));

    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncFailureMax: 1,
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 1,
    });

    setupAndStartWatcher(WatchEvent.GIVE_UP, error => {
      expect(error.message).toContain("Retry limit (1) exceeded, giving up");
    });
  });

  it("should handle the NETWORK_ERROR event", () => {
    mockClient
      .intercept({
        path: "/api/v1/pods",
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "45",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: "/api/v1/pods?watch=true&resourceVersion=45",
        method: "GET",
      })
      .replyWithError(new Error("Something bad happened"));

    watcher = K8s(kind.Pod).Watch(evtMock, {
      resyncDelaySec: 1,
    });

    setupAndStartWatcher(WatchEvent.NETWORK_ERROR, error => {
      expect(error.message).toEqual(
        "request to https://jest-test:8080/api/v1/pods?watch=true&resourceVersion=45 failed, reason: Something bad happened",
      );
    });
  });

  it("should trigger reconnect after non-OK watch response", async () => {
    const namespace = "reconnect-test";

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "90",
        },
        items: [createMockPod(`pod-0`, `1`)],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=90`,
        method: "GET",
      })
      .reply(500, {
        kind: "Status",
        apiVersion: "v1",
        metadata: {},
        status: "Failure",
        message: "internal error",
        reason: "InternalError",
        code: 500,
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(evtMock, {
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 1,
      resyncFailureMax: 2,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("did not reconnect after non-OK watch response")),
        2500,
      );

      watcher.events.on(WatchEvent.RECONNECT, count => {
        try {
          expect(count).toEqual(1);
          clearTimeout(timeout);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      watcher.start().catch(reject);
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
      uid: "random-uid",
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

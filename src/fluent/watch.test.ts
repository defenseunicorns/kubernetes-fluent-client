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

// Strip the custom `dispatcher` from k8sCfg return values so that fetch
// calls route through the global MockAgent instead of a real undici Agent.
// Without this, the Agent from getHTTPSAgent bypasses the mock entirely.
// Uses a plain function (not vi.fn) so vi.resetAllMocks() doesn't wipe it.
vi.mock("./utils.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./utils.js")>();
  return {
    ...actual,
    k8sCfg: async (...args: Parameters<typeof actual.k8sCfg>) => {
      const result = await actual.k8sCfg(...args);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { dispatcher, ...opts } = result.opts as Record<string, unknown>;
      return { ...result, opts };
    },
  };
});

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

  it("should clear continueToken on the last pagination page and not re-request with stale token", async () => {
    // Verifies that a paginated list (page 1 returns a continue token,
    // page 2 omits it) completes without re-requesting using the stale
    // continue token from page 1.

    const namespace = "pagination-test";
    let staleTokenReused = false;
    let listCount = 0;

    // Page 1: returns a continue token, indicating more pages exist.
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "100",
          continue: "page2-token",
        },
        items: [createMockPod("pod-page1", "1")],
      });

    // Page 2 (last page): no continue token in metadata.
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?continue=page2-token`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: {
          resourceVersion: "101",
        },
        items: [createMockPod("pod-page2", "2")],
      });

    // Canary: if the stale continue token were reused, this interceptor
    // would be consumed and staleTokenReused would flip to true.
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?continue=page2-token`,
        method: "GET",
      })
      .reply(200, () => {
        staleTokenReused = true;
        return {
          kind: "PodList",
          apiVersion: "v1",
          metadata: { resourceVersion: "102" },
          items: [],
        };
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(evtMock, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
    });

    // Wait for list pagination to complete. Each LIST event corresponds to
    // one page of results. We expect exactly 2 pages.
    await new Promise<void>(resolve => {
      watcher.events.on(WatchEvent.LIST, () => {
        listCount++;
        if (listCount >= 2) {
          resolve();
        }
      });
      watcher.start().catch(() => {});
    });

    // Both pages were listed successfully.
    expect(listCount).toBe(2);
    // The stale continue token from page 1 was NOT reused after page 2.
    expect(staleTokenReused).toBe(false);
  });

  it("should not cache items when the callback fails", async () => {
    const namespace = "callback-fail-test";
    let callCount = 0;

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [createMockPod("fail-pod", "1", "fail-pod-uid")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("callback failed");
        }
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
    });

    const dataErrors: Error[] = [];
    watcher.events.on(WatchEvent.DATA_ERROR, (err: Error) => dataErrors.push(err));

    await watcher.start();

    // Callback was called once and failed
    expect(callback).toHaveBeenCalledTimes(1);
    expect(dataErrors.length).toBe(1);
    expect(dataErrors[0].message).toBe("callback failed");
  });

  it("should not emit DATA when callback throws", async () => {
    const namespace = "data-no-emit-test";

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [createMockPod("fail-pod", "1", "data-fail-uid")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockRejectedValue(new Error("callback throws"));

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
    });

    const dataEvents: kind.Pod[] = [];
    const dataErrors: Error[] = [];
    watcher.events.on(WatchEvent.DATA, (pod: kind.Pod) => dataEvents.push(pod));
    watcher.events.on(WatchEvent.DATA_ERROR, (err: Error) => dataErrors.push(err));

    await watcher.start();

    // DATA should NOT have been emitted since callback threw
    expect(dataEvents.length).toBe(0);
    // DATA_ERROR should have been emitted
    expect(dataErrors.length).toBe(1);
  });

  it("should retry failed items on next relist via reconnect", async () => {
    const namespace = "relist-retry-test";
    let callCount = 0;
    const listResponse = (rv: string) => ({
      kind: "PodList",
      apiVersion: "v1",
      metadata: { resourceVersion: rv },
      items: [createMockPod("retry-pod", "1", "retry-pod-uid")],
    });

    // Provide multiple list/watch interceptors to handle reconnect cycles.
    // The first list processes the item (callback fails), subsequent lists
    // re-deliver it (callback succeeds) because the item was never cached.
    for (let i = 0; i < 5; i++) {
      mockClient
        .intercept({ path: `/api/v1/namespaces/${namespace}/pods`, method: "GET" })
        .reply(200, listResponse(String(50 + i)));

      mockClient
        .intercept({
          path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
          method: "GET",
        })
        .replyWithError(new Error("stream error"));
    }

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("callback failed first time");
        }
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 0.01,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for retry callback")),
        10000,
      );

      watcher.events.on(WatchEvent.LIST, () => {
        if (callCount >= 2) {
          clearTimeout(timeout);
          resolve();
        }
      });

      watcher.start().catch(reject);
    });

    // Callback was called at least twice: first failed (item not cached), then retried on reconnect
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("should skip re-processing cached items with unchanged resource version on relist", async () => {
    const namespace = "cache-success-test";

    // First list: item exists
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [createMockPod("cached-pod", "1", "cached-pod-uid")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    // Second list (relist): same item at same resourceVersion
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "51" },
        items: [createMockPod("cached-pod", "1", "cached-pod-uid")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=51`,
        method: "GET",
      })
      .reply(200);

    const callback = vi.fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>();

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
      relistIntervalSec: 0.1,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for second relist")),
        5000,
      );

      let listCount = 0;
      watcher.events.on(WatchEvent.LIST, () => {
        listCount++;
        if (listCount >= 2) {
          // Give a brief moment for processing, then resolve
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 100);
        }
      });

      watcher.start().catch(reject);
    });

    // Callback should only be called once (first list adds it, second list sees same RV and skips)
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("should emit LIST_ERROR and skip callback when 429 exhausts retries", async () => {
    const namespace = "list-429-test";

    // List returns 429 with retry-after header
    for (let i = 0; i <= 5; i++) {
      mockClient
        .intercept({
          path: `/api/v1/namespaces/${namespace}/pods`,
          method: "GET",
        })
        .reply(429, { message: "Too Many Requests" }, { headers: { "retry-after": "0" } });
    }

    // Watch mock (may not be reached)
    mockClient
      .intercept({
        path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
        method: "GET",
      })
      .reply(200);

    const listErrors: Error[] = [];
    const callback = vi.fn();

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 60,
      lastSeenLimitSeconds: 60,
    });

    watcher.events.on(WatchEvent.LIST_ERROR, (err: Error) => listErrors.push(err));

    await watcher.start();

    // LIST_ERROR should have been emitted
    expect(listErrors.length).toBeGreaterThan(0);
    // Callback should not have been called (list failed, no items processed)
    expect(callback).not.toHaveBeenCalled();
  });

  it("should await process calls during list operations", async () => {
    const namespace = "await-process-test";
    const processOrder: string[] = [];

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [createMockPod("pod-a", "1", "uid-a"), createMockPod("pod-b", "1", "uid-b")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async pod => {
        // Simulate async work
        await new Promise(r => setTimeout(r, 10));
        processOrder.push(pod.metadata!.name!);
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 60,
      lastSeenLimitSeconds: 60,
    });

    const dataErrors: Error[] = [];
    watcher.events.on(WatchEvent.DATA_ERROR, (err: Error) => dataErrors.push(err));

    await watcher.start();

    // Both callbacks completed (awaited, not fire-and-forget)
    expect(callback).toHaveBeenCalledTimes(2);
    expect(processOrder).toEqual(["pod-a", "pod-b"]);
    // No unhandled errors
    expect(dataErrors).toEqual([]);
  });

  it("should retry delete when delete callback fails", async () => {
    const namespace = "delete-retry-test";
    let deleteCallCount = 0;

    // First list: item exists, callback succeeds (caches it)
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [createMockPod("del-pod", "1", "del-pod-uid")],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    // Second list (relist): item is GONE, triggering delete. Callback fails.
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "51" },
        items: [], // item removed
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=51`,
        method: "GET",
      })
      .reply(200);

    // Third list (relist): item still GONE. Delete callback succeeds this time.
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "52" },
        items: [],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=52`,
        method: "GET",
      })
      .reply(200);

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async (_pod, phase) => {
        if (phase === WatchPhase.Deleted) {
          deleteCallCount++;
          if (deleteCallCount === 1) {
            throw new Error("delete callback failed");
          }
        }
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
      relistIntervalSec: 0.1,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for delete retry")),
        5000,
      );

      let listCount = 0;
      watcher.events.on(WatchEvent.LIST, () => {
        listCount++;
        if (listCount >= 3) {
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 200);
        }
      });

      watcher.start().catch(reject);
    });

    // Delete callback was called at least twice (first failed, second succeeded)
    expect(deleteCallCount).toBeGreaterThanOrEqual(2);
  });

  it("should trigger faster resync when callback fails during list", async () => {
    const namespace = "callback-fail-resync-test";

    // Provide list/watch interceptors for multiple reconnect cycles
    for (let i = 0; i < 5; i++) {
      mockClient
        .intercept({ path: `/api/v1/namespaces/${namespace}/pods`, method: "GET" })
        .reply(200, {
          kind: "PodList",
          apiVersion: "v1",
          metadata: { resourceVersion: String(50 + i) },
          items: [createMockPod("fail-pod", "1", "fail-resync-uid")],
        });

      mockClient
        .intercept({
          path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
          method: "GET",
        })
        .reply(200);
    }

    let callCount = 0;
    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("callback fails");
        }
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 0.01,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for resync after callback failure")),
        10000,
      );

      watcher.events.on(WatchEvent.RECONNECT, () => {
        clearTimeout(timeout);
        resolve();
      });

      watcher.start().catch(reject);
    });

    // A RECONNECT was triggered because the callback failure caused #list to return false
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("should not run concurrent list operations", async () => {
    const namespace = "concurrent-list-test";
    let concurrentLists = 0;
    let maxConcurrentLists = 0;

    // Provide many list/watch interceptors for reconnect cycles
    for (let i = 0; i < 10; i++) {
      mockClient
        .intercept({ path: `/api/v1/namespaces/${namespace}/pods`, method: "GET" })
        .reply(200, {
          kind: "PodList",
          apiVersion: "v1",
          metadata: { resourceVersion: String(50 + i) },
          items: [createMockPod("slow-pod", "1", "slow-pod-uid")],
        });

      mockClient
        .intercept({
          path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
          method: "GET",
        })
        .reply(200);
    }

    const callback = vi
      .fn<(pod: kind.Pod, phase: WatchPhase) => Promise<void>>()
      .mockImplementation(async () => {
        concurrentLists++;
        maxConcurrentLists = Math.max(maxConcurrentLists, concurrentLists);
        // Slow callback to widen the race window
        await new Promise(r => setTimeout(r, 100));
        concurrentLists--;
      });

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 5,
      lastSeenLimitSeconds: 30,
      relistIntervalSec: 0.05, // Very short relist interval to trigger overlap attempts
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for relist cycles")),
        5000,
      );

      let listCount = 0;
      watcher.events.on(WatchEvent.LIST, () => {
        listCount++;
        if (listCount >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });

      watcher.start().catch(reject);
    });

    // At no point should more than one list operation have been processing concurrently
    expect(maxConcurrentLists).toBeLessThanOrEqual(1);
  });

  it("should trigger faster resync when relist timer list fails", async () => {
    const namespace = "relist-fail-resync-test";

    // First list (from #watch) succeeds
    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods`,
        method: "GET",
      })
      .reply(200, {
        kind: "PodList",
        apiVersion: "v1",
        metadata: { resourceVersion: "50" },
        items: [],
      });

    mockClient
      .intercept({
        path: `/api/v1/namespaces/${namespace}/pods?watch=true&resourceVersion=50`,
        method: "GET",
      })
      .reply(200);

    // Relist (from timer) fails with 500
    for (let i = 0; i < 5; i++) {
      mockClient
        .intercept({
          path: `/api/v1/namespaces/${namespace}/pods`,
          method: "GET",
        })
        .reply(500, { message: "Internal Server Error" });

      mockClient
        .intercept({
          path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
          method: "GET",
        })
        .reply(200);
    }

    const callback = vi.fn();

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 0.01,
      lastSeenLimitSeconds: 0.01,
      relistIntervalSec: 0.05,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for reconnect after relist failure")),
        5000,
      );

      watcher.events.on(WatchEvent.RECONNECT, () => {
        clearTimeout(timeout);
        resolve();
      });

      watcher.start().catch(reject);
    });
  });

  it("should stop pagination at maximum page limit", async () => {
    const namespace = "max-pages-test";

    // Mock 12 pages of results, each with a continue token (except the last)
    for (let i = 0; i < 12; i++) {
      mockClient
        .intercept({
          path: new RegExp(`/api/v1/namespaces/${namespace}/pods`),
          method: "GET",
        })
        .reply(200, {
          kind: "PodList",
          apiVersion: "v1",
          metadata: {
            resourceVersion: String(50 + i),
            ...(i < 11 ? { continue: `page-${i + 1}-token` } : {}),
          },
          items: [createMockPod(`pod-page-${i}`, "1", `uid-page-${i}`)],
        });
    }

    mockClient
      .intercept({
        path: new RegExp(`/api/v1/namespaces/${namespace}/pods\\?watch=true`),
        method: "GET",
      })
      .reply(200);

    const listErrors: string[] = [];
    const callback = vi.fn();

    watcher = K8s(kind.Pod).InNamespace(namespace).Watch(callback, {
      resyncDelaySec: 60,
      lastSeenLimitSeconds: 60,
    });

    watcher.events.on(WatchEvent.LIST_ERROR, (err: Error) =>
      listErrors.push(err?.message ?? String(err)),
    );

    await watcher.start();

    // Should have hit the pagination limit
    const paginationError = listErrors.find(msg => msg.includes("Maximum pagination limit"));
    expect(paginationError).toBeDefined();
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
 * @param uid The UID of the pod
 * @returns A mock pod object
 */
function createMockPod(
  name: string,
  resourceVersion: string,
  uid: string = crypto.randomUUID(),
): kind.Pod {
  return {
    kind: "Pod",
    apiVersion: "v1",
    metadata: {
      name: name,
      resourceVersion: resourceVersion,
      uid,
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

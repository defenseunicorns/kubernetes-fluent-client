import { K8s, kind } from "../src";
import { applyWithOwnership, deleteAllByOwnership } from "../src/test/index.js";
import { setupKubernetesPreflight } from "../src/test/vitest/setup.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WatchPhase } from "../src/fluent/shared-types.js";
import { WatchEvent } from "../src";
import type { EventEmitter } from "node:events";
import { e2eOwnership, waitForRunningStatusPhase } from "./support.js";
const namespace = `kfc-watch`;
const recoveryTimeoutMs = 15000;
const ownership = e2eOwnership("kfc-e2e-watch");

/**
 * Wait for the watcher to see the pod, emit reconnect, then establish a replacement watch.
 *
 * @param events - watcher event source
 * @param seenPodPromise - resolves after callback sees the listed pod
 * @returns promise that resolves after reconnect recovery is proven
 */
function watcherRecoveryPromise(events: EventEmitter, seenPodPromise: Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    let initialConnectSeen = false;
    let podSeen = false;
    let reconnectSeen = false;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      events.off(WatchEvent.CONNECT, onConnect);
      events.off(WatchEvent.RECONNECT, onReconnect);
    };

    const finish = (err?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (err) {
        reject(err);
        return;
      }

      resolve();
    };

    const failOutOfOrder = (message: string) => {
      finish(new Error(`Watcher recovery events out of order: ${message}`));
    };

    const timeout = setTimeout(() => {
      const state = [
        initialConnectSeen && "initial CONNECT",
        podSeen && "pod callback",
        reconnectSeen && "RECONNECT",
      ]
        .filter(Boolean)
        .join(", ");

      finish(
        new Error(
          `Timed out waiting for watcher lifecycle; observed ${state || "no recovery events"}`,
        ),
      );
    }, recoveryTimeoutMs);

    const onConnect = () => {
      if (!initialConnectSeen) {
        initialConnectSeen = true;
        return;
      }

      if (!reconnectSeen) {
        failOutOfOrder("replacement CONNECT occurred before RECONNECT");
        return;
      }

      finish();
    };

    const onReconnect = (num: number) => {
      try {
        expect(num).toBe(1);
      } catch (err) {
        finish(err);
        return;
      }

      if (!initialConnectSeen) {
        failOutOfOrder("RECONNECT occurred before initial CONNECT");
        return;
      }

      if (!podSeen) {
        failOutOfOrder("RECONNECT occurred before callback saw pod");
        return;
      }

      reconnectSeen = true;
    };

    events.on(WatchEvent.CONNECT, onConnect);
    events.on(WatchEvent.RECONNECT, onReconnect);

    withTimeout(seenPodPromise, "callback to see pod", recoveryTimeoutMs)
      .then(() => {
        podSeen = true;
      })
      .catch(finish);
  });
}

/**
 * Reject when the watcher emits any failure event relevant to this test.
 *
 * @param events - watcher event source
 * @returns promise that rejects with the emitted failure
 */
function watcherFailurePromise(events: EventEmitter): Promise<never> {
  return Promise.race([
    onceEvent<Error>(events, WatchEvent.DATA_ERROR).then(err => {
      throw err;
    }),
    onceEvent<Error>(events, WatchEvent.LIST_ERROR).then(err => {
      throw err;
    }),
    onceEvent<Error>(events, WatchEvent.WATCH_ERROR).then(err => {
      throw err;
    }),
    onceEvent<Error>(events, WatchEvent.NETWORK_ERROR).then(err => {
      throw err;
    }),
  ]);
}

/**
 * Add a timeout to an existing promise.
 *
 * @param promise - promise to bound
 * @param label - label used in timeout errors
 * @param timeoutMs - timeout in milliseconds
 * @returns original promise result
 */
function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    }),
  ]);
}

/**
 * Resolve when an event is emitted.
 *
 * @param events - event source
 * @param event - event name
 * @returns emitted event payload
 */
function onceEvent<T>(events: EventEmitter, event: string): Promise<T> {
  return new Promise<T>(resolve => {
    events.once(event, resolve);
  });
}

describe("watcher e2e", () => {
  setupKubernetesPreflight();

  beforeAll(async () => {
    await applyWithOwnership(
      kind.Namespace,
      { metadata: { name: namespace } },
      {
        ...ownership,
        force: true,
      },
    );
    await applyWithOwnership(
      kind.Pod,
      {
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      },
      { ...ownership, force: true },
    );
    await waitForRunningStatusPhase(kind.Pod, {
      metadata: { name: namespace, namespace },
    });
  }, 80000);

  afterAll(async () => {
    await deleteAllByOwnership(kind.Namespace, { ...ownership, waitForDeletion: true });
  }, 60000);

  it("should handle the RECONNECT event", async () => {
    let seenPodResolve!: () => void;
    const seenPodPromise = new Promise<void>(resolve => {
      seenPodResolve = resolve;
    });
    const watcher = K8s(kind.Pod)
      .InNamespace(namespace)
      .Watch(
        po => {
          expect(po.metadata!.name).toBe(namespace);
          seenPodResolve();
        },
        {
          resyncDelaySec: 0.01,
          lastSeenLimitSeconds: 0.01,
        },
      );

    try {
      const watcherErrorPromise = watcherFailurePromise(watcher.events);
      const recoveryPromise = watcherRecoveryPromise(watcher.events, seenPodPromise);

      void watcher.start();
      await Promise.race([recoveryPromise, watcherErrorPromise]);
    } finally {
      watcher.close();
    }
  }, 90000);

  it("should watch named resources", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(po => {
          expect(po.metadata!.name).toBe(namespace);
          watcher.close();
          resolve();
        });
      void watcher.start();
    });
  });

  it("should call the event handler for each event", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch((po, evt) => {
          expect(po.metadata!.name).toBe(namespace);
          expect(evt).toBe(WatchPhase.Added);
          watcher.close();
          resolve();
        });
      void watcher.start();
    });
  });

  it("should handle the CONNECT event", async () => {
    const watcher = K8s(kind.Pod)
      .InNamespace(namespace)
      .Watch(po => {
        expect(po.metadata!.name).toBe(namespace);
      });

    const connectPromise = new Promise<void>(resolve => {
      watcher.events.once(WatchEvent.CONNECT, path => {
        expect(path).toBe("/api/v1/namespaces/kfc-watch/pods");
        resolve();
      });
    });

    void watcher.start();
    await connectPromise;
    watcher.close();
  });

  it("should handle the DATA event", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(po => {
          expect(po.metadata!.name).toBe(namespace);
        });
      void watcher.start();

      watcher.events.on(WatchEvent.DATA, po => {
        expect(po.metadata.name).toBe(namespace);
      });
      watcher.close();
      resolve();
    });
  });

  it("should handle the GIVE_UP event", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(
          po => {
            expect(po.metadata!.name).toBe(namespace);
          },
          {
            resyncDelaySec: 1,
            resyncFailureMax: 1,
          },
        );
      void watcher.start();

      watcher.events.on(WatchEvent.GIVE_UP, err => {
        expect(err).toBeDefined();
      });
      watcher.close();
      resolve();
    });
  });

  it("should handle the GIVE_UP event", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(
          po => {
            expect(po.metadata!.name).toBe(namespace);
          },
          {
            resyncDelaySec: 1,
            resyncFailureMax: 1,
          },
        );
      void watcher.start();

      watcher.events.on(WatchEvent.GIVE_UP, err => {
        expect(err).toBeDefined();
      });
      watcher.close();
      resolve();
    });
  });

  it("should perform a resync after the resync interval", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(
          po => {
            expect(po.metadata!.name).toBe(namespace);
          },
          {
            resyncDelaySec: 1,
            resyncFailureMax: 1,
          },
        );
      void watcher.start();

      watcher.events.on(WatchEvent.RECONNECT, num => {
        expect(num).toBe(1);
      });

      watcher.close();
      resolve();
    });
  });
});

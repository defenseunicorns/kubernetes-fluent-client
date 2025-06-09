import { GenericClass, K8s, kind, KubernetesObject } from "../src";
import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { WatchPhase } from "../src/fluent/shared-types.js";
import { WatchEvent } from "../src";
const namespace = `kfc-watch`;
describe("watcher e2e", () => {
  beforeAll(async () => {
    try {
      await K8s(kind.Namespace).Apply(
        { metadata: { name: namespace } },
        {
          force: true,
        },
      );
      await K8s(kind.Pod).Apply(
        {
          metadata: { name: namespace, namespace, labels: { app: "nginx" } },
          spec: { containers: [{ name: "nginx", image: "nginx" }] },
        },
        { force: true },
      );
      await waitForRunningStatusPhase(kind.Pod, {
        metadata: { name: namespace, namespace },
      });
    } catch (e) {
      expect(e).toBeUndefined();
    }
  }, 80000);

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

  it("should handle the RECONNECT event", () => {
    return new Promise<void>(resolve => {
      const watcher = K8s(kind.Pod)
        .InNamespace(namespace)
        .Watch(po => {
          expect(po.metadata!.name).toBe(namespace);
        });
      void watcher.start();

      watcher.events.on(WatchEvent.RECONNECT, num => {
        expect(num).toBe(1);
      });
      execSync(`k3d cluster stop kfc-dev`, { stdio: "inherit" });
      execSync(`k3d cluster start kfc-dev`, { stdio: "inherit" });
      watcher.close();
      resolve();
    });
  }, 90000);

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

/**
 * sleep for a given number of seconds
 *
 * @param seconds - number of seconds to sleep
 * @returns Promise<void>
 */
export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Wait for the status phase to be Running
 *
 * @param k - GenericClass
 * @param o - KubernetesObject
 * @returns Promise<void>
 */
export async function waitForRunningStatusPhase(
  k: GenericClass,
  o: KubernetesObject,
): Promise<void> {
  const object = await K8s(k)
    .InNamespace(o.metadata?.namespace || "")
    .Get(o.metadata?.name || "");

  if (object.status?.phase !== "Running") {
    await sleep(2);
    return waitForRunningStatusPhase(k, o);
  }
}

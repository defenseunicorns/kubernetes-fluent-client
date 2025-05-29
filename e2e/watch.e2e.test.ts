import {
  GenericClass,
  K8s,
  kind,
  KubernetesObject,
} from "kubernetes-fluent-client";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { execSync } from "child_process";
import { WatchPhase } from "../src/fluent/types";
import { WatchEvent } from "../src";
jest.unmock("@kubernetes/client-node");
const namespace = `kfc-watch`;
describe("watcher e2e", () => {
  beforeAll(async () => {
    try {
      await K8s(kind.Namespace).Apply({ metadata: { name: namespace } }, {
        force: true,
      });
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

  it("should watch named resources", (done) => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po) => {
      expect(po.metadata!.name).toBe(namespace);
      watcher.close();
      done();
    });
    watcher.start();
  });

  it("should call the event handler for each event", (done) => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po, evt) => {
      expect(po.metadata!.name).toBe(namespace);
      expect(evt).toBe(WatchPhase.Added);
      watcher.close();
      done();
    });
    watcher.start();
  });

  it("should return the cache id", () => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po) =>
      console.log(po.metadata!.name)
    );
    expect(watcher.getCacheID()).toBeDefined();
    watcher.close();
  });

  it("should handle the CONNECT event", (done) => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po) => {
      expect(po.metadata!.name).toBe(namespace);
    });
    watcher.start();
    watcher.events.on(WatchEvent.CONNECT, (path) => {
      expect(path).toBe("/api/v1/namespaces/kfc-watch/pods");
    });
    watcher.close();
    done();
  });

  it("should handle the RECONNECT event", (done) => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po) => {
      expect(po.metadata!.name).toBe(namespace);
    });
    watcher.start();

    watcher.events.on(WatchEvent.RECONNECT, (num) => {
      expect(num).toBe(1);
    });
    execSync(`k3d cluster stop kfc-dev`, { stdio: "inherit" });
    execSync(`k3d cluster start kfc-dev`, { stdio: "inherit" });
    watcher.close();
    done();
  });

  it("should handle the DATA event", (done) => {
    const watcher = K8s(kind.Pod).InNamespace(namespace).Watch((po) => {
      expect(po.metadata!.name).toBe(namespace);
    });
    watcher.start();

    watcher.events.on(WatchEvent.DATA, (po) => {
      expect(po.metadata.name).toBe(namespace);
    });
    watcher.close();
    done();
  });
});
/**
 * sleep for a given number of seconds
 *
 * @param seconds - number of seconds to sleep
 * @returns Promise<void>
 */
export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
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

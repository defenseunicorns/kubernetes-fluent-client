import { describe, it, expect, afterAll, beforeEach, afterEach, jest } from "@jest/globals";
import { Pod } from "../src/upstream";
import { K8s, RegisterKind } from "../src/index";
import { V1ObjectMeta } from "@kubernetes/client-node";
import { EventEmitter } from "stream";
import { watch } from "fs";

const poddy = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: {
    name: "simple-pod",
    namespace: "default",
    labels: {
      app: "simple-app",
    },
  },
  spec: {
    containers: [
      {
        name: "simple-container",
        image: "nginx:latest",
        ports: [
          {
            containerPort: 80,
          },
        ],
      },
    ],
  },
};

const poddyFilter = { name: poddy.metadata.name, namespace: poddy.metadata.namespace };
export function stuff() {
  describe("fluent API tests", () => {
    it("Apply", async () => {
      await K8s(Pod).Apply(poddy);
      const result = await K8s(Pod).InNamespace("default").Get(poddy.metadata.name);
      expect(result.metadata?.name).toEqual(poddy.metadata.name);
    });

    it("Patch", async () => {
      await K8s(Pod, poddyFilter).Patch([
        {
          op: "add",
          path: "/metadata/labels/environment",
          value: "production",
        },
      ]);
      const whoami = await K8s(Pod).InNamespace(poddy.metadata.namespace).Get(poddy.metadata.name);
      expect(whoami.metadata?.labels?.environment).toEqual("production");
    });

    it("ForceApply", async () => {
      const updated = { ...poddy };
      (updated.metadata.labels as any)["hithere"] = "meow";

      await K8s(Pod).ForceApply(updated);
      const whoami = await K8s(Pod).InNamespace("default").Get(poddy.metadata.name);
      expect(whoami.metadata?.labels?.["hithere"]).toEqual("meow");
    });

    it("RegisterKind", async () => {
      class FakeKind {
        apiVersion: string;
        kind: string;
        metadata: V1ObjectMeta;
        constructor(input?: Partial<FakeKind>) {
          this.apiVersion = "FakeKind";
          this.kind = "FakeKind";
          this.metadata = input?.metadata || { name: "FakeKind", namespace: "default" };
        }
      }
      RegisterKind(FakeKind, {
        kind: "FakeKind",
        version: "FakeKind",
        group: "FakeKind",
      });

      try {
        await K8s(FakeKind).Apply({ metadata: { name: "meow" } });
      } catch (e) {
        expect(e.status).toEqual(404);
      }
      try {
        await K8s(FakeKind, { name: "FakeKind" }).Get();
      } catch (e) {
        expect(e.status).toEqual(404);
      }
    });

    it("Watch", async () => {
      async function sleepy() {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve("Slept for 2 seconds");
          }, 2000);
        });
      }

      var w: Pod = new Pod();

      const watchy = await K8s(Pod, poddyFilter).Watch((event, phase) => {
        w = { ...event };
      });
      await sleepy();
      watchy.abort();
      expect(w.metadata?.name).toEqual(poddy.metadata.name);
    });

    afterAll(async () => {
      await K8s(Pod).Delete(poddy);
    });
  });
}

import { kind, K8s, fetch } from "kubernetes-fluent-client";
import { beforeAll, afterAll, jest, test, describe, expect } from "@jest/globals";
import path from "path";
import { execSync } from "child_process";
import { V1APIGroup } from "@kubernetes/client-node";
jest.unmock("@kubernetes/client-node");

describe("KFC e2e test", () => {
  const namespace = `e2e-tests`;
  const clusterName = "kfc-dev";
  const execCommand = (cmd: string) => {
    try {
      return execSync(cmd, { stdio: "inherit" });
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  //   afterAll(async () => {
  //     try {
  //       execCommand(`k3d cluster delete ${clusterName}`);
  //     } catch {}
  //   });

  beforeAll(async () => {
    try {
      await K8s(kind.Namespace).Apply({ metadata: { name: namespace } });
      await K8s(kind.Pod).Apply({
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch {}
    await waitForPodReady(namespace, namespace);
  }, 30000);

  // test("kfc crd", () => {})
  test("Apply()", async () => {
    // No Force
    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.name).toBe(namespace);
    } catch (e) {
      expect(e).toBeDefined();
    }
    // Force
    try {
      await K8s(kind.Namespace).Apply(
        {
          metadata: {
            name: namespace,
            labels: {
              "e2e-test": "true",
            },
          },
        },
        { force: true },
      );
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.labels!["e2e-test"]).toBe("true");
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("Get(name)", async () => {
    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.name).toBe(namespace);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("GET()", async () => {
    try {
      const nsList = await K8s(kind.Namespace).Get();
      expect(nsList.items.length).toBeGreaterThan(0);
      expect(nsList.items.find(ns => ns.metadata!.name === namespace)).toBeDefined();
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("Delete(name)", async () => {
    try {
      await K8s(kind.Namespace).Delete(namespace);
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.status!.phase).toBe("Terminating");
    } catch (e) {
      expect(e).toBeDefined();
    }

    try {
      await K8s(kind.Namespace).Apply({ metadata: { name: namespace } });
      await K8s(kind.Pod).Apply({
        metadata: { name: namespace, namespace },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch {}
    await waitForPodReady(namespace, namespace);
  });

  test("Create()", async () => {
    try {
      await K8s(kind.Pod).Apply({
        metadata: { name: `${namespace}-1`, namespace },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch (e) {
      expect(e).toBeUndefined();
    }

    await waitForPodReady(`${namespace}-1`, namespace);
  });
  test("Raw()", async () => {
    interface API {
      kind: string;
      versions: string[];
      serverAddressByClientCIDRs: { clientCIDR: string; serverAddress: string }[];
      serverAddress: string;
    }
    try {
      const data = await K8s(V1APIGroup).Raw("/api");
      expect(data).toBeDefined();
      expect(data.kind).toBe("APIVersions");
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });
  test("PatchStatus()", () => {});

  test("filters - InNamespace, WithLabel, WithField", async () => {
    try {
      const podList = await K8s(kind.Pod)
        .InNamespace(namespace)
        .WithLabel("app", "nginx")
        .WithField("metadata.name", namespace)
        .Get();
      expect(podList.items.length).toBe(1);
      const po = podList.items[0];
      expect(po.metadata!.name).toBe(namespace);
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("Logs", async () => {
    try {
      const logs = await K8s(kind.Pod).InNamespace(namespace).Logs(namespace);
      expect(logs).toBeDefined();
      expect(logs.find(log => log.includes("nginx"))).toBeTruthy();
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });
  test("Patch", async () => {
    try {
      await K8s(kind.Namespace, { name: namespace }).Patch([
        {
          op: "add",
          path: "/metadata/annotations",
          value: {
            "e2e-test": "true",
          },
        },
      ]);
    } catch (e) {
      expect(e).toBeDefined();
    }

    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.annotations!["e2e-test"]).toBe("true");
    } catch (e) {
      expect(e).toBeDefined();
    }
  });
  test("kfc fetch", async () => {
    const jsonURL = "https://api.github.com/repositories/1";
    const stringURL = "https://api.github.com/octocat";

    interface GHRepo {
      id: number;
      name: string;
      full_name: string;
    }
    // string
    try {
      const { data, ok } = await fetch(stringURL);
      expect(ok).toBe(true);
      expect(data).toBeDefined();
      expect(ok).toContain("Keep it logically awesome.");
    } catch {}

    // JSON payload
    try {
      const { data, ok } = await fetch<GHRepo>(jsonURL);
      expect(ok).toBe(true);
      expect(data).toBeDefined();
      expect(data.id).toBe(1);
    } catch {}
  });
});

export async function waitForPodReady(name: string, namespace: string) {
  const pod = await K8s(kind.Pod).InNamespace(namespace).Get(name);

  if (pod.status?.phase !== "Running") {
    await sleep(2);
    return waitForPodReady(name, namespace);
  }
}

export function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

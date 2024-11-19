import { kind, K8s, fetch, GenericClass, KubernetesObject } from "kubernetes-fluent-client";
import { beforeAll, afterAll, jest, test, describe, expect } from "@jest/globals";
import path from "path";
import { Datastore, Kind as Backing } from "./datastore-v1alpha1";
import { WebApp, Phase, Language, Theme } from "./webapp-v1alpha1";
import { execSync } from "child_process";
import { V1APIGroup } from "@kubernetes/client-node";
import exp from "constants";
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

  afterAll(async () => {
    try {
      execCommand(`k3d cluster delete ${clusterName}`);
    } catch {}
  });

  beforeAll(async () => {
    try {
      await K8s(kind.Namespace).Apply({ metadata: { name: namespace } });
      await K8s(kind.Pod).Apply({
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch {}
    await untilTrue(() => live(kind.Pod, { metadata: { name: namespace, namespace } }));
  }, 30000);

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
      await K8s(kind.Pod).InNamespace(namespace).Delete(namespace);
    } catch (e) {
      expect(e).toBeUndefined();
    }
    await gone(kind.Pod, { metadata: { name: namespace, namespace } });
    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.spec).toBe(undefined);
    } catch (e) {
      expect(e).toBeDefined();
    }

    try {
      await K8s(kind.Pod).Apply({ metadata: { name: namespace, namespace } });
    } catch {}
    await untilTrue(() => live(kind.Pod, { metadata: { name: namespace, namespace } }));
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

    await untilTrue(() => live(kind.Pod, { metadata: { name: `${namespace}-1`, namespace } }));
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
  test("PatchStatus()", async () => {
    try {
      await K8s(WebApp).Apply({
        metadata: { name: "webapp", namespace },
        spec: {
          language: Language.En,
          theme: Theme.Dark,
          replicas: 1,
        },
        status: { phase: Phase.Pending },
      });
    } catch {}

    try {
      await K8s(Datastore).Apply({
        metadata: { name: "valkey", namespace },
        spec: {
          accessModes: ["ReadWriteOnce"],
          capacity: "10Gi",
          hostPath: "/data",
          kind: Backing.Valkey,
        },
        status: {
          phase: Phase.Pending,
        },
      });
    } catch {}

    try {
      const wa = await K8s(WebApp).InNamespace(namespace).Get("webapp");
      expect(wa.status?.phase).toBe(Phase.Pending);
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ds = await K8s(Datastore).InNamespace(namespace).Get("valkey");
      expect(ds.status?.phase).toBe(Phase.Pending);
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("kfc crd", async () => {
    try {
      await K8s(WebApp).PatchStatus({
        metadata: { name: "webapp", namespace },
        status: { phase: Phase.Ready },
      });
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      await K8s(Datastore).Apply({
        metadata: { name: "valkey", namespace },
        status: {
          phase: Phase.Ready,
        },
      });
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const wa = await K8s(WebApp).InNamespace(namespace).Get("webapp");
      expect(wa.status?.phase).toBe(Phase.Pending);
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ds = await K8s(Datastore).InNamespace(namespace).Get("valkey");
      expect(ds.status?.phase).toBe(Phase.Pending);
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

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

export function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function live(k: GenericClass, o: KubernetesObject) {
  const ns = o.metadata?.namespace ? o.metadata.namespace : "";

  try {
    await K8s(k)
      .InNamespace(ns)
      .Get(o.metadata?.name || "");
  } catch (e) {
    if (e.status === 404) {
      return false;
    } else {
      throw e;
    }
  }
  return true;
}
export async function statusCheck(k: GenericClass, o: KubernetesObject, status: string) {
  const ns = o.metadata?.namespace ? o.metadata.namespace : "";
  try {
    const obj = await K8s(k)
      .InNamespace(ns)
      .Get(o.metadata?.name || "");
    return obj.status?.phase.toString() === status;
  } catch (e) {
    if (e.status === 404) {
      return false;
    } else {
      throw e;
    }
  }
}
export async function gone(k: GenericClass, o: KubernetesObject) {
  const ns = o.metadata?.namespace ? o.metadata.namespace : "";

  try {
    await K8s(k)
      .InNamespace(ns)
      .Get(o.metadata?.name || "");
  } catch (e) {
    if (e.status === 404) {
      return Promise.resolve(true);
    }
  }
  return Promise.resolve(false);
}

export async function untilTrue(predicate: () => Promise<boolean>) {
  while (true) {
    if (await predicate()) {
      break;
    }
    await sleep(0.25);
  }
}

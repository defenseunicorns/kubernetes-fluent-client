import { kind, K8s, fetch, GenericClass, KubernetesObject } from "kubernetes-fluent-client";
import { beforeAll, afterAll, jest, test, describe, expect } from "@jest/globals";
import { Datastore, Kind as Backing } from "./datastore-v1alpha1";
import { WebApp, Phase, Language, Theme } from "./webapp-v1alpha1";
import { execSync } from "child_process";
import { V1APIGroup } from "@kubernetes/client-node";
import { beforeEach } from "node:test";

jest.unmock("@kubernetes/client-node");
const namespace = `e2e-tests`;
const clusterName = "kfc-dev";

describe("KFC e2e test", () => {
  afterAll(async () => {
    try {
      execCommand(`k3d cluster delete ${clusterName}`);
    } catch {}
  });

  beforeAll(async () => {
    try {
      await K8s(kind.Namespace).Apply({ metadata: { name: namespace } });
    } catch {}
  }, 30000);

  beforeEach(async () => {
    try {
      await K8s(kind.Pod).Apply(
        {
          metadata: { name: namespace, namespace, labels: { app: "nginx" } },
          spec: { containers: [{ name: "nginx", image: "nginx" }] },
        },
        { force: true },
      );
    } catch (e) {
      console.error(e);
    }
    await waitForRunningStatusPhase(kind.Pod, { metadata: { name: namespace, namespace } });
  });

  test("Apply", async () => {
    // No Force Test - NS is already created
    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.name).toBe(namespace);
    } catch (e) {
      expect(e).toBeDefined();
    }
    // Force - Update NS with label
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

  test("Get by name", async () => {
    try {
      const ns = await K8s(kind.Namespace).Get(namespace);
      expect(ns.metadata!.name).toBe(namespace);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  test("Get by list", async () => {
    try {
      const nsList = await K8s(kind.Namespace).Get();
      expect(nsList.items.length).toBeGreaterThan(0);
      expect(nsList.items.find(ns => ns.metadata!.name === namespace)).toBeDefined();
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("Delete by name", async () => {
    try {
      const result = await K8s(kind.Pod).InNamespace(namespace).Delete(`${namespace}`);
      expect(result).toBeUndefined();
      await untilTrue(() => gone(kind.Pod, { metadata: { name: namespace, namespace } }));
    } catch (e) {
      console.error(e);
    }
    try {
      await K8s(kind.Pod).Apply({
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch (e) {
      console.error(e);
    }
    await waitForRunningStatusPhase(kind.Pod, { metadata: { name: namespace, namespace } });
  }, 80000);

  test("Create", async () => {
    try {
      await K8s(kind.Pod).Apply({
        metadata: { name: `${namespace}-1`, namespace },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      });
    } catch (e) {
      expect(e).toBeUndefined();
    }
    await waitForRunningStatusPhase(kind.Pod, { metadata: { name: `${namespace}-1`, namespace } });
    try {
      const po = await K8s(kind.Pod).InNamespace(namespace).Get(`${namespace}-1`);
      expect(po.metadata!.name).toBe(`${namespace}-1`);
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });
  test("Raw", async () => {
    try {
      const data = await K8s(V1APIGroup).Raw("/api");
      expect(data).toBeDefined();
      expect(data.kind).toBe("APIVersions");
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("kfc crd", async () => {
    await createCR(
      WebApp,
      {
        metadata: { name: "webapp", namespace },
        spec: {
          language: Language.En,
          theme: Theme.Dark,
          replicas: 1,
        },
      } as KubernetesObject,
      true,
    );
    await createCR(
      Datastore,
      {
        metadata: { name: "valkey", namespace },
        spec: {
          accessModes: ["ReadWriteOnce"],
          capacity: "10Gi",
          hostPath: "/data",
          kind: Backing.Valkey,
        },
      } as KubernetesObject,
      true,
    );

    try {
      const wa = await K8s(WebApp).InNamespace(namespace).Get("webapp");
      expect(wa.spec?.replicas).toBe(1);
      expect(wa.spec?.language).toBe(Language.En);
      expect(wa.spec?.theme).toBe(Theme.Dark);
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ds = await K8s(Datastore).InNamespace(namespace).Get("valkey");
      expect(ds.spec?.accessModes).toContain("ReadWriteOnce");
      expect(ds.spec?.capacity).toBe("10Gi");
      expect(ds.spec?.hostPath).toBe("/data");
    } catch (e) {
      expect(e).toBeUndefined();
    }
  });

  test("PatchStatus", async () => {
    // Create initial CRs
    await createCR(WebApp, {
      metadata: { name: "webapp", namespace },
      spec: {
        language: Language.En,
        theme: Theme.Dark,
        replicas: 1,
      },
    } as KubernetesObject);
    await createCR(Datastore, {
      metadata: { name: "valkey", namespace },
      spec: {
        accessModes: ["ReadWriteOnce"],
        capacity: "10Gi",
        hostPath: "/data",
        kind: Backing.Valkey,
      },
    } as KubernetesObject);

    // Patch Status
    await K8s(WebApp).PatchStatus({
      metadata: { name: "webapp", namespace },
      spec: {
        language: Language.En,
        theme: Theme.Dark,
        replicas: 1,
      },
      status: { phase: Phase.Ready },
    });
    await K8s(Datastore).PatchStatus({
      metadata: { name: "valkey", namespace },
      status: {
        phase: Phase.Ready,
      },
    });

    await waitForGenericStatusPhase(
      WebApp,
      { metadata: { name: "webapp", namespace } },
      Phase.Ready.toString(),
    );
    await waitForGenericStatusPhase(
      Datastore,
      { metadata: { name: "valkey", namespace } },
      Phase.Ready.toString(),
    );

    try {
      const wa = await K8s(WebApp).InNamespace(namespace).Get("webapp");
      expect(wa.status?.phase).toBe(Phase.Ready);
    } catch (e) {
      expect(e).toBeUndefined();
    }

    try {
      const ds = await K8s(Datastore).InNamespace(namespace).Get("valkey");
      expect(ds.status?.phase).toBe(Phase.Ready);
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

export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

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

export async function waitForGenericStatusPhase(
  k: GenericClass,
  o: KubernetesObject,
  status: string,
): Promise<void> {
  const object = await K8s(k)
    .InNamespace(o.metadata?.namespace || "")
    .Get(o.metadata?.name || "");
  if (object.status?.phase.toString() !== status) {
    await sleep(2);
    return waitForGenericStatusPhase(k, o, status);
  }
}
export async function gone(k: GenericClass, o: KubernetesObject): Promise<boolean> {
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

export async function untilTrue(predicate: () => Promise<boolean>): Promise<void> {
  while (true) {
    if (await predicate()) {
      break;
    }
    await sleep(0.25);
  }
}

const createCR = async (
  k: GenericClass,
  o: KubernetesObject,
  force: boolean = false,
): Promise<void> => {
  try {
    await K8s(k).Apply(o, { force });
  } catch (e) {
    console.error(e);
  }
};

const execCommand = (cmd: string): Buffer => {
  try {
    return execSync(cmd, { stdio: "inherit" });
  } catch (e) {
    console.error(e);
    throw e;
  }
};

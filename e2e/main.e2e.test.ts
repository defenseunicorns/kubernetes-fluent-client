import { kind, K8s, fetch, GenericClass, KubernetesObject } from "kubernetes-fluent-client";
import { applyWithOwnership, deleteAllByOwnership, ownershipLabel } from "../src/test/index.js";
import { setupKubernetesPreflight } from "../src/test/vitest/setup.js";
import { afterAll, beforeAll, beforeEach, it, describe, expect } from "vitest";
import { Datastore, Kind as Backing } from "./datastore-v1alpha1";
import { WebApp, Phase, Language, Theme } from "./webapp-v1alpha1";
import { V1APIGroup } from "@kubernetes/client-node";
import {
  e2eOwnership,
  gone,
  untilTrue,
  waitForRunningStatusPhase,
  waitForStatusPhase,
} from "./support.js";

const namespace = `e2e-tests`;
const e2eFetchAttempts = 4;
const e2eFetchBackoffMs = 250;
const ownership = e2eOwnership("kfc-e2e-main");

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
    kind.Deployment,
    {
      metadata: { name: `${namespace}-scale`, namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "nginx" } },
        template: {
          metadata: { labels: { app: "nginx" } },
          spec: { containers: [{ name: "nginx", image: "nginx" }] },
        },
      },
    },
    { ...ownership, force: true },
  );
}, 30000);

afterAll(async () => {
  await deleteAllByOwnership(kind.Namespace, { ...ownership, waitForDeletion: true });
}, 60000);

describe("KFC e2e test", () => {
  beforeEach(async () => {
    await applyWithOwnership(
      kind.Pod,
      {
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      },
      { ...ownership, force: true },
    );
    await waitForRunningStatusPhase(kind.Pod, { metadata: { name: namespace, namespace } });
  }, 80000);

  it("Adds Finalizer to Deployment", async () => {
    await K8s(kind.Deployment)
      .InNamespace(namespace)
      .Finalize("add", "example.com/finalizer", `${namespace}-scale`);
    const deployment = await K8s(kind.Deployment).InNamespace(namespace).Get(`${namespace}-scale`);
    expect(deployment.metadata?.finalizers).toContain("example.com/finalizer");
  });

  it("Removes Finalizer from Deployment", async () => {
    await K8s(kind.Deployment)
      .InNamespace(namespace)
      .Finalize("remove", "example.com/finalizer", `${namespace}-scale`);
    const deployment = await K8s(kind.Deployment).InNamespace(namespace).Get(`${namespace}-scale`);
    expect(deployment.metadata?.finalizers ?? []).not.toContain("example.com/finalizer");
  });

  it("Scales Deployment", async () => {
    const before = await K8s(kind.Deployment).InNamespace(namespace).Get(`${namespace}-scale`);
    expect(before.spec?.replicas).toBe(1);
    await K8s(kind.Deployment).InNamespace(namespace).Scale(3, `${namespace}-scale`);
    const after = await K8s(kind.Deployment).InNamespace(namespace).Get(`${namespace}-scale`);
    expect(after.spec?.replicas).toBe(3);
  });
}, 40000);

it("Apply", async () => {
  const owner = ownershipLabel(ownership);
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
            [owner.key]: owner.value,
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

it("Get by name", async () => {
  try {
    const ns = await K8s(kind.Namespace).Get(namespace);
    expect(ns.metadata!.name).toBe(namespace);
  } catch (e) {
    expect(e).toBeDefined();
  }
});

it("Get by list", async () => {
  try {
    const nsList = await K8s(kind.Namespace).Get();
    expect(nsList.items.length).toBeGreaterThan(0);
    expect(
      nsList.items.find((ns: KubernetesObject) => ns.metadata!.name === namespace),
    ).toBeDefined();
  } catch (e) {
    expect(e).toBeUndefined();
  }
});

it("Evict by name", async () => {
  try {
    await K8s(kind.Pod).Apply({
      metadata: { name: `${namespace}-evict-me`, namespace },
      spec: { containers: [{ name: "nginx", image: "nginx" }] },
    });
  } catch (e) {
    expect(e).toBeUndefined();
  }
  await waitForRunningStatusPhase(kind.Pod, {
    metadata: { name: `${namespace}-evict-me`, namespace },
  });

  try {
    const result = await K8s(kind.Pod).InNamespace(namespace).Evict(`${namespace}-evict-me`);
    expect(result).toBeUndefined();
    await untilTrue(() =>
      gone(kind.Pod, { metadata: { name: `${namespace}-evict-me`, namespace } }),
    );
  } catch (e) {
    expect(e).toBeUndefined();
  }
}, 80000);

it("Delete by name", async () => {
  try {
    const result = await K8s(kind.Pod).InNamespace(namespace).Delete(`${namespace}`);
    expect(result).toBeUndefined();
    await untilTrue(() => gone(kind.Pod, { metadata: { name: namespace, namespace } }));
  } catch (e) {
    expect(e).toBeUndefined();
  }
  try {
    await K8s(kind.Pod).Apply(
      {
        metadata: { name: namespace, namespace, labels: { app: "nginx" } },
        spec: { containers: [{ name: "nginx", image: "nginx" }] },
      },
      { force: true },
    );
  } catch (e) {
    expect(e).toBeUndefined();
  }
  await waitForRunningStatusPhase(kind.Pod, { metadata: { name: namespace, namespace } });
}, 80000);

it("Create", async () => {
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
it("Raw", async () => {
  try {
    const data = await K8s(V1APIGroup).Raw("/api");
    expect(data).toBeDefined();
    expect(data.kind).toBe("APIVersions");
  } catch (e) {
    expect(e).toBeUndefined();
  }
});

it("kfc crd", async () => {
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

it("PatchStatus", async () => {
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

  await waitForStatusPhase(
    WebApp,
    { metadata: { name: "webapp", namespace } },
    Phase.Ready.toString(),
  );
  await waitForStatusPhase(
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

it("filters - InNamespace, WithLabel, WithField", async () => {
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

it("Logs", async () => {
  try {
    const logs = await K8s(kind.Pod).InNamespace(namespace).Logs(namespace);
    expect(logs).toBeDefined();
    expect(logs.find((log: string) => log.includes("nginx"))).toBeTruthy();
  } catch (e) {
    expect(e).toBeUndefined();
  }
});
it("Patch", async () => {
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

it("Proxy", async () => {
  try {
    await K8s(kind.Pod).Apply({
      metadata: { name: `${namespace}-proxy`, namespace },
      spec: { containers: [{ name: "nginx", image: "nginx" }] },
    });
    await waitForRunningStatusPhase(kind.Pod, {
      metadata: { name: `${namespace}-proxy`, namespace },
    });
  } catch (e) {
    expect(e).toBeUndefined();
  }

  try {
    const proxyMessage = await K8s(kind.Pod)
      .InNamespace(namespace)
      .Proxy(`${namespace}-proxy`, "80");
    expect(proxyMessage).toContain("Welcome to nginx!");
  } catch (e) {
    expect(e).toBeUndefined();
  }
});

it("kfc fetch", async () => {
  const jsonURL = "https://api.github.com/repositories/1";
  const stringURL = "https://api.github.com/octocat";

  interface TestRepo {
    id: number;
    name: string;
    full_name: string;
  }

  const stringResponse = await fetchWithE2EDiagnostics<string>(stringURL);
  expect(stringResponse.ok).toBe(true);
  expect(stringResponse.data).toBeDefined();
  expect(stringResponse.data).toContain("MMMMMMMMMMMMM");

  const jsonResponse = await fetchWithE2EDiagnostics<TestRepo>(jsonURL);
  expect(jsonResponse.ok).toBe(true);
  expect(jsonResponse.data).toBeDefined();
  expect(jsonResponse.data.id).toBe(1);
});

/**
 * Fetch an external e2e resource with short retries and actionable diagnostics.
 *
 * @param url - URL to fetch
 * @returns successful KFC fetch response
 */
async function fetchWithE2EDiagnostics<T>(
  url: string,
): Promise<Awaited<ReturnType<typeof fetch<T>>>> {
  let lastResponse: Awaited<ReturnType<typeof fetch<T>>> | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= e2eFetchAttempts; attempt++) {
    try {
      const response = await fetch<T>(url);
      if (response.ok) {
        return response;
      }

      lastResponse = response;
      logFetchFailure(url, attempt, response);
    } catch (error) {
      lastError = error;
      logFetchFailure(url, attempt, undefined, error);
    }

    if (attempt < e2eFetchAttempts) {
      await sleepMilliseconds(e2eFetchBackoffMs);
    }
  }

  throw new Error(
    `Failed to fetch ${url} after ${e2eFetchAttempts} attempts. ${fetchFailureDetails(
      lastResponse,
      lastError,
    )}`,
  );
}

/**
 * Log a failed external e2e fetch attempt.
 *
 * @param url - URL that failed
 * @param attempt - one-based attempt number
 * @param response - failed KFC fetch response
 * @param error - thrown error, if any
 */
function logFetchFailure<T>(
  url: string,
  attempt: number,
  response?: Awaited<ReturnType<typeof fetch<T>>>,
  error?: unknown,
): void {
  console.warn(
    `[e2e fetch] ${url} attempt ${attempt}/${e2eFetchAttempts} failed. ${fetchFailureDetails(
      response,
      error,
    )}`,
  );
}

/**
 * Format fetch failure context for e2e logs.
 *
 * @param response - failed KFC fetch response
 * @param error - thrown error, if any
 * @returns concise failure context
 */
function fetchFailureDetails<T>(
  response?: Awaited<ReturnType<typeof fetch<T>>>,
  error?: unknown,
): string {
  const responseDetails = response
    ? `ok=${response.ok} status=${response.status} statusText=${response.statusText}`
    : "no response";
  const responseError = response?.e ? ` responseError=${errorDetails(response.e)}` : "";
  const thrownError = error ? ` thrownError=${errorDetails(error)}` : "";

  return `${responseDetails}${responseError}${thrownError}`;
}

/**
 * Format an unknown error value.
 *
 * @param error - error-like value
 * @returns error message
 */
function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause ? ` cause=${String(error.cause)}` : "";
    return `${error.name}: ${error.message}${cause}`;
  }

  return String(error);
}

/**
 * Sleep for a fixed number of milliseconds.
 *
 * @param milliseconds - milliseconds to sleep
 * @returns Promise<void>
 */
function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Create a CR
 *
 * @param k - GenericClass
 * @param o - KubernetesObject
 * @param force - boolean
 * @returns Promise<void>
 */
const createCR = async (
  k: GenericClass,
  o: KubernetesObject,
  force: boolean = false,
): Promise<void> => {
  try {
    await K8s(k).Apply(o, { force });
  } catch (e) {
    expect(e).toBeUndefined();
  }
};

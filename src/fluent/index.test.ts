// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { beforeEach, describe, expect, it, vi } from "vitest";
import { V1APIGroup } from "@kubernetes/client-node";
import { Operation } from "fast-json-patch";
import { KubernetesObject } from "@kubernetes/client-node";
import { K8s, removeControllerFields, updateFinalizersOrSkip } from "./index.js";
import { fetch } from "../fetch.js";
import { Pod } from "../upstream.js";
import { k8sCfg, k8sExec } from "./utils.js";

// Setup mocks
vi.mock("./utils");
vi.mock("../fetch");

const generateFakePodManagedFields = (manager: string) => {
  return [
    {
      apiVersion: "v1",
      fieldsType: "FieldsV1",
      fieldsV1: {
        "f:metadata": {
          "f:labels": {
            "f:fake": {},
          },
          "f:spec": {
            "f:containers": {
              'k:{"name":"fake"}': {
                "f:image": {},
                "f:name": {},
                "f:resources": {
                  "f:limits": {
                    "f:cpu": {},
                    "f:memory": {},
                  },
                  "f:requests": {
                    "f:cpu": {},
                    "f:memory": {},
                  },
                },
              },
            },
          },
        },
      },
      manager: manager,
      operation: "Apply",
    },
  ];
};
describe("Kube", () => {
  const fakeResource = {
    metadata: {
      name: "fake",
      namespace: "default",
      managedFields: generateFakePodManagedFields("pepr"),
    },
  };

  const mockedKubeCfg = vi.mocked(k8sCfg);
  const mockedKubeExec = vi.mocked(k8sExec).mockResolvedValue(fakeResource);

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    mockedKubeExec.mockClear();
  });

  it("should create a resource", async () => {
    const result = await K8s(Pod).Create(fakeResource);

    expect(result).toEqual(fakeResource);
    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        name: "fake",
        namespace: "default",
      }),
      { method: "POST", payload: fakeResource },
    );
  });

  it("should delete a resource", async () => {
    await K8s(Pod).Delete(fakeResource);

    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        name: "fake",
        namespace: "default",
      }),
      { method: "DELETE" },
    );
  });

  it("should evict a resource", async () => {
    await K8s(Pod).Evict(fakeResource);

    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        name: "fake",
        namespace: "default",
      }),
      {
        method: "POST",
        payload: {
          apiVersion: "policy/v1",
          kind: "Eviction",
          metadata: { name: "fake", namespace: "default" },
        },
      },
    );
  });

  it("should patch a resource", async () => {
    const patchOperations: Operation[] = [
      { op: "replace", path: "/metadata/name", value: "new-fake" },
    ];

    const result = await K8s(Pod).Patch(patchOperations);

    expect(result).toEqual(fakeResource);
    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      {},
      { method: "PATCH", payload: patchOperations },
    );
  });

  it("should patch the status of a resource", async () => {
    await K8s(Pod).PatchStatus({
      metadata: {
        name: "fake",
        namespace: "default",
        managedFields: generateFakePodManagedFields("pepr"),
      },
      spec: { priority: 3 },
      status: {
        phase: "Ready",
      },
    });

    expect(k8sExec).toBeCalledWith(
      Pod,
      expect.objectContaining({
        name: "fake",
        namespace: "default",
      }),
      {
        method: "PATCH_STATUS",
        payload: {
          apiVersion: "v1",
          kind: "Pod",
          metadata: {
            name: "fake",
            namespace: "default",
            managedFields: generateFakePodManagedFields("pepr"),
          },
          spec: { priority: 3 },
          status: {
            phase: "Ready",
          },
        },
      },
    );
  });

  it("should filter with WithField", async () => {
    await K8s(Pod).WithField("metadata.name", "fake").Get();

    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        fields: {
          "metadata.name": "fake",
        },
      }),
      { method: "GET" },
    );
  });

  it("should filter with WithLabel", async () => {
    await K8s(Pod).WithLabel("app", "fakeApp").Get();

    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        labels: {
          app: "fakeApp",
        },
      }),
      { method: "GET" },
    );
  });

  it("should use InNamespace", async () => {
    await K8s(Pod).InNamespace("fakeNamespace").Get();

    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        namespace: "fakeNamespace",
      }),
      { method: "GET" },
    );
  });

  it("should throw an error if namespace is already specified", async () => {
    expect(() => K8s(Pod, { namespace: "default" }).InNamespace("fakeNamespace")).toThrow(
      "Namespace already specified: default",
    );
  });

  it("should handle Delete when the resource doesn't exist", async () => {
    mockedKubeExec.mockRejectedValueOnce({ status: 404 }); // Not Found on first call
    await expect(K8s(Pod).Delete("fakeResource")).resolves.toBeUndefined();
  });

  it("should handle Evict when the resource doesn't exist", async () => {
    mockedKubeExec.mockRejectedValueOnce({ status: 404 }); // Not Found on first call
    await expect(K8s(Pod).Evict("fakeResource")).resolves.toBeUndefined();
  });

  it("should handle Get", async () => {
    const result = await K8s(Pod).Get("fakeResource");

    expect(result).toEqual(fakeResource);
    expect(mockedKubeExec).toHaveBeenCalledWith(
      Pod,
      expect.objectContaining({
        name: "fakeResource",
      }),
      { method: "GET" },
    );
  });

  it("should thrown an error if Get is called with a name and filters are already specified a name", async () => {
    await expect(K8s(Pod, { name: "fake" }).Get("fakeResource")).rejects.toThrow(
      "Name already specified: fake",
    );
  });

  it("should throw an error if no patch operations provided", async () => {
    await expect(K8s(Pod).Patch([])).rejects.toThrow("No operations specified");
  });

  it("should allow Apply of deep partials", async () => {
    const result = await K8s(Pod).Apply({ metadata: { name: "fake" }, spec: { priority: 3 } });
    expect(result).toEqual(fakeResource);
  });

  it("should allow force apply to resolve FieldManagerConflict", async () => {
    const result = await K8s(Pod).Apply(
      {
        metadata: { name: "fake", managedFields: generateFakePodManagedFields("kubectl") },
        spec: { priority: 3 },
      },
      { force: true },
    );
    expect(result).toEqual(fakeResource);
  });

  it("should throw an error if a Delete failed for a reason other than Not Found", async () => {
    mockedKubeExec.mockRejectedValueOnce({ status: 500 }); // Internal Server Error on first call
    await expect(K8s(Pod).Delete("fakeResource")).rejects.toEqual(
      expect.objectContaining({ status: 500 }),
    );
  });

  it("should throw an error if an Evict failed for a reason other than Not Found", async () => {
    mockedKubeExec.mockRejectedValueOnce({ status: 500 }); // Internal Server Error on first call
    await expect(K8s(Pod).Evict("fakeResource")).rejects.toEqual(
      expect.objectContaining({ status: 500 }),
    );
  });

  it("should create a raw api request", async () => {
    mockedKubeCfg.mockReturnValue(
      new Promise(r =>
        r({
          serverUrl: "https://localhost:8080",
          opts: {},
        }),
      ),
    );
    const mockResp = {
      kind: "APIVersions",
      versions: ["v1"],
      serverAddressByClientCIDRs: [
        {
          serverAddress: "172.27.0.3:6443",
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      data: mockResp,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    });

    const result = await K8s(V1APIGroup).Raw("/api");

    expect(result).toEqual(mockResp);
  });

  it("should remove controller fields from the object", () => {
    const obj = {
      metadata: {
        name: "test",
        managedFields: [
          {
            manager: "kubectl",
            operation: "Apply",
            apiVersion: "v1",
            time: new Date("2010-10-10T00:00:00Z"),
            fieldsType: "FieldsV1",
            fieldsV1: {
              f: {
                metadata: {
                  f: {
                    labels: {
                      f: {
                        "test-label": {},
                      },
                    },
                  },
                },
                data: {
                  f: {
                    key: {},
                  },
                },
              },
            },
          },
        ],
        uid: "abcde",
        creationTimestamp: new Date("2023-10-01T00:00:00Z"),
        generation: 1,
        finalizers: ["test.finalizer"],
      },
    };

    removeControllerFields(obj);

    expect(obj.metadata).toEqual({
      name: "test",
    });
  });

  it("should skip 'add' if the finalizer is already present", async () => {
    const fakePod: KubernetesObject = {
      metadata: {
        name: "fake",
        namespace: "default",
        finalizers: ["test.finalizer1"],
      },
    };

    const updatedFinalizers = await updateFinalizersOrSkip("add", "test.finalizer1", fakePod);
    // Finalizer is already there
    expect(updatedFinalizers).toBe(null);
  });

  it("should add if the finalizer is not present", async () => {
    const fakePod: KubernetesObject = {
      metadata: {
        name: "fake",
        namespace: "default",
        finalizers: ["test.finalizer1"],
      },
    };

    const updatedFinalizers = await updateFinalizersOrSkip("add", "test.finalizer2", fakePod);

    expect(updatedFinalizers).toContain("test.finalizer2");
  });

  it("should skip 'remove' if the finalizer is not present", async () => {
    const fakePod: KubernetesObject = {
      metadata: {
        name: "fake",
        namespace: "default",
        finalizers: [],
      },
    };

    const updatedFinalizers = await updateFinalizersOrSkip("remove", "test.finalizer1", fakePod);
    // Finalizer is not there
    expect(updatedFinalizers).toBe(null);
  });

  describe("filter isolation across terminal operations", () => {
    it("should allow reusing a fluent chain for multiple Get(name) calls", async () => {
      // A stored fluent chain with a namespace filter but no name filter.
      const pods = K8s(Pod).InNamespace("default");

      // First call sets filters.name = "pod-a" internally.
      await pods.Get("pod-a");

      // Second call with a different name should NOT throw
      // "Name already specified: pod-a".
      await expect(pods.Get("pod-b")).resolves.toBeDefined();

      // Verify both calls went through with their respective names.
      expect(mockedKubeExec).toHaveBeenCalledWith(
        Pod,
        expect.objectContaining({ name: "pod-a", namespace: "default" }),
        { method: "GET" },
      );
      expect(mockedKubeExec).toHaveBeenCalledWith(
        Pod,
        expect.objectContaining({ name: "pod-b", namespace: "default" }),
        { method: "GET" },
      );
    });

    it("should allow reusing a fluent chain for multiple Delete(name) calls", async () => {
      const pods = K8s(Pod).InNamespace("default");

      await pods.Delete("pod-a");
      // Second delete should not carry over name from the first call.
      await expect(pods.Delete("pod-b")).resolves.toBeUndefined();

      expect(mockedKubeExec).toHaveBeenCalledWith(
        Pod,
        expect.objectContaining({ name: "pod-a", namespace: "default" }),
        { method: "DELETE" },
      );
      expect(mockedKubeExec).toHaveBeenCalledWith(
        Pod,
        expect.objectContaining({ name: "pod-b", namespace: "default" }),
        { method: "DELETE" },
      );
    });

    it("should not leak name from Create's syncFilters into subsequent Get", async () => {
      // K8s() returns Create at the top level (before InNamespace).
      const pods = K8s(Pod);

      // Create writes the resource's name into filters via syncFilters.
      await pods.Create({
        metadata: { name: "created-pod", namespace: "default" },
      } as InstanceType<typeof Pod>);

      // A subsequent list-Get (no name) should not have name="created-pod".
      await pods.Get();

      const getCalls = mockedKubeExec.mock.calls.filter(([, , opts]) => opts.method === "GET");
      expect(getCalls).toHaveLength(1);
      // The filters passed to the list Get should have no name set.
      expect(getCalls[0][1]).not.toHaveProperty("name", "created-pod");
    });
  });

  it("should remove finalizers if they are present", async () => {
    const fakePod: KubernetesObject = {
      metadata: {
        name: "fake",
        namespace: "default",
        finalizers: ["test.finalizer"],
      },
    };

    const updatedFinalizers = await updateFinalizersOrSkip("remove", "test.finalizer", fakePod);

    expect(updatedFinalizers).toStrictEqual([]);
  });
});

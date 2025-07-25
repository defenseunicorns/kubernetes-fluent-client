import { beforeEach, describe, expect, it, vi } from "vitest";
import { V1APIGroup } from "@kubernetes/client-node";
import { Operation } from "fast-json-patch";

import { K8s } from "./index.js";
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
    });

    const result = await K8s(V1APIGroup).Raw("/api");

    expect(result).toEqual(mockResp);
  });
});

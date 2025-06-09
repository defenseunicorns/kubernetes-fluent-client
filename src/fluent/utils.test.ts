// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import { RequestInit } from "node-fetch";
import { fetch } from "../fetch.js";
import { RegisterKind } from "../kinds.js";
import { GenericClass } from "../types.js";
import { ClusterRole, Ingress, Pod } from "../upstream.js";
import { FetchMethods, Filters } from "./shared-types.js";
import { k8sExec, pathBuilder, getHTTPSAgent, getHeaders, getToken } from "./utils.js";
// Import k8sCfg directly for mocking
import * as utils from "./utils.js";
vi.mock("https");
vi.mock("../fetch");

describe("getToken", () => {
  it("should return the token from the service account", async () => {
    const token = "fake-token";
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(token);
    const result = await getToken();
    expect(result).toEqual(token);
    vi.restoreAllMocks();
  });
});
describe("getHTTPSAgent", () => {
  it("should return an agent for undici with correct options", () => {
    const opts = {
      agent: {
        options: {
          ca: "ca",
          cert: "cert",
          key: "key",
        },
      },
    } as unknown as RequestInit;

    const agent = getHTTPSAgent(opts);
    expect(agent).toBeDefined();
  });
});
describe("getHeaders", () => {
  it("should return the correct headers if the @kubernetes/client-node token is undefined", async () => {
    const token = "fake-token";
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(token);
    const headers = await getHeaders();
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "kubernetes-fluent-client",
      Authorization: `Bearer ${token}`,
    });
    vi.restoreAllMocks();
  });

  it("should return the correct headers if the @kubernetes/client-node token is defined", async () => {
    const token = "fake-token";
    vi.spyOn(fs.promises, "readFile").mockResolvedValue(token);
    const headers = await getHeaders("aws-token");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "kubernetes-fluent-client",
      Authorization: `Bearer aws-token`,
    });
    vi.restoreAllMocks();
  });
});
describe("pathBuilder Function", () => {
  const serverUrl = "https://jest-test:8080";
  it("should throw an error if the kind is not specified and the model is not a KubernetesObject", () => {
    const model = { name: "Unknown" } as unknown as GenericClass;
    const filters: Filters = {};
    expect(() => pathBuilder("", model, filters)).toThrow("Kind not specified for Unknown");
  });

  it("should generate a path with a set-based label selector", () => {
    const filters: Filters = {
      namespace: "default",
      name: "mypod",
      labels: { iamalabel: "" },
    };
    const result = pathBuilder(serverUrl, Pod, filters);
    const expected = new URL(
      "/api/v1/namespaces/default/pods/mypod?labelSelector=iamalabel",
      serverUrl,
    );

    expect(result.toString()).toEqual(expected.toString());
  });

  it("should generate a path for core group kinds (with custom filters)", () => {
    const filters: Filters = {
      namespace: "default",
      name: "mypod",
      fields: { iamafield: "iamavalue" },
      labels: { iamalabel: "iamalabelvalue" },
    };
    const result = pathBuilder(serverUrl, Pod, filters);
    const expected = new URL(
      "/api/v1/namespaces/default/pods/mypod?fieldSelector=iamafield%3Diamavalue&labelSelector=iamalabel%3Diamalabelvalue",
      serverUrl,
    );

    expect(result.toString()).toEqual(expected.toString());
  });

  it("Version not specified in a Kind", () => {
    const filters: Filters = {
      namespace: "default",
      name: "mypod",
    };
    class Fake {
      name: string;
      constructor() {
        this.name = "Fake";
      }
    }
    RegisterKind(Fake, {
      kind: "Fake",
      version: "",
      group: "fake",
    });
    try {
      pathBuilder(serverUrl, Fake, filters);
    } catch (e) {
      expect(e.message).toEqual(`Version not specified for Fake`);
    }
  });

  it("should generate a path for core group kinds", () => {
    const filters: Filters = { namespace: "default", name: "mypod" };
    const result = pathBuilder(serverUrl, Pod, filters);
    const expected = new URL("/api/v1/namespaces/default/pods/mypod", serverUrl);
    expect(result).toEqual(expected);
  });

  it("should generate a path for non-core group kinds", () => {
    const filters: Filters = {
      namespace: "default",
      name: "myingress",
    };
    const result = pathBuilder(serverUrl, Ingress, filters);
    const expected = new URL(
      "/apis/networking.k8s.io/v1/namespaces/default/ingresses/myingress",
      serverUrl,
    );
    expect(result).toEqual(expected);
  });

  it("should generate a path without a namespace if not provided", () => {
    const filters: Filters = { name: "tester" };
    const result = pathBuilder(serverUrl, ClusterRole, filters);
    const expected = new URL("/apis/rbac.authorization.k8s.io/v1/clusterroles/tester", serverUrl);
    expect(result).toEqual(expected);
  });

  it("should generate a path without a name if excludeName is true", () => {
    const filters: Filters = { namespace: "default", name: "mypod" };
    const result = pathBuilder(serverUrl, Pod, filters, true);
    const expected = new URL("/api/v1/namespaces/default/pods", serverUrl);
    expect(result).toEqual(expected);
  });
});

describe("kubeExec Function", () => {
  const mockedFetch = vi.mocked(fetch);

  const fakeFilters: Filters = { name: "fake", namespace: "default" };
  const fakeMethod = FetchMethods.GET;
  const fakePayload = {
    metadata: { name: "fake", namespace: "default" },
    status: { phase: "Ready" },
  };
  const fakeServerUrl = "https://jest-test:8080";

  // Mock necessary functions to ensure consistent URL construction in tests
  const mockK8sCfg = vi.spyOn(utils, "k8sCfg");
  const mockPathBuilder = vi.spyOn(utils, "pathBuilder");

  beforeEach(() => {
    mockedFetch.mockClear();

    // Mock k8sCfg to return a consistent URL and options
    mockK8sCfg.mockImplementation(async (method: string | undefined) => {
      return {
        serverUrl: fakeServerUrl,
        opts: {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "kubernetes-fluent-client",
          },
          method,
          dispatcher: undefined,
        },
      };
    });

    // Mock pathBuilder to return consistent URLs that match test expectations
    mockPathBuilder.mockImplementation(() => {
      // Return URL objects that match the expectations in the tests
      return new URL(`${fakeServerUrl}/api/v1/namespaces/default/pods/fake`);
    });
  });

  it.skip("should make a successful fetch call", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      data: fakePayload,
      status: 200,
      statusText: "OK",
    });

    const result = await k8sExec(Pod, fakeFilters, fakeMethod, fakePayload);

    expect(result).toEqual(fakePayload);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        body: JSON.stringify(fakePayload),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": expect.stringContaining("kubernetes-fluent-client"),
        }),
        method: fakeMethod,
      }),
    );

    // Verify the path contains the expected elements
    const urlArg = mockedFetch.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toContain("/api/v1/namespaces/default/pods/fake");
  });

  it.skip("should handle PATCH_STATUS", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      data: fakePayload,
      status: 200,
      statusText: "OK",
    });

    const result = await k8sExec(Pod, fakeFilters, FetchMethods.PATCH_STATUS, fakePayload);

    expect(result).toEqual(fakePayload);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/merge-patch+json",
          "User-Agent": expect.stringContaining("kubernetes-fluent-client"),
        }),
        body: JSON.stringify({ status: fakePayload.status }),
      }),
    );

    // Verify the path contains the expected elements
    const urlArg = mockedFetch.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toContain("/api/v1/namespaces/default/pods/fake/status");
  });

  it.skip("should handle PATCH", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      data: fakePayload,
      status: 200,
      statusText: "OK",
    });

    const patchPayload = [{ op: "replace", path: "/status/phase", value: "Ready" }];

    const result = await k8sExec(Pod, fakeFilters, FetchMethods.PATCH, patchPayload);

    expect(result).toEqual(fakePayload);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/json-patch+json",
          "User-Agent": expect.stringContaining("kubernetes-fluent-client"),
        }),
        body: JSON.stringify(patchPayload),
      }),
    );

    // Verify the path contains the expected elements
    const urlArg = mockedFetch.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toContain("/api/v1/namespaces/default/pods/fake");
  });

  it.skip("should handle APPLY", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      data: fakePayload,
      status: 200,
      statusText: "OK",
    });

    const result = await k8sExec(Pod, fakeFilters, FetchMethods.APPLY, fakePayload);

    expect(result).toEqual(fakePayload);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/apply-patch+yaml",
          "User-Agent": expect.stringContaining("kubernetes-fluent-client"),
        }),
        body: JSON.stringify(fakePayload),
      }),
    );

    // Verify the path and search params contain the expected elements
    const urlArg = mockedFetch.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toContain("/api/v1/namespaces/default/pods/fake");
    expect(urlArg.searchParams.get("fieldManager")).toBe("pepr");
    expect(urlArg.searchParams.get("fieldValidation")).toBe("Strict");
    expect(urlArg.searchParams.get("force")).toBe("false");
  });

  it.skip("should handle APPLY with force", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      data: fakePayload,
      status: 200,
      statusText: "OK",
    });

    const result = await k8sExec(Pod, fakeFilters, FetchMethods.APPLY, fakePayload, {
      force: true,
    });

    expect(result).toEqual(fakePayload);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/apply-patch+yaml",
          "User-Agent": expect.stringContaining("kubernetes-fluent-client"),
        }),
        body: JSON.stringify(fakePayload),
      }),
    );

    // Verify the path and search params contain the expected elements
    const urlArg = mockedFetch.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toContain("/api/v1/namespaces/default/pods/fake");
    expect(urlArg.searchParams.get("fieldManager")).toBe("pepr");
    expect(urlArg.searchParams.get("fieldValidation")).toBe("Strict");
    expect(urlArg.searchParams.get("force")).toBe("true");
  });

  it.skip("should handle fetch call failure", async () => {
    const fakeStatus = 404;
    const fakeStatusText = "Not Found";

    mockedFetch.mockResolvedValueOnce({
      ok: false,
      data: null,
      status: fakeStatus,
      statusText: fakeStatusText,
    });

    await expect(k8sExec(Pod, fakeFilters, fakeMethod, fakePayload)).rejects.toEqual(
      expect.objectContaining({
        status: fakeStatus,
        statusText: fakeStatusText,
      }),
    );

    // Verify the fetch was called with the right method
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: fakeMethod,
      }),
    );
  });
});

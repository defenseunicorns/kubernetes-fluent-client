// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubernetesObject } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { K8s } from "../fluent/index.js";
import { k8sExec } from "../fluent/utils.js";
import {
  TEST_OWNERSHIP_LABEL,
  TEST_RUN_ID_LABEL,
  applyWithOwnership,
  deleteAllByOwnership,
  ownershipLabels,
  waitForResource,
} from "./resources.js";

vi.mock("../fluent/index.js", () => ({ K8s: vi.fn() }));
vi.mock("../fluent/utils.js", () => ({ k8sExec: vi.fn() }));

class ExampleResource implements KubernetesObject {
  metadata?: KubernetesObject["metadata"];
}

const Apply = vi.fn();
const Delete = vi.fn();
const Get = vi.fn();
const WithLabel = vi.fn();
const filteredClient = { Delete, Get, WithLabel };
const InNamespace = vi.fn(() => ({ Delete, Get, WithLabel }));

beforeEach(() => {
  vi.clearAllMocks();
  Apply.mockReset();
  Delete.mockReset();
  Get.mockReset();
  InNamespace.mockImplementation(() => ({ Delete, Get, WithLabel }));
  WithLabel.mockReturnValue(filteredClient);
  vi.mocked(K8s).mockReturnValue({ Apply, Delete, Get, InNamespace, WithLabel } as never);
  vi.mocked(k8sExec).mockReset();
});

describe("ownershipLabels", () => {
  it("preserves the stable owner when no run ID is supplied", () => {
    expect(ownershipLabels({ owner: "suite" })).toEqual({
      [TEST_OWNERSHIP_LABEL]: "suite",
    });
  });

  it("uses a separate label for an opt-in run ID", () => {
    expect(ownershipLabels({ owner: "suite.a", runId: "a.ci-42" })).toEqual({
      [TEST_OWNERSHIP_LABEL]: "suite.a",
      [TEST_RUN_ID_LABEL]: "a.ci-42",
    });
  });

  it.each([
    { owner: "" },
    { owner: "not/valid" },
    { owner: "suite", runId: "" },
    { owner: "a".repeat(64) },
  ])("rejects invalid ownership values: %o", options => {
    expect(() => ownershipLabels(options)).toThrow("Invalid Kubernetes");
  });

  it("rejects invalid custom label keys", () => {
    expect(() => ownershipLabels({ owner: "suite", labelKey: "Not Valid/key" })).toThrow(
      "Invalid Kubernetes ownership label key",
    );
  });

  it("supports distinct repository-specific owner and run-ID label keys", () => {
    expect(
      ownershipLabels({
        owner: "suite",
        runId: "ci-42",
        labelKey: "example.dev/owner",
        runIdLabelKey: "example.dev/run",
      }),
    ).toEqual({ "example.dev/owner": "suite", "example.dev/run": "ci-42" });
  });

  it("rejects colliding owner and run-ID label keys", () => {
    expect(() =>
      ownershipLabels({
        owner: "suite",
        runId: "ci-42",
        labelKey: "example.dev/identity",
        runIdLabelKey: "example.dev/identity",
      }),
    ).toThrow("must be different");
  });
});

describe("applyWithOwnership", () => {
  it("preserves existing labels, stamps ownership, and does not mutate input", async () => {
    const resource = {
      metadata: { name: "example", labels: { app: "demo" } },
    };
    Apply.mockResolvedValue(resource);

    await applyWithOwnership(ExampleResource, resource, { owner: "suite", force: true });

    expect(Apply).toHaveBeenCalledWith(
      {
        metadata: {
          name: "example",
          labels: { app: "demo", [TEST_OWNERSHIP_LABEL]: "suite" },
        },
      },
      { force: true },
    );
    expect(resource.metadata.labels).toEqual({ app: "demo" });
  });

  it("supports a repository-specific ownership label", async () => {
    await applyWithOwnership(
      ExampleResource,
      { metadata: { name: "example" } },
      {
        owner: "run-42",
        labelKey: "example.dev/run",
      },
    );

    expect(Apply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ labels: { "example.dev/run": "run-42" } }),
      }),
      { force: undefined },
    );
  });

  it("stamps the opt-in run ID into a separate label", async () => {
    await applyWithOwnership(
      ExampleResource,
      { metadata: { name: "example" } },
      {
        owner: "suite",
        runId: "ci-42",
      },
    );

    expect(Apply).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          labels: {
            [TEST_OWNERSHIP_LABEL]: "suite",
            [TEST_RUN_ID_LABEL]: "ci-42",
          },
        }),
      }),
      { force: undefined },
    );
  });
});

describe("deleteAllByOwnership", () => {
  it("rejects a blank namespace before making a request", async () => {
    await expect(
      deleteAllByOwnership(ExampleResource, { owner: "suite", namespace: " " }),
    ).rejects.toThrow("Resource namespace must not be blank");
    expect(Delete).not.toHaveBeenCalled();
  });

  it("deletes through exact owner and run-ID label selectors", async () => {
    await expect(
      deleteAllByOwnership(ExampleResource, {
        owner: "suite.a",
        runId: "a.ci-42",
        namespace: "testing",
      }),
    ).resolves.toBeUndefined();

    expect(InNamespace).toHaveBeenCalledWith("testing");
    expect(WithLabel).toHaveBeenNthCalledWith(1, TEST_OWNERSHIP_LABEL, "suite.a");
    expect(WithLabel).toHaveBeenNthCalledWith(2, TEST_RUN_ID_LABEL, "a.ci-42");
    expect(Delete).toHaveBeenCalledOnce();
    expect(Delete).toHaveBeenCalledWith();
  });

  it("optionally waits until the exact-label query is empty", async () => {
    Get.mockResolvedValueOnce({ items: [{ metadata: { name: "first" } }] });
    Get.mockResolvedValueOnce({ items: [] });

    await expect(
      deleteAllByOwnership(ExampleResource, {
        owner: "suite",
        waitForDeletion: true,
        timeoutMs: 50,
        intervalMs: 1,
      }),
    ).resolves.toBeUndefined();

    expect(Get).toHaveBeenCalledTimes(2);
    expect(WithLabel).toHaveBeenCalledWith(TEST_OWNERSHIP_LABEL, "suite");
  });

  it("falls back to identity-and-version preconditions when collection deletion is unsupported", async () => {
    Delete.mockRejectedValueOnce({ status: 405 });
    Get.mockResolvedValueOnce({
      items: [
        {
          metadata: {
            name: "testing",
            uid: "2d8eab64-62d5-4b59-a63c-31cfc178450e",
            resourceVersion: "42",
          },
        },
      ],
    });

    await expect(
      deleteAllByOwnership(ExampleResource, { owner: "suite" }),
    ).resolves.toBeUndefined();

    expect(k8sExec).toHaveBeenCalledWith(
      ExampleResource,
      { name: "testing", namespace: undefined },
      {
        method: "DELETE",
        payload: {
          apiVersion: "v1",
          kind: "DeleteOptions",
          preconditions: {
            resourceVersion: "42",
            uid: "2d8eab64-62d5-4b59-a63c-31cfc178450e",
          },
        },
      },
    );
  });

  it("refuses an unsafe fallback deletion without API identity metadata", async () => {
    Delete.mockRejectedValueOnce({ status: 405 });
    Get.mockResolvedValueOnce({ items: [{ metadata: { name: "testing" } }] });

    await expect(deleteAllByOwnership(ExampleResource, { owner: "suite" })).rejects.toThrow(
      "metadata.name, uid, and resourceVersion are required",
    );
    expect(k8sExec).not.toHaveBeenCalled();
  });

  it("re-lists after a precondition conflict instead of using stale identity data", async () => {
    const conflict = { status: 409 };
    Delete.mockRejectedValueOnce({ status: 405 });
    Get.mockResolvedValue({
      items: [
        {
          metadata: {
            name: "testing",
            uid: "2d8eab64-62d5-4b59-a63c-31cfc178450e",
            resourceVersion: "42",
          },
        },
      ],
    });
    vi.mocked(k8sExec).mockRejectedValueOnce(conflict);

    await expect(
      deleteAllByOwnership(ExampleResource, {
        owner: "suite",
        timeoutMs: 50,
        intervalMs: 1,
      }),
    ).resolves.toBeUndefined();
    expect(Get).toHaveBeenCalledTimes(2);
    expect(k8sExec).toHaveBeenCalledTimes(2);
  });

  it("propagates deletion failures", async () => {
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    Delete.mockRejectedValue(forbidden);

    await expect(deleteAllByOwnership(ExampleResource, { owner: "suite" })).rejects.toBe(forbidden);
  });
});

describe("waitForResource", () => {
  it("reads the named resource through the correct namespace", async () => {
    const resource = { metadata: { name: "example" } };
    Get.mockResolvedValue(resource);

    await expect(
      waitForResource(ExampleResource, {
        name: "example",
        namespace: "testing",
        timeoutMs: 50,
        intervalMs: 5,
      }),
    ).resolves.toBe(resource);

    expect(InNamespace).toHaveBeenCalledWith("testing");
    expect(Get).toHaveBeenCalledWith("example");
  });

  it.each([
    { name: "", namespace: "testing", message: "name" },
    { name: "   ", namespace: "testing", message: "name" },
    { name: "example", namespace: "", message: "namespace" },
    { name: "example", namespace: "   ", message: "namespace" },
  ])("rejects a blank $message before making a request", options => {
    expect(() => waitForResource(ExampleResource, options)).toThrow(
      `Resource ${options.message} must not be blank`,
    );
    expect(Get).not.toHaveBeenCalled();
  });
});

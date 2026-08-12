// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import type { KubernetesObject } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { K8s } from "../fluent/index.js";
import {
  TEST_OWNERSHIP_LABEL,
  applyWithOwnership,
  deleteAllByOwnership,
  deleteIgnoringNotFound,
  ownershipLabel,
  waitForResource,
} from "./resources.js";

vi.mock("../fluent/index.js", () => ({ K8s: vi.fn() }));

class ExampleResource implements KubernetesObject {
  metadata?: KubernetesObject["metadata"];
}

const Apply = vi.fn();
const Delete = vi.fn();
const Get = vi.fn();
const WithLabel = vi.fn(() => ({ Get }));
const InNamespace = vi.fn(() => ({ Delete, Get, WithLabel }));

beforeEach(() => {
  vi.clearAllMocks();
  Apply.mockReset();
  Delete.mockReset();
  Get.mockReset();
  InNamespace.mockImplementation(() => ({ Delete, Get, WithLabel }));
  WithLabel.mockImplementation(() => ({ Get }));
  vi.mocked(K8s).mockReturnValue({ Apply, Delete, Get, InNamespace, WithLabel } as never);
});

describe("ownershipLabel", () => {
  it("preserves the stable owner when no run ID is supplied", () => {
    expect(ownershipLabel({ owner: "suite" })).toEqual({
      key: TEST_OWNERSHIP_LABEL,
      value: "suite",
    });
  });

  it("adds an opt-in run ID", () => {
    expect(ownershipLabel({ owner: "suite", runId: "ci-42" })).toEqual({
      key: TEST_OWNERSHIP_LABEL,
      value: "suite.ci-42",
    });
  });

  it.each([
    { owner: "" },
    { owner: "not/valid" },
    { owner: "suite", runId: "" },
    { owner: "a".repeat(64) },
  ])("rejects invalid ownership values: %o", options => {
    expect(() => ownershipLabel(options)).toThrow("Invalid Kubernetes ownership label value");
  });

  it("rejects invalid custom label keys", () => {
    expect(() => ownershipLabel({ owner: "suite", labelKey: "Not Valid/key" })).toThrow(
      "Invalid Kubernetes ownership label key",
    );
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

  it("stamps the opt-in run ID into the ownership value", async () => {
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
          labels: { [TEST_OWNERSHIP_LABEL]: "suite.ci-42" },
        }),
      }),
      { force: undefined },
    );
  });
});

describe("deleteAllByOwnership", () => {
  it("lists and deletes only resources with the exact ownership label", async () => {
    Get.mockResolvedValue({
      items: [
        { metadata: { name: "first", namespace: "testing" } },
        { metadata: { name: "second", namespace: "testing" } },
      ],
    });

    await expect(
      deleteAllByOwnership(ExampleResource, {
        owner: "suite",
        runId: "ci-42",
        namespace: "testing",
      }),
    ).resolves.toEqual([
      { name: "first", namespace: "testing" },
      { name: "second", namespace: "testing" },
    ]);

    expect(WithLabel).toHaveBeenCalledWith(TEST_OWNERSHIP_LABEL, "suite.ci-42");
    expect(Delete).toHaveBeenCalledTimes(2);
    expect(Delete).toHaveBeenCalledWith("first");
    expect(Delete).toHaveBeenCalledWith("second");
  });

  it("does nothing when no owned resources exist", async () => {
    Get.mockResolvedValue({ items: [] });

    await expect(deleteAllByOwnership(ExampleResource, { owner: "suite" })).resolves.toEqual([]);
    expect(Delete).not.toHaveBeenCalled();
  });

  it("optionally waits for every deletion to finish", async () => {
    Get.mockResolvedValueOnce({ items: [{ metadata: { name: "first" } }] });
    Get.mockResolvedValueOnce({ metadata: { name: "first" } });
    Get.mockRejectedValueOnce({ status: 404 });

    await expect(
      deleteAllByOwnership(ExampleResource, {
        owner: "suite",
        waitForDeletion: true,
        timeoutMs: 50,
        intervalMs: 1,
      }),
    ).resolves.toEqual([{ name: "first" }]);

    expect(Get).toHaveBeenCalledTimes(3);
  });

  it("refuses to delete a malformed API response", async () => {
    Get.mockResolvedValue({ items: [{ metadata: {} }] });

    await expect(deleteAllByOwnership(ExampleResource, { owner: "suite" })).rejects.toThrow(
      "resource has no metadata.name",
    );
    expect(Delete).not.toHaveBeenCalled();
  });

  it("propagates deletion failures", async () => {
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    Get.mockResolvedValue({ items: [{ metadata: { name: "first" } }] });
    Delete.mockRejectedValue(forbidden);

    await expect(deleteAllByOwnership(ExampleResource, { owner: "suite" })).rejects.toBe(forbidden);
  });
});

describe("deleteIgnoringNotFound", () => {
  it("deletes a namespaced resource through KFC", async () => {
    await deleteIgnoringNotFound(ExampleResource, { name: "example", namespace: "testing" });

    expect(InNamespace).toHaveBeenCalledWith("testing");
    expect(Delete).toHaveBeenCalledWith("example");
  });

  it("propagates errors not suppressed by KFC", async () => {
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    Delete.mockRejectedValueOnce(forbidden);

    await expect(deleteIgnoringNotFound(ExampleResource, { name: "example" })).rejects.toBe(
      forbidden,
    );
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
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { describe, expect, it, vi } from "vitest";

import { collectDiagnostics } from "./diagnostics.js";

describe("collectDiagnostics", () => {
  it("collects values in declaration order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));

    await expect(
      collectDiagnostics({ namespace: "example" }, [
        { name: "namespace", collect: context => context.namespace },
        { name: "count", collect: async () => 2 },
      ]),
    ).resolves.toEqual({
      collectedAt: "2026-08-10T12:00:00.000Z",
      entries: [
        { name: "namespace", value: "example" },
        { name: "count", value: 2 },
      ],
    });

    vi.useRealTimers();
  });

  it("captures one collector failure without suppressing the others", async () => {
    const failure = new Error("pods unavailable");
    const report = await collectDiagnostics(undefined, [
      {
        name: "pods",
        collect: () => {
          throw failure;
        },
      },
      { name: "events", collect: () => ["scheduled"] },
    ]);

    expect(report.entries).toEqual([
      { name: "pods", error: failure },
      { name: "events", value: ["scheduled"] },
    ]);
  });
});

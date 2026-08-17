// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface PackResult {
  entryCount: number;
  files: { path: string }[];
  size: number;
  unpackedSize: number;
}

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const requiredFiles = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/test/index.js",
  "dist/test/index.d.ts",
  "dist/test/vitest/index.js",
  "dist/test/vitest/index.d.ts",
  "dist/test/vitest/setup.js",
  "dist/test/vitest/setup.d.ts",
];

describe("published package", () => {
  let npmCache: string | undefined;
  let packResult: PackResult;

  beforeAll(async () => {
    npmCache = await mkdtemp(join(tmpdir(), "kfc-package-check-"));
    [packResult] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--dry-run", "--ignore-scripts", "--cache", npmCache, "--json"],
        {
          encoding: "utf8",
        },
      ),
    ) as PackResult[];
  });

  afterAll(async () => {
    if (npmCache) await rm(npmCache, { recursive: true });
  });

  it("declares Vitest 3 and 4 as an optional peer dependency", () => {
    expect(packageJson.peerDependencies?.vitest).toBe("^3.2.4 || ^4.1.10");
    expect(packageJson.peerDependenciesMeta?.vitest?.optional).toBe(true);
  });

  it("loads every intentional public entry point and preserves existing deep imports", async () => {
    const entries = [
      packageJson.name,
      `${packageJson.name}/test`,
      `${packageJson.name}/test/vitest`,
      `${packageJson.name}/test/vitest/setup`,
      `${packageJson.name}/dist/fetch.js`,
    ];
    const [, , vitestConfigEntry, vitestSetupEntry] = (await Promise.all(
      entries.map(entry => import(entry)),
    )) as Record<string, unknown>[];

    expect(vitestConfigEntry.defineKubernetesTestConfig).toBeTypeOf("function");
    expect(vitestConfigEntry).not.toHaveProperty("setupKubernetesPreflight");
    expect(vitestSetupEntry.setupKubernetesPreflight).toBeTypeOf("function");
  });

  it.each(requiredFiles)("includes %s", file => {
    const packedFiles = new Set(packResult.files.map(entry => entry.path));
    expect(packedFiles).toContain(file);
  });

  it("compiles a consumer's Vitest configuration", async () => {
    const consumerRoot = await mkdtemp(join(tmpdir(), "kfc-consumer-check-"));

    try {
      const nodeModules = join(consumerRoot, "node_modules");
      const consumerConfig = join(consumerRoot, "vitest.config.ts");
      await mkdir(nodeModules);
      await symlink(packageRoot, join(nodeModules, packageJson.name), "dir");
      await writeFile(
        consumerConfig,
        'import { defineKubernetesTestConfig } from "kubernetes-fluent-client/test/vitest";\n' +
          "export default defineKubernetesTestConfig();\n",
      );
      execFileSync(
        join(packageRoot, "node_modules", ".bin", "tsc"),
        [
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          consumerConfig,
        ],
        { cwd: consumerRoot, encoding: "utf8" },
      );
    } finally {
      await rm(consumerRoot, { recursive: true });
    }
  });

  it("measures the published artifact", () => {
    expect(packResult.entryCount).toBeGreaterThan(0);
    expect(packResult.size).toBeGreaterThan(0);
    expect(packResult.unpackedSize).toBeGreaterThan(packResult.size);
  });
});

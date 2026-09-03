// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface PackResult {
  filename: string;
  files: { path: string }[];
}

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const allowedRootFiles = new Set(["LICENSE", "README.md", "package.json"]);
const implementationTestFile = /\.(?:test|spec)\.(?:d\.)?[cm]?[jt]sx?(?:\.map)?$/;
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
  let packageWorkspace: string | undefined;
  let consumerRoot: string;
  let npmCache: string;
  let tarballPath: string;
  let packResult: PackResult;

  beforeAll(async () => {
    packageWorkspace = await mkdtemp(join(tmpdir(), "kfc-package-check-"));
    consumerRoot = join(packageWorkspace, "consumer");
    npmCache = join(packageWorkspace, "npm-cache");
    const packDestination = join(packageWorkspace, "pack");
    await mkdir(packDestination);
    [packResult] = JSON.parse(
      execFileSync(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--cache",
          npmCache,
          "--json",
          "--pack-destination",
          packDestination,
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
        },
      ),
    ) as PackResult[];
    tarballPath = join(packDestination, packResult.filename);

    await mkdir(consumerRoot);
    await writeFile(
      join(consumerRoot, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--package-lock=false",
        "--cache",
        npmCache,
        tarballPath,
        `vitest@${packageJson.peerDependencies.vitest}`,
      ],
      { cwd: consumerRoot, encoding: "utf8" },
    );
  });

  afterAll(async () => {
    if (packageWorkspace) await rm(packageWorkspace, { recursive: true, force: true });
  });

  it("declares Vitest 4 as an optional peer dependency", () => {
    expect(packageJson.peerDependencies?.vitest).toBe("^4.1.10");
    expect(packageJson.peerDependenciesMeta?.vitest?.optional).toBe(true);
  });

  it("loads every intentional public entry point and preserves existing deep imports", async () => {
    const output = execFileSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        `
          import * as rootEntry from ${JSON.stringify(packageJson.name)};
          import ${JSON.stringify(`${packageJson.name}/test`)};
          import * as vitestConfigEntry from ${JSON.stringify(`${packageJson.name}/test/vitest`)};
          import * as vitestSetupEntry from ${JSON.stringify(`${packageJson.name}/test/vitest/setup`)};
          import ${JSON.stringify(`${packageJson.name}/dist/fetch.js`)};

          if (rootEntry.WatchPhase.Added !== "ADDED") throw new Error("WatchPhase is unavailable");
          if (typeof rootEntry.Watcher !== "function") throw new Error("Watcher is unavailable");
          if (typeof vitestConfigEntry.defineKubernetesTestConfig !== "function") throw new Error("Vitest config helper is unavailable");
          if ("setupKubernetesPreflight" in vitestConfigEntry) throw new Error("Vitest config entry exports setup helpers");
          if (typeof vitestSetupEntry.setupKubernetesPreflight !== "function") throw new Error("Vitest setup helper is unavailable");
        `,
      ],
      { cwd: consumerRoot, encoding: "utf8" },
    );

    expect(output).toBe("");
  });

  it.each(requiredFiles)("includes %s", file => {
    const packedFiles = new Set(packResult.files.map(entry => entry.path));
    expect(packedFiles).toContain(file);
  });

  it("compiles a NodeNext consumer using the public fluent API", async () => {
    const consumerConfig = join(consumerRoot, "vitest.config.ts");
    const consumerSource = join(consumerRoot, "consumer.ts");
    await writeFile(
      consumerConfig,
      'import { defineKubernetesTestConfig } from "kubernetes-fluent-client/test/vitest";\n' +
        "export default defineKubernetesTestConfig();\n",
    );
    await writeFile(
      consumerSource,
      'import { WatchEvent, WatchPhase, Watcher, type K8sInit, type KubernetesListObject, type WatchCfg, type WatcherType } from "kubernetes-fluent-client";\n' +
        "const phase = WatchPhase.Added;\n" +
        "const event = WatchEvent.CONNECT;\n" +
        "void phase;\n" +
        "void event;\n" +
        "void Watcher;\n" +
        "type PublicFluentTypes = [K8sInit<any, any>, KubernetesListObject<any>, WatchCfg, WatcherType<any>];\n" +
        "void (null as unknown as PublicFluentTypes);\n",
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
        consumerSource,
      ],
      { cwd: consumerRoot, encoding: "utf8" },
    );
  });

  it("includes files only from intentional package paths", () => {
    const unexpectedFiles = packResult.files
      .map(entry => entry.path)
      .filter(
        file =>
          !allowedRootFiles.has(file) && !file.startsWith("src/") && !file.startsWith("dist/"),
      );

    expect(unexpectedFiles).toEqual([]);
  });

  it("excludes implementation test files", () => {
    const testFiles = packResult.files
      .map(entry => entry.path)
      .filter(file => implementationTestFile.test(file));

    expect(testFiles).toEqual([]);
  });
});

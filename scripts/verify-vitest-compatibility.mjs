// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
assert(["4.1.10", "4.1.11", "5.0.4"].includes(version), "Pass a supported Vitest version");
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "kfc-vitest-compat-"));
const npmCache = process.env.npm_config_cache || join(workspace, "npm-cache");
const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

async function createConsumer(name, tarball, vitestVersion) {
  const cwd = join(workspace, name);
  await mkdir(cwd);
  await writeFile(join(cwd, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      npmCache,
      tarball,
      ...(vitestVersion ? [`vitest@${vitestVersion}`] : []),
    ],
    cwd,
  );
  return cwd;
}

try {
  await access(join(packageRoot, "dist/test/vitest/setup.js"));
  const [packed] = JSON.parse(
    run(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--cache", npmCache, "--pack-destination", workspace],
      packageRoot,
      true,
    ),
  );
  const tarball = join(workspace, packed.filename);
  const consumer = await createConsumer("vitest-consumer", tarball, version);
  const installedVitest = JSON.parse(
    await readFile(join(consumer, "node_modules/vitest/package.json"), "utf8"),
  );
  assert.equal(installedVitest.version, version);
  // npm rejects invalid peer relationships here as well as during installation.
  run("npm", ["ls", packageJson.name, "vitest"], consumer);

  await writeFile(
    join(consumer, "vitest.config.ts"),
    `import assert from "node:assert/strict";
import { defineKubernetesTestConfig, KUBERNETES_TEST_TIMEOUT_MS } from "kubernetes-fluent-client/test/vitest";

const defaults = defineKubernetesTestConfig();
assert.equal(KUBERNETES_TEST_TIMEOUT_MS, 120_000);
assert.deepEqual(defaults.test?.include, ["./*.test.ts"]);
assert.equal(defaults.test?.testTimeout, 120_000);
assert.equal(defaults.test?.hookTimeout, 120_000);

const config = defineKubernetesTestConfig({
  test: { include: ["compatibility.test.ts"], testTimeout: 5_000 },
});
assert.deepEqual(config.test?.include, ["compatibility.test.ts"]);
assert.equal(config.test?.testTimeout, 5_000);
assert.equal(config.test?.hookTimeout, 120_000);
export default config;
`,
  );
  await writeFile(
    join(consumer, "compatibility.test.ts"),
    `import type { KubeConfig } from "@kubernetes/client-node";
import { afterAll, describe, expect, it } from "vitest";
import { setupKubernetesPreflight } from "kubernetes-fluent-client/test/vitest/setup";

describe("published preflight helper", () => {
  let calls = 0;
  let completed = false;
  const kubeConfig = {
    getCurrentContext: () => "consumer",
    getCurrentCluster: () => ({ name: "consumer", server: "https://fixture.invalid" }),
    makeApiClient: () => ({
      getCode: async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        completed = true;
        return { gitVersion: "v1.33.1" };
      },
    }),
  } as unknown as KubeConfig;

  setupKubernetesPreflight({ kubeConfig });
  it("finishes preflight before the first test", () => {
    expect(completed).toBe(true);
    expect(calls).toBe(1);
  });
  it("does not repeat preflight before subsequent tests", () => {
    expect(completed).toBe(true);
    expect(calls).toBe(1);
  });
  afterAll(() => expect(calls).toBe(1));
});
`,
  );
  run(
    process.execPath,
    [
      join(packageRoot, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "vitest.config.ts",
      "compatibility.test.ts",
    ],
    consumer,
  );
  run(process.execPath, [join(consumer, "node_modules/vitest/vitest.mjs"), "run"], consumer);

  const neutralConsumer = await createConsumer("runner-neutral-consumer", tarball);
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as kfc from "kubernetes-fluent-client";
import * as helpers from "kubernetes-fluent-client/test";
assert.equal(typeof kfc.Watcher, "function");
assert.equal(typeof helpers.preflight, "function");
assert.throws(() => createRequire(import.meta.url).resolve("vitest"), { code: "MODULE_NOT_FOUND" });`,
    ],
    neutralConsumer,
  );
  console.log(`Published Vitest ${version} compatibility and optional-peer isolation passed.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

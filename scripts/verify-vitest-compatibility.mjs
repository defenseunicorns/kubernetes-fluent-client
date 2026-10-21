// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
const { peerDependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const peerRanges = peerDependencies.vitest.split(" || ");
assert(
  peerRanges.flatMap(range => [range.slice(1), range]).includes(version),
  "Pass an advertised Vitest caret range or its minimum version",
);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "kfc-vitest-compat-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_cache: process.env.npm_config_cache || join(workspace, "npm-cache"),
    },
    ...options,
  });
}

function install(...packages) {
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages]);
}

try {
  const [packed] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace], {
      cwd: packageRoot,
      stdio: "pipe",
    }),
  );
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  install(join(workspace, packed.filename));
  // Check optional-peer isolation before adding Vitest to this consumer.
  run(process.execPath, [
    "--input-type=module",
    "--eval",
    `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as kfc from "kubernetes-fluent-client";
import * as helpers from "kubernetes-fluent-client/test";
assert.equal(typeof kfc.Watcher, "function");
assert.equal(typeof helpers.preflight, "function");
assert.throws(() => createRequire(import.meta.url).resolve("vitest"), { code: "MODULE_NOT_FOUND" });`,
  ]);

  install(`vitest@${version}`);
  const installedVitest = JSON.parse(
    await readFile(join(workspace, "node_modules/vitest/package.json"), "utf8"),
  );
  if (!peerRanges.includes(version)) assert.equal(installedVitest.version, version);
  run("npm", ["ls", "kubernetes-fluent-client", "vitest"]);

  // Run the existing adapter tests against public exports of the installed tarball.
  for (const [name, entry] of [
    ["config", "kubernetes-fluent-client/test/vitest"],
    ["setup", "kubernetes-fluent-client/test/vitest/setup"],
  ]) {
    const source = await readFile(join(packageRoot, `src/test/vitest/${name}.test.ts`), "utf8");
    const localImport = `"./${name}.js"`;
    assert(source.includes(localImport), `Missing adapter import in ${name}.test.ts`);
    await writeFile(
      join(workspace, `${name}.test.ts`),
      source.replace(localImport, JSON.stringify(entry)),
    );
  }
  await writeFile(
    join(workspace, "vitest.config.ts"),
    `import assert from "node:assert/strict";
import { defineKubernetesTestConfig, KUBERNETES_TEST_TIMEOUT_MS } from "kubernetes-fluent-client/test/vitest";
const config = defineKubernetesTestConfig({ test: { testTimeout: 5_000 } });
assert.equal(KUBERNETES_TEST_TIMEOUT_MS, 120_000);
assert.equal(config.test?.testTimeout, 5_000);
assert.equal(config.test?.hookTimeout, 120_000);
export default config;
`,
  );
  await writeFile(
    join(workspace, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
    }),
  );
  run(process.execPath, [join(packageRoot, "node_modules/typescript/bin/tsc")]);
  run(process.execPath, [join(workspace, "node_modules/vitest/vitest.mjs"), "run"]);
  console.log(
    `Published Vitest ${installedVitest.version} (${version}) compatibility and optional-peer isolation passed.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

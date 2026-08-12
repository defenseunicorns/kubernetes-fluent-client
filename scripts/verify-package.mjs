// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

if (packageJson.peerDependencies?.vitest !== "^3.2.4 || ^4.1.10") {
  throw new Error("Vitest 3 and 4 must be declared as compatible peer dependencies");
}

if (packageJson.peerDependenciesMeta?.vitest?.optional !== true) {
  throw new Error("The Vitest peer dependency must be optional");
}

const [, , vitestConfigEntry, vitestSetupEntry] = await Promise.all([
  import("kubernetes-fluent-client"),
  import("kubernetes-fluent-client/test"),
  import("kubernetes-fluent-client/test/vitest"),
  import("kubernetes-fluent-client/test/vitest/setup"),
  import("kubernetes-fluent-client/dist/fetch.js"),
]);

if (
  typeof vitestConfigEntry.defineKubernetesTestConfig !== "function" ||
  "setupKubernetesPreflight" in vitestConfigEntry ||
  typeof vitestSetupEntry.setupKubernetesPreflight !== "function"
) {
  throw new Error("The Vitest config and runtime helpers must use separate package entries");
}

const npmCache = await mkdtemp(join(tmpdir(), "kfc-package-check-"));
let packResult;

try {
  packResult = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--cache", npmCache, "--json"], {
      encoding: "utf8",
    }),
  )[0];
} finally {
  await rm(npmCache, { recursive: true });
}

const packedFiles = new Set(packResult.files.map(file => file.path));
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

for (const file of requiredFiles) {
  if (!packedFiles.has(file)) {
    throw new Error(`Published package is missing ${file}`);
  }
}

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

console.log(
  `Package entry points verified: ${packResult.entryCount} files, ` +
    `${packResult.size} bytes packed, ${packResult.unpackedSize} bytes unpacked; ` +
    "consumer Vitest config compiled.",
);

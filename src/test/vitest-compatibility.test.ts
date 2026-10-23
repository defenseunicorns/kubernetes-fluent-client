// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const isCI = Boolean(process.env.CI);
const packTimeoutMs = isCI ? 60_000 : 30_000;
const installTimeoutMs = isCI ? 180_000 : 60_000;
const importTimeoutMs = isCI ? 30_000 : 10_000;
const consumerTimeoutMs = isCI ? 60_000 : 30_000;
const compatibilityTimeoutMs = isCI ? 420_000 : 180_000;
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const { peerDependencies } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const peerRanges: string[] = peerDependencies.vitest.split(" || ");
const versions = peerRanges.flatMap(range => [range.slice(1), range]);

describe("published Vitest compatibility", () => {
  let workspace: string;
  let tarball: string;
  const run = async (command: string, args: string[], timeout: number, cwd = workspace) => {
    const { stdout } = await exec(command, args, { cwd, encoding: "utf8", timeout });
    return stdout;
  };

  const installConsumer = async (version?: string) => {
    const consumer = await mkdtemp(join(workspace, "consumer-"));
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        tarball,
        ...(version ? [`vitest@${version}`] : []),
      ],
      installTimeoutMs,
      consumer,
    );
    return consumer;
  };

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "kfc-vitest-compat-"));
    const [packed] = JSON.parse(
      await run(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace],
        packTimeoutMs,
        packageRoot,
      ),
    ) as { filename: string }[];
    tarball = join(workspace, packed.filename);
  }, packTimeoutMs + 5_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it(
    "loads runner-neutral exports without installing Vitest",
    async () => {
      const consumer = await installConsumer();
      expect(() => createRequire(join(consumer, "package.json")).resolve("vitest")).toThrow(
        expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
      );
      const output = await run(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
      import { Watcher } from "kubernetes-fluent-client";
      import { preflight } from "kubernetes-fluent-client/test";
      console.log(JSON.stringify([typeof Watcher, typeof preflight]));
    `,
        ],
        importTimeoutMs,
        consumer,
      );
      expect(JSON.parse(output)).toEqual(["function", "function"]);
    },
    isCI ? 240_000 : 90_000,
  );

  it.each(versions)(
    "supports the packaged adapters with Vitest %s",
    async version => {
      const consumer = await installConsumer(version);
      const installed = JSON.parse(
        await readFile(join(consumer, "node_modules/vitest/package.json"), "utf8"),
      );
      if (!peerRanges.includes(version)) expect(installed.version).toBe(version);
      expect(
        await run("npm", ["ls", "kubernetes-fluent-client", "vitest"], importTimeoutMs, consumer),
      ).toContain(`vitest@${installed.version}`);

      for (const [name, entry] of [
        ["config", "kubernetes-fluent-client/test/vitest"],
        ["setup", "kubernetes-fluent-client/test/vitest/setup"],
      ]) {
        const source = await readFile(join(packageRoot, `src/test/vitest/${name}.test.ts`), "utf8");
        const localImport = `"./${name}.js"`;
        expect(source).toContain(localImport);
        await writeFile(
          join(consumer, `${name}.test.ts`),
          source.replace(localImport, JSON.stringify(entry)),
        );
      }
      await writeFile(
        join(consumer, "vitest.config.ts"),
        `
      import { defineKubernetesTestConfig } from "kubernetes-fluent-client/test/vitest";
      export default defineKubernetesTestConfig({ test: { testTimeout: 5_000 } });
    `,
      );
      await writeFile(
        join(consumer, "tsconfig.json"),
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
      await run(
        process.execPath,
        [join(packageRoot, "node_modules/typescript/bin/tsc")],
        consumerTimeoutMs,
        consumer,
      );
      await run(
        process.execPath,
        [join(consumer, "node_modules/vitest/vitest.mjs"), "run"],
        consumerTimeoutMs,
        consumer,
      );
    },
    compatibilityTimeoutMs,
  );
});

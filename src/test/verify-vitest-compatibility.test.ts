// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const { peerDependencies } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const peerRanges: string[] = peerDependencies.vitest.split(" || ");
const versions = peerRanges.flatMap(range => [range.slice(1), range]);

describe("published Vitest compatibility", () => {
  let workspace: string;
  let tarball: string;
  const run = (command: string, args: string[], cwd = workspace) =>
    execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: process.env.npm_config_cache || join(workspace, "npm-cache"),
      },
    });

  const installConsumer = async (version?: string) => {
    const consumer = await mkdtemp(join(workspace, "consumer-"));
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        tarball,
        ...(version ? [`vitest@${version}`] : []),
      ],
      consumer,
    );
    return consumer;
  };

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "kfc-vitest-compat-"));
    const [packed] = JSON.parse(
      run(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace],
        packageRoot,
      ),
    ) as { filename: string }[];
    tarball = join(workspace, packed.filename);
  }, 60_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it("loads runner-neutral exports without installing Vitest", async () => {
    const consumer = await installConsumer();
    expect(() => createRequire(join(consumer, "package.json")).resolve("vitest")).toThrow(
      expect.objectContaining({ code: "MODULE_NOT_FOUND" }),
    );
    const output = run(
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
      consumer,
    );
    expect(JSON.parse(output)).toEqual(["function", "function"]);
  }, 120_000);

  it.each(versions)(
    "supports the packaged adapters with Vitest %s",
    async version => {
      const consumer = await installConsumer(version);
      const installed = JSON.parse(
        await readFile(join(consumer, "node_modules/vitest/package.json"), "utf8"),
      );
      if (!peerRanges.includes(version)) expect(installed.version).toBe(version);
      expect(run("npm", ["ls", "kubernetes-fluent-client", "vitest"], consumer)).toContain(
        `vitest@${installed.version}`,
      );

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
      run(process.execPath, [join(packageRoot, "node_modules/typescript/bin/tsc")], consumer);
      run(process.execPath, [join(consumer, "node_modules/vitest/vitest.mjs"), "run"], consumer);
    },
    120_000,
  );
});

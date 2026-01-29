import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Helper that executes the built CLI (dist/cli.js) to keep these tests as close as possible
// to real end-user usage. We reject on non-zero exit codes so CI can detect failures.
const runCliCommand = (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    execFile("node", ["./dist/cli.js", ...args], (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

const readText = (filePath: string): string => fs.readFileSync(filePath, "utf8").trim();

describe("Clusterless CRD export (no cluster)", () => {
  const fixtureDir = path.join(__dirname, "crds/clusterless");
  const fixtureCrd = path.join(fixtureDir, "clusterless-crd.ts");
  const invalidSchemaFixtureCrd = path.join(fixtureDir, "invalid-schema-crd.ts");
  const outputDir = path.join(__dirname, "clusterless-tmp");

  const expectedYaml = path.join(fixtureDir, "widgets.example.com.expected.yaml");
  const expectedTs = path.join(fixtureDir, "widget-v1.expected.ts");

  beforeEach(() => {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  // Primary “clusterless export” use-case: produce Kubernetes YAML without generating types.
  // This must not require a Kubernetes cluster.
  it("exports YAML only with --export --exportOnly", async () => {
    const { stdout } = await runCliCommand([
      "crd",
      fixtureCrd,
      outputDir,
      "--export",
      "--exportOnly",
    ]);

    const yamlPath = path.join(outputDir, "widgets.example.com.yaml");
    expect(fs.existsSync(yamlPath)).toBe(true);

    expect(readText(yamlPath)).toBe(readText(expectedYaml));

    expect(stdout).toContain("✅ Exported 1 CRD manifest(s)");
  });

  // UX/contract test: --exportOnly is not meaningful unless --export is also set.
  // This should fail with a non-zero exit code and should not create any output files.
  it("fails fast when --exportOnly is provided without --export", async () => {
    await expect(
      runCliCommand(["crd", fixtureCrd, outputDir, "--exportOnly"]),
    ).rejects.toBeDefined();

    const files = fs.readdirSync(outputDir);
    expect(files).toEqual([]);
  });

  // Main “export + generate” workflow: export CRD YAML first, then generate types from the exported YAML.
  // This enables clusterless CI usage while preserving the same type-generation behavior.
  it("exports YAML and generates TS with --export", async () => {
    const { stdout } = await runCliCommand(["crd", fixtureCrd, outputDir, "--export"]);

    const yamlPath = path.join(outputDir, "widgets.example.com.yaml");
    const tsPath = path.join(outputDir, "widget-v1.ts");

    expect(fs.existsSync(yamlPath)).toBe(true);
    expect(fs.existsSync(tsPath)).toBe(true);

    expect(readText(yamlPath)).toBe(readText(expectedYaml));
    expect(readText(tsPath)).toBe(readText(expectedTs));

    expect(stdout).toContain("📝 Generating types from exported CRDs");
    expect(stdout).toContain("✅ Generated 1 files");
  });

  // Safety/behavior test: exporting should still succeed even if the CRD is not eligible for type generation.
  // In that scenario we expect YAML to be written, but the CLI should fail overall and produce no TS output.
  it("exports YAML but fails type generation when exported CRD is missing required schema", async () => {
    await expect(
      runCliCommand(["crd", invalidSchemaFixtureCrd, outputDir, "--export"]),
    ).rejects.toBeDefined();

    const yamlPath = path.join(outputDir, "invalidschema.example.com.yaml");
    expect(fs.existsSync(yamlPath)).toBe(true);

    const tsPath = path.join(outputDir, "invalidschema-v1.ts");
    expect(fs.existsSync(tsPath)).toBe(false);
  });
});

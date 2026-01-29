// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { exportCRDFromTS, generate } from "../src/generate.js";
import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "../src/generate.js";

describe("Export Integration Tests", () => {
  const testDir = path.join(process.cwd(), "test-export-tmp");

  beforeEach(() => {
    // Create test directory
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should export CRD from TypeScript file to YAML", async () => {
    const crdFile = path.join(testDir, "test-crd.mjs");
    const testCRD = `export const testCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "testcrds.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "TestCR", plural: "testcrs" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                properties: {
                  replicas: { type: "integer" },
                },
              },
            },
          },
        },
      },
    ],
  },
};
`;
    fs.writeFileSync(crdFile, testCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await exportCRDFromTS(opts);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("testcrds.example.com.yaml");
    expect(result.crds).toHaveLength(1);
    expect(result.crds[0].metadata?.name).toBe("testcrds.example.com");

    // Verify the file was created
    const exportedFile = result.files[0];
    expect(fs.existsSync(exportedFile)).toBe(true);

    // Verify the file contains valid YAML
    const content = fs.readFileSync(exportedFile, "utf8");
    expect(content).toContain("apiVersion:");
    expect(content).toContain("apiextensions.k8s.io/v1");
    expect(content).toContain("kind: CustomResourceDefinition");
    expect(content).toContain("name: testcrds.example.com");
  });

  test("should export CRD from a .ts module (tsx loader path)", async () => {
    const crdFile = path.join(testDir, "test-crd.ts");
    const testCRD = `export const testCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "tscrd.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "TSCRD", plural: "tscrds" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                properties: {
                  replicas: { type: "integer" },
                },
              },
            },
          },
        },
      },
    ],
  },
};
`;
    fs.writeFileSync(crdFile, testCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await exportCRDFromTS(opts);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("tscrd.example.com.yaml");
    expect(result.crds).toHaveLength(1);

    const content = fs.readFileSync(result.files[0], "utf8");
    expect(content).toContain("apiextensions.k8s.io/v1");
    expect(content).toContain("kind: CustomResourceDefinition");
    expect(content).toContain("name: tscrd.example.com");
  });

  test("should handle export-only mode correctly", async () => {
    const crdFile = path.join(testDir, "export-only-test.mjs");
    const testCRD = `export const testCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "testcrds.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "TestCR", plural: "testcrs" },
    scope: "Namespaced",
    versions: [{ name: "v1" }],
  },
};
`;
    fs.writeFileSync(crdFile, testCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await generate(opts);

    // In export-only mode, generate should return empty array
    expect(result).toEqual([]);
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining("Exported 1 CRD"));
  });

  test("should export and generate types from a TypeScript CRD module", async () => {
    const crdFile = path.join(testDir, "export-and-generate.ts");
    const testCRD = `export const testCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "exportgen.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "ExportGen", plural: "exportgens" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                properties: {
                  replicas: { type: "integer" },
                },
              },
            },
          },
        },
      },
    ],
  },
};
`;
    fs.writeFileSync(crdFile, testCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: false,
    };

    const results = await generate(opts);

    expect(results).toHaveLength(1);
    expect(results[0].crd.metadata?.name).toBe("exportgen.example.com");
    expect(results[0].version).toBe("v1");

    expect(fs.existsSync(path.join(testDir, "exportgen.example.com.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "exportgen-v1.ts"))).toBe(true);
  });

  test("should handle multiple CRDs in single file", async () => {
    const crdFile = path.join(testDir, "multi-crd.mjs");
    const multiCRD = `export const crd1 = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "crd1.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "CRD1", plural: "crd1s" },
    scope: "Namespaced",
    versions: [{ name: "v1" }],
  },
};

export const crd2 = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "crd2.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "CRD2", plural: "crd2s" },
    scope: "Namespaced",
    versions: [{ name: "v1" }],
  },
};
`;
    fs.writeFileSync(crdFile, multiCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await exportCRDFromTS(opts);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toContain("crd1.example.com.yaml");
    expect(result.files[1]).toContain("crd2.example.com.yaml");
    expect(result.crds).toHaveLength(2);

    // Verify both files were created
    expect(fs.existsSync(result.files[0])).toBe(true);
    expect(fs.existsSync(result.files[1])).toBe(true);
  });

  test("should skip invalid CRDs and continue with valid ones", async () => {
    const crdFile = path.join(testDir, "mixed-crd.mjs");
    const mixedCRD = `export const validCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "valid.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Valid", plural: "valids" },
    scope: "Namespaced",
    versions: [{ name: "v1" }],
  },
};

export const invalidCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "invalid.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Invalid", plural: "invalids" },
    scope: "Namespaced",
    versions: [], // Invalid: empty versions
  },
};
`;
    fs.writeFileSync(crdFile, mixedCRD);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: crdFile,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await exportCRDFromTS(opts);

    // Should only export the valid CRD
    expect(result.files).toHaveLength(1);
    expect(result.crds).toHaveLength(1);
    expect(result.files[0]).toContain("valid.example.com.yaml");
    expect(result.crds[0].metadata?.name).toBe("valid.example.com");

    // Should have logged a skip message for the invalid CRD
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining("Skipping invalidCRD"));
  });

  test("should ignore non-CRD exports", async () => {
    const filePath = path.join(testDir, "mixed-exports.mjs");
    const content = `export const deployment = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "demo" },
  spec: {},
};

export const crd = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "onlycrd.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "OnlyCRD", plural: "onlycrds" },
    scope: "Namespaced",
    versions: [{ name: "v1" }],
  },
};
`;
    fs.writeFileSync(filePath, content);

    const logFn = vi.fn();
    const opts: GenerateOptions = {
      source: filePath,
      directory: testDir,
      language: "ts",
      logFn,
      plain: false,
      npmPackage: "kubernetes-fluent-client",
      export: true,
      exportOnly: true,
    };

    const result = await exportCRDFromTS(opts);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("onlycrd.example.com.yaml");

    expect(logFn).not.toHaveBeenCalledWith(expect.stringContaining("Skipping deployment"));
  });
});

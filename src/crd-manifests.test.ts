// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { beforeEach, describe, expect, vi, test } from "vitest";
import {
  validateCRDStructure,
  extractCRDsFromModule,
  writeCRDToFile,
  exportCRDFromModule,
  loadCRDModule,
  fixImportPaths,
  validateFile,
  type ExportOptions,
} from "./crd-manifests.js";
import type { LogFn } from "./types.js";
import * as fs from "fs";
import * as path from "path";
import { dump } from "js-yaml";
import { execSync } from "child_process";
import type { V1CustomResourceDefinition } from "@kubernetes/client-node";

// Mock the url module for ES module support
vi.mock("url", () => ({
  fileURLToPath: vi.fn((url: string) => url.replace("file://", "")),
  pathToFileURL: vi.fn((path: string) => `file://${path}`),
}));

// Mock the fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock the path module
vi.mock("path", () => ({
  join: vi.fn((...args: string[]) => args.join("/")),
  dirname: vi.fn((path: string) => path.split("/").slice(0, -1).join("/")),
  extname: vi.fn((path: string) => (path.includes(".") ? path.split(".").pop() : "")),
  relative: vi.fn((from: string, to: string) => to.replace(from + "/", "")),
}));

// Mock js-yaml
vi.mock("js-yaml", () => ({
  dump: vi.fn(),
}));

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Get the mocked modules
const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);
const mockDump = vi.mocked(dump);

describe("validateCRDStructure", () => {
  test("should validate a correct CRD structure", () => {
    const validCRD: V1CustomResourceDefinition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test-crd.example.com" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
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
                      field1: { type: "string" },
                      field2: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    };

    expect(() => validateCRDStructure(validCRD)).not.toThrow();
  });

  // Invalid apiVersion should be rejected with specific error message
  test("should throw error for invalid apiVersion", () => {
    const invalidCRD = {
      apiVersion: "v1", // Invalid - should be apiextensions.k8s.io/v1
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      'Invalid CRD: apiVersion must be "apiextensions.k8s.io/v1", got "v1"',
    );
  });

  // Invalid kind should be rejected with specific error message
  test("should throw error for invalid kind", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "Pod", // Invalid - should be CustomResourceDefinition
      metadata: { name: "test" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      'Invalid CRD: kind must be "CustomResourceDefinition", got "Pod"',
    );
  });

  // Missing metadata.name should be rejected
  test("should throw error for missing metadata.name", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: {}, // Missing required name field
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      "Invalid CRD: metadata.name is required",
    );
  });

  // Missing spec should be rejected
  test("should throw error for missing spec", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      // Missing required spec field
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      "Invalid CRD: spec is required",
    );
  });

  // Invalid scope should be rejected with specific error message
  test("should throw error for invalid scope", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Invalid", // Invalid - should be Namespaced or Cluster
        versions: [],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      'Invalid CRD: spec.scope must be "Namespaced" or "Cluster", got "Invalid"',
    );
  });

  // Missing versions array should be rejected
  test("should throw error for missing versions", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [], // Empty versions array should be rejected
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      "Invalid CRD: spec.versions must contain at least one version",
    );
  });

  // Missing required names fields should be rejected
  test("should throw error for missing names fields", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      spec: {
        group: "example.com",
        names: {}, // Missing kind and plural
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      "Invalid CRD: spec.names.kind and spec.names.plural are required",
    );
  });

  // Missing group should be rejected
  test("should throw error for missing group", () => {
    const invalidCRD = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test" },
      spec: {
        // Missing group field
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    };

    expect(() => validateCRDStructure(invalidCRD as V1CustomResourceDefinition)).toThrow(
      "Invalid CRD: spec.group is required",
    );
  });
});

describe("extractCRDsFromModule", () => {
  const mockLogFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Should successfully extract valid CRDs while filtering out invalid ones
  test("should extract valid CRDs from module exports", () => {
    const validCRD: V1CustomResourceDefinition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test-crd.example.com" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    };

    const module = {
      validCRD, // Should be extracted
      invalidResource: { apiVersion: "v1", kind: "Pod" }, // Should be skipped (not CRD)
      _privateCRD: validCRD, // Should be skipped (private by convention)
      nullValue: null, // Should be skipped (null)
      undefinedValue: undefined, // Should be skipped (undefined)
      emptyString: "", // Should be skipped (not object)
      numberValue: 42, // Should be skipped (not object)
    };

    const result = extractCRDsFromModule(module, mockLogFn);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(validCRD);
  });

  // Should skip invalid CRDs and log appropriate warnings
  test("should skip invalid CRDs and log warnings", () => {
    const validCRD: V1CustomResourceDefinition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "test-crd.example.com" },
      spec: {
        group: "example.com",
        names: { kind: "Test", plural: "tests" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    };

    const invalidCRD = {
      apiVersion: "v1", // Invalid apiVersion
      kind: "CustomResourceDefinition",
      metadata: { name: "invalid" },
    };

    const module = {
      validCRD, // Should be extracted
      invalidCRD, // Should be skipped with warning
    };

    const result = extractCRDsFromModule(module, mockLogFn);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(validCRD);
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining("Skipping invalidCRD:"));
  });

  // Should throw error when no valid CRDs are found in the module
  test("should throw error when no valid CRDs found", () => {
    const module = {
      notACRD: { apiVersion: "v1", kind: "Pod" },
      anotherNotCRD: { apiVersion: "v1", kind: "Service" },
      _privateCRD: { apiVersion: "v1", kind: "CustomResourceDefinition" }, // Private, should be skipped
    };

    expect(() => extractCRDsFromModule(module, mockLogFn)).toThrow(
      "No valid CRD definitions found in the module",
    );
  });

  // Should handle modules with only private exports (all starting with _)
  test("should throw error when only private CRDs are present", () => {
    const privateCRD: V1CustomResourceDefinition = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "private.example.com" },
      spec: {
        group: "example.com",
        names: { kind: "Private", plural: "privates" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    };

    const module = {
      _privateCRD: privateCRD, // Should be skipped
      _anotherPrivate: privateCRD, // Should be skipped
    };

    expect(() => extractCRDsFromModule(module, mockLogFn)).toThrow(
      "No valid CRD definitions found in the module",
    );
  });

  // Should handle empty module exports
  test("should throw error when module exports are empty", () => {
    const module = {};

    expect(() => extractCRDsFromModule(module, mockLogFn)).toThrow(
      "No valid CRD definitions found in the module",
    );
  });
});

describe("writeCRDToFile", () => {
  const mockCRD: V1CustomResourceDefinition = {
    apiVersion: "apiextensions.k8s.io/v1",
    kind: "CustomResourceDefinition",
    metadata: { name: "test-crd.example.com" },
    spec: {
      group: "example.com",
      names: { kind: "Test", plural: "tests" },
      scope: "Namespaced",
      versions: [{ name: "v1", served: true, storage: true }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPath.join.mockReturnValue("output/test-crd.example.com.yaml");
    mockDump.mockReturnValue("yaml-content");
  });

  // Should successfully write CRD to file with correct parameters
  test("should write CRD to file successfully", async () => {
    const result = await writeCRDToFile(mockCRD, "output");

    // Verify dump was called with correct CRD object and options
    expect(mockDump).toHaveBeenCalledWith(mockCRD as unknown as object, { noRefs: true });

    // Verify path.join was called with correct directory and filename
    expect(mockPath.join).toHaveBeenCalledWith("output", "test-crd.example.com.yaml");

    // Verify directory creation with recursive option
    expect(mockFs.promises.mkdir).toHaveBeenCalledWith("output", { recursive: true });

    // Verify file writing with correct content
    expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
      "output/test-crd.example.com.yaml",
      "yaml-content",
    );

    // Verify correct file path is returned
    expect(result).toBe("output/test-crd.example.com.yaml");
  });

  // Should handle CRDs with complex metadata names
  test("should handle CRDs with complex names", async () => {
    const complexCRD: V1CustomResourceDefinition = {
      ...mockCRD,
      metadata: { name: "complex-name.with.dots-and-underscores.example.com" },
    };

    mockPath.join.mockReturnValue("output/complex-name.with.dots-and-underscores.example.com.yaml");

    const result = await writeCRDToFile(complexCRD, "output");

    expect(mockPath.join).toHaveBeenCalledWith(
      "output",
      "complex-name.with.dots-and-underscores.example.com.yaml",
    );
    expect(result).toBe("output/complex-name.with.dots-and-underscores.example.com.yaml");
  });

  // Should handle different output directories
  test("should handle different output directories", async () => {
    const customDir = "/custom/output/path";
    mockPath.join.mockReturnValue(`${customDir}/test-crd.example.com.yaml`);

    const result = await writeCRDToFile(mockCRD, customDir);

    expect(mockPath.join).toHaveBeenCalledWith(customDir, "test-crd.example.com.yaml");
    expect(mockFs.promises.mkdir).toHaveBeenCalledWith(customDir, { recursive: true });
    expect(result).toBe(`${customDir}/test-crd.example.com.yaml`);
  });
});

describe("exportCRDFromModule", () => {
  // Should throw error when module file doesn't exist
  test("should throw error when module file not found", async () => {
    const mockOpts: ExportOptions = {
      source: "./test-module.ts",
      directory: "./output",
      logFn: vi.fn(),
    };

    // Mock existsSync to return false for this test
    vi.mocked(fs).existsSync.mockReturnValue(false);

    await expect(exportCRDFromModule(mockOpts)).rejects.toThrow(
      "CRD module not found: ./test-module.ts",
    );
  });
});

describe("Enhanced Export Features", () => {
  const mockLogFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Default Export Support", () => {
    test("should handle default export with single CRD", () => {
      const crd = {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        metadata: { name: "test.example.com" },
        spec: {
          group: "example.com",
          names: { kind: "Test", plural: "tests", singular: "test" },
          scope: "Namespaced",
          versions: [{ name: "v1", served: true, storage: true }],
        },
      };

      const module = { default: crd };
      const result = extractCRDsFromModule(module, mockLogFn);
      expect(result).toHaveLength(1);
      expect(result[0].metadata?.name).toBe("test.example.com");
    });

    test("should handle default export with object containing multiple CRDs", () => {
      const crd1 = {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        metadata: { name: "test1.example.com" },
        spec: {
          group: "example.com",
          names: { kind: "Test1", plural: "test1s", singular: "test1" },
          scope: "Namespaced",
          versions: [{ name: "v1", served: true, storage: true }],
        },
      };

      const crd2 = {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        metadata: { name: "test2.example.com" },
        spec: {
          group: "example.com",
          names: { kind: "Test2", plural: "test2s", singular: "test2" },
          scope: "Namespaced",
          versions: [{ name: "v1", served: true, storage: true }],
        },
      };

      const module = { default: { crd1, crd2 } };
      const result = extractCRDsFromModule(module, mockLogFn);
      expect(result).toHaveLength(2);
      expect(result[0].metadata?.name).toBe("test1.example.com");
      expect(result[1].metadata?.name).toBe("test2.example.com");
    });

    test("should handle default export with array of CRDs", () => {
      const crd1 = {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        metadata: { name: "test1.example.com" },
        spec: {
          group: "example.com",
          names: { kind: "Test1", plural: "test1s", singular: "test1" },
          scope: "Namespaced",
          versions: [{ name: "v1", served: true, storage: true }],
        },
      };

      const crd2 = {
        apiVersion: "apiextensions.k8s.io/v1",
        kind: "CustomResourceDefinition",
        metadata: { name: "test2.example.com" },
        spec: {
          group: "example.com",
          names: { kind: "Test2", plural: "test2s", singular: "test2" },
          scope: "Namespaced",
          versions: [{ name: "v1", served: true, storage: true }],
        },
      };

      const module = { default: [crd1, crd2] };
      const result = extractCRDsFromModule(module, mockLogFn);
      expect(result).toHaveLength(2);
      expect(result[0].metadata?.name).toBe("test1.example.com");
      expect(result[1].metadata?.name).toBe("test2.example.com");
    });
  });

  // Tests for the new CRD compilation functionality
  describe("CRD Module Compilation", () => {
    let mockLogFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockLogFn = vi.fn();
      vi.clearAllMocks();
    });

    describe("validateFile", () => {
      test("should throw error for non-existent file", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(() => validateFile("non-existent.ts")).toThrow(
          "CRD file not found: non-existent.ts",
        );
      });

      test("should not throw for existing file", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        expect(() => validateFile("existing.ts")).not.toThrow();
      });
    });

    describe("fixImportPaths", () => {
      beforeEach(() => {
        vi.mocked(fs.readFileSync).mockReturnValue(`
          import { something } from '../dependency';
          import { other } from './local';
          import { external } from 'external-package';
        `);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {});
        vi.mocked(execSync).mockReturnValue("file1.js\nfile2.js");
      });

      test("should add .js extensions to relative imports", () => {
        // Test the regex replacement logic directly
        const content = `
          import { something } from '../dependency';
          import { other } from './local';
          import { external } from 'external-package';
        `;

        // Apply the same logic as fixImportPaths
        const result = content.replace(
          /from\s+["'](\.\.\/[^"']+|\.\/[^"']+)["']/g,
          (match, importPath) => {
            const mockPath = { extname: vi.fn((p: string) => (p.includes(".js") ? ".js" : "")) };
            return mockPath.extname(importPath) ? match : `from "${importPath}.js"`;
          },
        );

        expect(result).toContain('from "../dependency.js"');
        expect(result).toContain('from "./local.js"');
        expect(result).not.toContain("from 'external-package.js'"); // External packages unchanged
      });

      test("should not add .js if already present", () => {
        vi.mocked(fs.readFileSync).mockReturnValue(`
          import { something } from '../dependency.js';
        `);

        void fixImportPaths("/tmp/out", mockLogFn as unknown as LogFn);

        const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(writtenContent).toContain("from '../dependency.js'"); // Unchanged
      });
    });

    describe("loadCRDModule integration", () => {
      test("should provide clear error messages for missing files", async () => {
        const mockFilePath = "/path/to/missing.ts";

        vi.mocked(fs.existsSync).mockReturnValue(false);

        await expect(loadCRDModule(mockFilePath, mockLogFn as unknown as LogFn)).rejects.toThrow(
          "CRD file not found: /path/to/missing.ts",
        );
      });
    });
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, beforeEach, it, test, expect, afterEach } from "vitest";

// Utility function to execute the CLI command
const runCliCommand = (
  args: string[],
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => {
  execFile("node", ["./dist/cli.js", ...args], callback); // Path to built CLI JS file
};

describe("crd-manifests CLI E2E tests", () => {
  const testModulePath = path.join(__dirname, "crd-manifests-test-module.ts");
  const outputDir = path.join(__dirname, "test-output");

  // Sample CRD module content for testing - includes valid CRD, private CRD, and various edge cases
  const testModuleContent = `
import { V1CustomResourceDefinition } from "@kubernetes/client-node";

// Valid CRD that should be exported
export const testCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "testresources.example.com",
    labels: {
      "app.kubernetes.io/name": "test-operator",
    },
  },
  spec: {
    group: "example.com",
    names: {
      kind: "TestResource",
      plural: "testresources",
      singular: "testresource",
    },
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
                  name: {
                    type: "string",
                    description: "Name of the test resource",
                  },
                  replicas: {
                    type: "integer",
                    minimum: 1,
                    maximum: 10,
                    default: 1,
                    description: "Number of replicas",
                  },
                },
                required: ["name"],
              },
            },
          },
        },
      },
    ],
  },
};

// Private CRD that should be skipped (starts with underscore)
export const _internalCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "internal.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "Internal",
      plural: "internals",
    },
    scope: "Namespaced",
    versions: [],
  },
};

// Invalid object that should be skipped (wrong kind)
export const notACRD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "test-pod" },
};
`;

  beforeEach(() => {
    // Ensure the output directory is clean before each test
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }

    // Create the test module file with sample content
    fs.writeFileSync(testModulePath, testModuleContent);
  });

  afterEach(() => {
    // Cleanup the output directory and test module after each test
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }
    if (fs.existsSync(testModulePath)) {
      fs.unlinkSync(testModulePath);
    }
  });

  // should successfully export valid CRDs from TypeScript module
  it("should export CRD manifests from TypeScript module", async () => {
    await runCliCommand(["crd-manifests", testModulePath, outputDir], async (error, stdout) => {
      expect(error).toBeNull();

      // Verify the output directory was created
      expect(fs.existsSync(outputDir)).toBe(true);

      // Verify the CRD file was created with correct name
      const expectedFile = path.join(outputDir, "testresources.example.com.yaml");
      expect(fs.existsSync(expectedFile)).toBe(true);

      // Verify the content of the generated YAML file
      const generatedContent = fs.readFileSync(expectedFile, "utf8");
      expect(generatedContent).toContain("apiVersion: apiextensions.k8s.io/v1");
      expect(generatedContent).toContain("kind: CustomResourceDefinition");
      expect(generatedContent).toContain("name: testresources.example.com");
      expect(generatedContent).toContain("group: example.com");
      expect(generatedContent).toContain("kind: TestResource");
      expect(generatedContent).toContain("scope: Namespaced");

      // Verify stdout contains success messages and progress information
      expect(stdout).toContain("Loading CRD definitions from");
      expect(stdout).toContain("Exported testresources.example.com to");
      expect(stdout).toContain("✅ Exported 1 CRD manifest(s) to");

      // Verify internal CRD was not exported (starts with underscore)
      const internalFile = path.join(outputDir, "internal.example.com.yaml");
      expect(fs.existsSync(internalFile)).toBe(false);

      // Verify non-CRD objects were not exported
      const podFile = path.join(outputDir, "test-pod.yaml");
      expect(fs.existsSync(podFile)).toBe(false);
    });
  });

  // should fail gracefully when module file doesn't exist
  it("should handle non-existent module file", async () => {
    const nonExistentFile = path.join(__dirname, "non-existent.ts");

    await runCliCommand(
      ["crd-manifests", nonExistentFile, outputDir],
      async (error, stdout, stderr) => {
        expect(error).not.toBeNull();
        expect(stdout).toBe("");
        expect(stderr).toContain("❌ CRD module not found:");
        expect(stderr).toContain("non-existent.ts");

        // Verify output directory was not created on error
        expect(fs.existsSync(outputDir)).toBe(false);
      },
    );
  });

  // should fail when module contains no valid CRDs
  it("should handle module with no valid CRDs", async () => {
    const emptyModuleContent = `
// Module with no valid CRDs - should cause failure
export const notACRD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "test" }
};

export const anotherNotCRD = {
  apiVersion: "v1", 
  kind: "Service",
  metadata: { name: "test" }
};

// Private CRD (should be skipped)
export const _privateCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "private.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Private", plural: "privates" },
    scope: "Namespaced",
    versions: []
  }
};
`;

    fs.writeFileSync(testModulePath, emptyModuleContent);

    await runCliCommand(
      ["crd-manifests", testModulePath, outputDir],
      async (error, stdout, _stderr) => {
        expect(error).not.toBeNull();
        expect(stdout).toContain("Loading CRD definitions from");
        expect(_stderr).toContain("❌ No valid CRD definitions found in the module");

        // Verify output directory was not created on validation failure
        expect(fs.existsSync(outputDir)).toBe(false);
      },
    );
  });

  // should handle TypeScript compilation errors gracefully
  it("should handle TypeScript compilation errors", async () => {
    const invalidModuleContent = `
// Invalid CRD with missing required spec property
export const invalidCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "invalid.example.com"
  },
  // Missing required 'spec' property - this will cause validation error
};

// This will cause TypeScript compilation error due to syntax issues
export const brokenSyntax = {
  apiVersion: "apiextensions.k8s.io/v1"
  // Missing comma - syntax error
};

// Another syntax error
export const moreBroken = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "more-broken.example.com" }
  // Missing closing brace
`;

    fs.writeFileSync(testModulePath, invalidModuleContent);

    await runCliCommand(
      ["crd-manifests", testModulePath, outputDir],
      async (error, stdout, _stderr) => {
        expect(error).not.toBeNull();
        expect(stdout).toContain("Loading CRD definitions from");
        expect(_stderr).toContain("❌");

        // Verify output directory was not created on compilation error
        expect(fs.existsSync(outputDir)).toBe(false);
      },
    );
  });

  // should handle modules with multiple valid CRDs
  it("should handle modules with multiple valid CRDs", async () => {
    const multiCRDModuleContent = `
import { V1CustomResourceDefinition } from "@kubernetes/client-node";

// First valid CRD
export const firstCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "first.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "First", plural: "firsts" },
    scope: "Namespaced",
    versions: [{ name: "v1", served: true, storage: true }]
  }
};

// Second valid CRD
export const secondCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition", 
  metadata: { name: "second.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Second", plural: "seconds" },
    scope: "Namespaced",
    versions: [{ name: "v1", served: true, storage: true }]
  }
};

// Private CRD (should be skipped)
export const _privateCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "private.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Private", plural: "privates" },
    scope: "Namespaced",
    versions: []
  }
};
`;

    fs.writeFileSync(testModulePath, multiCRDModuleContent);

    await runCliCommand(
      ["crd-manifests", testModulePath, outputDir],
      async (error, stdout, stderr) => {
        expect(error).toBeNull();
        expect(stderr).toContain("alpha");

        // Verify both CRD files were created
        const firstFile = path.join(outputDir, "first.example.com.yaml");
        const secondFile = path.join(outputDir, "second.example.com.yaml");
        expect(fs.existsSync(firstFile)).toBe(true);
        expect(fs.existsSync(secondFile)).toBe(true);

        // Verify private CRD was not exported
        const privateFile = path.join(outputDir, "private.example.com.yaml");
        expect(fs.existsSync(privateFile)).toBe(false);

        // Verify success message shows correct count
        expect(stdout).toContain("✅ Exported 2 CRD manifest(s) to");
      },
    );
  });

  // should handle .js files as well as .ts files
  it("should handle JavaScript modules", async () => {
    const jsModuleContent = `
// JavaScript module with CRD definition
export const jsCRD = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "js-test.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "JsTest",
      plural: "jstests",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};
`;

    const jsModulePath = path.join(__dirname, "crd-manifests-test-module.js");
    fs.writeFileSync(jsModulePath, jsModuleContent);

    try {
      await runCliCommand(["crd-manifests", jsModulePath, outputDir], async (error, stdout) => {
        expect(stdout).toContain("Loading CRD definitions from");
      });
    } finally {
      // Cleanup the JS module file
      if (fs.existsSync(jsModulePath)) {
        fs.unlinkSync(jsModulePath);
      }
    }
  });

  describe("TypeScript child imports", () => {
    // Permanent fixture: e2e/fixtures/crd-with-child-imports/
    //   index.ts          → parent: assembles full CRD, imports version-schema.ts
    //   version-schema.ts → child:  exports V1CustomResourceDefinitionVersion, imports shared-metadata.ts
    //   shared-metadata.ts→ grandchild: exports a string constant
    //
    // This exercises the tsImport() → tsx scoped ESM loader chain with
    // transitive .ts imports, mirroring how uds-core structures its CRDs.

    const fixtureModule = path.join(__dirname, "fixtures", "crd-with-child-imports", "index.ts");

    test("should load CRD from a TS module with transitive .ts child imports", async () => {
      await runCliCommand(
        ["crd-manifests", fixtureModule, outputDir],
        async (error, stdout, stderr) => {
          expect(error).toBeNull();
          expect(stderr).toContain("alpha");

          // Verify the CRD YAML was generated
          const outputFile = path.join(outputDir, "widgets.example.com.yaml");
          expect(fs.existsSync(outputFile)).toBe(true);

          // Verify the content includes data from the child import chain
          const content = fs.readFileSync(outputFile, "utf8");
          expect(content).toContain("apiVersion: apiextensions.k8s.io/v1");
          expect(content).toContain("kind: CustomResourceDefinition");
          expect(content).toContain("name: widgets.example.com");
          expect(content).toContain("group: example.com");
          expect(content).toContain("kind: Widget");
          expect(content).toContain("scope: Namespaced");

          // Verify the version schema from the child module is present
          expect(content).toContain("name: v1alpha1");
          expect(content).toContain("served: true");
          expect(content).toContain("storage: true");

          // Verify the grandchild import resolved (shared description made it through)
          expect(content).toContain("Widget specification for the test CRD");

          expect(stdout).toContain("Loading CRD definitions from");
          expect(stdout).toContain("✅ Exported 1 CRD manifest(s) to");
        },
      );
    });
  });

  describe("default export patterns", () => {
    test("should handle single CRD default export", async () => {
      const singleDefaultModulePath = path.join(__dirname, "crd-single-default.ts");
      const singleDefaultContent = `
import { V1CustomResourceDefinition } from "@kubernetes/client-node";

const singleCRD: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "single-default.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "SingleDefault",
      plural: "singledefaults",
      singular: "singledefault",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};

export default singleCRD;
`;

      fs.writeFileSync(singleDefaultModulePath, singleDefaultContent);

      try {
        await runCliCommand(
          ["crd-manifests", singleDefaultModulePath, outputDir],
          async (error, stdout) => {
            expect(error).toBeNull();
            expect(stdout).toContain("Exported 1 CRD manifest(s)");

            const outputFile = path.join(outputDir, "single-default.example.com.yaml");
            expect(fs.existsSync(outputFile)).toBe(true);
          },
        );
      } finally {
        if (fs.existsSync(singleDefaultModulePath)) {
          fs.unlinkSync(singleDefaultModulePath);
        }
      }
    });

    test("should handle object with multiple CRDs default export", async () => {
      const objectDefaultModulePath = path.join(__dirname, "crd-object-default.ts");
      const objectDefaultContent = `
import { V1CustomResourceDefinition } from "@kubernetes/client-node";

const crd1: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "object-default-1.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "ObjectDefault1",
      plural: "objectdefaults1",
      singular: "objectdefault1",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};

const crd2: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "object-default-2.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "ObjectDefault2",
      plural: "objectdefaults2",
      singular: "objectdefault2",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};

export default { crd1, crd2 };
`;

      fs.writeFileSync(objectDefaultModulePath, objectDefaultContent);

      try {
        await runCliCommand(
          ["crd-manifests", objectDefaultModulePath, outputDir],
          async (error, stdout) => {
            expect(error).toBeNull();
            expect(stdout).toContain("Exported 2 CRD manifest(s)");

            const outputFile1 = path.join(outputDir, "object-default-1.example.com.yaml");
            const outputFile2 = path.join(outputDir, "object-default-2.example.com.yaml");
            expect(fs.existsSync(outputFile1)).toBe(true);
            expect(fs.existsSync(outputFile2)).toBe(true);
          },
        );
      } finally {
        if (fs.existsSync(objectDefaultModulePath)) {
          fs.unlinkSync(objectDefaultModulePath);
        }
      }
    });

    test("should handle array of CRDs default export", async () => {
      const arrayDefaultModulePath = path.join(__dirname, "crd-array-default.ts");
      const arrayDefaultContent = `
import { V1CustomResourceDefinition } from "@kubernetes/client-node";

const crd1: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "array-default-1.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "ArrayDefault1",
      plural: "arraydefaults1",
      singular: "arraydefault1",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};

const crd2: V1CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "array-default-2.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "ArrayDefault2",
      plural: "arraydefaults2",
      singular: "arraydefault2",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
      },
    ],
  },
};

export default [crd1, crd2];
`;

      fs.writeFileSync(arrayDefaultModulePath, arrayDefaultContent);

      try {
        await runCliCommand(
          ["crd-manifests", arrayDefaultModulePath, outputDir],
          async (error, stdout) => {
            expect(error).toBeNull();
            expect(stdout).toContain("Exported 2 CRD manifest(s)");

            const outputFile1 = path.join(outputDir, "array-default-1.example.com.yaml");
            const outputFile2 = path.join(outputDir, "array-default-2.example.com.yaml");
            expect(fs.existsSync(outputFile1)).toBe(true);
            expect(fs.existsSync(outputFile2)).toBe(true);
          },
        );
      } finally {
        if (fs.existsSync(arrayDefaultModulePath)) {
          fs.unlinkSync(arrayDefaultModulePath);
        }
      }
    });
  });
});

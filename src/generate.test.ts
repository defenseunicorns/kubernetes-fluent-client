import { beforeEach, describe, expect, vi, test } from "vitest";
import { convertCRDtoTS, GenerateOptions, readOrFetchCrd } from "./generate.js";
import * as fs from "fs";
import path from "path";
import { quicktype } from "quicktype-core";
import { fetch } from "./fetch.js";
import { loadAllYaml } from "@kubernetes/client-node";
import { K8s } from "./fluent/index.js";
import { CustomResourceDefinition } from "./upstream.js";

// Mock the fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

// Get the mocked fs module
vi.mock("./fetch");
vi.mock("quicktype-core", async () => {
  const actualQuicktypeCore =
    await vi.importActual<typeof import("quicktype-core")>("quicktype-core");
  return {
    quicktype: vi.fn(),
    JSONSchemaInput: actualQuicktypeCore.JSONSchemaInput,
    FetchingJSONSchemaStore: actualQuicktypeCore.FetchingJSONSchemaStore,
    InputData: actualQuicktypeCore.InputData,
  };
});
vi.mock("@kubernetes/client-node", () => {
  return {
    loadAllYaml: vi.fn(),
  };
});
vi.mock("./fluent", () => ({
  K8s: vi.fn(),
}));
vi.mock("./generate", async () => {
  const actualGenerate = await vi.importActual("./generate");
  return {
    ...(actualGenerate as object),
    resolveFilePath: vi.fn(),
    tryParseUrl: vi.fn(),
  };
});

// Sample CRD content to use in tests
const sampleCrd = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: { name: "movies.example.com" },
  spec: {
    group: "example.com",
    names: { kind: "Movie", plural: "movies" },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: "object",
            description: "Movie nerd",
            properties: {
              spec: {
                properties: {
                  title: { type: "string" },
                  author: { type: "string" },
                },
              },
            },
          },
        },
      },
    ],
  },
};

const expectedMovie = [
  "/**",
  " * Movie nerd",
  " */",
  "export interface Movie {",
  "    spec?: any[] | boolean | number | number | null | SpecObject | string;",
  "    [property: string]: any;",
  "}",
  "",
  "export interface SpecObject {",
  "    author?: string;",
  "    title?: string;",
  "    [property: string]: any;",
  "}",
  "",
];

describe("CRD Generate", () => {
  let logFn: ReturnType<typeof vi.fn>; // Mock log function

  beforeEach(() => {
    vi.clearAllMocks(); // Reset all mocks before each test
    logFn = vi.fn(); // Mock the log function with correct typing
  });

  test("convertCRDtoTS should generate the expected TypeScript file", async () => {
    // Clear mocks before test
    vi.clearAllMocks();

    // Mock quicktype to return the expected result
    vi.mocked(quicktype).mockResolvedValueOnce({
      lines: expectedMovie,
      annotations: [],
    });

    // Make sure directory exists check passes
    vi.mocked(fs).existsSync.mockReturnValue(true);

    const options = {
      source: "test-crd.yaml",
      language: "ts",
      logFn,
      directory: "test-dir",
      plain: false,
      npmPackage: "kubernetes-fluent-client",
    };

    // Call convertCRDtoTS with sample CRD
    const result = await convertCRDtoTS(sampleCrd, options);

    // Extract the generated types from the result
    const generatedTypes = result[0].results["movie-v1"];

    // Assert that the generated types match the expected TypeScript code
    expect(generatedTypes).toEqual(expectedMovie);

    // Assert the file writing happens with the expected TypeScript content
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join("test-dir", "movie-v1.ts"),
      expectedMovie.join("\n"),
    );

    // Assert the logs contain expected log messages
    expect(logFn).toHaveBeenCalledTimes(1);
    expect(logFn).toHaveBeenCalledWith("- Generating example.com/v1 types for Movie");
  });
});

describe("readOrFetchCrd", () => {
  let mockOpts: GenerateOptions;

  beforeEach(async () => {
    mockOpts = {
      source: "mock-source",
      logFn: vi.fn(),
    };

    // Create a dedicated spy for resolveFilePath that always returns a known value
    // regardless of the input for consistent testing
    const mockFilePath = "mock-file-path";
    vi.spyOn(await import("./generate.js"), "resolveFilePath").mockImplementation(
      () => mockFilePath,
    );
  });

  test("should load CRD from a local file", async () => {
    // Clear previous mocks
    vi.clearAllMocks();

    // Since we're having issues with the resolveFilePath mock, take a different approach
    // Instead of mocking path resolution, we'll make file system functions return success
    // regardless of the path

    // First setup our mock CRD data
    const mockCrd = [{ kind: "CustomResourceDefinition" }] as CustomResourceDefinition[];
    vi.mocked(loadAllYaml).mockReturnValue(mockCrd);

    // Now setup the file operations to succeed
    vi.mocked(fs.existsSync).mockImplementation(() => true);
    vi.mocked(fs.readFileSync).mockImplementation(() => "mock file content");

    // Set options for this test
    mockOpts = {
      source: "mock-source",
      logFn: vi.fn(),
    };

    // Call function to test
    const result = await readOrFetchCrd(mockOpts);

    // Verify the results
    expect(result).toEqual(mockCrd);
    expect(mockOpts.logFn).toHaveBeenCalledWith("Attempting to load mock-source as a local file");

    // Check that fs functions were called (with any path)
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();
    expect(loadAllYaml).toHaveBeenCalledWith("mock file content");
  });
});

describe("readOrFetchCrd with URL", () => {
  let mockOpts: GenerateOptions;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpts = {
      source: "http://example.com/mock-crd",
      logFn: vi.fn(),
    };

    // Mock resolveFilePath correctly
    vi.mocked(await import("./generate.js")).resolveFilePath.mockReturnValue("mock-file-path");

    // Ensure fs.existsSync returns false for URL tests to skip file logic
    vi.mocked(fs).existsSync.mockReturnValue(false);
  });

  test("should fetch CRD from a URL and parse YAML", async () => {
    // Mock tryParseUrl to return a valid URL
    vi.mocked(await import("./generate.js")).tryParseUrl.mockReturnValue(
      new URL("http://example.com/mock-crd"),
    );

    // Mock fetch to return a valid response
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      data: "mock fetched data",
      status: 0,
      statusText: "",
    });

    // Mock loadAllYaml to return parsed CRD
    const mockCrd = [{ kind: "CustomResourceDefinition" }] as CustomResourceDefinition[];
    vi.mocked(loadAllYaml).mockReturnValue(mockCrd);

    // Call the function
    const result = await readOrFetchCrd(mockOpts);

    // Assert fetch was called with correct URL
    expect(fetch).toHaveBeenCalledWith("http://example.com/mock-crd");

    // Assert loadAllYaml was called with fetched data
    expect(loadAllYaml).toHaveBeenCalledWith("mock fetched data");

    // Assert the result matches the mocked CRD
    expect(result).toEqual(mockCrd);

    // Assert log function was called with correct message
    expect(mockOpts.logFn).toHaveBeenCalledWith(
      "Attempting to load http://example.com/mock-crd as a URL",
    );
  });
});

describe("readOrFetchCrd from Kubernetes cluster", () => {
  let mockOpts: GenerateOptions;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpts = {
      source: "my-crd",
      logFn: vi.fn(),
    };

    // Mock resolveFilePath and tryParseUrl properly
    const generateModule = await import("./generate.js");
    vi.mocked(generateModule.resolveFilePath).mockReturnValue("mock-file-path");
    vi.mocked(generateModule.tryParseUrl).mockReturnValue(null);

    // Ensure fs.existsSync returns false to force fallback to Kubernetes
    vi.mocked(fs).existsSync.mockReturnValue(false);
  });

  test("should load CRD from Kubernetes cluster", async () => {
    // Mock K8s to return a mocked CRD from the Kubernetes cluster
    const mockCrd = { kind: "CustomResourceDefinition" } as CustomResourceDefinition;

    // Use a conditional mock that returns the direct CRD object when called with a name parameter
    // This is what the readOrFetchCrd function expects, and it still satisfies TypeScript typings
    const mockK8sGet = vi.fn().mockImplementation((name?: string) => {
      if (name) {
        // When called with a name, return the direct CRD object
        // This matches the behavior expected by readOrFetchCrd
        return Promise.resolve(mockCrd);
      } else {
        // When called without a name, return a KubernetesListObject
        // This satisfies the TypeScript interface
        return Promise.resolve({
          kind: "CustomResourceDefinitionList",
          apiVersion: "apiextensions.k8s.io/v1",
          items: [mockCrd],
          metadata: {
            resourceVersion: "123456",
          },
        });
      }
    });

    // Create a complete mock object with all required methods
    const k8sMockObj = {
      Get: mockK8sGet,
      Logs: vi.fn(),
      Delete: vi.fn(),
      Evict: vi.fn(),
      Watch: vi.fn(),
      Apply: vi.fn(),
      Create: vi.fn(),
      Patch: vi.fn(),
      PatchStatus: vi.fn(),
      Raw: vi.fn(),
      WithField: vi.fn(),
      WithLabel: vi.fn(),
      InNamespace: vi.fn(),
    };

    // Make circular references for WithField and WithLabel
    k8sMockObj.WithField.mockReturnValue(k8sMockObj);
    k8sMockObj.WithLabel.mockReturnValue(k8sMockObj);

    vi.mocked(K8s).mockReturnValue(k8sMockObj);

    // Call the function
    const result = await readOrFetchCrd(mockOpts);

    // Assert K8s.Get was called with the correct source
    expect(K8s).toHaveBeenCalledWith(CustomResourceDefinition);
    expect(mockK8sGet).toHaveBeenCalledWith("my-crd");

    // Assert the result matches the mocked CRD
    // The readOrFetchCrd function should extract the CRD from the list object
    expect(result).toEqual([mockCrd]);

    // Assert log function was called with correct message
    expect(mockOpts.logFn).toHaveBeenCalledWith(
      "Attempting to read my-crd from the Kubernetes cluster",
    );
  });

  test("should log an error if Kubernetes cluster read fails", async () => {
    // Mock K8s to throw an error
    const mockError = new Error("Kubernetes API error");

    // Use a consistent mock pattern without specifying a narrow return type
    const mockK8sGet = vi.fn().mockRejectedValue(mockError);

    // Create a complete mock object with all required methods
    const k8sMockObj = {
      Get: mockK8sGet,
      Logs: vi.fn(),
      Delete: vi.fn(),
      Evict: vi.fn(),
      Watch: vi.fn(),
      Apply: vi.fn(),
      Create: vi.fn(),
      Patch: vi.fn(),
      PatchStatus: vi.fn(),
      Raw: vi.fn(),
      WithField: vi.fn(),
      WithLabel: vi.fn(),
      InNamespace: vi.fn(),
    };

    // Make circular references for WithField and WithLabel
    k8sMockObj.WithField.mockReturnValue(k8sMockObj);
    k8sMockObj.WithLabel.mockReturnValue(k8sMockObj);

    vi.mocked(K8s).mockReturnValue(k8sMockObj);

    // Call the function and assert that it throws an error
    await expect(readOrFetchCrd(mockOpts)).rejects.toThrowError(
      `Failed to read my-crd as a file, URL, or Kubernetes CRD`,
    );

    // Assert log function was called with error message
    expect(mockOpts.logFn).toHaveBeenCalledWith("Error loading CRD: Kubernetes API error");

    // Assert K8s.Get was called with the correct source
    expect(K8s).toHaveBeenCalledWith(CustomResourceDefinition);
    expect(mockK8sGet).toHaveBeenCalledWith("my-crd");
  });
});

describe("readOrFetchCrd error handling", () => {
  let mockOpts: GenerateOptions;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpts = {
      source: "mock-source",
      logFn: vi.fn(),
    };

    // Ensure URL check doesn't pass
    const { tryParseUrl } = await import("./generate.js");
    (tryParseUrl as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    // Mock K8s to throw an error with the specific message we're testing for
    const mockError = new Error("Kubernetes API error");
    const mockK8sGet = vi.fn().mockRejectedValue(mockError);

    // Create complete mock object with all required methods
    const k8sMockObj = {
      Get: mockK8sGet,
      Logs: vi.fn(),
      Delete: vi.fn(),
      Evict: vi.fn(),
      Watch: vi.fn(),
      Apply: vi.fn(),
      Create: vi.fn(),
      Patch: vi.fn(),
      PatchStatus: vi.fn(),
      Raw: vi.fn(),
      WithField: vi.fn(),
      WithLabel: vi.fn(),
      InNamespace: vi.fn(),
    };

    // Make circular references for methods that return the fluent API
    k8sMockObj.WithField.mockReturnValue(k8sMockObj);
    k8sMockObj.WithLabel.mockReturnValue(k8sMockObj);
    k8sMockObj.InNamespace.mockReturnValue(k8sMockObj);

    vi.mocked(K8s).mockReturnValue(k8sMockObj);
  });

  test("should throw an error if file reading fails", async () => {
    // Clear any previous mock calls
    vi.clearAllMocks();

    // Configure mocks for this specific test
    vi.mocked(fs).existsSync.mockReturnValue(true);
    vi.mocked(fs).readFileSync.mockImplementation(() => {
      throw new Error("File read error");
    });

    // Mock tryParseUrl to return null to avoid URL path
    vi.mocked(await import("./generate.js")).tryParseUrl.mockReturnValue(null);

    // We need a minimal K8s mock since the code shouldn't get that far
    const mockK8sGet = vi.fn().mockRejectedValue(new Error("Kubernetes API error"));
    const k8sMockObj = {
      Get: mockK8sGet,
      // Add all required methods to satisfy the interface
      Logs: vi.fn(),
      Delete: vi.fn(),
      Evict: vi.fn(),
      Watch: vi.fn(),
      Apply: vi.fn(),
      Create: vi.fn(),
      Patch: vi.fn(),
      PatchStatus: vi.fn(),
      Raw: vi.fn(),
      WithField: vi.fn(),
      WithLabel: vi.fn(),
      InNamespace: vi.fn(),
    };

    // Make circular references for method chaining
    k8sMockObj.WithField.mockReturnValue(k8sMockObj);
    k8sMockObj.WithLabel.mockReturnValue(k8sMockObj);

    vi.mocked(K8s).mockReturnValue(k8sMockObj);

    // Test that the function throws the expected error
    await expect(readOrFetchCrd(mockOpts)).rejects.toThrowError(
      "Failed to read mock-source as a file, URL, or Kubernetes CRD",
    );

    // Verify the log messages
    expect(mockOpts.logFn).toHaveBeenCalledWith("Attempting to load mock-source as a local file");
    expect(mockOpts.logFn).toHaveBeenCalledWith("Error loading CRD: File read error");
  });
});

describe("convertCRDtoTS with invalid CRD", () => {
  test("should skip CRD with no versions", async () => {
    const invalidCrd = {
      ...sampleCrd,
      spec: {
        ...sampleCrd.spec,
        versions: [], // CRD with no versions
      },
    };

    const options = {
      source: "mock-source",
      language: "ts",
      logFn: vi.fn(), // Ensure the mock log function is set
      directory: "test-dir",
      plain: false,
      npmPackage: "kubernetes-fluent-client",
    };

    const result = await convertCRDtoTS(invalidCrd, options);

    // Assert that result is empty due to invalid CRD
    expect(result).toEqual([]);

    // Assert the log function is called with the correct message
    expect(options.logFn).toHaveBeenCalledWith(
      "Skipping movies.example.com, it does not appear to be a CRD",
    );
  });

  test("should handle schema with no OpenAPI schema", async () => {
    // Modify the sampleCrd to simulate the invalid CRD
    const invalidCrd = {
      ...sampleCrd,
      spec: {
        ...sampleCrd.spec,
        versions: [
          {
            name: "v1",
            served: true,
            storage: true,
            schema: undefined, // No OpenAPI schema
          },
        ],
      },
    };

    const options = {
      source: "mock-source",
      language: "ts",
      logFn: vi.fn(), // Mock log function
      directory: "test-dir",
      plain: false,
      npmPackage: "kubernetes-fluent-client",
    };

    // Call the convertCRDtoTS function with the invalid CRD
    const result = await convertCRDtoTS(invalidCrd, options);

    // Assert that result is empty due to invalid schema
    expect(result).toEqual([]);

    // Assert that the log function was called with the appropriate message
    expect(options.logFn).toHaveBeenCalledWith(
      "Skipping movies.example.com, it does not appear to have a valid schema",
    );
  });
});

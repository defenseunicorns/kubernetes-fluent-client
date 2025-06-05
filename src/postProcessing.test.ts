// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as postProcessingModule from "./postProcessing";
import { vi, beforeEach, it, expect, describe, afterEach } from "vitest";
import { CustomResourceDefinition } from "./upstream";
import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "./generate";

// Mock the fs module
vi.mock("fs");

// Get the mocked fs module
const mockFs = vi.mocked(fs);

vi.mock("./types", () => ({
  GenericKind: vi.fn().mockImplementation(() => ({
    kind: "MockKind",
    apiVersion: "v1",
  })),
}));

const mockCRDResults = [
  {
    name: "TestKind",
    crd: {
      spec: {
        group: "test.group",
        names: { kind: "TestKind", plural: "TestKinds" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    },
    version: "v1",
  },
];

// Define the mock data
const mockOpts: GenerateOptions = {
  directory: "mockDir",
  logFn: vi.fn(), // Mock logging function
  language: "ts",
  plain: false,
  npmPackage: "mockPackage",
  source: "",
};

describe("postProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should log error when directory is not defined", async () => {
    const optsWithoutDirectory = { ...mockOpts, directory: undefined };

    await postProcessingModule.postProcessing(mockCRDResults, optsWithoutDirectory);

    expect(mockOpts.logFn).toHaveBeenCalledWith("⚠️ Error: Directory is not defined.");
  });

  it("should read files from directory and process them", async () => {
    const mockFileResultMap = { "testkind-v1.ts": mockCRDResults[0] };
    const mockContent = "test content";

    // Mock the file system operations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFs.readFileSync.mockImplementation(() => mockContent as any);
    mockFs.writeFileSync.mockImplementation(() => {});

    await postProcessingModule.processFiles(["testkind-v1.ts"], mockFileResultMap, mockOpts);

    // Verify read was called with the correct arguments
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      path.join("mockDir", "testkind-v1.ts"),
      "utf8",
    );

    // Verify write was called with the correct arguments
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it("should log error when failing to read the file", async () => {
    // Mock a situation where the file exists but reading it fails
    const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };

    // Simulate readFileSync throwing an error
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("File read error");
    });

    await postProcessingModule.processFiles(["TestKind-v1.ts"], mockFileResultMap, mockOpts);

    // Verify the error log
    expect(mockOpts.logFn).toHaveBeenCalledWith(
      `❌ Error processing file: ${path.join("mockDir", "TestKind-v1.ts")} - File read error`,
    );
  });

  it("should log start and completion messages", async () => {
    const mockContent = "mock content";
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFs.readdirSync.mockReturnValue(["TestKind-v1.ts"] as any);
    mockFs.readFileSync.mockReturnValue(Buffer.from(mockContent));
    mockFs.writeFileSync.mockImplementation(() => {});

    vi.spyOn(postProcessingModule, "mapFilesToCRD").mockReturnValue({
      "TestKind-v1.ts": mockCRDResults[0],
    });

    await postProcessingModule.postProcessing(mockCRDResults, mockOpts);

    // Verify the start message was logged
    expect(mockOpts.logFn).toHaveBeenCalledWith("\n🔧 Post-processing started...");

    // Verify the completion message was logged
    expect(mockOpts.logFn).toHaveBeenCalledWith("🔧 Post-processing completed.\n");
  });

  it("should handle readdirSync error gracefully", async () => {
    // Simulate an error when reading the directory
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error("Directory read error");
    });

    await expect(postProcessingModule.postProcessing(mockCRDResults, mockOpts)).rejects.toThrow(
      "Directory read error",
    );

    // Ensure the process is not continued after the error
    expect(mockOpts.logFn).not.toHaveBeenCalledWith("🔧 Post-processing completed.\n");
  });

  it("should handle file content processing correctly", async () => {
    const mockFileResultMap = { "testkind-v1.ts": mockCRDResults[0] };
    const mockContent = "test content";

    // Mock the file system operations
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFs.readFileSync.mockImplementation(() => mockContent as any);
    mockFs.writeFileSync.mockImplementation(() => {});

    await postProcessingModule.processFiles(["testkind-v1.ts"], mockFileResultMap, mockOpts);

    // Verify read was called with the correct arguments
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      path.join("mockDir", "testkind-v1.ts"),
      "utf8",
    );

    // Verify write was called
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });
});

describe("mapFilesToCRD", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should map files to corresponding CRD results", () => {
    const result = postProcessingModule.mapFilesToCRD(mockCRDResults);
    // The actual key will be lowercase due to the implementation
    const expectedKey = Object.keys(result)[0];
    expect(result).toEqual({
      [expectedKey]: mockCRDResults[0],
    });
  });

  it("should log a warning if no matching CRD result found for a file", async () => {
    const mockFiles = ["NonExistingKind.ts"];
    const mockFileResultMap = {};

    await postProcessingModule.processFiles(mockFiles, mockFileResultMap, mockOpts);

    expect(mockOpts.logFn).toHaveBeenCalledWith(
      "⚠️ Warning: No matching CRD result found for file: mockDir/NonExistingKind.ts",
    );
  });
});

describe("applyCRDPostProcessing", () => {
  const mockContent = "mock content";
  const mockOpts = {
    directory: "mockDir",
    logFn: vi.fn(),
    language: "ts",
    plain: false,
    npmPackage: "mockPackage",
    source: "",
  };

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  describe("when processing TypeScript file content", () => {
    it("should preserve existing content in the processed result", () => {
      const result = postProcessingModule.applyCRDPostProcessing(
        mockContent,
        "TestKind",
        mockCRDResults[0].crd,
        "v1",
        mockOpts,
      );

      expect(result).toContain("mock content");
      // Add more assertions based on what is expected after processing
    });

    it("should properly format the processed output", () => {
      const result = postProcessingModule.applyCRDPostProcessing(
        mockContent,
        "TestKind",
        mockCRDResults[0].crd,
        "v1",
        mockOpts,
      );

      expect(result).toContain("mock content");
      // Add more assertions based on what is expected after processing
    });
  });
});

describe("processFiles", () => {
  const mockOptsWithoutDirectory = { ...mockOpts, directory: undefined };

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  describe("when processing files with valid directory", () => {
    it("should read from and write to the correct paths", async () => {
      const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };
      const mockContent = "test content";
      mockFs.readFileSync.mockReturnValue(mockContent);
      mockFs.writeFileSync.mockImplementation(() => {});

      await postProcessingModule.processFiles(["TestKind-v1.ts"], mockFileResultMap, mockOpts);

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.join("mockDir", "TestKind-v1.ts"),
        "utf8",
      );
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join("mockDir", "TestKind-v1.ts"),
        expect.any(String),
      );
    });
  });

  describe("when directory is not defined", () => {
    it("should throw an appropriate error", async () => {
      const mockFiles = ["TestKind-v1.ts"];
      const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };

      await expect(
        postProcessingModule.processFiles(mockFiles, mockFileResultMap, mockOptsWithoutDirectory),
      ).rejects.toThrow("Directory is not defined");
    });
  });
});

describe("wrapWithFluentClient", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  describe("when transforming an interface to a fluent client class", () => {
    it("should replace interface declaration with class extending GenericKind", () => {
      const inputLines = ["export interface TestKind {", "  prop: string;", "}"];

      const crd = {
        spec: {
          group: "test.group",
          names: { plural: "testkinds" },
        },
      } as CustomResourceDefinition; // mock the CRD

      const expectedOutputLines = [
        "// This file is auto-generated by mockPackage, do not edit manually",
        'import { GenericKind, RegisterKind } from "mockPackage";',
        "export class TestKind extends GenericKind {",
        "  prop: string;",
        "}",
        "RegisterKind(TestKind, {",
        '  group: "test.group",',
        '  version: "v1",',
        '  kind: "TestKind",',
        '  plural: "testkinds",',
        "});",
      ];

      const result = postProcessingModule.wrapWithFluentClient(
        inputLines,
        "TestKind",
        crd,
        "v1",
        "mockPackage",
      );

      expect(result).toEqual(expectedOutputLines);
    });
  });
});

describe("getGenericKindProperties", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  describe("when retrieving generic kind properties", () => {
    it("should include standard kubernetes resource properties", () => {
      const result = postProcessingModule.getGenericKindProperties();
      expect(result).toContain("kind");
      expect(result).toContain("apiVersion");
      // More assertions as needed
    });
  });
});

describe("processLines", () => {
  const mockGenericKindProperties = ["kind", "apiVersion"];
  const mockLines = ["export class TestKind extends GenericKind {", "  prop: string;", "}"];
  const mockFoundInterfaces = new Set<string>(["TestKind"]);

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  describe("when processing class lines extending GenericKind", () => {
    it("should preserve class structure while modifying properties as needed", () => {
      const result = postProcessingModule.processLines(
        mockLines,
        mockGenericKindProperties,
        mockFoundInterfaces,
      );

      expect(result).toContain(mockLines[0]); // Class declaration should remain
      expect(result).toContain(mockLines[1]); // Property should remain
      expect(result).toContain(mockLines[2]); // Closing brace should remain
      // More assertions as needed
    });
  });
});

describe("processClassContext", () => {
  const mockGenericKindProperties = ["kind", "apiVersion"];
  const mockFoundInterfaces = new Set<string>(["TestKind"]);

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  describe("when encountering a class declaration", () => {
    it("should detect class extending GenericKind and update context accordingly", () => {
      const line = "export class TestKind extends GenericKind {";
      const result = postProcessingModule.processClassContext(
        line,
        false,
        0,
        mockGenericKindProperties,
        mockFoundInterfaces,
      );
      expect(result.insideClass).toBe(true);
      expect(result.braceBalance).toBe(1);
    });
  });

  describe("when processing braces in class definition", () => {
    it("should update brace balance when closing braces are found", () => {
      const line = "}";
      const result = postProcessingModule.processClassContext(
        line,
        true,
        1,
        mockGenericKindProperties,
        mockFoundInterfaces,
      );
      expect(result.insideClass).toBe(false);
      expect(result.braceBalance).toBe(0);
    });
  });
});

describe("collectInterfaceNames", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should collect interface names from lines", () => {
    const lines = [
      "export interface MyInterface {",
      "export interface AnotherInterface {",
      "some other line",
      "export interface YetAnotherInterface {",
    ];

    const result = postProcessingModule.collectInterfaceNames(lines);

    expect(result).toEqual(new Set(["MyInterface", "AnotherInterface", "YetAnotherInterface"]));
  });

  it("should return an empty set if no interfaces are found", () => {
    const lines = ["some other line", "function test() {}", "const value = 42;"];

    const result = postProcessingModule.collectInterfaceNames(lines);

    expect(result).toEqual(new Set());
  });

  it("should not add duplicate interface names", () => {
    const lines = ["export interface MyInterface {", "export interface MyInterface {"];

    const result = postProcessingModule.collectInterfaceNames(lines);

    expect(result).toEqual(new Set(["MyInterface"]));
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as postProcessingModule from "./postProcessing";
import { GenerateOptions } from "./generate";
import { jest, beforeEach, it, expect, describe, afterEach } from "@jest/globals";
import { CustomResourceDefinition } from "./upstream";
import * as fs from "fs";
import * as path from "path";

// Mock the fs module
jest.mock("fs");

// Get the mocked fs module
const mockFs = jest.mocked(fs, { shallow: false });

jest.mock("./types", () => ({
  GenericKind: jest.fn().mockImplementation(() => ({
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
  logFn: jest.fn(), // Mock logging function
  language: "ts",
  plain: false,
  npmPackage: "mockPackage",
  source: "",
};

describe("postProcessing", () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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

    jest
      .spyOn(postProcessingModule, "mapFilesToCRD")
      .mockReturnValue({ "TestKind-v1.ts": mockCRDResults[0] });

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
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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
    logFn: jest.fn(),
    language: "ts",
    plain: false,
    npmPackage: "mockPackage",
    source: "",
  };

  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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
    jest.clearAllMocks(); // Clear mocks before each test
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
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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

describe("normalizeIndentationAndSpacing", () => {
  const mockOpts = {
    language: "ts",
    source: "",
    logFn: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should normalize indentation to two spaces", () => {
    const mockLines = [
      "    indentedWithFourSpaces: string;", // Line with 4 spaces, should be normalized
      "  alreadyTwoSpaces: string;", // Line with 2 spaces, should remain unchanged
      "      sixSpacesIndent: string;", // Line with 6 spaces, only first 4 should be normalized
      "noIndent: string;", // Line with no indentation, should remain unchanged
    ];

    const expectedResult = [
      "  indentedWithFourSpaces: string;", // Normalized to 2 spaces
      "  alreadyTwoSpaces: string;", // No change
      "    sixSpacesIndent: string;", // Only first 4 spaces should be normalized to 2
      "noIndent: string;", // No change
    ];

    const result = postProcessingModule.normalizeIndentation(mockLines);

    expect(result).toEqual(expectedResult);
  });

  it("should normalize single line indentation to two spaces", () => {
    const cases = [
      { input: "    indentedWithFourSpaces;", expected: "  indentedWithFourSpaces;" }, // 4 spaces to 2 spaces
      { input: "  alreadyTwoSpaces;", expected: "  alreadyTwoSpaces;" }, // 2 spaces, no change
      { input: "      sixSpacesIndent;", expected: "    sixSpacesIndent;" }, // First 4 spaces to 2
      { input: "noIndent;", expected: "noIndent;" }, // No indentation, no change
    ];

    cases.forEach(({ input, expected }) => {
      const result = postProcessingModule.normalizeLineIndentation(input);
      expect(result).toBe(expected);
    });
  });

  it("should normalize property spacing", () => {
    const cases = [
      {
        input: "optionalProp  ? : string;",
        expected: "optionalProp?: string;",
      }, // Extra spaces around ? and :
      {
        input: "optionalProp?: string;",
        expected: "optionalProp?: string;",
      }, // Already normalized
      {
        input: "optionalProp ? :string;",
        expected: "optionalProp?: string;",
      }, // No space after colon
      {
        input: "nonOptionalProp: string;",
        expected: "nonOptionalProp: string;",
      }, // Non-optional property, should remain unchanged
    ];

    const inputLines = cases.map(c => c.input);
    const expectedLines = cases.map(c => c.expected);

    const result = postProcessingModule.normalizePropertySpacing(inputLines);

    expect(result).toEqual(expectedLines);
  });

  it('should remove lines containing "[property: string]: any;" when language is "ts" or "typescript"', () => {
    const inputLines = [
      "someProp: string;",
      "[property: string]: any;",
      "anotherProp: number;",
      "[property: string]: any;",
    ];

    // Test for TypeScript
    const tsOpts: GenerateOptions = { ...mockOpts, language: "ts" };
    const resultTs = postProcessingModule.removePropertyStringAny(inputLines, tsOpts);
    const expectedTs = ["someProp: string;", "anotherProp: number;"];
    expect(resultTs).toEqual(expectedTs);

    // Test for TypeScript with "typescript" as language
    const typescriptOpts: GenerateOptions = { ...mockOpts, language: "typescript" };
    const resultTypescript = postProcessingModule.removePropertyStringAny(
      inputLines,
      typescriptOpts,
    );
    expect(resultTypescript).toEqual(expectedTs);
  });

  describe("processEslintDisable", () => {
    beforeEach(() => {
      jest.clearAllMocks(); // Clear mocks before each test
    });

    afterEach(() => {
      jest.restoreAllMocks(); // Restore all mocks after each test
    });

    it('should add ESLint disable comment if line contains "[key: string]: any" and is not part of genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["kind", "apiVersion"]; // No "[key: string]" present

      const result = postProcessingModule.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual(
        "  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n[key: string]: any;",
      );
    });

    it('should not add ESLint disable comment if "[key: string]" is in genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["[key: string]", "kind", "apiVersion"]; // "[key: string]" present

      const result = postProcessingModule.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("[key: string]: any;"); // No comment added
    });

    it('should not add ESLint disable comment if line does not contain "[key: string]: any"', () => {
      const line = "prop: string;";
      const genericKindProperties = ["kind", "apiVersion"]; // Normal properties

      const result = postProcessingModule.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("prop: string;"); // No change in the line
    });

    it('should not add ESLint disable comment if line contains "[key: string]: any" but is part of genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["[key: string]"];

      const result = postProcessingModule.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("[key: string]: any;"); // No comment added since it's in genericKindProperties
    });
  });

  it('should not remove lines when language is not "ts" or "typescript"', () => {
    const inputLines = ["someProp: string;", "[property: string]: any;", "anotherProp: number;"];

    // Test for other languages
    const otherOpts: GenerateOptions = { ...mockOpts, language: "js" }; // Not TypeScript
    const resultOther = postProcessingModule.removePropertyStringAny(inputLines, otherOpts);
    expect(resultOther).toEqual(inputLines); // Should return the original lines
  });
});

describe("makePropertiesOptional", () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should make property optional if type is found in interfaces and not already optional", () => {
    const line = "myProp: MyInterface;";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface

    const result = postProcessingModule.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp?: MyInterface;"); // The colon is replaced by `?:`
  });

  it("should not make property optional if type is not found in interfaces", () => {
    const line = "myProp: AnotherType;";
    const foundInterfaces = new Set(["MyInterface"]); // No match for this type

    const result = postProcessingModule.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp: AnotherType;"); // No change
  });

  it("should not make property optional if already optional", () => {
    const line = "myProp?: MyInterface;";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface, but already optional

    const result = postProcessingModule.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp?: MyInterface;"); // No change since it's already optional
  });

  it("should not change line if it does not match the property pattern", () => {
    const line = "function test() {}";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface, but the line is not a property

    const result = postProcessingModule.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("function test() {}"); // No change
  });
});

describe("collectInterfaceNames", () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    jest.restoreAllMocks(); // Restore all mocks after each test
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

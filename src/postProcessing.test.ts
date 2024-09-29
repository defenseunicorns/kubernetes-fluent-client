// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors
// postProcessing.test.ts
import {
  applyCRDPostProcessing,
  mapFilesToCRD,
  postProcessing,
  processFiles,
  conditionallyWrapWithFluentClient,
  getGenericKindProperties,
  processLines,
  processClassContext,
  normalizeIndentationAndSpacing,
  normalizeLineIndentation,
  normalizeIndentation,
  normalizePropertySpacing,
  removePropertyStringAny,
  wrapWithFluentClient,
} from "./postProcessing";
import { NodeFileSystem } from "./fileSystem";
import { GenerateOptions } from "./generate";
import * as path from "path";
import { jest, beforeEach, test, expect, describe } from "@jest/globals";
import { log } from "console";
import { CustomResourceDefinition } from "./upstream";

// Mock path.join
jest.mock("path", () => ({
  join: (...args: string[]) => args.join("/"), // Simulates path.join behavior
}));

// Mock NodeFileSystem methods
jest.mock("./fileSystem", () => ({
  NodeFileSystem: jest.fn().mockImplementation(() => ({
    readdirSync: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  })),
}));

jest.mock('./types', () => ({
  GenericKind: jest.fn().mockImplementation(() => ({
    kind: 'MockKind',
    apiVersion: 'v1',
  })),
}));

const mockFileSystem = new NodeFileSystem();

const mockOpts: GenerateOptions = {
  directory: "mockDir",
  logFn: jest.fn(),
  language: "ts",
  plain: false,
  npmPackage: "mockPackage",
  source: "",
};

const mockCRDResults = [
  {
    name: "TestKind",
    crd: {
      spec: {
        group: "test.group",
        names: { kind: "TestKind", plural: "testkind" },
        scope: "Namespaced",
        versions: [{ name: "v1", served: true, storage: true }],
      },
    },
    version: "v1",
  },
];

describe("postProcessing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should log error when directory is not defined", async () => {
    const optsWithoutDirectory = { ...mockOpts, directory: undefined };

    await postProcessing(mockCRDResults, optsWithoutDirectory, mockFileSystem);

    expect(mockOpts.logFn).toHaveBeenCalledWith("⚠️ Error: Directory is not defined.");
  });

  test("should read files from directory and process them", async () => {
    const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };
    jest.spyOn(mockFileSystem, "readFile").mockReturnValue("mock content");
    jest.spyOn(mockFileSystem, "writeFile");

    await processFiles(["TestKind-v1.ts"], mockFileResultMap, mockOpts, mockFileSystem);

    expect(mockFileSystem.readFile).toHaveBeenCalledWith("mockDir/TestKind-v1.ts");
    expect(mockFileSystem.writeFile).toHaveBeenCalled();
  });

  test("should log error when failing to read the file", async () => {
    // Mock a situation where the file exists but reading it fails
    const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };

    // Simulate readFile throwing an error
    jest.spyOn(mockFileSystem, "readFile").mockImplementation(() => {
      throw new Error("File read error");
    });

    await processFiles(["TestKind-v1.ts"], mockFileResultMap, mockOpts, mockFileSystem);

    // Verify the error log
    expect(mockOpts.logFn).toHaveBeenCalledWith(
      "❌ Error processing file: mockDir/TestKind-v1.ts - File read error",
    );
  });
});

describe("mapFilesToCRD", () => {
  test("should map files to corresponding CRD results", () => {
    const result = mapFilesToCRD(mockCRDResults);
    expect(result).toEqual({
      "testkind-v1.ts": mockCRDResults[0],
    });
  });
});

describe("applyCRDPostProcessing", () => {
  test("should process TypeScript file content", () => {
    const mockContent = "mock content";
    const result = applyCRDPostProcessing(
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

describe("processFiles", () => {
  test("should process files in directory", async () => {
    const mockFileResultMap = { "TestKind-v1.ts": mockCRDResults[0] };
    jest.spyOn(mockFileSystem, "readFile").mockReturnValue("mock content");
    jest.spyOn(mockFileSystem, "writeFile");

    await processFiles(["TestKind-v1.ts"], mockFileResultMap, mockOpts, mockFileSystem);

    expect(mockFileSystem.readFile).toHaveBeenCalledWith("mockDir/TestKind-v1.ts");
    expect(mockFileSystem.writeFile).toHaveBeenCalled();
  });

  test("should log warning if no matching CRD result found", async () => {
    await processFiles(["NonExistingKind.ts"], {}, mockOpts, mockFileSystem);

    expect(mockOpts.logFn).toHaveBeenCalledWith(
      "⚠️ Warning: No matching CRD result found for file: mockDir/NonExistingKind.ts",
    );
  });
});

describe('conditionallyWrapWithFluentClient', () => {
  const mockLines = ['some content'];
  const mockOpts = {
    language: 'ts',
    plain: false,
    npmPackage: 'mockPackage',
    source: '',
    logFn: jest.fn(),
  };

  test('should wrap with fluent client when opts are correct', () => {
    const result = conditionallyWrapWithFluentClient(mockLines, 'TestKind', mockCRDResults[0].crd, 'v1', mockOpts);
    expect(result).toContain(`import { GenericKind, RegisterKind } from "mockPackage";`);
  });

  test('should not wrap with fluent client when plain is true', () => {
    const optsWithPlain = { ...mockOpts, plain: true };
    const result = conditionallyWrapWithFluentClient(mockLines, 'TestKind', mockCRDResults[0].crd, 'v1', optsWithPlain);
    expect(result).toEqual(mockLines); // No wrapping should happen
  });

  test('should replace interface declaration with class extending GenericKind', () => {
    const inputLines = [
      'export interface TestKind {',
      '  prop: string;',
      '}',
    ];

    const crd = {
      spec: {
        group: 'test.group',
        names: { plural: 'testkinds' },
      },
    } as CustomResourceDefinition; // mock the CRD

    const expectedOutputLines = [
      '// This file is auto-generated by mockPackage, do not edit manually',
      'import { GenericKind, RegisterKind } from "mockPackage";',
      'export class TestKind extends GenericKind {',
      '  prop: string;',
      '}',
      'RegisterKind(TestKind, {',
      '  group: "test.group",',
      '  version: "v1",',
      '  kind: "TestKind",',
      '  plural: "testkinds",',
      '});',
    ];

    const result = wrapWithFluentClient(inputLines, 'TestKind', crd, 'v1', 'mockPackage');

    expect(result).toEqual(expectedOutputLines);
  });

});

describe('getGenericKindProperties', () => {
  test('should retrieve properties from GenericKind', () => {
    const result = getGenericKindProperties();
    expect(result).toContain('kind');
    expect(result).toContain('apiVersion');
    expect(result).not.toContain('[key: string]');
  });
});

describe('processLines', () => {
  const mockLines = [
    'export class TestKind extends GenericKind {',
    '  kind: string;',
    '}',
  ];

  const mockFoundInterfaces = new Set<string>(['TestKind']);
  const mockGenericKindProperties = ['kind', 'apiVersion'];

  test('should process lines and modify properties of classes extending GenericKind', () => {
    const result = processLines(mockLines, mockGenericKindProperties, mockFoundInterfaces);
    expect(result).toContain('  declare kind: string;');
  });
});

describe('processClassContext', () => {
  const mockGenericKindProperties = ['kind'];
  const mockFoundInterfaces = new Set<string>();

  test('should detect class extending GenericKind and modify context', () => {
    const line = 'export class TestKind extends GenericKind {';
    const result = processClassContext(line, false, 0, mockGenericKindProperties, mockFoundInterfaces);
    expect(result.insideClass).toBe(true);
    expect(result.braceBalance).toBe(1);
  });

  test('should update brace balance when closing braces are found', () => {
    const line = '}';
    const result = processClassContext(line, true, 1, mockGenericKindProperties, mockFoundInterfaces);
    expect(result.insideClass).toBe(false);
    expect(result.braceBalance).toBe(0);
  });
});

describe('normalizeIndentationAndSpacing', () => {
  const mockOpts = {
    language: 'ts',
    source: '',
    logFn: jest.fn(),
  };

  test('should normalize indentation to two spaces', () => {
    const mockLines = [
      '    indentedWithFourSpaces: string;',  // Line with 4 spaces, should be normalized
      '  alreadyTwoSpaces: string;',         // Line with 2 spaces, should remain unchanged
      '      sixSpacesIndent: string;',      // Line with 6 spaces, only first 4 should be normalized
      'noIndent: string;',                   // Line with no indentation, should remain unchanged
    ];

    const expectedResult = [
      '  indentedWithFourSpaces: string;',   // Normalized to 2 spaces
      '  alreadyTwoSpaces: string;',         // No change
      '    sixSpacesIndent: string;',        // Only first 4 spaces should be normalized to 2
      'noIndent: string;',                   // No change
    ];

    const result = normalizeIndentation(mockLines);

    expect(result).toEqual(expectedResult);
  });

  test('should normalize single line indentation to two spaces', () => {
    const cases = [
      { input: '    indentedWithFourSpaces;', expected: '  indentedWithFourSpaces;' }, // 4 spaces to 2 spaces
      { input: '  alreadyTwoSpaces;', expected: '  alreadyTwoSpaces;' },               // 2 spaces, no change
      { input: '      sixSpacesIndent;', expected: '    sixSpacesIndent;' },           // First 4 spaces to 2
      { input: 'noIndent;', expected: 'noIndent;' },                                   // No indentation, no change
    ];

    cases.forEach(({ input, expected }) => {
      const result = normalizeLineIndentation(input);
      expect(result).toBe(expected);
    });
  });

  test('should normalize property spacing', () => {
    const cases = [
      {
        input: 'optionalProp  ? : string;',
        expected: 'optionalProp?: string;'
      }, // Extra spaces around ? and :
      {
        input: 'optionalProp?: string;',
        expected: 'optionalProp?: string;'
      }, // Already normalized
      {
        input: 'optionalProp ? :string;',
        expected: 'optionalProp?: string;'
      }, // No space after colon
      {
        input: 'nonOptionalProp: string;',
        expected: 'nonOptionalProp: string;'
      }, // Non-optional property, should remain unchanged
    ];

    const inputLines = cases.map(c => c.input);
    const expectedLines = cases.map(c => c.expected);

    const result = normalizePropertySpacing(inputLines);

    expect(result).toEqual(expectedLines);
  });

  test('should remove lines containing "[property: string]: any;" when language is "ts" or "typescript"', () => {
    const inputLines = [
      'someProp: string;',
      '[property: string]: any;',
      'anotherProp: number;',
      '[property: string]: any;',
    ];

    // Test for TypeScript
    const tsOpts: GenerateOptions = { ...mockOpts, language: 'ts' };
    const resultTs = removePropertyStringAny(inputLines, tsOpts);
    const expectedTs = [
      'someProp: string;',
      'anotherProp: number;',
    ];
    expect(resultTs).toEqual(expectedTs);

    // Test for TypeScript with "typescript" as language
    const typescriptOpts: GenerateOptions = { ...mockOpts, language: 'typescript' };
    const resultTypescript = removePropertyStringAny(inputLines, typescriptOpts);
    expect(resultTypescript).toEqual(expectedTs);
  });

  test('should not remove lines when language is not "ts" or "typescript"', () => {
    const inputLines = [
      'someProp: string;',
      '[property: string]: any;',
      'anotherProp: number;',
    ];

    // Test for other languages
    const otherOpts: GenerateOptions = { ...mockOpts, language: 'js' }; // Not TypeScript
    const resultOther = removePropertyStringAny(inputLines, otherOpts);
    expect(resultOther).toEqual(inputLines); // Should return the original lines
  });


});
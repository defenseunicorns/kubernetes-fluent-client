import * as fs from "fs";
import {
  readFile,
  writeFile,
  getGenericKindProperties,
  collectInterfaceNames,
  processFile,
  postProcessing,
  removePropertyStringAny,
} from "./postProcessing";
//import { GenericKind } from "./upstream";
import { jest, describe, beforeEach, test, expect } from "@jest/globals";
import { GenerateOptions } from "./generate";
import { CustomResourceDefinition } from "./upstream";

jest.mock("fs");

const mockLogFn = jest.fn();

// Mock the `fs` functions
const mockReadFileSync = fs.readFileSync as jest.Mock;
const mockReaddirSync = fs.readdirSync as jest.Mock;

// Sample CRD for tests
const mockCRD: CustomResourceDefinition = {
  apiVersion: "apiextensions.k8s.io/v1",
  kind: "CustomResourceDefinition",
  metadata: {
    name: "movies.example.com",
  },
  spec: {
    group: "example.com",
    names: {
      kind: "Movie",
      plural: "movies",
    },
    scope: "Namespaced",
    versions: [
      {
        name: "v1",
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
        served: false,
        storage: false,
      },
    ],
  },
};

// Mock GenerateOptions for tests
const mockOpts: GenerateOptions = {
  directory: "test-directory",
  language: "ts",
  logFn: mockLogFn,
  plain: false,
  source: "test-source.yaml",
};

describe("File I/O functions", () => {
  const mockFilePath = "test-file.ts";
  const mockFileContent = "file content";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("readFile should read file content from disk", () => {
    mockReadFileSync.mockReturnValue(mockFileContent);
    const content = readFile(mockFilePath);
    expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath, "utf8");
    expect(content).toBe(mockFileContent);
  });

  test("writeFile should write content to disk", () => {
    writeFile(mockFilePath, mockFileContent);
    expect(fs.writeFileSync).toHaveBeenCalledWith(mockFilePath, mockFileContent, "utf8");
  });
});

describe("getGenericKindProperties", () => {
  test("should retrieve properties from GenericKind excluding dynamic [key: string]: any", () => {
    // Mock the `GenericKind` class
    jest.mock("./upstream", () => ({
      GenericKind: jest.fn(() => ({
        apiVersion: "",
        kind: "",
        metadata: {},
        "[key: string]": "any",
      })),
    }));

    const properties = getGenericKindProperties();
    expect(properties).toEqual(["apiVersion", "kind", "metadata"]);
  });
});

describe("collectInterfaceNames", () => {
  test("should collect interface names from file content", () => {
    const fileContent = ["export interface TestInterface1 {", "export interface TestInterface2 {"];

    const interfaces = collectInterfaceNames(fileContent);
    expect(interfaces).toEqual(new Set(["TestInterface1", "TestInterface2"]));
  });
});

describe("processFile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should process the file content and add declare to GenericKind properties", () => {
    const content = `
      export class PolicyReport extends GenericKind {
        apiVersion: string;
        kind: string;
        results: Result;
        scope: Scope;
      }
      export interface Result {}
      export interface Scope {}
    `;

    const modifiedContent = processFile(content, "Movie", mockCRD, "v1", mockOpts);
    expect(modifiedContent).toContain("declare apiVersion: string;");
    expect(modifiedContent).toContain("declare kind: string;");
    expect(modifiedContent).toContain("results?: Result;");
    expect(modifiedContent).toContain("scope?: Scope;");
  });

  test("should handle the addition of eslint-disable for [key: string]: any", () => {
    const content = `
      export class PolicyReport extends GenericKind {
        [key: string]: any;
      }
    `;
    const modifiedContent = processFile(content, "Movie", mockCRD, "v1", mockOpts);
    expect(modifiedContent).toContain(
      "// eslint-disable-next-line @typescript-eslint/no-explicit-any",
    );
  });
});

describe("postProcessing", () => {
  const mockDirectory = "test-directory";
  const mockFile = "movie-v1.ts";
  const mockFilePath = `${mockDirectory}/${mockFile}`;
  const mockFileContent = "export class TestClass extends GenericKind {}";

  beforeEach(() => {
    jest.clearAllMocks();
    mockReaddirSync.mockReturnValue([mockFile]); // Simulate a matching file in the directory
    mockReadFileSync.mockReturnValue(mockFileContent); // Simulate file content
  });

  test("should log 'No matching CRD result found' when file has no corresponding CRD result", async () => {
    // Set up a CRD result that doesn't match the file
    const unmatchedResult = [
      { name: "UnmatchedFile", crd: mockCRD, version: "v1" }, // "Movie-v1" won't match "unmatchedFile.ts"
    ];

    // Call postProcessing with the unmatched result
    await postProcessing(unmatchedResult, mockOpts);

    // Expect the log to contain the "No matching CRD result found" message
    expect(mockLogFn).toHaveBeenCalledWith(
      `No matching CRD result found for file: ${mockFilePath}`,
    );
  });

  test("should process all files in the directory", async () => {
    await postProcessing(
      [
        { name: "Movie", crd: mockCRD, version: "v1" }, // Ensure the name and version match the file name
      ],
      mockOpts,
    );

    expect(fs.readdirSync).toHaveBeenCalledWith(mockDirectory);
    expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath, "utf8");
    expect(fs.writeFileSync).toHaveBeenCalledWith(mockFilePath, expect.any(String), "utf8");
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining("Post-processing file"));
  });

  test("should log post-processing steps correctly", async () => {
    await postProcessing(
      [
        { name: "Movie", crd: mockCRD, version: "v1" }, // Ensure the name and version match the file name
      ],
      mockOpts,
    );

    expect(mockLogFn).toHaveBeenCalledWith("\n🔧 Post-processing started...");
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining("Post-processing file:"));
    expect(mockLogFn).toHaveBeenCalledWith("🔧 Post-processing completed.\n");
  });
});

describe("processFile - wrapping with fluent client", () => {
  const mockOpts: GenerateOptions = {
    directory: "test-directory",
    language: "ts",
    logFn: mockLogFn,
    plain: false,
    source: "test-source.yaml",
  };

  test("should replace interface with class that extends GenericKind", () => {
    const content = `
      export interface Movie {
        title: string;
        director: string;
      }
    `;

    const modifiedContent = processFile(content, "Movie", mockCRD, "v1", mockOpts);

    // Check that the interface was replaced with a class extending GenericKind
    expect(modifiedContent).toContain("export class Movie extends GenericKind {");
    expect(modifiedContent).not.toContain("export interface Movie {");
  });
});

describe("removePropertyStringAny", () => {
  const linesWithPropertyStringAny = [
    "export class Movie extends GenericKind {",
    "  title: string;",
    "  [property: string]: any;", // This line should be removed for TypeScript
  ];

  const linesWithoutPropertyStringAny = [
    "export class Movie extends GenericKind {",
    "  title: string;",
  ];

  test("should remove '[property: string]: any;' when language is 'ts'", () => {
    const opts: GenerateOptions = {
      directory: "test-directory",
      language: "ts",
      logFn: mockLogFn,
      plain: false,
      source: "test-source.yaml",
    };

    const result = removePropertyStringAny(linesWithPropertyStringAny, opts);
    expect(result).toEqual(linesWithoutPropertyStringAny);
  });

  test("should remove '[property: string]: any;' when language is 'typescript'", () => {
    const opts: GenerateOptions = {
      directory: "test-directory",
      language: "typescript",
      logFn: mockLogFn,
      plain: false,
      source: "test-source.yaml",
    };

    const result = removePropertyStringAny(linesWithPropertyStringAny, opts);
    expect(result).toEqual(linesWithoutPropertyStringAny);
  });

  test("should not remove '[property: string]: any;' when language is not 'ts' or 'typescript'", () => {
    const opts: GenerateOptions = {
      directory: "test-directory",
      language: "js",
      logFn: mockLogFn,
      plain: false,
      source: "test-source.yaml",
    };

    const result = removePropertyStringAny(linesWithPropertyStringAny, opts);
    expect(result).toEqual(linesWithPropertyStringAny);
  });
});

import * as fs from "fs";
import {
  readFile,
  writeFile,
  getGenericKindProperties,
  collectInterfaceNames,
  processFile,
  postProcessing,
} from "./postProcessing";
import { GenericKind } from "./types"; // Mock the GenericKind class
import { jest, describe, beforeEach, test, expect } from "@jest/globals";
import { GenerateOptions } from './generate';
import { CustomResourceDefinition } from './upstream';

jest.mock("fs");
jest.mock("./types");

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
        storage: false
      },
    ],
  },
};

// Mock GenerateOptions for tests
const mockOpts: GenerateOptions = {
  directory: 'test-directory',
  language: 'ts',
  logFn: mockLogFn,
  plain: false,
  source: 'test-source.yaml',
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
    (GenericKind as jest.Mock).mockImplementation(() => ({
      apiVersion: "",
      kind: "",
      metadata: {},
      "[key: string]": "any",
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
  const mockFile = "testFile.ts";
  const mockFilePath = `${mockDirectory}/${mockFile}`;
  const mockFileContent = "export class TestClass extends GenericKind {}";

  beforeEach(() => {
    jest.clearAllMocks();
    mockReaddirSync.mockReturnValue([mockFile]);
    mockReadFileSync.mockReturnValue(mockFileContent);
  });

  test("should process all files in the directory", async () => {
    await postProcessing("Movie", mockCRD, "v1", mockOpts);

    expect(fs.readdirSync).toHaveBeenCalledWith(mockDirectory);
    expect(fs.readFileSync).toHaveBeenCalledWith(mockFilePath, "utf8");
    expect(fs.writeFileSync).toHaveBeenCalledWith(mockFilePath, expect.any(String), "utf8");
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining("Post processing file"));
  });

  test("should log post-processing steps correctly", async () => {
    await postProcessing("Movie", mockCRD, "v1", mockOpts);

    expect(mockLogFn).toHaveBeenCalledWith("\n🔧 Post-processing started...");
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining("Post processing file:"));
    expect(mockLogFn).toHaveBeenCalledWith("🔧 Post-processing completed.\n");
  });
});

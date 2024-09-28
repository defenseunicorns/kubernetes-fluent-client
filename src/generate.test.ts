import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { convertCRDtoTS, resolveFilePath, prepareInputData } from "./generate";
import fs from "fs";
import { LogFn } from "./types";
import path from "path";
import { quicktype } from "quicktype-core";

// Spy on the file writing instead of mocking the entire fs module
jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});

// Mock the file system and fetch functions
jest.mock("fs");
jest.mock("./fetch");
jest.mock("./fluent");

// Mock the quicktype function
jest.mock("quicktype-core", () => {
  const actualQuicktypeCore = jest.requireActual<typeof import("quicktype-core")>("quicktype-core");
  return {
    quicktype: jest.fn(),
    JSONSchemaInput: actualQuicktypeCore.JSONSchemaInput,
    FetchingJSONSchemaStore: actualQuicktypeCore.FetchingJSONSchemaStore,
    InputData: actualQuicktypeCore.InputData, // Add InputData here
  };
});

// Sample CRD YAML content to use in tests
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
  let logFn: jest.Mock<ReturnType<LogFn>>; // Explicitly typing the mock function

  beforeEach(() => {
    jest.clearAllMocks(); // Reset all mocks before each test
    logFn = jest.fn(); // Mock the log function with correct typing
  });

  test("convertCRDtoTS should generate the expected TypeScript file", async () => {
    // Mock quicktype to return a sample result
    (quicktype as jest.MockedFunction<typeof quicktype>).mockResolvedValueOnce({
      lines: [
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
      ],
      annotations: [], // Correctly mock annotations as an empty array
    });

    const options = {
      source: "test-crd.yaml",
      language: "ts",
      logFn, // Mocked log function
      directory: "test-dir", // Mock directory
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
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join("test-dir", "movie-v1.ts"),
      expectedMovie.join("\n"),
    );

    // Assert the logs contain expected log messages
    expect(logFn).toHaveBeenCalledWith("- Generating example.com/v1 types for Movie");
  });
});

describe("prepareInputData Tests", () => {
  test("prepareInputData should correctly prepare input data for quicktype", async () => {
    const schema = JSON.stringify({
      type: "object",
      description: "Movie nerd",
      properties: {
        title: { type: "string" },
        author: { type: "string" },
      },
    });

    const name = "Movie";

    // Call prepareInputData with sample schema and name
    const inputData = await prepareInputData(name, schema);

    // Mock quicktype to return a sample result
    (quicktype as jest.MockedFunction<typeof quicktype>).mockResolvedValueOnce({
      lines: ["interface Movie {", "  title?: string;", "  author?: string;", "}"],
      annotations: [],
    });

    // Use the prepared inputData to call quicktype
    const result = await quicktype({
      inputData,
      lang: "ts",
      rendererOptions: { "just-types": "true" },
    });

    // Verify that quicktype was called with the correct input
    expect(quicktype).toHaveBeenCalledWith({
      inputData,
      lang: "ts",
      rendererOptions: { "just-types": "true" },
    });

    // Assert the quicktype result matches the expected TypeScript interface
    expect(result.lines).toEqual([
      "interface Movie {",
      "  title?: string;",
      "  author?: string;",
      "}",
    ]);
  });
});

describe("Utility Tests", () => {
  test("resolves file path correctly for absolute path", () => {
    const absolutePath = "/absolute/path/to/crd.yaml"; // Absolute path
    const result = resolveFilePath(absolutePath);
    expect(result).toBe(absolutePath); // Should be the same as absolute path
  });

  test("resolves file path correctly for relative path", () => {
    const relativePath = "relative/path/to/crd.yaml"; // Relative path
    const expectedPath = path.join(process.cwd(), relativePath); // Expected path
    const result = resolveFilePath(relativePath);
    expect(result).toBe(expectedPath);
  });
});

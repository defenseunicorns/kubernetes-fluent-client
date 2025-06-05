import * as normalization from "./normalization";
import { GenerateOptions } from "./generate";
import { vi, beforeEach, it, expect, describe, afterEach } from "vitest";

// Mock the fs module
vi.mock("fs");

vi.mock("./types", () => ({
  GenericKind: vi.fn().mockImplementation(() => ({
    kind: "MockKind",
    apiVersion: "v1",
  })),
}));

describe("normalizeIndentationAndSpacing", () => {
  const mockOpts = {
    language: "ts",
    source: "",
    logFn: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
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

    const result = normalization.normalizeIndentation(mockLines);

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
      const result = normalization.normalizeLineIndentation(input);
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

    const result = normalization.normalizePropertySpacing(inputLines);

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
    const resultTs = normalization.removePropertyStringAny(inputLines, tsOpts);
    const expectedTs = ["someProp: string;", "anotherProp: number;"];
    expect(resultTs).toEqual(expectedTs);

    // Test for TypeScript with "typescript" as language
    const typescriptOpts: GenerateOptions = { ...mockOpts, language: "typescript" };
    const resultTypescript = normalization.removePropertyStringAny(inputLines, typescriptOpts);
    expect(resultTypescript).toEqual(expectedTs);
  });

  describe("processEslintDisable", () => {
    beforeEach(() => {
      vi.clearAllMocks(); // Clear mocks before each test
    });

    afterEach(() => {
      vi.restoreAllMocks(); // Restore all mocks after each test
    });

    it('should add ESLint disable comment if line contains "[key: string]: any" and is not part of genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["kind", "apiVersion"]; // No "[key: string]" present

      const result = normalization.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual(
        "  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n[key: string]: any;",
      );
    });

    it('should not add ESLint disable comment if "[key: string]" is in genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["[key: string]", "kind", "apiVersion"]; // "[key: string]" present

      const result = normalization.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("[key: string]: any;"); // No comment added
    });

    it('should not add ESLint disable comment if line does not contain "[key: string]: any"', () => {
      const line = "prop: string;";
      const genericKindProperties = ["kind", "apiVersion"]; // Normal properties

      const result = normalization.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("prop: string;"); // No change in the line
    });

    it('should not add ESLint disable comment if line contains "[key: string]: any" but is part of genericKindProperties', () => {
      const line = "[key: string]: any;";
      const genericKindProperties = ["[key: string]"];

      const result = normalization.processEslintDisable(line, genericKindProperties);

      expect(result).toEqual("[key: string]: any;"); // No comment added since it's in genericKindProperties
    });
  });

  it('should not remove lines when language is not "ts" or "typescript"', () => {
    const inputLines = ["someProp: string;", "[property: string]: any;", "anotherProp: number;"];

    // Test for other languages
    const otherOpts: GenerateOptions = { ...mockOpts, language: "js" }; // Not TypeScript
    const resultOther = normalization.removePropertyStringAny(inputLines, otherOpts);
    expect(resultOther).toEqual(inputLines); // Should return the original lines
  });
});

describe("makePropertiesOptional", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it("should make property optional if type is found in interfaces and not already optional", () => {
    const line = "myProp: MyInterface;";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface

    const result = normalization.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp?: MyInterface;"); // The colon is replaced by `?:`
  });

  it("should not make property optional if type is not found in interfaces", () => {
    const line = "myProp: AnotherType;";
    const foundInterfaces = new Set(["MyInterface"]); // No match for this type

    const result = normalization.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp: AnotherType;"); // No change
  });

  it("should not make property optional if already optional", () => {
    const line = "myProp?: MyInterface;";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface, but already optional

    const result = normalization.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("myProp?: MyInterface;"); // No change since it's already optional
  });

  it("should not change line if it does not match the property pattern", () => {
    const line = "function test() {}";
    const foundInterfaces = new Set(["MyInterface"]); // Matching interface, but the line is not a property

    const result = normalization.makePropertiesOptional(line, foundInterfaces);

    expect(result).toEqual("function test() {}"); // No change
  });
});

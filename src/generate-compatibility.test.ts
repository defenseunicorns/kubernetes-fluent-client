// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { TypeScriptTargetLanguage } from "quicktype-core";
import { generateTypes, prepareInputData } from "./generate.js";

describe("TypeScript array compatibility", () => {
  it.each([undefined, 0, 1, 2, 16, 17])("preserves arrays with minItems %s", async minItems => {
    const inputData = await prepareInputData(
      "WebApp",
      JSON.stringify({
        type: "object",
        properties: {
          values: { type: "array", items: { type: "string" }, minItems, maxItems: 20 },
        },
      }),
    );

    const output = (
      await generateTypes(inputData, { source: "test-crd.yaml", language: "ts", logFn: () => {} })
    ).join("\n");

    expect(output).toContain("values?: string[];");
  });

  it.each(["ts", "typescript", "tsx", undefined] as const)(
    "preserves arrays for the %s TypeScript target",
    async language => {
      const inputData = await prepareInputData(
        "WebApp",
        JSON.stringify({
          type: "object",
          properties: { values: { type: "array", items: { type: "string" }, minItems: 1 } },
        }),
      );
      const output = (
        await generateTypes(inputData, { source: "test-crd.yaml", language, logFn: () => {} })
      ).join("\n");

      expect(output).toContain("string[]");
      expect(output).not.toContain("...string[]");
    },
  );

  it("preserves caller-supplied target languages and their schema constraints", async () => {
    const inputData = await prepareInputData(
      "WebApp",
      JSON.stringify({
        type: "object",
        properties: { values: { type: "array", items: { type: "string" }, minItems: 1 } },
      }),
    );
    const output = (
      await generateTypes(inputData, {
        source: "test-crd.yaml",
        language: new TypeScriptTargetLanguage(),
        logFn: () => {},
      })
    ).join("\n");

    expect(output).toContain("values?: [string, ...string[]];");
  });

  it("keeps ordinary array variables assignable to generated constrained arrays", async () => {
    const inputData = await prepareInputData(
      "WebApp",
      JSON.stringify({
        type: "object",
        properties: {
          values: { type: "array", items: { type: "string" }, minItems: 1 },
          nested: {
            type: "array",
            minItems: 1,
            items: { type: "array", items: { type: "string" }, minItems: 2 },
          },
          mixed: {
            type: "array",
            minItems: 1,
            items: { anyOf: [{ type: "string" }, { type: "integer" }] },
          },
        },
      }),
    );
    const output = (
      await generateTypes(inputData, { source: "test-crd.yaml", language: "ts", logFn: () => {} })
    ).join("\n");

    expect(output).toContain("nested?: Array<string[]>;");
    expect(output).toMatch(/mixed\?:\s+Array<number \| string>;/);

    const fileName = "/kfc-array-consumer.ts";
    const source = `${output}
      const values: string[] = ["a"];
      const nested: string[][] = [["a", "b"]];
      const mixed: (string | number)[] = ["a", 1];
      const app: WebApp = { values, nested, mixed };
    `;
    const options: ts.CompilerOptions = {
      noEmit: true,
      strict: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
    };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
      file === fileName
        ? ts.createSourceFile(file, source, languageVersion, true)
        : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);

    const program = ts.createProgram([fileName], options, host);
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic => diagnostic.messageText)).toEqual([]);
  });
});

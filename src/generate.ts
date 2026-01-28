// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { loadAllYaml, dumpYaml } from "@kubernetes/client-node";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import {
  FetchingJSONSchemaStore,
  InputData,
  JSONSchemaInput,
  TargetLanguage,
  quicktype,
} from "quicktype-core";

import { fetch } from "./fetch.js";
import { K8s } from "./fluent/index.js";
import { CustomResourceDefinition } from "./upstream.js";
import { LogFn } from "./types.js";

import type { V1CustomResourceDefinition } from "@kubernetes/client-node";

/**
 * Recursively fixes _enum properties to enum for quicktype compatibility.
 * The Kubernetes client library converts 'enum' to '_enum' to avoid JS reserved keywords,
 * but quicktype expects 'enum'.
 *
 * @param obj - The schema object to fix
 * @returns The fixed schema object with enum properties restored
 */
export function fixEnumProperties(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(fixEnumProperties);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "_enum") {
      // Convert _enum back to enum
      result.enum = value;
    } else {
      // Recursively fix nested objects
      result[key] = fixEnumProperties(value);
    }
  }

  return result;
}

export type QuicktypeLang = Parameters<typeof quicktype>[0]["lang"];

type ExportableCustomResourceDefinition = CustomResourceDefinition | V1CustomResourceDefinition;

export interface GenerateOptions {
  source: string; // URL, file path, or K8s CRD name
  directory?: string; // Output directory path
  overrideClassName?: string; // Override class name for generated types
  plain?: boolean; // Disable fluent client wrapping
  language: QuicktypeLang; // Language for type generation (default: "ts")
  npmPackage?: string; // Override NPM package
  logFn: LogFn; // Log function callback
  noPost?: boolean; // Enable/disable post-processing
  export?: boolean; // Export CRD to YAML
  exportOnly?: boolean; // Export only, no type generation
}

/**
 * Converts a CustomResourceDefinition to TypeScript types
 *
 * @param crd - The CustomResourceDefinition object to convert.
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to a record of generated TypeScript types.
 */
export async function convertCRDtoTS(
  crd: CustomResourceDefinition,
  opts: GenerateOptions,
): Promise<
  {
    results: Record<string, string[]>;
    name: string;
    crd: CustomResourceDefinition;
    version: string;
  }[]
> {
  const name = opts.overrideClassName || crd.spec.names.kind;
  const originalKind = crd.spec.names.kind;
  const results: Record<string, string[]> = {};
  const output: {
    results: Record<string, string[]>;
    name: string;
    crd: CustomResourceDefinition;
    version: string;
  }[] = [];

  // Check for missing versions or empty schema
  if (!crd.spec.versions || crd.spec.versions.length === 0) {
    opts.logFn(`Skipping ${crd.metadata?.name}, it does not appear to be a CRD`);
    return [];
  }

  // Iterate through each version of the CRD
  for (const match of crd.spec.versions) {
    if (!match.schema?.openAPIV3Schema) {
      opts.logFn(
        `Skipping ${crd.metadata?.name ?? "unknown"}, it does not appear to have a valid schema`,
      );
      continue;
    }

    // Fix _enum properties to enum for quicktype compatibility
    const fixedSchema = fixEnumProperties(match.schema.openAPIV3Schema);
    const schema = JSON.stringify(fixedSchema);
    opts.logFn(`- Generating ${crd.spec.group}/${match.name} types for ${name}`);

    const inputData = await prepareInputData(name, schema);
    const generatedTypes = await generateTypes(inputData, opts);

    const fileName = `${originalKind.toLowerCase()}-${match.name.toLowerCase()}`;
    writeGeneratedFile(fileName, opts.directory || "", generatedTypes, opts.language || "ts");

    results[fileName] = generatedTypes;
    output.push({ results, name, crd, version: match.name });
  }

  return output;
}

/**
 * Prepares the input data for quicktype from the provided schema.
 *
 * @param name - The name of the schema.
 * @param schema - The JSON schema as a string.
 * @returns A promise that resolves to the input data for quicktype.
 */
export async function prepareInputData(name: string, schema: string): Promise<InputData> {
  // Create a new JSONSchemaInput
  const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

  // Add the schema to the input
  await schemaInput.addSource({ name, schema });

  // Create a new InputData object
  const inputData = new InputData();
  inputData.addInput(schemaInput);

  return inputData;
}

/**
 * Generates TypeScript types using quicktype.
 *
 * @param inputData - The input data for quicktype.
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to an array of generated TypeScript type lines.
 */
export async function generateTypes(
  inputData: InputData,
  opts: GenerateOptions,
): Promise<string[]> {
  // Generate the types
  const out = await quicktype({
    inputData,
    lang: opts.language,
    rendererOptions: { "just-types": "true" },
  });

  return out.lines;
}

/**
 * Writes the processed lines to the output file.
 *
 * @param fileName - The name of the file to write.
 * @param directory - The directory where the file will be written.
 * @param content - The content to write to the file.
 * @param language - The programming language of the file.
 */
export function writeGeneratedFile(
  fileName: string,
  directory: string,
  content: string[],
  language: string | TargetLanguage,
): void {
  language = language || "ts";
  if (!directory) return;

  const filePath = path.join(directory, `${fileName}.${language}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, content.join("\n"));
}

/**
 * Reads or fetches a CustomResourceDefinition from a file, URL, or the cluster.
 *
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to an array of CustomResourceDefinition objects.
 */
export async function readOrFetchCrd(opts: GenerateOptions): Promise<CustomResourceDefinition[]> {
  try {
    const filePath = resolveFilePath(opts.source);

    if (fs.existsSync(filePath)) {
      opts.logFn(`Attempting to load ${opts.source} as a local file`);
      const content = fs.readFileSync(filePath, "utf8");
      return loadAllYaml(content) as CustomResourceDefinition[];
    }

    const url = tryParseUrl(opts.source);
    if (url) {
      opts.logFn(`Attempting to load ${opts.source} as a URL`);
      const { ok, data } = await fetch<string>(url.href);
      if (ok) {
        return loadAllYaml(data) as CustomResourceDefinition[];
      }
    }

    // Fallback to Kubernetes cluster
    opts.logFn(`Attempting to read ${opts.source} from the Kubernetes cluster`);
    return [await K8s(CustomResourceDefinition).Get(opts.source)];
  } catch (error) {
    opts.logFn(`Error loading CRD: ${error.message}`);
    throw new Error(`Failed to read ${opts.source} as a file, URL, or Kubernetes CRD`);
  }
}

/**
 * Resolves the source file path, treating relative paths as local files.
 *
 * @param source - The source path to resolve.
 * @returns The resolved file path.
 */
export function resolveFilePath(source: string): string {
  return source.startsWith("/") ? source : path.join(process.cwd(), source);
}

/**
 * Tries to parse the source as a URL.
 *
 * @param source - The source string to parse as a URL.
 * @returns The parsed URL object or null if parsing fails.
 */
export function tryParseUrl(source: string): URL | null {
  try {
    return new URL(source);
  } catch {
    return null;
  }
}

/**
 *
 * @param crd
 */
function allVersionsHaveTypeGenSchema(crd: ExportableCustomResourceDefinition): boolean {
  if (!crd.spec?.versions?.length) return false;
  return crd.spec.versions.every(v => !!v?.schema?.openAPIV3Schema);
}

/**
 * Validates CRD structure required for exporting.
 *
 * @param crd - The CustomResourceDefinition to validate
 * @returns True if valid, throws error if invalid
 */
export function validateCRDStructure(crd: ExportableCustomResourceDefinition): boolean {
  if (!crd.apiVersion || crd.apiVersion !== "apiextensions.k8s.io/v1") {
    throw new Error(
      `Invalid CRD: apiVersion must be "apiextensions.k8s.io/v1", got "${crd.apiVersion}"`,
    );
  }

  if (crd.kind !== "CustomResourceDefinition") {
    throw new Error(`Invalid CRD: kind must be "CustomResourceDefinition", got "${crd.kind}"`);
  }

  if (!crd.metadata?.name) {
    throw new Error("Invalid CRD: metadata.name is required");
  }

  if (!crd.spec) {
    throw new Error("Invalid CRD: spec is required");
  }

  if (!crd.spec.group) {
    throw new Error("Invalid CRD: spec.group is required");
  }

  if (!crd.spec.names?.kind || !crd.spec.names?.plural) {
    throw new Error("Invalid CRD: spec.names.kind and spec.names.plural are required");
  }

  if (!crd.spec.scope || (crd.spec.scope !== "Namespaced" && crd.spec.scope !== "Cluster")) {
    throw new Error(
      `Invalid CRD: spec.scope must be "Namespaced" or "Cluster", got "${crd.spec.scope}"`,
    );
  }

  if (!crd.spec.versions || crd.spec.versions.length === 0) {
    throw new Error("Invalid CRD: spec.versions must contain at least one version");
  }

  return true;
}

/**
 *
 * @param crd
 */
export function validateCRDForTypeGeneration(crd: ExportableCustomResourceDefinition): boolean {
  validateCRDStructure(crd);

  if (!allVersionsHaveTypeGenSchema(crd)) {
    throw new Error(
      "Invalid CRD for type generation: every spec.versions[].schema.openAPIV3Schema is required",
    );
  }

  return true;
}

/**
 *
 * @param crd
 */
function normalizeExportedCRDForTypeGeneration(
  crd: ExportableCustomResourceDefinition,
): CustomResourceDefinition {
  const versions = (crd.spec.versions || []).map(v => {
    return {
      name: v.name,
      served: v.served,
      storage: v.storage,
      schema: v.schema
        ? {
            openAPIV3Schema: v.schema.openAPIV3Schema,
          }
        : undefined,
    };
  });

  return {
    apiVersion: crd.apiVersion,
    kind: crd.kind,
    metadata: {
      ...crd.metadata,
      name: crd.metadata?.name,
    },
    spec: {
      ...crd.spec,
      group: crd.spec.group,
      names: {
        ...crd.spec.names,
        kind: crd.spec.names.kind,
        plural: crd.spec.names.plural,
      },
      scope: crd.spec.scope,
      versions,
    },
  } as CustomResourceDefinition;
}

/**
 * Serializes CRD to YAML format.
 *
 * @param crd - The CustomResourceDefinition to serialize
 * @returns The YAML string representation
 */
export function serializeCRDToYAML(crd: ExportableCustomResourceDefinition): string {
  return dumpYaml(crd);
}

/**
 * Loads a TypeScript module from the specified file path.
 *
 * @param filePath - The absolute path to the TypeScript file
 * @param logFn - The logging function
 * @returns A promise that resolves to the imported module
 * @throws Error if the file cannot be imported
 */
async function loadCRDModule(filePath: string, logFn: LogFn): Promise<unknown> {
  logFn(`Loading TypeScript CRD definitions from ${filePath}`);

  const isTypeScriptFile = /\.(ts|mts|cts|tsx)$/i.test(filePath);
  if (isTypeScriptFile) {
    await import("tsx/esm");
  }

  try {
    return await import(pathToFileURL(filePath).href);
  } catch (error) {
    const base = `Failed to import TypeScript file: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(base, { cause: error instanceof Error ? error : undefined });
  }
}

/**
 * Extracts valid CRD definitions from a module.
 *
 * @param module - The imported module to extract CRDs from
 * @param logFn - The logging function
 * @returns An array of valid CustomResourceDefinition objects
 * @throws Error if no valid CRDs are found
 */
function extractCRDsFromModule(
  module: unknown,
  logFn: LogFn,
): ExportableCustomResourceDefinition[] {
  const crds: ExportableCustomResourceDefinition[] = [];

  for (const [key, value] of Object.entries(module as Record<string, unknown>)) {
    // Skip private properties
    if (key.startsWith("_")) continue;

    // Check if the value looks like a CRD
    if (value && typeof value === "object" && "apiVersion" in value && "kind" in value) {
      const crd = value as ExportableCustomResourceDefinition;
      if (crd.kind !== "CustomResourceDefinition") {
        continue;
      }
      try {
        validateCRDStructure(crd);
        crds.push(crd);
      } catch (error) {
        logFn(`Skipping ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (crds.length === 0) {
    throw new Error("No valid CRD definitions found in the TypeScript file");
  }

  return crds;
}

/**
 * Writes a CRD to a YAML file.
 *
 * @param crd - The CustomResourceDefinition to write
 * @param outputDir - The output directory path
 * @returns The path to the written file
 */
function writeCRDToFile(crd: ExportableCustomResourceDefinition, outputDir: string): string {
  const yaml = serializeCRDToYAML(crd);
  const fileName = `${crd.metadata!.name}.yaml`;
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, yaml);
  return outputPath;
}

/**
 * Exports TypeScript-defined CRDs to YAML manifests.
 *
 * @param opts - The options for CRD export
 * @returns A promise that resolves to an object containing exported file paths and CRD objects
 */
export async function exportCRDFromTS(opts: GenerateOptions): Promise<{
  files: string[];
  crds: ExportableCustomResourceDefinition[];
}> {
  const filePath = resolveFilePath(opts.source);
  const outputDir = opts.directory || process.cwd();
  const exportedFiles: string[] = [];

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`TypeScript file not found: ${opts.source}`);
  }

  // Load the module
  const module = await loadCRDModule(filePath, opts.logFn);

  // Extract valid CRDs
  const crds = extractCRDsFromModule(module, opts.logFn);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Write each CRD to a file
  for (const crd of crds) {
    const outputPath = writeCRDToFile(crd, outputDir);
    exportedFiles.push(outputPath);
    opts.logFn(`Exported ${crd.metadata!.name} to ${outputPath}`);
  }

  return { files: exportedFiles, crds };
}

/**
 * Main generate function to convert CRDs to TypeScript types.
 *
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to a record of generated TypeScript types.
 */
export async function generate(opts: GenerateOptions): Promise<
  {
    results: Record<string, string[]>;
    name: string;
    crd: CustomResourceDefinition;
    version: string;
  }[]
> {
  let crds: CustomResourceDefinition[] = [];

  if (opts.export) {
    const { files, crds: exportedCRDs } = await exportCRDFromTS(opts);
    if (opts.exportOnly) {
      opts.logFn(`\n✅ Exported ${files.length} CRD manifest(s)`);
      return [];
    }
    opts.logFn(`\n📝 Generating types from exported CRDs...`);
    const invalidForGen: string[] = [];
    const validForGen: CustomResourceDefinition[] = [];

    for (const exported of exportedCRDs) {
      try {
        validateCRDForTypeGeneration(exported);
        validForGen.push(normalizeExportedCRDForTypeGeneration(exported));
      } catch {
        invalidForGen.push(exported?.metadata?.name || "<unknown>");
      }
    }

    if (invalidForGen.length > 0) {
      throw new Error(
        `Exported CRD(s) missing required schema for type generation: ${invalidForGen.join(", ")}`,
      );
    }

    crds = validForGen;
  } else {
    // Read or fetch CRDs from source
    crds = (await readOrFetchCrd(opts)).filter(crd => !!crd);
  }

  const allResults: {
    results: Record<string, string[]>;
    name: string;
    crd: CustomResourceDefinition;
    version: string;
  }[] = [];

  opts.logFn("");

  for (const crd of crds) {
    if (crd.kind !== "CustomResourceDefinition" || !crd.spec?.versions?.length) {
      opts.logFn(`Skipping ${crd?.metadata?.name}, it does not appear to be a CRD`);
      continue;
    }

    allResults.push(...(await convertCRDtoTS(crd, opts)));
  }

  if (opts.directory) {
    opts.logFn(`\n✅ Generated ${allResults.length} files in the ${opts.directory} directory`);
  } else {
    opts.logFn(`\n✅ Generated ${allResults.length} files`);
  }

  return allResults;
}

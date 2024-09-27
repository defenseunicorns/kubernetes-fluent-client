// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { loadAllYaml } from "@kubernetes/client-node";
import * as fs from "fs";
import * as path from "path";
import {
  FetchingJSONSchemaStore,
  InputData,
  JSONSchemaInput,
  TargetLanguage,
  quicktype,
} from "quicktype-core";

import { fetch } from "./fetch";
import { K8s } from "./fluent";
import { CustomResourceDefinition } from "./upstream";
import { LogFn } from "./types";

export interface GenerateOptions {
  source: string; // URL, file path, or K8s CRD name
  directory?: string; // Output directory path
  plain?: boolean; // Disable fluent client wrapping
  language?: string | TargetLanguage;
  npmPackage?: string; // Override NPM package
  logFn: LogFn; // Log function callback
  noPost?: boolean; // Enable/disable post-processing
}

/**
 * Converts a CustomResourceDefinition to TypeScript types
 *
 * @param crd - The CustomResourceDefinition object to convert.
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to a record of generated TypeScript types.
 */
async function convertCRDtoTS(
  crd: CustomResourceDefinition,
  opts: GenerateOptions,
): Promise<Record<string, string[]>> {
  // Get the name of the kind
  const name = crd.spec.names.kind;

  const results: Record<string, string[]> = {};

  for (const match of crd.spec.versions) {
    const version = match.name;

    // Get the schema from the matched version
    const schema = JSON.stringify(match.schema?.openAPIV3Schema);

    opts.logFn(`- Generating ${crd.spec.group}/${version} types for ${name}`);

    const inputData = await prepareInputData(name, schema);
    const generatedTypes = await generateTypes(inputData, opts);
    const processedLines = processGeneratedLines(generatedTypes, name, crd, version, opts);

    const fileName = `${name.toLowerCase()}-${version.toLowerCase()}`;
    writeGeneratedFile(fileName, opts.directory || "", processedLines, opts.language || "ts");

    results[fileName] = processedLines;
  }

  return results;
}

/**
 * Prepares the input data for quicktype from the provided schema.
 *
 * @param name - The name of the schema.
 * @param schema - The JSON schema as a string.
 * @returns A promise that resolves to the input data for quicktype.
 */
async function prepareInputData(name: string, schema: string): Promise<InputData> {
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
async function generateTypes(inputData: InputData, opts: GenerateOptions): Promise<string[]> {
  // If the language is not specified, default to TypeScript
  const language = opts.language || "ts";

  // Generate the types
  const out = await quicktype({
    inputData,
    lang: language,
    rendererOptions: { "just-types": "true" },
  });

  return out.lines;
}

/**
 * Processes the generated lines, adding imports, wrapping with fluent client, and fixing indentation.
 *
 * @param lines - The generated TypeScript lines.
 * @param name - The name of the schema.
 * @param crd - The CustomResourceDefinition object.
 * @param version - The version of the CRD.
 * @param opts - The options for generating the TypeScript types.
 * @returns The processed TypeScript lines.
 */
function processGeneratedLines(
  lines: string[],
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  opts: GenerateOptions,
): string[] {
  let processedLines = lines.filter(line => !line.includes("[property: string]: any;"));

  // Handle TypeScript and fluent client wrapping
  if (opts.language === "ts" && !opts.plain) {
    processedLines = wrapWithFluentClient(processedLines, name, crd, version, opts.npmPackage);
  }

  // Normalize indentation and property spacing
  processedLines = normalizeIndentation(processedLines);
  processedLines = normalizePropertySpacing(processedLines);

  return processedLines;
}

/**
 * Adds fluent client wrappers (e.g., GenericKind and RegisterKind).
 *
 * @param lines - The generated TypeScript lines.
 * @param name - The name of the schema.
 * @param crd - The CustomResourceDefinition object.
 * @param version - The version of the CRD.
 * @param npmPackage - The NPM package name for the fluent client.
 * @returns The processed TypeScript lines with fluent client wrappers.
 */
function wrapWithFluentClient(
  lines: string[],
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  npmPackage: string = "kubernetes-fluent-client",
): string[] {
  const autoGenNotice = `// This file is auto-generated by ${npmPackage}, do not edit manually\n`;
  const imports = `import { GenericKind, RegisterKind } from "${npmPackage}";\n`;

  const classIndex = lines.findIndex(line => line.includes(`export interface ${name} {`));
  lines[classIndex] = `export class ${name} extends GenericKind {`;

  lines.unshift(autoGenNotice, imports);
  lines.push(`RegisterKind(${name}, {`);
  lines.push(`  group: "${crd.spec.group}",`);
  lines.push(`  version: "${version}",`);
  lines.push(`  kind: "${name}",`);
  lines.push(`  plural: "${crd.spec.names.plural}",`);
  lines.push(`});`);

  return lines;
}

/**
 * Normalizes the indentation of the generated lines.
 *
 * @param lines - The generated TypeScript lines.
 * @returns The lines with normalized indentation.
 */
function normalizeIndentation(lines: string[]): string[] {
  return lines.map(line => line.replace(/^ {4}/, "  "));
}

/**
 * Normalizes the spacing between property names and types in TypeScript lines.
 * Ensures that there is only one space between the property and its type.
 *
 * @param lines - The generated TypeScript lines.
 * @returns The lines with normalized property spacing.
 */
export function normalizePropertySpacing(lines: string[]): string[] {
  return lines.map(line => line.replace(/\?\s*:\s*/, "?: "));
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
async function readOrFetchCrd(opts: GenerateOptions): Promise<CustomResourceDefinition[]> {
  const filePath = resolveFilePath(opts.source);

  // Try to load from file
  if (fs.existsSync(filePath)) {
    opts.logFn(`Attempting to load ${opts.source} as a local file`);
    const content = fs.readFileSync(filePath, "utf8");
    return loadAllYaml(content) as CustomResourceDefinition[];
  }

  // Try to load from URL
  const url = tryParseUrl(opts.source);
  if (url) {
    opts.logFn(`Attempting to load ${opts.source} as a URL`);
    const { ok, data } = await fetch<string>(url.href);
    if (ok) {
      return loadAllYaml(data) as CustomResourceDefinition[];
    }
  }

  // If neither file nor URL worked, try to read from Kubernetes cluster
  try {
    opts.logFn(`Attempting to read ${opts.source} from the Kubernetes cluster`);
    return [await K8s(CustomResourceDefinition).Get(opts.source)];
  } catch (e) {
    opts.logFn(e);
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
function tryParseUrl(source: string): URL | null {
  try {
    return new URL(source);
  } catch {
    return null;
  }
}

/**
 * Main generate function to convert CRDs to TypeScript types.
 *
 * @param opts - The options for generating the TypeScript types.
 * @returns A promise that resolves to a record of generated TypeScript types.
 */
export async function generate(opts: GenerateOptions): Promise<Record<string, string[]>> {
  const crds = (await readOrFetchCrd(opts)).filter(crd => !!crd);
  const results: Record<string, string[]> = {};

  opts.logFn("");

  for (const crd of crds) {
    // Skip non-CRD objects
    if (crd.kind !== "CustomResourceDefinition" || !crd.spec?.versions?.length) {
      opts.logFn(`Skipping ${crd?.metadata?.name}, it does not appear to be a CRD`);
      // Ignore empty and non-CRD objects
      continue;
    }

    // Add the conversion results to the record
    const out = await convertCRDtoTS(crd, opts);
    Object.assign(results, out);
  }

  if (opts.directory) {
    // Notify the user that the files have been generated
    opts.logFn(
      `\n✅ Generated ${Object.keys(results).length} files in the ${opts.directory} directory`,
    );
  }

  return results;
}

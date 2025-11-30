// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "./generate.js";
import { GenericKind } from "./types.js";
import { CustomResourceDefinition } from "./upstream.js";
import {
  modifyAndNormalizeClassProperties,
  normalizeIndentationAndSpacing,
} from "./normalization.js";

type CRDResult = {
  name: string;
  crd: CustomResourceDefinition;
  version: string;
};

type ClassContextResult = { line: string; insideClass: boolean; braceBalance: number };

const genericKindProperties = getGenericKindProperties();

/**
 * Performs post-processing on generated TypeScript files.
 *
 * @param allResults The array of CRD results.
 * @param opts The options for post-processing.
 */
export async function postProcessing(allResults: CRDResult[], opts: GenerateOptions) {
  if (!opts.directory) {
    opts.logFn("⚠️ Error: Directory is not defined.");
    return;
  }

  const files = fs.readdirSync(opts.directory);
  opts.logFn("\n🔧 Post-processing started...");

  const fileResultMap = mapFilesToCRD(allResults);
  await processFiles(files, fileResultMap, opts);

  opts.logFn("🔧 Post-processing completed.\n");
}

/**
 * Creates a map linking each file to its corresponding CRD result.
 *
 * @param allResults - The array of CRD results.
 * @returns A map linking file names to their corresponding CRD results.
 */
export function mapFilesToCRD(allResults: CRDResult[]): Record<string, CRDResult> {
  const fileResultMap: Record<string, CRDResult> = {};

  for (const { name, crd, version } of allResults) {
    const expectedFileName = `${crd.spec.names.kind.toLowerCase()}-${version.toLowerCase()}.ts`;
    fileResultMap[expectedFileName] = { name, crd, version };
  }

  if (Object.keys(fileResultMap).length === 0) {
    console.warn("⚠️ Warning: No CRD results were mapped to files.");
  }

  return fileResultMap;
}

/**
 * Processes the list of files, applying CRD post-processing to each.
 *
 * @param files - The list of file names to process.
 * @param fileResultMap - A map linking file names to their corresponding CRD results.
 * @param opts - Options for the generation process.
 */
export async function processFiles(
  files: string[],
  fileResultMap: Record<string, CRDResult>,
  opts: GenerateOptions,
) {
  for (const file of files) {
    if (!opts.directory) {
      throw new Error("Directory is not defined.");
    }
    const filePath = path.join(opts.directory, file);
    const fileResult = fileResultMap[file];

    if (!fileResult) {
      opts.logFn(`⚠️ Warning: No matching CRD result found for file: ${filePath}`);
      continue;
    }

    try {
      processAndModifySingleFile(filePath, fileResult, opts);
    } catch (error) {
      logError(error, filePath, opts.logFn);
    }
  }
}

/**
 * Handles the processing of a single file: reading, modifying, and writing back to disk.
 *
 * @param filePath - The path to the file to be processed.
 * @param fileResult - The associated CRD result for this file.
 * @param fileResult.name - The name of the schema.
 * @param fileResult.crd - The CustomResourceDefinition object.
 * @param fileResult.version - The version of the CRD.
 * @param opts - Options for the generation process.
 */
export function processAndModifySingleFile(
  filePath: string,
  fileResult: CRDResult,
  opts: GenerateOptions,
) {
  opts.logFn(`🔍 Processing file: ${filePath}`);
  const { name, crd, version } = fileResult;

  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    logError(error, filePath, opts.logFn);
    return;
  }

  let modifiedContent;
  try {
    modifiedContent = applyCRDPostProcessing(fileContent, name, crd, version, opts);
  } catch (error) {
    logError(error, filePath, opts.logFn);
    return;
  }

  try {
    fs.writeFileSync(filePath, modifiedContent);
    opts.logFn(`✅ Successfully processed and wrote file: ${filePath}`);
  } catch (error) {
    logError(error, filePath, opts.logFn);
  }
}

/**
 * Processes the TypeScript file content, applying wrapping and property modifications.
 *
 * @param content The content of the TypeScript file.
 * @param name The name of the schema.
 * @param crd The CustomResourceDefinition object.
 * @param version The version of the CRD.
 * @param opts The options for processing.
 * @returns The processed TypeScript file content.
 */
export function applyCRDPostProcessing(
  content: string,
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  opts: GenerateOptions,
): string {
  try {
    let lines = content.split("\n");

    // Wraps with the fluent client if needed
    if (opts.language === "ts" && !opts.plain) {
      lines = wrapWithFluentClient(lines, name, crd, version, opts);
    }
    const foundInterfaces = collectInterfaceNames(lines);

    // Process the lines, focusing on classes extending `GenericKind`
    let processedLines = processLines(lines, genericKindProperties, foundInterfaces);

    if (opts.language === "ts") {
      processedLines = extendMetadataWithV1ObjectMeta(processedLines, crd, version);
    }

    // Normalize the final output
    const normalizedLines = normalizeIndentationAndSpacing(processedLines, opts);

    return normalizedLines.join("\n");
  } catch (error) {
    throw new Error(`Error while applying post-processing for ${name}: ${error.message}`);
  }
}

/**
 * Retrieves the properties of the `GenericKind` class, excluding dynamic properties like `[key: string]: any`.
 *
 * @returns An array of property names that belong to `GenericKind`.
 */
export function getGenericKindProperties(): string[] {
  // Ensure we always include standard Kubernetes resource properties
  const standardProperties = ["kind", "apiVersion", "metadata"];

  // Get actual properties from GenericKind
  const instanceProperties = Object.getOwnPropertyNames(new GenericKind()).filter(
    prop => prop !== "[key: string]",
  );

  // Combine both sets of properties, removing duplicates
  return Array.from(new Set([...standardProperties, ...instanceProperties]));
}

/**
 * Collects interface names from TypeScript file lines.
 *
 * @param lines The lines of the file content.
 * @returns A set of found interface names.
 */
export function collectInterfaceNames(lines: string[]): Set<string> {
  // https://regex101.com/r/S6w8pW/1
  const interfacePattern = /export interface (?<interfaceName>\w+)/;
  const foundInterfaces = new Set<string>();

  for (const line of lines) {
    const match = line.match(interfacePattern);
    if (match?.groups?.interfaceName) {
      foundInterfaces.add(match.groups.interfaceName);
    }
  }

  return foundInterfaces;
}

/**
 * Identifies whether a line declares a class that extends `GenericKind`.
 *
 * @param line The current line of code.
 * @returns True if the line defines a class that extends `GenericKind`, false otherwise.
 */
export function isClassExtendingGenericKind(line: string): boolean {
  return line.includes("class") && line.includes("extends GenericKind");
}

/**
 * Adjusts the brace balance to determine if the parser is within a class definition.
 *
 * @param line The current line of code.
 * @param braceBalance The current balance of curly braces.
 * @returns The updated brace balance.
 */
export function updateBraceBalance(line: string, braceBalance: number): number {
  return braceBalance + (line.includes("{") ? 1 : 0) - (line.includes("}") ? 1 : 0);
}

/**
 * Wraps the generated TypeScript file with fluent client elements (`GenericKind` and `RegisterKind`).
 *
 * @param lines The generated TypeScript lines.
 * @param name The name of the schema.
 * @param crd The CustomResourceDefinition object.
 * @param version The version of the CRD.
 * @param opts The options for the generation process.
 * @returns The processed TypeScript lines.
 */
export function wrapWithFluentClient(
  lines: string[],
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  opts: GenerateOptions,
): string[] {
  const autoGenNotice = `// This file is auto-generated by ${opts.npmPackage}, do not edit manually`;
  const imports = `import { GenericKind, RegisterKind } from "${opts.npmPackage}";`;
  const classIndex = lines.findIndex(line => line.includes(`export interface ${name} {`));
  if (classIndex !== -1) {
    lines[classIndex] = `export class ${name} extends GenericKind {`;
  }

  lines.unshift(autoGenNotice, imports);
  lines.push(
    `RegisterKind(${name}, {`,
    `  group: "${crd.spec.group}",`,
    `  version: "${version}",`,
    `  kind: "${crd.spec.names.kind}",`,
    `  plural: "${crd.spec.names.plural}",`,
    `});`,
  );

  return lines;
}

/**
 * Processes the lines of the TypeScript file, focusing on classes extending `GenericKind`.
 *
 * @param lines The lines of the file content.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns The processed lines.
 */
export function processLines(
  lines: string[],
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): string[] {
  let insideClass = false;
  let braceBalance = 0;

  return lines.map(line => {
    const result = processClassContext(
      line,
      insideClass,
      braceBalance,
      genericKindProperties,
      foundInterfaces,
    );
    insideClass = result.insideClass;
    braceBalance = result.braceBalance;

    return result.line;
  });
}

/**
 * Processes a single line inside a class extending `GenericKind`.
 *
 * @param line The current line of code.
 * @param insideClass Whether we are inside a class context.
 * @param braceBalance The current brace balance to detect when we exit the class.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns An object containing the updated line, updated insideClass flag, and braceBalance.
 */
export function processClassContext(
  line: string,
  insideClass: boolean,
  braceBalance: number,
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): ClassContextResult {
  if (isClassExtendingGenericKind(line)) {
    insideClass = true;
    braceBalance = 0;
  }

  if (!insideClass) return { line, insideClass, braceBalance };

  braceBalance = updateBraceBalance(line, braceBalance);
  line = modifyAndNormalizeClassProperties(line, genericKindProperties, foundInterfaces);

  if (braceBalance === 0) {
    insideClass = false;
  }

  return { line, insideClass, braceBalance };
}

/**
 * Handles logging for errors with stack trace.
 *
 * @param error The error object to log.
 * @param filePath The path of the file being processed.
 * @param logFn The logging function.
 */
export function logError(error: Error, filePath: string, logFn: (msg: string) => void) {
  logFn(`❌ Error processing file: ${filePath} - ${error.message}`);
  logFn(`Stack trace: ${error.stack}`);
}

/**
 * Extends the generated Metadata interface with V1ObjectMeta when the CRD
 * schema for this version defines a metadata property.
 *
 * This ensures that generated types keep the full Kubernetes ObjectMeta
 * contract while still including CRD-specific constraints like name enums.
 *
 * @param lines
 * @param crd
 * @param version
 */
export function extendMetadataWithV1ObjectMeta(
  lines: string[],
  crd: CustomResourceDefinition,
  version: string,
): string[] {
  // Find the matching version in the CRD
  const versionSchema = crd.spec?.versions?.find(v => v.name === version);
  const openAPIV3Schema = versionSchema?.schema?.openAPIV3Schema as
    | { properties?: Record<string, unknown> }
    | undefined;

  // Only proceed if this version actually defines a metadata schema
  const metadataSchema = openAPIV3Schema?.properties?.metadata;
  if (!metadataSchema) {
    return lines;
  }

  // Check if there's a Metadata interface at all
  const metadataInterfaceRegex = /export interface Metadata\s*{/;
  const hasMetadataInterface = lines.some(line => metadataInterfaceRegex.test(line));
  if (!hasMetadataInterface) {
    return lines;
  }

  // Avoid double-extending if we've already patched this file
  const alreadyExtends = lines.some(line =>
    /export interface Metadata\s+extends\s+V1ObjectMeta\s*{/.test(line),
  );
  let updatedLines = lines;

  if (!alreadyExtends) {
    updatedLines = updatedLines.map(line =>
      line.replace(metadataInterfaceRegex, "export interface Metadata extends V1ObjectMeta {"),
    );
  }

  // Ensure we import V1ObjectMeta from @kubernetes/client-node
  const hasV1ObjectMetaImport = updatedLines.some(
    line =>
      line.includes("V1ObjectMeta") &&
      line.includes("@kubernetes/client-node") &&
      line.includes("import"),
  );

  if (!hasV1ObjectMetaImport) {
    const importStatement = 'import type { V1ObjectMeta } from "@kubernetes/client-node";';

    // Insert after existing imports, if any; otherwise right after any auto-gen notice
    let insertIndex = 0;

    // Prefer to insert after the last import line at the top of the file
    const firstImportIdx = updatedLines.findIndex(line => line.startsWith("import "));
    if (firstImportIdx !== -1) {
      let lastImportIdx = firstImportIdx;
      for (let i = firstImportIdx + 1; i < updatedLines.length; i++) {
        if (updatedLines[i].startsWith("import ")) {
          lastImportIdx = i;
        } else {
          break;
        }
      }
      insertIndex = lastImportIdx + 1;
    } else {
      // Otherwise, place after auto-gen notice if present
      const autoGenIdx = updatedLines.findIndex(
        line => line.includes("auto-generated") || line.includes("auto generated"),
      );
      if (autoGenIdx !== -1) {
        insertIndex = autoGenIdx + 1;
      }
    }

    updatedLines.splice(insertIndex, 0, importStatement);
  }

  return updatedLines;
}

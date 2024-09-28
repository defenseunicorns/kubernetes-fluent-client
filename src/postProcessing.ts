// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "./generate";
import { GenericKind } from "./types";
import { CustomResourceDefinition } from "./upstream";

/**
 * Reads the content of a file from disk.
 *
 * @param filePath The path to the file.
 * @returns The file contents as a string.
 */
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Writes the modified content back to the file.
 *
 * @param filePath The path to the file.
 * @param content The modified content to write.
 */
export function writeFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Retrieves the properties of the `GenericKind` class, excluding dynamic properties like `[key: string]: any`.
 *
 * @returns An array of property names that belong to `GenericKind`.
 */
export function getGenericKindProperties(): string[] {
  const properties = Object.getOwnPropertyNames(new GenericKind());
  return properties.filter(prop => prop !== "[key: string]");
}

/**
 * Collects interface names from TypeScript file lines.
 *
 * @param lines The lines of the file content.
 * @returns A set of found interface names.
 */
export function collectInterfaceNames(lines: string[]): Set<string> {
  const interfacePattern = /export interface (\w+)/;
  const foundInterfaces = new Set<string>();

  for (const line of lines) {
    const match = line.match(interfacePattern);
    if (match) foundInterfaces.add(match[1]);
  }

  return foundInterfaces;
}

/**
 * Identifies whether a line declares a class that extends `GenericKind`.
 *
 * @param line The current line of code.
 * @returns True if the line defines a class that extends `GenericKind`, false otherwise.
 */
function isClassExtendingGenericKind(line: string): boolean {
  return line.includes("class") && line.includes("extends GenericKind");
}

/**
 * Adjusts the brace balance to determine if the parser is within a class definition.
 *
 * @param line The current line of code.
 * @param braceBalance The current balance of curly braces.
 * @returns The updated brace balance.
 */
function updateBraceBalance(line: string, braceBalance: number): number {
  return braceBalance + (line.includes("{") ? 1 : 0) - (line.includes("}") ? 1 : 0);
}

/**
 * Modifies property declarations within class definitions:
 * - Adds the `declare` keyword to properties of `GenericKind`.
 * - Makes properties optional if their type matches an interface name.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns The modified line.
 */
function processPropertyDeclarations(
  line: string,
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): string {
  line = addDeclareToGenericKindProperties(line, genericKindProperties);
  line = makePropertiesOptional(line, foundInterfaces);
  return line;
}

/**
 * Adds the `declare` keyword to `GenericKind` properties.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @returns The modified line with the `declare` keyword, if applicable.
 */
function addDeclareToGenericKindProperties(line: string, genericKindProperties: string[]): string {
  for (const property of genericKindProperties) {
    const propertyPattern = new RegExp(`\\b${property}\\b\\s*\\?\\s*:|\\b${property}\\b\\s*:`);
    if (propertyPattern.test(line)) {
      return line.replace(property, `declare ${property}`);
    }
  }
  return line;
}

/**
 * Makes a property optional if its type matches one of the found interfaces and it is not already optional.
 *
 * @param line The current line of code.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns The modified line with the optional `?` symbol.
 */
function makePropertiesOptional(line: string, foundInterfaces: Set<string>): string {
  const propertyTypePattern = /:\s*(\w+)\s*;/;
  const match = line.match(propertyTypePattern);

  if (match) {
    const propertyType = match[1];
    if (foundInterfaces.has(propertyType) && !line.includes("?")) {
      return line.replace(":", "?:");
    }
  }
  return line;
}

/**
 * Adds an ESLint disable comment for `[key: string]: any` if it's not part of `GenericKind`.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @returns The modified line with the ESLint disable comment.
 */
function processEslintDisable(line: string, genericKindProperties: string[]): string {
  if (line.includes("[key: string]: any") && !genericKindProperties.includes("[key: string]")) {
    return `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${line}`;
  }
  return line;
}

/**
 * Wraps the generated TypeScript file with fluent client elements (`GenericKind` and `RegisterKind`).
 *
 * @param lines The generated TypeScript lines.
 * @param name The name of the schema.
 * @param crd The CustomResourceDefinition object.
 * @param version The version of the CRD.
 * @param npmPackage The NPM package name for the fluent client.
 * @returns The processed TypeScript lines.
 */
function wrapWithFluentClient(
  lines: string[],
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  npmPackage: string = "kubernetes-fluent-client",
): string[] {
  const autoGenNotice = `// This file is auto-generated by ${npmPackage}, do not edit manually`;
  const imports = `import { GenericKind, RegisterKind } from "${npmPackage}";`;

  const classIndex = lines.findIndex(line => line.includes(`export interface ${name} {`));
  if (classIndex !== -1) {
    lines[classIndex] = `export class ${name} extends GenericKind {`;
  }

  lines.unshift(autoGenNotice, imports);
  lines.push(
    `RegisterKind(${name}, {`,
    `  group: "${crd.spec.group}",`,
    `  version: "${version}",`,
    `  kind: "${name}",`,
    `  plural: "${crd.spec.names.plural}",`,
    `});`,
  );

  return lines;
}

/**
 * Normalizes indentation for TypeScript lines to a consistent format.
 *
 * @param lines The generated TypeScript lines.
 * @returns The lines with normalized indentation.
 */
function normalizeIndentation(lines: string[]): string[] {
  return lines.map(line => line.replace(/^ {4}/, "  "));
}

/**
 * Normalizes the indentation of a single line to use two spaces instead of four.
 *
 * @param line The line of code to normalize.
 * @returns The line with normalized indentation.
 */
function normalizeLineIndentation(line: string): string {
  return line.replace(/^ {4}/, "  ");
}

/**
 * Normalizes spacing between property names and types in TypeScript lines.
 *
 * @param lines The generated TypeScript lines.
 * @returns The lines with normalized property spacing.
 */
export function normalizePropertySpacing(lines: string[]): string[] {
  return lines.map(line => line.replace(/\?\s*:\s*/, "?: "));
}

/**
 * Removes lines containing `[property: string]: any;` from TypeScript files.
 *
 * @param lines The generated TypeScript lines.
 * @param opts The options for processing.
 * @returns The lines with `[property: string]: any;` removed.
 */
export function removePropertyStringAny(lines: string[], opts: GenerateOptions): string[] {
  if (opts.language === "ts" || opts.language === "typescript") {
    return lines.filter(line => !line.includes("[property: string]: any;"));
  }
  return lines;
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
export function processFile(
  content: string,
  name: string,
  crd: CustomResourceDefinition,
  version: string,
  opts: GenerateOptions,
): string {
  let lines = content.split("\n");
  const genericKindProperties = getGenericKindProperties();
  const foundInterfaces = collectInterfaceNames(lines);

  // Track whether we are inside a class definition
  let insideClass = false;
  let braceBalance = 0;

  // If the language is TypeScript and post-processing is enabled, wrap with the fluent client.
  if (opts.language === "ts" && !opts.plain) {
    lines = wrapWithFluentClient(lines, name, crd, version, opts.npmPackage);
  }

  // Iterate over the lines and apply processing logic
  const modifiedLines = lines.map(line => {
    // Detect if we are entering a class that extends GenericKind
    if (isClassExtendingGenericKind(line)) {
      insideClass = true;
      braceBalance = 0; // We opened a class, so increase brace balance
    }

    // While inside the class, modify the lines
    if (insideClass) {
      // Adjust the brace balance based on opening and closing braces
      braceBalance = updateBraceBalance(line, braceBalance);

      // Apply property declaration changes only inside the class
      line = processPropertyDeclarations(line, genericKindProperties, foundInterfaces);

      // Remove extra whitespace from the line
      line = normalizeLineIndentation(line);

      // Add ESLint disable comment for [key: string]: any if needed
      line = processEslintDisable(line, genericKindProperties);

      // If we have reached the closing brace of the class, exit class context
      if (braceBalance === 0) {
        insideClass = false;
      }

      return line;
    }

    // Return the line unmodified if not inside a class
    return line;
  });

  // Normalize indentation and spacing after processing the lines
  let normalizedLines = normalizeIndentation(modifiedLines);
  normalizedLines = normalizePropertySpacing(normalizedLines);

  // Call the new function to remove `[property: string]: any;` for TypeScript files
  normalizedLines = removePropertyStringAny(normalizedLines, opts);

  return normalizedLines.join("\n");
}

/**
 * Performs post-processing on generated TypeScript files.
 *
 * @param allResults The array of CRD results.
 * @param opts The options for post-processing.
 */
export async function postProcessing(
  allResults: {
    name: string;
    crd: CustomResourceDefinition;
    version: string;
  }[],
  opts: GenerateOptions,
) {
  if (opts.directory) {
    const files = fs.readdirSync(opts.directory);
    opts.logFn("\n🔧 Post-processing started...");

    // Create a map that links each file to its corresponding result
    const fileResultMap: Record<
      string,
      { name: string; crd: CustomResourceDefinition; version: string }
    > = {};

    for (const { name, crd, version } of allResults) {
      const expectedFileName = `${name.toLowerCase()}-${version.toLowerCase()}.ts`;
      fileResultMap[expectedFileName] = { name, crd, version };
    }

    // Loop through each file only once
    for (const file of files) {
      const filePath = path.join(opts.directory, file);
      opts.logFn(`Post-processing file: ${filePath}`);

      const fileResult = fileResultMap[file]; // Find the corresponding result for the file

      if (fileResult) {
        const { name, crd, version } = fileResult;
        const fileContent = readFile(filePath);
        const modifiedContent = processFile(fileContent, name, crd, version, opts);
        writeFile(filePath, modifiedContent);
      } else {
        opts.logFn(`No matching CRD result found for file: ${filePath}`);
      }
    }

    opts.logFn("🔧 Post-processing completed.\n");
  }
}

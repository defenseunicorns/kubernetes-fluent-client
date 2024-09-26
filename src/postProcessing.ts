// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "./generate";
import { GenericKind } from "./types";

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
 * Retrieves the properties of the GenericKind class, excluding the dynamic `[key: string]: any` property.
 *
 * @returns An array of property names that belong to GenericKind, excluding `[key: string]: any`.
 */
export function getGenericKindProperties(): string[] {
  // Retrieve the properties of GenericKind using Object.getOwnPropertyNames
  const properties = Object.getOwnPropertyNames(new GenericKind());

  // Filter out the dynamic `[key: string]: any` property
  return properties.filter(prop => prop !== "[key: string]");
}

/**
 * Collect interface names from the file content.
 *
 * @param lines The lines of the file content.
 * @returns A set of interface names found in the file.
 */
export function collectInterfaceNames(lines: string[]): Set<string> {
  const interfacePattern = /export interface (\w+)/;
  const foundInterfaces: Set<string> = new Set();

  lines.forEach(line => {
    const match = line.match(interfacePattern);
    if (match) {
      foundInterfaces.add(match[1]); // Add interface name to the set
    }
  });

  return foundInterfaces;
}

/**
 * Processes the content of a file by modifying class properties that extend GenericKind:
 * - Adds the `declare` keyword to properties from GenericKind.
 * - Makes certain properties optional based on found interfaces.
 * - Adds ESLint disable comments where necessary.
 *
 * @param content - The content of the file to process.
 * @returns - The processed file content.
 */
export function processFile(content: string): string {
  const lines = content.split("\n");
  const modifiedLines: string[] = [];
  const genericKindProperties = getGenericKindProperties();
  const foundInterfaces = collectInterfaceNames(lines);

  let insideClass = false;
  let braceBalance = 0;

  for (let line of lines) {
    // Find start of class definition
    if (isClassExtendingGenericKind(line)) {
      insideClass = true;
      braceBalance = 1;
      modifiedLines.push(line);
      continue; // Skip processing the class definition line
    }

    if (insideClass) {
      // Use brace balance to determine if we are still inside the class definition
      braceBalance = updateBraceBalance(line, braceBalance);
      if (braceBalance === 0) {
        insideClass = false;
      }

      line = processPropertyDeclarations(line, genericKindProperties, foundInterfaces);
      line = processEslintDisable(line, genericKindProperties);

      modifiedLines.push(line);
      continue;
    }

    modifiedLines.push(line); // Not inside class, so add line as is
  }

  return modifiedLines.join("\n");
}

/**
 * Checks whether the line contains a class that extends GenericKind.
 *
 * @param line - The line of code to check.
 * @returns - True if the line defines a class that extends GenericKind, false otherwise.
 */
function isClassExtendingGenericKind(line: string): boolean {
  return line.includes("class") && line.includes("extends GenericKind");
}

/**
 * Updates the balance of curly braces to track whether we are inside a class definition.
 *
 * @param line - The current line of code.
 * @param braceBalance - The current brace balance (number of unclosed opening braces).
 * @returns - The updated brace balance.
 */
function updateBraceBalance(line: string, braceBalance: number): number {
  if (line.includes("{")) braceBalance++;
  if (line.includes("}")) braceBalance--;
  return braceBalance;
}

/**
 * Processes the property declarations in the class:
 * - Adds the `declare` modifier to properties from GenericKind.
 * - Makes properties optional if their type matches any of the found interfaces.
 *
 * @param line - The current line of code.
 * @param genericKindProperties - The list of properties from GenericKind.
 * @param foundInterfaces - The set of found interfaces in the file.
 * @returns - The modified line, if applicable.
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
 * Adds the `declare` keyword to properties that belong to GenericKind.
 *
 * @param line - The current line of code.
 * @param genericKindProperties - The list of properties from GenericKind.
 * @returns - The modified line with the `declare` keyword, if applicable.
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
 * Makes a property optional if its type matches one of the found interfaces and it isn't already optional.
 *
 * @param line - The current line of code.
 * @param foundInterfaces - The set of found interfaces in the file.
 * @returns - The modified line with the optional `?`, if applicable.
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
 * Adds an ESLint disable comment for the `[key: string]: any` property if it's not in GenericKind.
 *
 * @param line - The current line of code.
 * @param genericKindProperties - The list of properties from GenericKind.
 * @returns - The modified line with the ESLint disable comment, if applicable.
 */
function processEslintDisable(line: string, genericKindProperties: string[]): string {
  if (
    line.includes("[key: string]: any") &&
    !genericKindProperties.includes("[key: string]: any")
  ) {
    return `    // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${line}`;
  }
  return line;
}

/**
 * Perform post-processing on the generated files.
 *
 * @param opts The options to use for post-processing
 */
export async function postProcessing(opts: GenerateOptions) {
  if (opts.directory) {
    const files = fs.readdirSync(opts.directory);

    // Indicate that post-processing has started
    opts.logFn("\n🔧 Post-processing started...");

    for (const file of files) {
      const filePath = path.join(opts.directory, file);
      // Log file processing before post-processing starts
      opts.logFn(`Post processing file: ${filePath}`);

      // Read the file
      const fileContent = readFile(filePath);

      // Process the file (add define to properties)
      const modifiedContent = processFile(fileContent);

      // Write the modified content back to the file
      writeFile(filePath, modifiedContent);
    }
  }

  // Indicate when post-processing completes
  opts.logFn("🔧 Post-processing completed.\n");
}

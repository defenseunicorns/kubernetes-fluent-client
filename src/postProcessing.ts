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
 * Process the file content to:
 * 1. Add `declare` to properties from `GenericKind`.
 * 2. Add `eslint-disable` comments for `[key: string]: any`.
 * 3. Make properties optional if their type matches one of the interfaces defined below the class.
 *
 * @param content The file content to process.
 * @returns The modified file content.
 */
export function processFile(content: string): string {
  const lines = content.split("\n"); // Split the content into lines
  const modifiedLines = [];
  const genericKindProperties = getGenericKindProperties(); // Get properties of GenericKind
  let insideClass = false;
  let braceBalance = 0; // Track the balance of curly braces
  const foundInterfaces: Set<string> = new Set(); // Set to store interface names

  // Step 1: Collect interface names from the file (lines below the class)
  const interfacePattern = /export interface (\w+)/;

  lines.forEach(line => {
    const match = line.match(interfacePattern);
    if (match) {
      foundInterfaces.add(match[1]); // Add interface name to the set
    }
  });

  // Step 2: Process the class and its properties
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Check for the start of the class that extends GenericKind
    if (line.includes("class") && line.includes("extends GenericKind")) {
      console.log(`Found class that extends GenericKind: ${line}`);
      insideClass = true;

      // Reset brace balance (expecting an opening brace soon)
      braceBalance = 0;

      // Add the class declaration line to the result without modification
      modifiedLines.push(line);
      continue;
    }

    // If we are inside the class, check for opening and closing braces
    if (insideClass) {
      // Count the opening braces
      if (line.includes("{")) {
        braceBalance++;
      }

      // Count the closing braces
      if (line.includes("}")) {
        braceBalance--;

        // If brace balance reaches 0, the class has ended
        if (braceBalance === 0) {
          insideClass = false; // We're no longer inside the class
        }
      }

      // Check if the line defines a property from GenericKind
      for (const property of genericKindProperties) {
        const propertyPattern = new RegExp(`\\b${property}\\b\\s*\\?\\s*:|\\b${property}\\b\\s*:`); // Regex to find the property definition

        if (propertyPattern.test(line)) {
          // Add `declare` before the property name
          line = line.replace(property, `declare ${property}`);
          console.log(`Adding declare modifier to property: ${property}`);
        }
      }

      // Step 3: Check if the property type matches one of the collected interface names
      const propertyTypePattern = /:\s*(\w+)\s*;/; // Match the property type
      const match = line.match(propertyTypePattern);
      if (match) {
        const propertyType = match[1];
        if (foundInterfaces.has(propertyType) && !line.includes("?")) {
          // If the property type matches an interface and is not optional, make it optional
          line = line.replace(":", "?:");
          console.log(`Making property of type ${propertyType} optional`);
        }
      }

      // Check if the line contains `[key: string]: any` and is not in GenericKind properties
      if (
        line.includes("[key: string]: any") &&
        !genericKindProperties.includes("[key: string]: any")
      ) {
        // Add the eslint-disable comment on the line before
        modifiedLines.push("    // eslint-disable-next-line @typescript-eslint/no-explicit-any");
      }

      // Add the modified line to the output
      modifiedLines.push(line);
      continue;
    }

    // If not inside a class, just add the line as it is
    modifiedLines.push(line);
  }

  return modifiedLines.join("\n"); // Join the modified lines back into a string
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

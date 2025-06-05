import { GenerateOptions } from "./generate";

/**
 * Normalizes indentation for TypeScript lines to a consistent format.
 *
 * @param lines The generated TypeScript lines.
 * @returns The lines with normalized indentation.
 */
export function normalizeIndentation(lines: string[]): string[] {
  return lines.map(line => line.replace(/^ {4}/, "  "));
}

/**
 * Normalizes the indentation of a single line to use two spaces instead of four.
 *
 * @param line The line of code to normalize.
 * @returns The line with normalized indentation.
 */
export function normalizeLineIndentation(line: string): string {
  return line.replace(/^ {4}/, "  ");
}

/**
 * Normalizes spacing between property names and types in TypeScript lines.
 *
 * @param lines The generated TypeScript lines.
 * @returns The lines with normalized property spacing.
 */
export function normalizePropertySpacing(lines: string[]): string[] {
  // https://regex101.com/r/XEv3pL/1
  return lines.map(line => line.replace(/\s*\?\s*:\s*/, "?: "));
}

/**
 * Processes a single line inside a class extending `GenericKind`.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns The modified line.
 */
export function modifyAndNormalizeClassProperties(
  line: string,
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): string {
  line = modifyPropertiesAndAddEslintDirective(line, genericKindProperties, foundInterfaces);
  line = normalizeLineIndentation(line);
  return line;
}

/**
 * Normalizes lines after processing, including indentation, spacing, and removing unnecessary lines.
 *
 * @param lines The lines of the file content.
 * @param opts The options for processing.
 * @returns The normalized lines.
 */
export function normalizeIndentationAndSpacing(lines: string[], opts: GenerateOptions): string[] {
  let normalizedLines = normalizeIndentation(lines);
  normalizedLines = normalizePropertySpacing(normalizedLines);
  return removePropertyStringAny(normalizedLines, opts);
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
 * Applies ESLint and property modifiers to a line of code.
 *
 * @param line - The current line of code.
 * @param genericKindProperties - The list of properties from `GenericKind`.
 * @param foundInterfaces - The set of found interfaces in the file.
 * @returns The modified line.
 */
export function modifyPropertiesAndAddEslintDirective(
  line: string,
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): string {
  line = addDeclareAndOptionalModifiersToProperties(line, genericKindProperties, foundInterfaces);
  line = processEslintDisable(line, genericKindProperties);
  return line;
}

/**
 * Adds an ESLint disable comment for `[key: string]: any` if it's not part of `GenericKind`.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @returns The modified line with the ESLint disable comment.
 */
export function processEslintDisable(line: string, genericKindProperties: string[]): string {
  if (line.includes("[key: string]: any") && !genericKindProperties.includes("[key: string]")) {
    return `  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n${line}`;
  }
  return line;
}

/**
 * Applies property modifiers to a line of code.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @param foundInterfaces The set of found interfaces in the file.
 * @returns The modified line.
 */
export function addDeclareAndOptionalModifiersToProperties(
  line: string,
  genericKindProperties: string[],
  foundInterfaces: Set<string>,
): string {
  line = addDeclareToGenericKindProperties(line, genericKindProperties);
  line = makePropertiesOptional(line, foundInterfaces);
  line = normalizeLineIndentation(line);
  return line;
}

/**
 * Adds the `declare` keyword to `GenericKind` properties.
 *
 * @param line The current line of code.
 * @param genericKindProperties The list of properties from `GenericKind`.
 * @returns The modified line with the `declare` keyword, if applicable.
 */
export function addDeclareToGenericKindProperties(
  line: string,
  genericKindProperties: string[],
): string {
  for (const prop of genericKindProperties) {
    const propertyPattern = getPropertyPattern(prop);
    if (propertyPattern.test(line)) {
      return line.replace(prop, `declare ${prop}`);
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
export function makePropertiesOptional(line: string, foundInterfaces: Set<string>): string {
  // https://regex101.com/r/kX8TCj/1
  const propertyTypePattern = /:\s*(?<propertyType>\w+)\s*;/;
  const match = line.match(propertyTypePattern);

  if (match?.groups?.propertyType) {
    const { propertyType } = match.groups;
    if (foundInterfaces.has(propertyType) && !line.includes("?")) {
      return line.replace(":", "?:");
    }
  }
  return line;
}

/**
 * Generates a regular expression to match a property pattern in TypeScript.
 *
 * @param prop The property name to match.
 * @returns A regular expression to match the property pattern.
 */
export function getPropertyPattern(prop: string): RegExp {
  // For prop="kind", the pattern will match "kind ? :" or "kind :"
  // https://regex101.com/r/mF8kXn/1
  return new RegExp(`\\b${prop}\\b\\s*\\?\\s*:|\\b${prop}\\b\\s*:`);
}

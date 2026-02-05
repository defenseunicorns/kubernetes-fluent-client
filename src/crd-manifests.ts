// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { dump } from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { spawnSync } from "child_process";

import type { V1CustomResourceDefinition } from "@kubernetes/client-node";
import type { LogFn } from "./types.js";
import { resolveFilePath } from "./generate.js";

/**
 * Options for exporting CRDs from a TS/JS module to YAML manifests.
 */
export interface ExportOptions {
  source: string;
  directory: string;
  logFn: LogFn;
}

/**
 * Validate the apiVersion field of a CRD.
 *
 * @param apiVersion - The apiVersion to validate
 * @throws {Error} if apiVersion is invalid
 */
function validateApiVersion(apiVersion?: string): void {
  if (!apiVersion || apiVersion !== "apiextensions.k8s.io/v1") {
    throw new Error(
      `Invalid CRD: apiVersion must be "apiextensions.k8s.io/v1", got "${apiVersion}"`,
    );
  }
}

/**
 * Validate the kind field of a CRD.
 *
 * @param kind - The kind to validate
 * @throws {Error} if kind is invalid
 */
function validateKind(kind?: string): void {
  if (kind !== "CustomResourceDefinition") {
    throw new Error(`Invalid CRD: kind must be "CustomResourceDefinition", got "${kind}"`);
  }
}

/**
 * Validate the metadata field of a CRD.
 *
 * @param metadata - The metadata to validate
 * @param metadata.name - The metadata name to validate
 * @throws {Error} if metadata is invalid
 */
function validateMetadata(metadata?: { name?: string }): void {
  if (!metadata?.name) {
    throw new Error("Invalid CRD: metadata.name is required");
  }
}

/**
 * Validate the spec field of a CRD.
 *
 * @param spec - The spec to validate
 * @param spec.group - The spec group to validate
 * @param spec.names - The spec names to validate
 * @param spec.names.kind - The spec names kind to validate
 * @param spec.names.plural - The spec names plural to validate
 * @param spec.scope - The spec scope to validate
 * @param spec.versions - The spec versions to validate
 * @throws {Error} if spec is invalid
 */
function validateSpec(spec?: {
  group?: string;
  names?: { kind?: string; plural?: string };
  scope?: string;
  versions?: unknown[];
}): void {
  if (!spec) {
    throw new Error("Invalid CRD: spec is required");
  }

  if (!spec.group) {
    throw new Error("Invalid CRD: spec.group is required");
  }

  if (!spec.names?.kind || !spec.names.plural) {
    throw new Error("Invalid CRD: spec.names.kind and spec.names.plural are required");
  }

  if (!spec.scope || (spec.scope !== "Namespaced" && spec.scope !== "Cluster")) {
    throw new Error(
      `Invalid CRD: spec.scope must be "Namespaced" or "Cluster", got "${spec?.scope ?? "undefined"}"`,
    );
  }

  if (!spec.versions || spec.versions.length === 0) {
    throw new Error("Invalid CRD: spec.versions must contain at least one version");
  }
}

/**
 * Perform basic structural validation of a v1 CustomResourceDefinition.
 *
 * Throws an Error when the object does not look like a valid v1 CRD.
 *
 * @param crd - The CRD object to validate
 * @throws {Error} if the CRD structure is invalid
 */
export function validateCRDStructure(crd: V1CustomResourceDefinition): void {
  validateApiVersion(crd.apiVersion);
  validateKind(crd.kind);
  validateMetadata(crd.metadata);
  validateSpec(crd.spec);
}

/**
 * Load a TypeScript module by spawning a subprocess with the tsx loader.
 *
 * This avoids the CJS/ESM circular dependency that occurs when dynamically
 * registering the tsx loader mid-execution. By using --import tsx, the loader
 * is registered at Node.js bootstrap time before any user code runs.
 *
 * @param filePath - Absolute path to the TypeScript module
 * @returns The module exports as a parsed object
 * @throws {Error} if the subprocess fails or output cannot be parsed
 */
function loadTypeScriptModuleViaSubprocess(filePath: string): unknown {
  // Build an ESM script that imports the module and serializes its exports
  const script = `
    import * as mod from ${JSON.stringify(pathToFileURL(filePath).href)};

    // Custom replacer to handle non-JSON-serializable values
    const replacer = (key, value) => {
      if (typeof value === "bigint") return { __type: "bigint", value: value.toString() };
      if (typeof value === "function") return { __type: "function", name: value.name || "anonymous" };
      if (typeof value === "symbol") return { __type: "symbol", description: value.description };
      return value;
    };

    console.log(JSON.stringify(mod, replacer));
  `;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: path.dirname(filePath),
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB for large CRDs
    },
  );

  if (result.error) {
    throw new Error(`Failed to spawn subprocess: ${result.error.message}`, { cause: result.error });
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "Unknown error";
    throw new Error(`Subprocess failed with exit code ${result.status}: ${stderr}`);
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error("Subprocess produced no output");
  }

  try {
    return JSON.parse(stdout);
  } catch (parseError) {
    throw new Error(
      `Failed to parse subprocess output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      { cause: parseError instanceof Error ? parseError : new Error(String(parseError)) },
    );
  }
}

/**
 * Dynamically import the user-provided CRD module.
 *
 * TypeScript files are loaded via a subprocess with the tsx loader to avoid
 * the CJS/ESM circular dependency that occurs when dynamically registering
 * loaders mid-execution.
 *
 * @param filePath - Path to the CRD module file
 * @param logFn - Function for logging messages
 * @returns The imported module object
 * @throws {Error} if the module cannot be imported
 */
async function loadCRDModule(filePath: string, logFn: LogFn): Promise<unknown> {
  logFn(`Loading CRD definitions from ${filePath}`);

  const isTypeScriptFile = /\.(ts|mts|cts|tsx)$/i.test(filePath);

  try {
    if (isTypeScriptFile) {
      // Use subprocess to avoid CJS/ESM cycle when loading TypeScript
      return loadTypeScriptModuleViaSubprocess(filePath);
    }
    // JavaScript files can be imported directly
    return await import(pathToFileURL(filePath).href);
  } catch (error) {
    const base = `Failed to import CRD module: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(base, { cause: error instanceof Error ? error : new Error(String(error)) });
  }
}

/**
 * Process a single CRD object for validation and collection.
 *
 * @param crd - The CRD object to process
 * @param source - Source description for error reporting
 * @param crds - Array to collect valid CRDs
 * @param logFn - Function for logging messages
 * @returns True if CRD was valid and added, false otherwise
 */
const processCRD = (
  crd: unknown,
  source: string,
  crds: V1CustomResourceDefinition[],
  logFn: LogFn,
): boolean => {
  if (!crd || typeof crd !== "object" || !("apiVersion" in crd) || !("kind" in crd)) {
    return false;
  }

  const maybeCrd = crd as V1CustomResourceDefinition;
  if (maybeCrd.kind !== "CustomResourceDefinition") {
    return false;
  }

  try {
    validateCRDStructure(maybeCrd);
    crds.push(maybeCrd);
    return true;
  } catch (error) {
    logFn(`Skipping ${source}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

/**
 * Process default export from a module.
 *
 * @param defaultExport - The default export to process
 * @param crds - Array to collect valid CRDs
 * @param logFn - Function for logging messages
 */
function processDefaultExport(
  defaultExport: unknown,
  crds: V1CustomResourceDefinition[],
  logFn: LogFn,
): void {
  if (Array.isArray(defaultExport)) {
    logFn("Processing default export as array of CRDs");
    defaultExport.forEach((crd, index) => {
      processCRD(crd, `default[${index}]`, crds, logFn);
    });
  } else if (typeof defaultExport === "object" && defaultExport !== null) {
    // Check if this looks like a single CRD (has apiVersion and kind)
    if ("apiVersion" in defaultExport && "kind" in defaultExport) {
      logFn("Processing default export as single CRD");
      processCRD(defaultExport, "default", crds, logFn);
    } else {
      // Handle object with multiple CRDs
      logFn("Processing default export as object with CRDs");
      for (const [key, value] of Object.entries(defaultExport as Record<string, unknown>)) {
        if (key.startsWith("_")) continue; // Skip private properties
        processCRD(value, `default.${key}`, crds, logFn);
      }
    }
  } else {
    // Handle primitive or other types as single CRD
    logFn("Processing default export as single CRD");
    processCRD(defaultExport, "default", crds, logFn);
  }
}

/**
 * Extract all structurally valid CRDs from the module's exports.
 *
 * @param module - The imported module object
 * @param logFn - Function for logging messages
 * @returns Array of valid CRD objects
 * @throws {Error} if no valid CRD definitions are found
 */
export function extractCRDsFromModule(module: unknown, logFn: LogFn): V1CustomResourceDefinition[] {
  const crds: V1CustomResourceDefinition[] = [];
  const moduleAsRecord = module as Record<string, unknown>;

  // Process default export if present
  if (moduleAsRecord.default) {
    processDefaultExport(moduleAsRecord.default, crds, logFn);
  }

  // Process named exports (excluding default and private exports)
  for (const key in moduleAsRecord) {
    if (Object.prototype.hasOwnProperty.call(moduleAsRecord, key)) {
      if (key === "default" || key.startsWith("_")) continue;

      processCRD(moduleAsRecord[key], key, crds, logFn);
    }
  }

  if (crds.length === 0) {
    throw new Error("No valid CRD definitions found in the module");
  }

  return crds;
}

/**
 * Serialize a CRD object to a YAML file named after metadata.name.
 *
 * @param crd - The CRD object to serialize
 * @param outputDir - Directory path where the YAML file will be created
 * @returns Promise resolving to the output file path
 */
export async function writeCRDToFile(
  crd: V1CustomResourceDefinition,
  outputDir: string,
): Promise<string> {
  const yaml = dump(crd as unknown as object, { noRefs: true });
  const fileName = `${crd.metadata!.name}.yaml`;
  const outputPath = path.join(outputDir, fileName);

  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.writeFile(outputPath, yaml);
  return outputPath;
}

/**
 * Export one or more CRDs from a TS/JS module to YAML manifests.
 *
 * The module is scanned for exported v1 CustomResourceDefinition objects.
 *
 * @param opts - Export options including source file and output directory
 * @returns Promise resolving to exported files and CRD objects
 */
export async function exportCRDFromModule(opts: ExportOptions): Promise<{
  files: string[];
  crds: V1CustomResourceDefinition[];
}> {
  const filePath = resolveFilePath(opts.source);

  if (!fs.existsSync(filePath)) {
    throw new Error(`CRD module not found: ${opts.source}`);
  }

  const module = await loadCRDModule(filePath, opts.logFn);
  const crds = extractCRDsFromModule(module, opts.logFn);

  const exportedFiles: string[] = [];
  for (const crd of crds) {
    const outputPath = await writeCRDToFile(crd, opts.directory);
    exportedFiles.push(outputPath);
    opts.logFn(`Exported ${crd.metadata!.name} to ${outputPath}`);
  }

  return { files: exportedFiles, crds };
}

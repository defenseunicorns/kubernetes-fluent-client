// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { dump } from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";
import * as os from "os";

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
 * Shared subprocess environment manager to avoid recreating temp dirs
 * and reinstalling dependencies for each CRD file.
 */
class SubprocessEnvironmentManager {
  private static instance: SubprocessEnvironmentManager | null = null;
  private tempDir: string | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): SubprocessEnvironmentManager {
    if (!SubprocessEnvironmentManager.instance) {
      SubprocessEnvironmentManager.instance = new SubprocessEnvironmentManager();
    }
    return SubprocessEnvironmentManager.instance;
  }

  /**
   * Initialize the shared temp environment once
   *
   * @param logFn
   */
  async initialize(logFn: LogFn): Promise<string> {
    // If already initialized, return the existing temp dir
    if (this.initialized && this.tempDir) {
      return this.tempDir;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      await this.initPromise;
      return this.tempDir!;
    }

    // Start initialization
    this.initPromise = this._doInitialize(logFn);
    await this.initPromise;
    this.initPromise = null;

    return this.tempDir!;
  }

  private async _doInitialize(logFn: LogFn): Promise<void> {
    logFn(`   📦 Creating shared isolated environment...`);

    // Create temp dir in OS temp directory (faster than project directory)
    this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kfc-crd-"));

    // Create package.json
    const tempPackageJson = {
      name: "kfc-crd-extractor",
      type: "module",
      dependencies: {
        "@kubernetes/client-node": "*",
        tsx: "latest",
      },
    };

    await fs.promises.writeFile(
      path.join(this.tempDir, "package.json"),
      JSON.stringify(tempPackageJson, null, 2),
    );

    // Install dependencies once
    logFn(`   📥 Installing dependencies (one-time setup)...`);
    execSync("npm install --silent --prefer-offline", {
      cwd: this.tempDir,
      stdio: "ignore",
      timeout: 60000,
    });

    this.initialized = true;
    logFn(`   ✅ Shared environment ready`);
  }

  getTempDir(): string {
    if (!this.tempDir) {
      throw new Error("SubprocessEnvironmentManager not initialized");
    }
    return this.tempDir;
  }

  /**
   * Cleanup the shared temp environment
   */
  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await fs.promises.rm(this.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      this.tempDir = null;
      this.initialized = false;
    }
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static reset(): void {
    if (SubprocessEnvironmentManager.instance) {
      SubprocessEnvironmentManager.instance.cleanup();
      SubprocessEnvironmentManager.instance = null;
    }
  }
}

/**
 * Register cleanup handler to remove temp directory on process exit
 */
let cleanupRegistered = false;
/**
 *
 */
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    SubprocessEnvironmentManager.getInstance().cleanup();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

/**
 * Dynamically import the user-provided CRD module with optimizations.
 *
 * @param filePath
 * @param logFn
 */
async function loadCRDModule(filePath: string, logFn: LogFn): Promise<unknown> {
  logFn(`Loading CRD definitions from ${filePath}`);

  const isTypeScriptFile = /\.(ts|mts|cts|tsx)$/i.test(filePath);

  try {
    // Try dynamic import first - this is fast and works most of the time
    const importPromise = import(pathToFileURL(filePath).href);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Module import timeout")), 2000);
    });

    return await Promise.race([importPromise, timeoutPromise]);
  } catch (error) {
    logFn(``);
    logFn(`⚠️  Dynamic import failed, using subprocess isolation...`);

    // Only use subprocess for TypeScript files
    if (isTypeScriptFile) {
      return await loadModuleViaSubprocess(filePath, logFn);
    }

    // For JS files, try require as fallback
    try {
      const require = createRequire(import.meta.url);
      const resolvedPath = path.resolve(filePath);
      delete require.cache[require.resolve(resolvedPath)];
      return require(resolvedPath);
    } catch {
      const base = `Failed to import CRD module: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(base, { cause: error instanceof Error ? error : new Error(String(error)) });
    }
  }
}

/**
 * Load TypeScript module via subprocess using shared environment
 *
 * @param filePath
 * @param logFn
 */
async function loadModuleViaSubprocess(filePath: string, logFn: LogFn): Promise<unknown> {
  registerCleanup();

  // Use shared environment (initialized once, reused for all CRDs)
  const envManager = SubprocessEnvironmentManager.getInstance();
  const tempDir = await envManager.initialize(logFn);

  // Create a unique subdirectory for this specific CRD to avoid conflicts
  const crdHash = Buffer.from(filePath).toString("base64").replace(/[/+=]/g, "");
  const crdWorkDir = path.join(tempDir, "crds", crdHash);
  await fs.promises.mkdir(crdWorkDir, { recursive: true });

  try {
    logFn(`   🔧 Setting up module extraction...`);

    // create a symlink
    const crdDir = path.dirname(path.dirname(filePath));
    const tempCrdDir = path.join(crdWorkDir, "crd");

    try {
      // Try symlink first (instant vs copying)
      await fs.promises.symlink(crdDir, tempCrdDir, "dir");
    } catch {
      // Fallback to copy if symlink fails (Windows or permission issues)
      await fs.promises.cp(crdDir, tempCrdDir, { recursive: true });
    }

    const relativeFilePath = path.relative(crdDir, filePath);
    const tempFilePath = path.join(tempCrdDir, relativeFilePath);

    // Use dynamic import which tsx can handle properly
    const extractScript = `
import { pathToFileURL } from 'url';

async function extract() {
  try {
    const fileUrl = pathToFileURL('${tempFilePath.replace(/\\/g, "\\\\")}').href;
    const module = await import(fileUrl);

    const exports = {};

    for (const [key, value] of Object.entries(module)) {
      if (key === 'default') {
        exports.default = value;
      } else if (!key.startsWith('_')) {
        exports[key] = value;
      }
    }

    console.log('EXPORT_START:' + JSON.stringify(exports) + ':EXPORT_END');
  } catch (error) {
    console.error('EXTRACT_ERROR:' + error.message);
    process.exit(1);
  }
}

extract();
`;

    const scriptPath = path.join(crdWorkDir, "extract.mjs");
    await fs.promises.writeFile(scriptPath, extractScript);

    logFn(`   ⚡ Running isolated extraction...`);

    // Use tsx directly from the shared environment
    const tsxBin = path.join(tempDir, "node_modules", ".bin", "tsx");
    const useTsx = fs.existsSync(tsxBin);

    const command = useTsx ? `${tsxBin} ${scriptPath}` : `npx tsx ${scriptPath}`;

    const result = execSync(command, {
      encoding: "utf8",
      cwd: tempCrdDir,
      timeout: 10000, // Reduced from 30s
      stdio: ["pipe", "pipe", "pipe"],
    });

    const match = result.match(/EXPORT_START:(.+):EXPORT_END/);
    if (!match) {
      throw new Error("Failed to extract module exports");
    }

    logFn(`   ✅ Module extraction successful`);

    return JSON.parse(match[1]);
  } finally {
    // Clean up the CRD-specific work dir, but keep the shared environment
    setImmediate(async () => {
      try {
        await fs.promises.rm(crdWorkDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });
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

/**
 * Export function to manually cleanup shared environment if needed
 */
export async function cleanupSharedEnvironment(): Promise<void> {
  await SubprocessEnvironmentManager.getInstance().cleanup();
}

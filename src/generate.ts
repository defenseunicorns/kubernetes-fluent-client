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

export interface GenerateOptions {
  /** The source URL, yaml file path or K8s CRD name */
  source: string;
  /** The output directory path */
  directory?: string;
  /** Disable kubernetes-fluent-client wrapping */
  plain?: boolean;
  /** The language to generate types in */
  language?: string | TargetLanguage;
}

/**
 * Converts a CustomResourceDefinition to TypeScript types
 *
 * @param crd The CustomResourceDefinition to convert
 * @param opts The options to use when converting
 * @returns A promise that resolves when the CustomResourceDefinition has been converted
 */
async function convertCRDtoTS(crd: CustomResourceDefinition, opts: GenerateOptions) {
  for (const match of crd.spec.versions) {
    // Get the name of the kind
    const name = crd.spec.names.kind;

    // Get the schema from the matched version
    const schema = JSON.stringify(match?.schema?.openAPIV3Schema);

    // Create a new JSONSchemaInput
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore());

    // Add the schema to the input
    await schemaInput.addSource({ name, schema });

    // Create a new InputData object
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    // Generate the types
    const out = await quicktype({
      inputData,
      lang: opts.language || "ts",
      rendererOptions: { "just-types": "true" },
    });

    let processedLines = out.lines;

    // If using typescript, remove the line containing `[property: string]: any;`
    if (opts.language === "ts" || opts.language === "typescript") {
      processedLines = out.lines.filter(line => !line.includes("[property: string]: any;"));
    }

    // If the language is TypeScript and plain is not specified, wire up the fluent client
    if (opts.language === "ts" && !opts.plain) {
      // Add the imports before any other lines
      processedLines.unshift(
        `import { GenericKind, RegisterKind } from "kubernetes-fluent-client";\n`,
      );

      // Replace the interface with a named class that extends GenericKind
      const entryIdx = processedLines.findIndex(line =>
        line.includes(`export interface ${name} {`),
      );

      // Replace the interface with a named class that extends GenericKind
      processedLines[entryIdx] = `export class ${name} extends GenericKind {`;

      // Add the RegisterKind call
      processedLines.push(`RegisterKind(${name}, {`);
      processedLines.push(`  group: "${crd.spec.group}",`);
      processedLines.push(`  version: "${match.name}",`);
      processedLines.push(`  kind: "${name}",`);
      processedLines.push(`});`);
    }

    const finalContents = processedLines.join("\n");

    // If an output file is specified, write the output to the file
    if (opts.directory) {
      // Create the directory if it doesn't exist
      fs.mkdirSync(opts.directory, { recursive: true });

      // Write the file
      const fileName = `${name.toLowerCase()}-${match.name.toLowerCase()}`;
      const filePath = path.join(opts.directory, `${fileName}.${opts.language}`);
      fs.writeFileSync(filePath, finalContents);
    }

    return processedLines;
  }

  return [];
}

/**
 * Reads a CustomResourceDefinition from a file, the cluster or the internet
 *
 * @param source The source to read from (file path, cluster or URL)
 * @returns A promise that resolves when the CustomResourceDefinition has been read
 */
async function readOrFetchCrd(source: string): Promise<CustomResourceDefinition[]> {
  const filePath = path.join(process.cwd(), source);

  // First try to read the source as a file
  try {
    if (fs.existsSync(filePath)) {
      const payload = fs.readFileSync(filePath, "utf8");
      return loadAllYaml(payload) as CustomResourceDefinition[];
    }
  } catch (e) {
    // Ignore errors
  }

  // Next try to parse the source as a URL
  try {
    const url = new URL(source);

    // If the source is a URL, fetch it
    if (url.protocol === "http:" || url.protocol === "https:") {
      const { ok, data } = await fetch<string>(source);

      // If the request failed, throw an error
      if (!ok) {
        throw new Error(`Failed to fetch ${source}: ${data}`);
      }

      return loadAllYaml(data) as CustomResourceDefinition[];
    }
  } catch (e) {
    // Ignore errors
  }

  // Finally, if the source is not a file or URL, try to read it as a CustomResourceDefinition from the cluster
  try {
    return [await K8s(CustomResourceDefinition).Get(source)];
  } catch (e) {
    throw new Error(`Failed to read ${source} as a file, url or K8s CRD: ${e}`);
  }
}

/**
 * Generate TypeScript types from a K8s CRD
 *
 * @param opts The options to use when generating
 */
export async function generate(opts: GenerateOptions) {
  const crds = await readOrFetchCrd(opts.source);
  const results: string[][] = [];

  for (const crd of crds) {
    if (!crd || !crd.spec?.versions?.length) {
      continue;
    }
    results.push(await convertCRDtoTS(crd, opts));
  }
}

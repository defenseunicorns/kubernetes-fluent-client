// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { loadYaml } from "@kubernetes/client-node";
import * as fs from "fs";
import * as path from "path";
import { FetchingJSONSchemaStore, InputData, JSONSchemaInput, quicktype } from "quicktype-core";

import { fetch } from "./fetch";
import { K8s } from "./fluent";
import { CustomResourceDefinition } from "./upstream";

/**
 * Converts a CustomResourceDefinition to TypeScript types
 *
 * @param crd The CustomResourceDefinition to convert
 * @param output The output file to write to
 * @param version The version of the CustomResourceDefinition to convert
 */
async function convertCRDtoTS(crd: CustomResourceDefinition, output?: string, version?: string) {
  // If no version is specified, use the first version
  if (!version) {
    version = crd.spec.versions[0].name;
  }

  // Find the version that matches the specified version
  const match = crd.spec.versions.find(v => v.name === version);

  // If no match is found, throw an error
  if (!match) {
    throw new Error("No match found");
  }

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
    lang: "ts",
    rendererOptions: { "just-types": "true" },
  });

  // Add the imports before any other lines
  out.lines.unshift(`import { GenericKind, RegisterKind } from "kubernetes-fluent-client";\n`);

  // Remove the line containing `[property: string]: any;`
  const filteredLines = out.lines.filter(line => !line.includes("[property: string]: any;"));

  // Replace the interface with a named class that extends GenericKind
  const entryIdx = filteredLines.findIndex(line => line.includes(`export interface ${name} {`));

  // Replace the interface with a named class that extends GenericKind
  filteredLines[entryIdx] = `export class ${name} extends GenericKind {`;

  // Add the RegisterKind call
  filteredLines.push(`RegisterKind(${name}, {`);
  filteredLines.push(`  group: "${crd.spec.group}",`);
  filteredLines.push(`  version: "${version}",`);
  filteredLines.push(`  kind: "${name}",`);
  filteredLines.push(`});`);

  const finalContents = filteredLines.join("\n");

  // If an output file is specified, write the output to the file
  if (output) {
    fs.writeFileSync(output, finalContents);
  } else {
    // Otherwise, print the output to the console
    console.log(finalContents);
  }
}

/**
 * Reads a CustomResourceDefinition from a file, the cluster or the internet
 *
 * @param source The source to read from (file path, cluster or URL)
 * @returns A promise that resolves when the CustomResourceDefinition has been read
 */
async function readOrFetchCrd(source: string): Promise<CustomResourceDefinition> {
  const filePath = path.join(process.cwd(), source);

  // First try to read the source as a file
  try {
    if (fs.existsSync(filePath)) {
      const payload = fs.readFileSync(filePath, "utf8");
      return loadYaml<CustomResourceDefinition>(payload);
    }
  } catch (e) {
    // Ignore errors
  }

  // Next try to parse the source as a URL
  try {
    const url = new URL(source);

    // If the source is a URL, fetch it
    if (url.protocol === "http:" || url.protocol === "https:") {
      const { ok, data } = await fetch<CustomResourceDefinition>(source);

      // If the request failed, throw an error
      if (!ok) {
        throw new Error(`Failed to fetch ${source}: ${data}`);
      }

      // If the payload is not a CustomResourceDefinition, throw an error
      if (data.kind !== "CustomResourceDefinition") {
        throw new Error("Not a CustomResourceDefinition");
      }

      return data;
    }
  } catch (e) {
    // Ignore errors
  }

  // Finally, if the source is not a file or URL, try to read it as a CustomResourceDefinition from the cluster
  try {
    return await K8s(CustomResourceDefinition).Get(source);
  } catch (e) {
    throw new Error(`Failed to read ${source} as a file, url or K8s CRD: ${e}`);
  }
}

/**
 * Generate TypeScript types from a K8s CRD
 *
 * @param source The source to read from (file path, cluster or URL)
 * @param output The output file to write to
 * @param version The version of the CustomResourceDefinition to convert
 */
export async function generate(source: string, output?: string, version?: string) {
  const crd = await readOrFetchCrd(source);
  await convertCRDtoTS(crd, output, version);
}

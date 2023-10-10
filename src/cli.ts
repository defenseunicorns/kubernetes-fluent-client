#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { GenerateOptions, generate } from "./generate";

void yargs(hideBin(process.argv))
  .version(false)
  .command(
    "crd [source] [output]",
    "generate usable types from a K8s CRD",
    yargs => {
      return yargs
        .positional("source", {
          describe: "the yaml file path, remote url, or K8s CRD name",
          type: "string",
        })
        .positional("output", {
          describe: "the output file path",
          type: "string",
        })
        .option("version", {
          alias: "v",
          type: "string",
          description: "the version of the CRD to use",
        })
        .option("plain", {
          alias: "p",
          type: "boolean",
          description:
            "generate plain types without binding to the fluent client, automatically enabled when an alternate language is specified",
        })
        .option("language", {
          alias: "l",
          type: "string",
          default: "ts",
          description:
            "the language to generate types in, see https://github.com/glideapps/quicktype#target-languages for a list of supported languages",
        });
    },
    argv => {
      void generate(argv as GenerateOptions);
    },
  )
  .parse();

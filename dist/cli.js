#!/usr/bin/env node
"use strict";
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("yargs/helpers");
const yargs_1 = __importDefault(require("yargs/yargs"));
const generate_1 = require("./generate");
const package_json_1 = require("../package.json");
void (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
    .version("version", "Display version number", `kubernetes-fluent-client v${package_json_1.version}`)
    .alias("version", "V")
    .command("crd [source] [directory]", "generate usable types from a K8s CRD", yargs => {
    return yargs
        .positional("source", {
        describe: "the yaml file path, remote url, or K8s CRD name",
        type: "string",
    })
        .positional("directory", {
        describe: "the directory to output the generated types to",
        type: "string",
    })
        .option("plain", {
        alias: "p",
        type: "boolean",
        description: "generate plain types without binding to the fluent client, automatically enabled when an alternate language is specified",
    })
        .option("language", {
        alias: "l",
        type: "string",
        default: "ts",
        description: "the language to generate types in, see https://github.com/glideapps/quicktype#target-languages for a list of supported languages",
    })
        .demandOption(["source", "directory"]);
}, async (argv) => {
    const opts = argv;
    opts.logFn = console.log;
    try {
        await (0, generate_1.generate)(opts);
    }
    catch (e) {
        console.log(`\n❌ ${e.message}`);
    }
})
    .parse();

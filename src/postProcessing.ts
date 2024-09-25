// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import * as fs from "fs";
import * as path from "path";
import { GenerateOptions } from "./generate";

/**
 * Perform post-processing on the generated files.
 *
 * @param opts The options to use for post-processing
 */
export async function PostProcessing(opts: GenerateOptions) {
  if (opts.directory) {
    const files = fs.readdirSync(opts.directory);

    // Indicate that post-processing has started
    opts.logFn("\n🔧 Post-processing started...");

    for (const file of files) {
      const filePath = path.join(opts.directory, file);
      // Log file processing before post-processing starts
      opts.logFn(`Post processing file: ${filePath}`);
      // Perform transformations
    }
  }

  // Indicate when post-processing completes
  opts.logFn("🔧 Post-processing completed.\n");
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

/**
 * Get an environment variable (Node, Deno or Bun), or throw an error if it's not set.
 *
 * @example
 * const value = fromEnv("MY_ENV_VAR");
 * console.log(value);
 * // => "my-value"
 *
 * @example
 * const value = fromEnv("MY_MISSING_ENV_VAR");
 * // => Error: Environment variable MY_MISSING_ENV_VAR is not set
 *
 * @param name The name of the environment variable to get.
 * @returns The value of the environment variable.
 * @throws An error if the environment variable is not set.
 */
export function fromEnv(name: string): string {
  let envValue: string | undefined;

  // Check for Node.js or Bun
  if (typeof process !== "undefined" && typeof process.env !== "undefined") {
    envValue = process.env[name];
  }
  // Check for Deno
  else if (typeof Deno !== "undefined") {
    envValue = Deno.env.get(name);
  }
  // Otherwise, throw an error
  else {
    throw new Error("Unknown runtime environment");
  }

  if (typeof envValue === "undefined") {
    throw new Error(`Environment variable ${name} is not set`);
  }

  return envValue;
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2023-Present The Kubernetes Fluent Client Authors

import { describe, expect, test } from "@jest/globals";

import { fromEnv } from "./helpers";

describe("helpers", () => {
  test("fromEnv for NodeJS", () => {
    expect(() => {
      fromEnv("MY_MISSING_ENV_VAR");
    }).toThrowError("Environment variable MY_MISSING_ENV_VAR is not set");

    process.env.MY_ENV_VAR = "my-value";
    expect(fromEnv("MY_ENV_VAR")).toEqual("my-value");
    delete process.env.MY_ENV_VAR;
  });
});

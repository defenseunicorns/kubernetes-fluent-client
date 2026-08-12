// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { ESLint } from "eslint";

const eslint = new ESLint();

const cases = [
  {
    name: "runtime imports test helpers",
    code: 'import "../test/index.js";',
    filePath: "src/fluent/index.ts",
    allowed: false,
  },
  {
    name: "core test helpers import Vitest",
    code: 'import "vitest";',
    filePath: "src/test/index.ts",
    allowed: false,
  },
  {
    name: "Vitest adapter imports Vitest",
    code: 'import "vitest";',
    filePath: "src/test/vitest/index.ts",
    allowed: true,
  },
  {
    name: "core test helpers import runtime code",
    code: 'import "../index.js";',
    filePath: "src/test/index.ts",
    allowed: true,
  },
];

for (const testCase of cases) {
  const [result] = await eslint.lintText(testCase.code, { filePath: testCase.filePath });
  const hasRestrictedImport = result.messages.some(
    message => message.ruleId === "no-restricted-imports" && message.severity === 2,
  );

  if (hasRestrictedImport === testCase.allowed) {
    const expectation = testCase.allowed ? "be allowed" : "be rejected";
    throw new Error(`Expected ${testCase.name} to ${expectation}`);
  }
}

console.log("Architecture boundary checks passed.");

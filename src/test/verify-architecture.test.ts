// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();

const cases = [
  {
    name: "runtime imports test helpers",
    code: 'import "../test/index.js";',
    filePath: "src/fluent/index.ts",
    restricted: true,
  },
  {
    name: "core test helpers import Vitest",
    code: 'import "vitest";',
    filePath: "src/test/index.ts",
    restricted: true,
  },
  {
    name: "Vitest adapter imports Vitest",
    code: 'import "vitest";',
    filePath: "src/test/vitest/index.ts",
    restricted: false,
  },
  {
    name: "core test helpers import runtime code",
    code: 'import "../index.js";',
    filePath: "src/test/index.ts",
    restricted: false,
  },
];

describe("test-helper architecture boundaries", () => {
  it.each(cases)(
    "$name",
    async ({ code, filePath, restricted }) => {
      const [result] = await eslint.lintText(code, { filePath });
      const hasRestrictedImport = result.messages.some(
        message => message.ruleId === "no-restricted-imports" && message.severity === 2,
      );

      expect(hasRestrictedImport).toBe(restricted);
    },
    15_000,
  );
});

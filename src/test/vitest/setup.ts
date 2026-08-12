// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

import { beforeAll } from "vitest";

import { preflight, type PreflightOptions } from "../preflight.js";

/**
 * Register a Vitest hook that verifies Kubernetes connectivity before tests.
 *
 * The returned preflight promise is deliberately not caught so configuration,
 * authentication, and connectivity failures stop the suite with their cause.
 *
 * @param options - Runner-neutral Kubernetes preflight options.
 */
export function setupKubernetesPreflight(options: PreflightOptions = {}): void {
  beforeAll(() => preflight(options));
}

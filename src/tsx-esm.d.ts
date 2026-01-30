// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

// Ambient declaration for the tsx ESM loader used at runtime when importing
// TypeScript CRD modules from the built CLI.
declare module "tsx/esm" {
  const register: unknown;
  export default register;
}

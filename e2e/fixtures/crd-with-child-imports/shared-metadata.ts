// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

/**
 * Fixture: Shared metadata (grandchild module).
 *
 * A second level of `.ts` child imports, exercising that tsx's scoped
 * loader resolves the full transitive import chain.
 */

export const sharedDescription = "Widget specification for the test CRD";

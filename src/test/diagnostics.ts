// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026-Present The Kubernetes Fluent Client Authors

/** A named, independently executed diagnostics operation. */
export interface DiagnosticCollector<TContext = void, TValue = unknown> {
  /** Stable name identifying the diagnostic in the report. */
  name: string;
  /** Collect a diagnostic value without writing output. */
  collect: (context: TContext) => TValue | Promise<TValue>;
}

/** Result from one diagnostics collector. */
export type DiagnosticEntry =
  { name: string; value: unknown; error?: never } | { name: string; value?: never; error: unknown };

/** Ordered, runner-neutral diagnostics report. */
export interface DiagnosticReport {
  /** ISO timestamp recorded immediately before collectors run. */
  collectedAt: string;
  /** One entry for every requested collector, in input order. */
  entries: DiagnosticEntry[];
}

/**
 * Run diagnostics collectors independently and return structured results.
 *
 * A failed collector is represented in its entry and does not prevent the
 * remaining collectors from running. This function never prints or writes files.
 *
 * @param context - Value shared with every collector.
 * @param collectors - Diagnostics operations to run.
 * @returns A structured report suitable for any test runner or artifact format.
 */
export async function collectDiagnostics<TContext>(
  context: TContext,
  collectors: readonly DiagnosticCollector<TContext>[],
): Promise<DiagnosticReport> {
  const collectedAt = new Date().toISOString();
  const entries = await Promise.all(
    collectors.map(async ({ name, collect }): Promise<DiagnosticEntry> => {
      try {
        return { name, value: await collect(context) };
      } catch (error) {
        return { name, error };
      }
    }),
  );

  return { collectedAt, entries };
}

# 2. Ship Kubernetes integration test helpers

Date: 2026-07-22

## Status

Proposed

## Context

UDS packages are tested with cluster-native integration packages: typically in a TypeScript project
under `tests/`, run by Vitest, using `kubernetes-fluent-client` (KFC) against a real k3d cluster
provisioned by the package task runner (`uds run test:all`).

An audit of two shipped packages (Argo Events, Peat Node Injector) shows duplication:

- A near-identical `waitFor` polling helper.
- The same ownership label key (`test.defenseunicorns.dev/source`) and exclusive use of KFC
  `Apply()` (server-side apply) for resource creation.
- Byte-identical `vitest.config.ts`, and `package.json`/`tsconfig.json`.
- A repeated catch-and-rethrow diagnostics block wrapping every test body (7 occurrences).
- Best-effort deletion, pods-by-label waiters, container-presence checks, env-based config, and
  diagnostics collectors, all duplicated in pattern.
- Deployment-ownership lookup/availability/log helpers, CRD waiters, and
  `GenericKind`/`RegisterKind` boilerplate present in Argo Events only; namespace lifecycle
  utilities present in Peat Node Injector only.

Both packages also share fixable gaps: every API error is retried (RBAC failures burn the full
timeout instead of failing fast), and ownership labels are stamped but never used for cleanup.

The KFC repository runs its own Vitest-based e2e package against k3d, and `pepr-excellent-examples`
maintains a third copy of similar patterns, so this is an ecosystem problem. No existing
TypeScript library covers this gap; the mature analogues are `kubernetes-sigs/e2e-framework` (Go)
and Chainsaw (declarative YAML, a paradigm the Peat package deliberately migrated away from).

KFC is the shared dependency of each example consumer, and its README already defines the
package as a fluent client "with some additional logic for" Server Side Apply, Watch retry/signal
control, and Field Selectors. Test helpers extend that list rather than changing what the package
is.

Alternatives considered:

- A sibling workspace package in the KFC repo: strongest runtime/test separation, but requires
  workspace conversion, monorepo release tooling, and a peer-version matrix.
- A standalone repo: rejected; it recreates the drift and coordination problem at the repo level.
- Helpers in reference-package: fallback if the subpath fails its adoption criteria.

## Decision

We will ship a runner-neutral test helper module inside `kubernetes-fluent-client`, exposed as two
subpath exports:

- `kubernetes-fluent-client/test`: the runner-neutral core. It extracts the shared `waitFor`
  call shape and ownership conventions and consolidates their repeated support patterns into
  small generic primitives. `waitFor` has retryable/terminal error classification (401/403/422 abort;
  404/409/timeouts/5xx retry), an exported `WaitForTimeoutError` carrying structured failure details,
  a custom-classifier option, and an `onTimeout` diagnostics hook;
  `preflight()`; `env()` (including exported timing defaults and environment-variable names);
  `applyWithOwnership()` and `ownershipLabels()` (default exported label keys
  `test.defenseunicorns.dev/source` and `test.defenseunicorns.dev/run-id`); `waitForResource`; and composable,
  structured diagnostics through `collectDiagnostics()` that do not write output. Public function
  option and result types are exported so TypeScript consumers can define reusable configuration
  without duplicating library types. `preflight()` is a new fail-fast guardrail rather than code
  copied from either package. `waitForPodsByLabel` and `hasContainer` are deferred because only Peat
  Node Injector currently supplies a concrete use.
  `deleteAllByOwnership()` deletes resources through exact label selectors evaluated by Kubernetes,
  with UID and resource-version preconditions for APIs that do not support collection deletion.
  Ownership and the optional run ID use separate labels so their identities are unambiguous;
  omitting a run ID preserves the stable owner-only behavior.
  Helpers present in only one consumer (e.g. deployment-ownership lookup, log tailing, CRD
  registration and waiters, namespace lifecycle) stay in that consumer until a second case appears.
- `kubernetes-fluent-client/test/vitest`: a thin, config-safe layer. It provides
  `defineKubernetesTestConfig()` (the packages' current shared config), while
  `kubernetes-fluent-client/test/vitest/setup` exposes `setupKubernetesPreflight()`, which registers
  the core preflight check as a Vitest `beforeAll` hook. The separate setup entry prevents config
  loading from eagerly importing Vitest's runtime APIs. The `KUBERNETES_TEST_TIMEOUT_MS` constant is
  also exported for consumers that need to align related configuration. `vitest` is an optional
  peer dependency used only by these entries and supports the repository's current Vitest major.
  Sync matchers are deferred until at least two consumers share a concrete assertion pattern.

Guardrails: no cluster provisioning; no package-level fixtures or namespace DSL (packages that test in
an existing package namespace stay first-class); no async polling matchers, custom environments,
or reporters in v1; no controller-specific logic; cleanup touches only declared or labeled
resources. The client's runtime code never imports from `src/test/` (enforced by a CI lint rule);
runner neutrality in the core entry is enforced by a separate CI lint rule that rejects
vitest-specific imports. For external consumers, the `/test` subpath signals test-only use (the
same convention as `@angular/core/testing`).

This implementation includes the exports, build wiring, runner-neutral core, race-resistant
label-scoped cleanup, KFC e2e migration, and Vitest adapters. After KFC publishes a version
containing these entry points, Argo Events and Peat Node Injector can land their prepared migrations
and `uds-package-test/reference-package` scaffolding can adopt the shared adapters. The KFC release
comes first because cross-repository consumers cannot depend on unpublished entry points.

## Consequences

Positive:

- Fixes propagate by version bump; the observed `waitFor` drift ends.
- Test bodies lose the repeated diagnostics boilerplate; RBAC failures fail in seconds.
- Adoption is an import statement for every existing KFC consumer, and helper and client versions
  cannot skew (no peer-range matrix exists).
- The semantic-release pipeline is untouched, and the README gains one focused integration-testing
  section documenting the new public entry points.

Negative:

- Helper changes release the runtime library. Accepted: runtime entry points do not import test
  code, so runtime consumers see no behavioral change. The initial API surface is deliberately
  small (only helpers duplicated in both audited packages); additional helpers are promoted when a
  second consumer appears. Revisit the sibling-package option if churn or surface growth becomes
  disruptive.
- The published artifact grows by the test subtree; package verification reports its packed and
  unpacked sizes against a future agreed budget.
- KFC maintainers take on the helpers' triage and API stability surface; this decision requires
  their buy-in.
- Error classification and `onTimeout` are behavior changes riding along with extraction; package
  migrations must call them out.

Success criteria for continued investment and expansion after the initial KFC release: a third
package adopts with less bespoke glue than either example package; migrations delete more code than
the subtree adds; a contributor beyond the original author lands a change.

Remaining open question: the artifact size budget that would trigger reconsidering a sibling
package. The package verification check reports packed and unpacked sizes so the project can set
that threshold from measured releases.

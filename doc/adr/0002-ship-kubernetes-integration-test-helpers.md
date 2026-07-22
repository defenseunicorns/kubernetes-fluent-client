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
- Best-effort deletion, pods-by-label waiters, container-presence checks, owned-Deployment
  lookup/availability/log helpers, condition and CRD waiters, env-based config, and
  `GenericKind`/`RegisterKind` boilerplate, all duplicated in pattern.

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

- `kubernetes-fluent-client/test`: the core. `waitFor` with retryable/terminal error
  classification (401/403/422 abort; 404/409/timeouts/5xx retry) and an `onTimeout` diagnostics
  hook; `preflight()`; `env()`; `registerCrd()`; `applyWithOwnership()` (default label key
  `test.defenseunicorns.dev/source`); `deleteIgnoringNotFound()`; optional namespace lifecycle
  utilities; waiters (`waitForResource`, `waitForPodsByLabel`, `waitForCrdEstablished`,
  `waitForResourceConditions`, `findDeploymentOwnedBy`, `waitForOwnedDeploymentAvailable`,
  `tailOwnedDeploymentLogs`); sync predicates (`hasContainer`); composable diagnostics collectors.
- `kubernetes-fluent-client/test/vitest`: a thin layer. `defineKubernetesTestConfig()` (the
  packages' current shared config), a preflight setup helper, and sync matchers. `vitest` is an
  optional peer dependency used only by this entry.

Guardrails: no cluster provisioning; no package-level fixtures or namespace DSL (packages that test in
an existing package namespace stay first-class); no async polling matchers, custom environments,
or reporters in v1; no controller-specific logic; cleanup touches only declared or labeled
resources; the client code never imports from `src/test/` (enforced in CI).

Rollout: (0) exports and build wiring with empty stubs, optional-peer declaration, import-direction
CI check, artifact size measurement; (1) extract the core and migrate both packages, deleting local
copies; (2) label-scoped cleanup, opt-in run-ID label values, and migration of KFC's own e2e package
onto the core; (3) ship the Vitest entry and point `uds-package-test`/reference-package
scaffolding at it.

## Consequences

Positive:

- Fixes propagate by version bump; the observed `waitFor` drift ends.
- Test bodies lose the repeated diagnostics boilerplate; RBAC failures fail in seconds.
- Adoption is an import statement for every existing KFC consumer, and helper and client versions
  cannot skew (no peer-range matrix exists).
- The semantic-release pipeline is untouched, and the README change is one new feature-list entry.

Negative:

- Helper changes release the runtime library. Accepted: runtime entry points do not import test
  code, so runtime consumers see no behavioral change; revisit the sibling-package option if churn
  becomes disruptive.
- The published artifact grows by the test subtree; measured in phase 0 against an agreed budget.
- KFC maintainers take on the helpers' triage and API stability surface; this decision requires
  their buy-in.
- Error classification and `onTimeout` are behavior changes riding along with extraction; package
  migrations must call them out.

Success criteria for continuing past phase 1: a third package adopts with less bespoke glue than
either example package; migrations delete more code than the subtree adds; a contributor beyond
the original author lands a change. Revert to blessed copy-paste helpers if packages begin wrapping
the helpers or single-consumer options.

Open questions for the workshop: subpath naming (`./test` vs `./testing` vs `./e2e`, noting the
repo's existing `test/` fixtures directory); whether helper-only changes carry a distinct
conventional-commit scope; default waiter timeouts (the example packages disagree); whether run-ID label
values are opt-in or default-on; whether runner neutrality is enforced by a no-`vitest`-imports CI
check or by review; the diagnostics output contract (console vs artifact files); and the artifact
size budget that would trigger reconsidering a sibling package.

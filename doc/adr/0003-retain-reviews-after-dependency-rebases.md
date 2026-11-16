# 3. Retain reviews after dependency rebases

Date: 2026-11-16

## Status

Proposed. Merging this document does not change GitHub branch protection.

## Context

Dependabot can push rebases and updated dependency versions after a PR has been reviewed. The
repository's classic protection for `main` currently sets `dismiss_stale_reviews: true`, requiring
another approval after such pushes. The active organization ruleset, `Default Global Ruleset for
main` (ID 9108671), sets `dismiss_stale_reviews_on_push: false`. Both layers require one approval and
code-owner review; the stricter effective setting still dismisses stale approvals.

Auto-merge can remove the final merge click, but it cannot supply missing reviews. Weekly batching
reduces repeated pushes but does not eliminate them.

## Decision

Propose changing only `dismiss_stale_reviews` to `false` in the repository's classic `main`
protection, aligning it with the organization ruleset. Keep the approval count, code-owner review,
required checks, up-to-date branch requirement, signature requirements, and other protections.

The exact proposed API request is:

```http
PATCH /repos/defenseunicorns/kubernetes-fluent-client/branches/main/protection/required_pull_request_reviews
Content-Type: application/json

{"dismiss_stale_reviews": false}
```

An administrator must apply this setting separately after the policy decision is accepted. Read the
current protection and organization rules before applying it; they may have changed since this
proposal. Verify afterward that only stale-review dismissal changed and that one approval,
code-owner review, and required checks still apply.

Rollback uses the same endpoint with `{"dismiss_stale_reviews": true}`.

## Consequences

Approved Dependabot PRs can retain their reviews after rebases and proceed through auto-merge once
all required checks pass. Security update PR creation is unaffected by this review policy.

This is a branch-wide setting: approvals also remain after human code changes and new dependency
versions. GitHub's classic setting cannot distinguish a mechanical bot rebase from a substantive
push. Reviewers must assess that tradeoff before accepting this proposal. If retaining approvals is
not acceptable, keep the existing setting and use weekly batching and auto-merge with fresh reviews.

## References

- [Current organization ruleset](https://github.com/defenseunicorns/kubernetes-fluent-client/rules/9108671)
- [Required review protection API](https://docs.github.com/en/rest/branches/branch-protection#update-pull-request-review-protection)
- [Protected branches and stale approvals](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

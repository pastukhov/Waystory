# Protecting main

The repository contains CI and a **proposed branch-protection configuration**. Committing this JSON does not enable branch protection. Applying it requires repository administration permission, which the authoring GitHub integration does not have.

## Required policy

- All changes to `main` go through a pull request, including administrators.
- The `Required checks` job must pass. It aggregates Node.js 22/24 tests and a real Docker build/runtime smoke test; failures, skips, and cancellations do not count as success.
- The branch must be up to date with `main` before merging.
- Resolve review conversations before merging.
- Force pushes and branch deletion are prohibited.
- No mandatory approving review count for now: a sole maintainer can merge their own green PR. The PR itself remains mandatory.

## Apply with an administrator account

After the CI pull request passes and is merged, run from a checkout containing these files:

```sh
gh api --method PUT repos/pastukhov/Waystory/branches/main/protection \
  --input .github/main-protection.json

gh api repos/pastukhov/Waystory/branches/main/protection
```

Use a GitHub CLI login/token with repository administration permission; do not put it in repository files or workflow secrets. This PUT sets the stated classic protection policy. Inspect and preserve any additional existing protection requirements before applying it to a repository that already has protection.

Alternatively open [branch settings](https://github.com/pastukhov/Waystory/settings/branches), create/edit a rule for `main`, require a pull request and the `Required checks` status, require up-to-date branches, enable enforcement for administrators, and prohibit bypass, force pushes, and deletion.

GitHub Actions only gets `contents: read`; CI cannot grant itself repository administration rights. This document is not evidence that protection has been applied.

# Protecting main

The repository tracks its branch-protection policy in .github/main-protection.json. Applying it requires repository administration permission.

## Required policy

- All changes to `main` go through a pull request, including administrators.
- The `Required checks` job from the GitHub Actions app (verified app ID `15368`) must pass. It aggregates Node.js 22/24 tests and a real Docker build/runtime smoke test; failures, skips, and cancellations do not count as success.
- The `Codex review complete` status must pass for the current PR head. Codex reviews on every push. The status waits for a completed review and resolved Codex threads.
- The branch must be up to date with `main` before merging.
- Resolve review conversations before merging.
- Force pushes and branch deletion are prohibited.
- No mandatory approving review count for now: a sole maintainer can merge their own green PR. The PR itself remains mandatory.

If the Codex review job times out, address or resolve its findings, then rerun the **Codex Review** workflow for that PR head. A new push starts a fresh review and check.

## Apply with an administrator account

After the CI pull request passes and is merged, run from a checkout containing these files:

```sh
gh api --method PUT repos/pastukhov/Waystory/branches/main/protection \
  --input .github/main-protection.json

gh api repos/pastukhov/Waystory/branches/main/protection
```

Use a GitHub CLI login/token with repository administration permission; do not put it in repository files or workflow secrets. This PUT sets the stated classic protection policy. Inspect and preserve any additional existing protection requirements before applying it to a repository that already has protection.

Alternatively open [branch settings](https://github.com/pastukhov/Waystory/settings/branches), create/edit a rule for `main`, require a pull request and the `Required checks` and `Codex review complete` statuses, require up-to-date branches, enable enforcement for administrators, and prohibit bypass, force pushes, and deletion.

The review workflow publishes the status using the GitHub Actions token and runs code from the PR base branch.

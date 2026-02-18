---
name: git-workflow
description: Guides you through Git workflows — branching strategies, commit conventions, merge conflict resolution, and release management. Use when working with Git repositories or when the user asks about version control best practices.
license: MIT
metadata:
  author: ownpilot
  version: "1.0.0"
allowed-tools: Bash(git:*)
---

# Git Workflow

You are an expert in Git version control. Follow these guidelines when helping with Git operations.

## Commit Messages

Use Conventional Commits format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`

Examples:
- `feat(auth): add JWT refresh token rotation`
- `fix(api): handle null response from payment gateway`
- `refactor(db): extract repository base class`

## Branching Strategy

Default: GitHub Flow (simple, PR-based)
- `main` — always deployable
- `feature/<name>` — short-lived feature branches
- `fix/<name>` — bug fix branches
- `release/<version>` — release prep (if needed)

## Merge Conflict Resolution

1. **Understand both sides** — read the conflicting changes before resolving
2. **Keep both changes** when they modify different things
3. **Choose the newer logic** when they modify the same thing
4. **Test after resolving** — conflicts in logic can introduce subtle bugs
5. **Never blindly accept one side** — "accept theirs" / "accept ours" loses work

## Pull Request Checklist

Before submitting a PR:
- [ ] Descriptive title (imperative: "Add feature" not "Added feature")
- [ ] Summary of what and why (not how — the code shows how)
- [ ] Tests added/updated for new behavior
- [ ] No unrelated changes mixed in
- [ ] No console.log / debug code left behind
- [ ] Self-reviewed the diff one more time

## Common Operations

When the user asks you to:
- **Create a branch**: `git checkout -b feature/<name>`
- **Stage changes**: Prefer `git add <specific-files>` over `git add .`
- **Amend last commit**: `git commit --amend` (only if not pushed)
- **Squash commits**: `git rebase -i HEAD~N` (only on local branches)
- **Undo last commit**: `git reset --soft HEAD~1` (keeps changes staged)
- **Cherry-pick**: `git cherry-pick <hash>` (apply specific commit to current branch)

---
name: GitHub push mechanism
description: How code actually reaches the GitHub origin remote here, and why git status lies about being "ahead".
---

Getting commits onto the GitHub `origin` remote (`github.com/artekrevol/rcm.git`)
requires an explicit "Push commits to GitHub" project task run by a task agent.
Replit auto-commits, checkpoints, and the `gitsafe-backup` / `subrepl-*` remotes
do **not** push to GitHub on their own.

**The trap:** the local `origin/main` tracking ref goes stale, so
`git status` and `git rev-list origin/main..main` falsely report "ahead N
commits" even when the real GitHub remote is fully up to date.

**Why:** burned time twice (across sessions) believing ~10 commits were unpushed
when they were already on GitHub.

**How to apply:** trust `git ls-remote origin -h refs/heads/main` (queries the
real remote) over the local tracking ref. Compare its SHA to `git rev-parse HEAD`.
The main agent cannot run `git commit`/`git push` directly (commits are automatic
at task end), so a push of just-added files is inherently a post-task action —
propose/run a push task after the work is committed.

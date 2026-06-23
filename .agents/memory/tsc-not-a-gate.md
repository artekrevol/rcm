---
name: tsc is not a passing gate
description: Why a red `npm run check` (tsc) is expected in this repo and how to tell if YOU broke something
---

# `npm run check` (tsc) is pre-existing red — not a regression signal

The repo's `check` script runs `tsc --noEmit`, but the project **runs and ships via `tsx`** (`dev`: `tsx server/index.ts`; `build`: `tsx script/build.ts`). `tsx` strips types without type-checking, so the codebase has accumulated a large number of standing tsc errors (~145 at last count) and still runs fine.

The dominant pre-existing error families (all systemic, all over `server/routes.ts` from line ~66 onward):
- `Cannot find name 'pool'` / `Cannot find name 'db'` (scoping)
- `Argument of type 'string | null' is not assignable to 'string | undefined'` (`getOrgId()` returns `string | null`, fed into query helpers)
- `Property 'X' does not exist on type '{}'` (raw `client.query`/`withTenantTx` results typed as `{}`)
- `Set/MapIterator can only be iterated ... target es2015+` (tsconfig target)

**Why:** running a full `tsc` takes >120s (exceeds the bash tool timeout) and returns hundreds of errors unrelated to your change, which is easy to misread as "I broke the build."

**How to apply:** after a change, DON'T judge by total tsc error count. Instead run `tsc --noEmit` once to a file, then prove your change is clean by grepping that file for (a) your new symbols/module names and (b) your exact changed line numbers / files. If neither appears, you introduced no new type errors. The 44-test `node --test test/phase-b-verify.test.ts` suite (runs via tsx) plus a running workflow are the real gates.

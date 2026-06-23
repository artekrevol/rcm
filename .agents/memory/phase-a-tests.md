---
name: Phase A test harness
description: How to run the Phase A verification harness and the pure-function extraction pattern.
---

## Test runner command
```bash
NODE_OPTIONS='--import tsx/esm' node --test test/phase-a-verify.test.ts
```

This matches the pattern used by `test/edi-837p-golden.test.ts`. Uses `node:test` (built-in), dynamic imports for TypeScript modules, and no Jest/Vitest dependency.

## Pure-function extraction for testability
Server-side React contexts can't be imported by `node:test` (no DOM, no React). The pattern:
1. Extract the pure logic to `shared/<module>.ts` (no React imports).
2. Re-export from the client context: `export { fn } from "@shared/<module>"`.
3. Test file imports from `../shared/<module>.js` (note `.js` extension for ESM resolution).

Applied to:
- `resolveSegmentFeatures` → `shared/segment-features.ts` (re-exported from `client/src/contexts/segment.tsx`)
- `runHhEpisodeCompleteness` → standalone adapter function at bottom of `server/services/validation/packs/hh-episode-completeness.ts`
- `computeNoaStatus` → `server/services/hh/noa.ts`

## Check 4 — cross-tenant RLS
`withTenantTx(fn, orgId)` signature: callback first, orgId override second.
The test seeds an episode as org A, reads it as org B, asserts zero rows, then cleans up.
Requires `DATABASE_URL` in env; the describe block has `{ skip: !process.env.DATABASE_URL }`.

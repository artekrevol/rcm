/**
 * In-memory pack registry.
 * All packs register here at module load time.
 * The runner queries resolvePacksForClaim() to determine which packs apply.
 *
 * Future enhancement (not in scope): a payer_rule_packs DB table that
 * lets ops add/remove pack assignments at runtime. For now, registration
 * is in-memory and pack-to-payer mapping is in code.
 */

import type { RulePack, ClaimWithRelations } from './engine/types.js';
import { x12Base837pPack } from './packs/x12-base-837p.js';
import { pgbaVaCcn837pPack } from './packs/pgba-va-ccn-837p.js';
import { hhEpisodeCompletenessPack } from './packs/hh-episode-completeness.js';
import { hhAuthVisitCapPack } from './packs/hh-auth-visit-cap.js';
// Phase B — 837I / HH institutional packs
import { palmettoHh837iPack } from './packs/palmetto-hh-837i.js';
import { hhRcdGatePack } from './packs/hh-rcd-gate.js';
import { hhNoaPreconditionPack } from './packs/hh-noa-precondition.js';
import { hhNoaTimingPack } from './packs/hh-noa-timing.js';

const registry = new Map<string, RulePack>();

function registerPack(pack: RulePack): void {
  registry.set(pack.id, pack);
}

// Auto-register all built-in packs
registerPack(x12Base837pPack);
registerPack(pgbaVaCcn837pPack);
registerPack(hhEpisodeCompletenessPack);
registerPack(hhAuthVisitCapPack);
// Phase B — 837I institutional packs (HH-only, guarded by careModels filter)
registerPack(palmettoHh837iPack);
registerPack(hhRcdGatePack);
registerPack(hhNoaPreconditionPack);
registerPack(hhNoaTimingPack);

export function getRegisteredPacks(): RulePack[] {
  return Array.from(registry.values());
}

export function getPackById(id: string): RulePack | undefined {
  return registry.get(id);
}

/**
 * Resolve the ordered list of packs to run for a claim.
 * Resolution order: base pack first, then payer-specific overlays.
 * The extends chain is resolved so parent pack rules are available
 * for override by child packs in the runner.
 *
 * @param claim - normalized claim with payer info attached
 * @param overridePackIds - optional explicit list (admin debug override)
 * @param careModel - org's care_model from practice_settings; used to filter segment-specific packs
 */
export function resolvePacksForClaim(
  claim: ClaimWithRelations,
  overridePackIds?: string[],
  careModel?: string,
): RulePack[] {
  const effectiveCareModel = careModel ?? 'outpatient_professional';

  if (overridePackIds && overridePackIds.length > 0) {
    const packs = overridePackIds
      .map(id => registry.get(id))
      .filter((p): p is RulePack => p != null);
    if (packs.length === 0) {
      console.warn(`[validation] Override packIds provided but none found in registry: ${overridePackIds.join(', ')}`);
    }
    return resolveExtendsChain(packs);
  }

  // Determine claim type — default to 837P
  const claimType = (claim as any).claimTransactionSet === '837I' ? '837I' : '837P';

  // 1. Find the base pack matching claim type (no payer IDs, no careModels restriction)
  const basePacks = Array.from(registry.values()).filter(
    p =>
      !p.appliesTo.payerIds &&
      !p.appliesTo.careModels &&
      (p.appliesTo.claimType === claimType || p.appliesTo.claimType === '*'),
  );

  // 2. Find payer-specific overlays (matching claim type and payer)
  const payerId = claim.payerRecord?.payerId ?? null;
  const overlayPacks = Array.from(registry.values()).filter(
    p =>
      p.appliesTo.payerIds != null &&
      !p.appliesTo.careModels &&
      (p.appliesTo.claimType === claimType || p.appliesTo.claimType === '*') &&
      payerId != null &&
      p.appliesTo.payerIds.includes(payerId),
  );

  // 3. Find segment-specific packs (filtered by careModel — HH packs only run for HH orgs)
  const segmentPacks = Array.from(registry.values()).filter(
    p =>
      p.appliesTo.careModels != null &&
      (p.appliesTo.claimType === claimType || p.appliesTo.claimType === '*') &&
      p.appliesTo.careModels.includes(effectiveCareModel),
  );

  const selectedPacks = [...basePacks, ...overlayPacks, ...segmentPacks];
  return resolveExtendsChain(selectedPacks);
}

/**
 * Ensure the extends chain is fully resolved and deduplicated.
 * If pack B extends pack A, pack A must appear before pack B.
 * Parents are inserted in the correct position if not already present.
 */
function resolveExtendsChain(packs: RulePack[]): RulePack[] {
  const seen = new Set<string>();
  const result: RulePack[] = [];

  function addPack(pack: RulePack): void {
    if (seen.has(pack.id)) return;
    // Add parents first
    for (const parentId of pack.extends ?? []) {
      const parent = registry.get(parentId);
      if (!parent) {
        console.warn(`[validation] Pack "${pack.id}" extends "${parentId}" which is not registered.`);
        continue;
      }
      addPack(parent);
    }
    if (!seen.has(pack.id)) {
      seen.add(pack.id);
      result.push(pack);
    }
  }

  for (const pack of packs) {
    addPack(pack);
  }

  return result;
}

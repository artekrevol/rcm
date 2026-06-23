/**
 * Generator dispatch selector for Phase B.
 *
 * Reads claim_transaction_set to determine which EDI generator to use.
 * This is the ONLY file that knows about both generators.
 * edi-generator.ts (837P) has ZERO knowledge of edi-generator-institutional.ts.
 *
 * G-B2: dispatch is segment-keyed, not branch-keyed.
 * Only claim_transaction_set = '837I' reaches the institutional generator.
 * null / '837P' / anything else → existing generate837P.
 */

import { generate837P, type EDI837PInput, type Generate837PResult } from '../edi-generator.js';
import { generate837I, generateNOA, type EDI837IInput, type EDI837IResult } from '../edi-generator-institutional.js';

export type ClaimTransactionSet = '837P' | '837I' | null;

export interface DispatchedGeneratorResult extends Generate837PResult {
  transactionSet: '837P' | '837I';
}

/**
 * Select and invoke the correct EDI generator based on claim_transaction_set.
 * Returns a unified result with a `transactionSet` discriminator so callers
 * can route the submission correctly.
 */
export function selectAndGenerate(
  transactionSet: ClaimTransactionSet,
  input837P: EDI837PInput,
): DispatchedGeneratorResult {
  if (transactionSet === '837I') {
    throw new Error(
      '[selectAndGenerate] 837I claims must use the selectAndGenerate837I() overload that takes EDI837IInput. ' +
      'Do not pass an EDI837PInput for institutional claims.',
    );
  }
  const result = generate837P(input837P);
  return { ...result, transactionSet: '837P' };
}

/**
 * Institutional-specific overload.
 */
export function selectAndGenerate837I(input: EDI837IInput): EDI837IResult & { transactionSet: '837I' } {
  const result = generate837I(input);
  return { ...result, transactionSet: '837I' };
}

/**
 * Pure function — used by VB-1 test to assert which generator path runs.
 * Returns the string '837I' or '837P' without running the full generator.
 */
export function resolveGeneratorKey(transactionSet: ClaimTransactionSet): '837P' | '837I' {
  return transactionSet === '837I' ? '837I' : '837P';
}

export { generate837I, generateNOA };

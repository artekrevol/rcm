// Step 5: HCPCS → modifier suggestion lookup table
// Extend this as more codes are encountered in production.

export interface HcpcsModifierHint {
  suggestedModifier: string | null;
  note: string;
}

export const HCPCS_MODIFIER_HINTS: Record<string, HcpcsModifierHint> = {
  'G0156': { suggestedModifier: null, note: 'Home health aide — no modifier required for VA CCN' },
  'G0299': { suggestedModifier: null, note: 'RN home visit — no modifier required for VA CCN' },
  'G0300': { suggestedModifier: null, note: 'LPN home visit — no modifier required for VA CCN' },
  'S5125': { suggestedModifier: null, note: 'Attendant care — no modifier required for VA CCN' },
  'S5126': { suggestedModifier: null, note: 'Attendant care, overnight — no modifier required for VA CCN' },
  'S9122': { suggestedModifier: null, note: 'Home health aide hourly — no modifier required for VA CCN' },
  'S9123': { suggestedModifier: null, note: 'Skilled nursing care, home — no modifier required for VA CCN' },
  'T1019': { suggestedModifier: null, note: 'Personal care services — verify modifier per auth' },
  'T1020': { suggestedModifier: null, note: 'Personal care services, 15 min — verify modifier per auth' },
  'T1021': { suggestedModifier: null, note: 'Home health aide, per visit — no modifier required for VA CCN' },
  'T2025': { suggestedModifier: null, note: 'Waiver services — verify modifier with payer' },
  'T2028': { suggestedModifier: null, note: 'Specialized supply, NEC — verify modifier with payer' },
  '99509': { suggestedModifier: null, note: 'Home visit for perinatal assessment — no modifier required' },
  'G0179': { suggestedModifier: null, note: 'MD recertification of home health plan — no modifier required' },
  'G0180': { suggestedModifier: null, note: 'MD certification of home health plan — no modifier required' },
  'G0181': { suggestedModifier: null, note: 'Home health care supervision — no modifier required' },
  'G0182': { suggestedModifier: null, note: 'Home health care supervision, hospice — no modifier required' },
  'S0271': { suggestedModifier: null, note: 'Physician service, home visit — verify modifier per fee schedule' },
  'G0151': { suggestedModifier: null, note: 'PT home health services — no modifier typically required' },
  'G0152': { suggestedModifier: null, note: 'OT home health services — no modifier typically required' },
  'G0153': { suggestedModifier: null, note: 'SLP home health services — no modifier typically required' },
  'G0154': { suggestedModifier: null, note: 'Skilled nursing home health — no modifier typically required' },
  'G0155': { suggestedModifier: null, note: 'Social work home health — no modifier typically required' },
  '97530': { suggestedModifier: null, note: 'Therapeutic activities — verify modifier with payer' },
  '97110': { suggestedModifier: null, note: 'Therapeutic exercises — verify modifier with payer' },
  '97012': { suggestedModifier: null, note: 'Mechanical traction — verify modifier with payer' },
  '92507': { suggestedModifier: null, note: 'Speech therapy treatment — verify modifier with payer' },
};

/** Returns the hint for the given HCPCS code (case-insensitive), or null if not found. */
export function getModifierHint(code: string): HcpcsModifierHint | null {
  return HCPCS_MODIFIER_HINTS[code.toUpperCase()] ?? null;
}

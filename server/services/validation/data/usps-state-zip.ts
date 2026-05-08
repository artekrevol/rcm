/**
 * Static USPS ZIP-prefix → state mapping.
 * Source: USPS Publication 28 (Postal Addressing Standards).
 * Ranges are the first three digits of the 5-digit ZIP code.
 * No external API — fully inline for auditability and version control.
 * Used by PGBA-BG5 to detect state/ZIP inconsistencies.
 */

const ZIP_STATE_RANGES: [number, number, string][] = [
  [6,    9,    'PR'],
  [10,   27,   'MA'],
  [28,   29,   'RI'],
  [30,   38,   'NH'],
  [39,   49,   'ME'],
  [50,   59,   'VT'],
  [60,   69,   'CT'],
  [70,   89,   'NJ'],
  [100,  149,  'NY'],
  [150,  196,  'PA'],
  [197,  199,  'DE'],
  [200,  205,  'DC'],
  [206,  212,  'MD'],
  [214,  219,  'MD'],
  [220,  246,  'VA'],
  [247,  268,  'WV'],
  [270,  289,  'NC'],
  [290,  299,  'SC'],
  [300,  319,  'GA'],
  [320,  349,  'FL'],
  [350,  369,  'AL'],
  [370,  385,  'TN'],
  [386,  397,  'MS'],
  [398,  399,  'GA'],
  [400,  427,  'KY'],
  [430,  458,  'OH'],
  [460,  479,  'IN'],
  [480,  499,  'MI'],
  [500,  528,  'IA'],
  [530,  545,  'WI'],
  [546,  546,  'MN'],
  [550,  567,  'MN'],
  [570,  577,  'SD'],
  [580,  588,  'ND'],
  [590,  599,  'MT'],
  [600,  629,  'IL'],
  [630,  658,  'MO'],
  [660,  679,  'KS'],
  [680,  693,  'NE'],
  [700,  714,  'LA'],
  [716,  729,  'AR'],
  [730,  749,  'OK'],
  [750,  799,  'TX'],
  [800,  816,  'CO'],
  [820,  831,  'WY'],
  [832,  838,  'ID'],
  [840,  847,  'UT'],
  [850,  865,  'AZ'],
  [870,  884,  'NM'],
  [885,  885,  'TX'],
  [889,  898,  'NV'],
  [900,  961,  'CA'],
  [967,  968,  'HI'],
  [969,  969,  'GU'],
  [970,  979,  'OR'],
  [980,  994,  'WA'],
  [995,  999,  'AK'],
  // Military APO/FPO — valid state codes per USPS
  [90,   98,   'AE'],  // APO Europe (09xxx)
  [340,  340,  'AA'],  // APO Miami
  [962,  966,  'AP'],  // APO Pacific
];

/**
 * Returns the expected 2-letter state abbreviation for a given ZIP prefix,
 * or null if the ZIP is unrecognized.
 */
export function stateForZip(zip: string): string | null {
  const clean = zip.replace(/\D/g, '');
  if (clean.length < 3) return null;
  const prefix = parseInt(clean.slice(0, 3), 10);
  for (const [lo, hi, state] of ZIP_STATE_RANGES) {
    if (prefix >= lo && prefix <= hi) return state;
  }
  return null;
}

/**
 * Valid US 2-letter state/territory/military codes.
 * Includes all 50 states + DC + territories + APO/FPO.
 */
export const VALID_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','GU','VI','AS','MP',
  'AA','AE','AP',
]);

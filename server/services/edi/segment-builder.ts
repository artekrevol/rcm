/**
 * X12 segment builder.
 *
 * Builds an X12 segment string from a segment ID and a sparse 1-based element
 * map. Empty/missing elements between populated ones become empty strings.
 * Trailing empty elements are omitted (X12 standard). Values are coerced via
 * String(); null/undefined treated as empty string.
 *
 * Throws if any value contains the element separator ('*') or segment
 * terminator ('~') — caller must strip/escape those characters first.
 *
 * Zero runtime dependencies. ~80 lines.
 */

export interface SegmentOptions {
  elementSep?: string;   // default '*'
  segmentTerm?: string;  // default '~'
}

export function buildSegment(
  id: string,
  elements: Record<number, string | number | null | undefined>,
  opts?: SegmentOptions
): string {
  const sep  = opts?.elementSep  ?? '*';
  const term = opts?.segmentTerm ?? '~';

  const numericKeys = Object.keys(elements)
    .map(Number)
    .filter(k => Number.isInteger(k) && k >= 1);

  if (numericKeys.length === 0) return id + term;

  const maxKey = Math.max(...numericKeys);
  const parts: string[] = [id];

  for (let i = 1; i <= maxKey; i++) {
    const raw = elements[i];
    const str = raw === null || raw === undefined ? '' : String(raw);

    if (str.includes(sep)) {
      throw new Error(
        `buildSegment: ${id} element ${i} contains element separator '${sep}': ` +
        `"${str.slice(0, 50)}${str.length > 50 ? '…' : ''}"`
      );
    }
    if (str.includes(term)) {
      throw new Error(
        `buildSegment: ${id} element ${i} contains segment terminator '${term}': ` +
        `"${str.slice(0, 50)}${str.length > 50 ? '…' : ''}"`
      );
    }

    parts.push(str);
  }

  // Remove trailing empty elements per X12 standard (omit trailing empties)
  while (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop();
  }

  return parts.join(sep) + term;
}

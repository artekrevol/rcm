/**
 * X12 segment parser.
 *
 * Parses an X12 segment string into a structured object with a 1-based
 * elements array (elements[0] is always undefined — element numbers match
 * the X12 specification directly, e.g. NM103 → elements[3]).
 *
 * parseEdi() splits a full EDI document into ParsedSegments.
 */

export interface ParsedSegment {
  id: string;
  /** 1-indexed element array. elements[0] is undefined; elements[1] = first element. */
  elements: string[];
}

export function parseSegment(
  raw: string,
  opts?: { elementSep?: string; segmentTerm?: string }
): ParsedSegment {
  const sep  = opts?.elementSep  ?? '*';
  const term = opts?.segmentTerm ?? '~';

  const s = raw.endsWith(term) ? raw.slice(0, -term.length) : raw;
  const parts = s.split(sep);
  const id = parts[0];
  // Prepend undefined placeholder so element numbers are 1-based
  const elements: string[] = [undefined as any, ...parts.slice(1)];
  return { id, elements };
}

export function parseEdi(
  edi: string,
  opts?: { elementSep?: string; segmentTerm?: string }
): ParsedSegment[] {
  return edi
    .split(/[~\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseSegment(s, opts));
}

import type { Rule, RuleContext, Violation, Severity } from '../types.js';

interface NoDuplicatesOpts<T> {
  ruleId: string;
  code: string;
  severity: Severity;
  description: string;
  collectionPath: string;
  getCollection: (ctx: RuleContext) => T[];
  keyFn: (item: T) => string;
  message: string | ((key: string, indices: number[]) => string);
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
}

export function noDuplicates<T>(opts: NoDuplicatesOpts<T>): Rule {
  return {
    id: opts.ruleId,
    code: opts.code,
    severity: opts.severity,
    description: opts.description,
    ediSegment: opts.ediSegment,
    appliesWhen: opts.appliesWhen,
    check(ctx: RuleContext): Violation[] | null {
      const items = opts.getCollection(ctx);
      const seen = new Map<string, number[]>();
      items.forEach((item, i) => {
        const key = opts.keyFn(item);
        const existing = seen.get(key) ?? [];
        existing.push(i);
        seen.set(key, existing);
      });
      const violations: Violation[] = [];
      for (const [key, indices] of seen.entries()) {
        if (indices.length > 1) {
          const msg = typeof opts.message === 'function' ? opts.message(key, indices) : opts.message;
          violations.push({ ruleId: opts.ruleId, code: opts.code, severity: opts.severity, message: msg, fieldPath: `${opts.collectionPath}[${indices.join(',')}]`, ediSegment: opts.ediSegment, suggestedFix: opts.suggestedFix, packId: opts.packId });
        }
      }
      return violations.length ? violations : null;
    },
  };
}

import type { Rule, RuleContext, Violation, Severity } from '../types.js';

interface InAllowedSetOpts {
  ruleId: string;
  code: string;
  severity: Severity;
  description: string;
  fieldPath: string | ((ctx: RuleContext) => string);
  getValue: (ctx: RuleContext) => string | null | undefined;
  allowedValues: Set<string> | string[];
  message: string | ((value: string) => string);
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
}

export function inAllowedSet(opts: InAllowedSetOpts): Rule {
  const allowed = opts.allowedValues instanceof Set ? opts.allowedValues : new Set(opts.allowedValues);
  return {
    id: opts.ruleId,
    code: opts.code,
    severity: opts.severity,
    description: opts.description,
    ediSegment: opts.ediSegment,
    appliesWhen: opts.appliesWhen,
    check(ctx: RuleContext): Violation[] | null {
      const value = opts.getValue(ctx);
      if (value == null || value === '') return null;
      if (allowed.has(value)) return null;
      const fp = typeof opts.fieldPath === 'function' ? opts.fieldPath(ctx) : opts.fieldPath;
      const msg = typeof opts.message === 'function' ? opts.message(value) : opts.message;
      return [{ ruleId: opts.ruleId, code: opts.code, severity: opts.severity, message: msg, fieldPath: fp, ediSegment: opts.ediSegment, suggestedFix: opts.suggestedFix, packId: opts.packId }];
    },
  };
}

import type { Rule, RuleContext, Violation, Severity } from '../types.js';

interface DateBoundaryOpts {
  ruleId: string;
  code: string;
  severity: Severity;
  description: string;
  fieldPath: string;
  getSubjectDate: (ctx: RuleContext) => string | null | undefined;
  getBoundaryDate: (ctx: RuleContext) => string | null | undefined;
  message: string | ((subject: string, boundary: string) => string);
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
}

function parseDate(d: string): Date | null {
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function beforeOrEqual(opts: DateBoundaryOpts): Rule {
  return {
    id: opts.ruleId,
    code: opts.code,
    severity: opts.severity,
    description: opts.description,
    ediSegment: opts.ediSegment,
    appliesWhen: opts.appliesWhen,
    check(ctx: RuleContext): Violation[] | null {
      const subjStr = opts.getSubjectDate(ctx);
      const boundStr = opts.getBoundaryDate(ctx);
      if (!subjStr || !boundStr) return null;
      const subj = parseDate(subjStr);
      const bound = parseDate(boundStr);
      if (!subj || !bound) return null;
      if (subj <= bound) return null;
      const msg = typeof opts.message === 'function' ? opts.message(subjStr, boundStr) : opts.message;
      return [{ ruleId: opts.ruleId, code: opts.code, severity: opts.severity, message: msg, fieldPath: opts.fieldPath, ediSegment: opts.ediSegment, suggestedFix: opts.suggestedFix, packId: opts.packId }];
    },
  };
}

export function afterOrEqual(opts: DateBoundaryOpts): Rule {
  return {
    id: opts.ruleId,
    code: opts.code,
    severity: opts.severity,
    description: opts.description,
    ediSegment: opts.ediSegment,
    appliesWhen: opts.appliesWhen,
    check(ctx: RuleContext): Violation[] | null {
      const subjStr = opts.getSubjectDate(ctx);
      const boundStr = opts.getBoundaryDate(ctx);
      if (!subjStr || !boundStr) return null;
      const subj = parseDate(subjStr);
      const bound = parseDate(boundStr);
      if (!subj || !bound) return null;
      if (subj >= bound) return null;
      const msg = typeof opts.message === 'function' ? opts.message(subjStr, boundStr) : opts.message;
      return [{ ruleId: opts.ruleId, code: opts.code, severity: opts.severity, message: msg, fieldPath: opts.fieldPath, ediSegment: opts.ediSegment, suggestedFix: opts.suggestedFix, packId: opts.packId }];
    },
  };
}

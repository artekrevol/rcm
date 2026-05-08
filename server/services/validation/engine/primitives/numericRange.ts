import type { Rule, RuleContext, Violation, Severity } from '../types.js';

interface RangeOpts {
  ruleId: string;
  code: string;
  severity: Severity;
  description: string;
  fieldPath: string | ((ctx: RuleContext, index?: number) => string);
  getValues: (ctx: RuleContext) => Array<{ value: number; index?: number }>;
  min?: number;
  max?: number;
  message: string | ((value: number, index?: number) => string);
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
}

export function inRange(opts: RangeOpts): Rule {
  return {
    id: opts.ruleId,
    code: opts.code,
    severity: opts.severity,
    description: opts.description,
    ediSegment: opts.ediSegment,
    appliesWhen: opts.appliesWhen,
    check(ctx: RuleContext): Violation[] | null {
      const items = opts.getValues(ctx);
      const violations: Violation[] = [];
      for (const { value, index } of items) {
        const belowMin = opts.min !== undefined && value < opts.min;
        const aboveMax = opts.max !== undefined && value > opts.max;
        if (belowMin || aboveMax) {
          const fp = typeof opts.fieldPath === 'function' ? opts.fieldPath(ctx, index) : opts.fieldPath;
          const msg = typeof opts.message === 'function' ? opts.message(value, index) : opts.message;
          violations.push({ ruleId: opts.ruleId, code: opts.code, severity: opts.severity, message: msg, fieldPath: fp, ediSegment: opts.ediSegment, suggestedFix: opts.suggestedFix, packId: opts.packId });
        }
      }
      return violations.length ? violations : null;
    },
  };
}

export function greaterThan(opts: Omit<RangeOpts, 'max'>): Rule {
  return inRange({ ...opts, min: opts.min ?? 0 });
}

export function lessThan(opts: Omit<RangeOpts, 'min'>): Rule {
  return inRange({ ...opts, max: opts.max });
}

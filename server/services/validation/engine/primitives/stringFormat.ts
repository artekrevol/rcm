import type { Rule, RuleContext, Violation, Severity } from '../types.js';

interface MatchesRegexOpts {
  ruleId: string;
  code: string;
  severity: Severity;
  description: string;
  fieldPath: string | ((ctx: RuleContext) => string);
  getValue: (ctx: RuleContext) => string | null | undefined;
  regex: RegExp;
  message: string | ((value: string) => string);
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
}

export function matchesRegex(opts: MatchesRegexOpts): Rule {
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
      if (opts.regex.test(value)) return null;
      const fieldPath = typeof opts.fieldPath === 'function' ? opts.fieldPath(ctx) : opts.fieldPath;
      const message = typeof opts.message === 'function' ? opts.message(value) : opts.message;
      return [{
        ruleId: opts.ruleId,
        code: opts.code,
        severity: opts.severity,
        message,
        fieldPath,
        ediSegment: opts.ediSegment,
        suggestedFix: opts.suggestedFix,
        packId: opts.packId,
      }];
    },
  };
}

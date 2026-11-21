import {
  AuditIssue,
  DirectoryPrepStep1C,
  OperationMentorGuide1C,
  OsvAuditorHint,
  Step01CalculationBreakdown1C,
} from '@/types/accounting';

/**
 * Invariant 6: Centralized copy & formatting hygiene for all generated 1C:BP 3.0
 * explanations, audit diagnostics, provenance traces, and OSV hints.
 * Eliminates double punctuation ("..", ".;", ", ,", ". ."), empty brackets/quotes,
 * unresolved placeholders ("undefined", "null", "{{...}}"), and contradictory spatial directions.
 */
export function sanitizeGeneratedText1C(raw: string | undefined | null): string {
  if (!raw) return '';

  let s = String(raw);

  // 1. Remove unresolved JS/template placeholders
  s = s
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\b(?:undefined|NaN)\b/g, '')
    .replace(/\(\s*null\s*\)/gi, '');

  // 2. Eliminate contradictory or brittle spatial references in generated hints
  s = s
    .replace(/ниже\s*\/\s*справа/gi, 'в блоке реквизитов')
    .replace(/справа\s*\/\s*ниже/gi, 'в блоке реквизитов')
    .replace(/в\s+поле\s+ниже\s+или\s+справа/gi, 'в поле ввода реквизита')
    .replace(/в\s+поле\s+ниже/gi, 'в поле ввода')
    .replace(/в\s+карточке\s+ниже/gi, 'в карточке операции')
    .replace(/кнопку\s+автоформирования\s+закрытия\s+ниже/gi, 'кнопку автоформирования закрытия периода');

  // 3. Remove empty parens / empty quotes left over when optional tokens are blank
  s = s
    .replace(/\(\s*[,;·/-]*\s*\)/g, '')
    .replace(/«\s*»/g, '')
    .replace(/"\s*"/g, '');

  // 4. Normalize whitespace (preserve intentional newlines in multi-line logs if any)
  s = s
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\s+([.,;:!?»)])/g, '$1')
    .replace(/([«(])\s+/g, '$1');

  // 5. Collapse duplicate / colliding punctuation without breaking ellipsis ("...")
  // Preserve real three-dot ellipsis temporarily
  s = s.replace(/\.{3,}/g, '…');
  s = s
    .replace(/\.\s*;/g, ';')
    .replace(/;\s*\./g, '.')
    .replace(/,\s*,+/g, ',')
    .replace(/;\s*;+/g, ';')
    .replace(/:\s*\.+/g, ':')
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*,/g, ',')
    .replace(/\.{2,}/g, '.')
    .replace(/\.\s+\./g, '.')
    .replace(/·\s*·+/g, '·')
    .replace(/^[\s·,;:-]+/, '')
    .replace(/[\s·,]+$/, '');

  s = s.replace(/…/g, '...');

  return s.trim();
}

export function sanitizeBreakdown1C(
  breakdown: Step01CalculationBreakdown1C | undefined
): Step01CalculationBreakdown1C | undefined {
  if (!breakdown) return undefined;
  return {
    ...breakdown,
    resolverLevelName: sanitizeGeneratedText1C(breakdown.resolverLevelName),
    summaryFormula: sanitizeGeneratedText1C(breakdown.summaryFormula),
    steps: breakdown.steps.map((st) => sanitizeGeneratedText1C(st)).filter(Boolean),
    sourceLinks: breakdown.sourceLinks.map((lnk) => ({
      ...lnk,
      label: sanitizeGeneratedText1C(lnk.label),
    })),
    checkedSourcesWhenMissing: breakdown.checkedSourcesWhenMissing
      ?.map((item) => sanitizeGeneratedText1C(item))
      .filter(Boolean),
  };
}

export function sanitizePrepSteps1C(
  steps: DirectoryPrepStep1C[] | undefined
): DirectoryPrepStep1C[] | undefined {
  if (!steps) return undefined;
  return steps.map((st) => ({
    ...st,
    entityLabel: sanitizeGeneratedText1C(st.entityLabel),
    entityName: sanitizeGeneratedText1C(st.entityName),
    originSummary: sanitizeGeneratedText1C(st.originSummary),
    menuPath1C: sanitizeGeneratedText1C(st.menuPath1C),
    fieldsToFill: st.fieldsToFill
      .map((f) => ({
        field: sanitizeGeneratedText1C(f.field),
        value: sanitizeGeneratedText1C(f.value),
      }))
      .filter((f) => f.field && f.value),
    formalAutoFillNote: st.formalAutoFillNote
      ? sanitizeGeneratedText1C(st.formalAutoFillNote)
      : undefined,
    note: st.note ? sanitizeGeneratedText1C(st.note) : undefined,
  }));
}

export function sanitizeMentorGuide1C(guide: OperationMentorGuide1C): OperationMentorGuide1C {
  const cleanPrep = sanitizePrepSteps1C(guide.step00Prep ?? guide.directoryPrepSteps);
  return {
    accountingMeaning: sanitizeGeneratedText1C(guide.accountingMeaning),
    whyAmountOrVatRule: sanitizeGeneratedText1C(guide.whyAmountOrVatRule),
    navigationPath1C: sanitizeGeneratedText1C(guide.navigationPath1C),
    documentOperationKind1C: sanitizeGeneratedText1C(guide.documentOperationKind1C),
    directoryPrepSteps: cleanPrep,
    step00Prep: cleanPrep,
    step01CalculationBreakdown: sanitizeBreakdown1C(guide.step01CalculationBreakdown),
    step02AccountingLogic: guide.step02AccountingLogic
      ? {
          plainExplanation: sanitizeGeneratedText1C(guide.step02AccountingLogic.plainExplanation),
          regulatoryNorms: guide.step02AccountingLogic.regulatoryNorms
            .map((r) => sanitizeGeneratedText1C(r))
            .filter(Boolean),
          subcontoArchitecture: sanitizeGeneratedText1C(
            guide.step02AccountingLogic.subcontoArchitecture
          ),
        }
      : undefined,
    headerFieldsSteps: guide.headerFieldsSteps
      .map((h) => ({
        field: sanitizeGeneratedText1C(h.field),
        value: sanitizeGeneratedText1C(h.value),
        hint: h.hint ? sanitizeGeneratedText1C(h.hint) : undefined,
      }))
      .filter((h) => h.field),
    tabularAndTabsSteps: guide.tabularAndTabsSteps
      .map((t) => ({
        tabName: sanitizeGeneratedText1C(t.tabName),
        instruction: sanitizeGeneratedText1C(t.instruction),
      }))
      .filter((t) => t.tabName && t.instruction),
    referencePostings: guide.referencePostings.map((p) => ({
      ...p,
      debit: p.debit.trim(),
      credit: p.credit.trim(),
      amountRule: sanitizeGeneratedText1C(p.amountRule),
      purpose: sanitizeGeneratedText1C(p.purpose),
    })),
    selfCheckOsv: guide.selfCheckOsv.map((s) => sanitizeGeneratedText1C(s)).filter(Boolean),
    commonStudentMistakes: guide.commonStudentMistakes
      .map((m) => sanitizeGeneratedText1C(m))
      .filter(Boolean),
  };
}

export function sanitizeAuditIssue1C(issue: AuditIssue): AuditIssue {
  return {
    ...issue,
    title: sanitizeGeneratedText1C(issue.title),
    description: sanitizeGeneratedText1C(issue.description),
    accountingReason: sanitizeGeneratedText1C(issue.accountingReason),
    quickFixLabel: issue.quickFixLabel ? sanitizeGeneratedText1C(issue.quickFixLabel) : undefined,
    autoFixActionLabel: issue.autoFixActionLabel
      ? sanitizeGeneratedText1C(issue.autoFixActionLabel)
      : undefined,
    inlineTarget: issue.inlineTarget
      ? {
          ...issue.inlineTarget,
          label: sanitizeGeneratedText1C(issue.inlineTarget.label),
          placeholder: sanitizeGeneratedText1C(issue.inlineTarget.placeholder),
        }
      : undefined,
    guide1C: issue.guide1C
      ? {
          menuPath: sanitizeGeneratedText1C(issue.guide1C.menuPath),
          documentKind: sanitizeGeneratedText1C(issue.guide1C.documentKind),
          checkPoints: issue.guide1C.checkPoints
            .map((c) => sanitizeGeneratedText1C(c))
            .filter(Boolean),
          repostInstruction: sanitizeGeneratedText1C(issue.guide1C.repostInstruction),
          verifyInOsv: sanitizeGeneratedText1C(issue.guide1C.verifyInOsv),
        }
      : undefined,
  };
}

export function sanitizeAuditorHint1C(hint: OsvAuditorHint): OsvAuditorHint {
  return {
    ...hint,
    title: sanitizeGeneratedText1C(hint.title),
    explanation: sanitizeGeneratedText1C(hint.explanation),
    howToFix1C: sanitizeGeneratedText1C(hint.howToFix1C),
    quickActionLabel: hint.quickActionLabel
      ? sanitizeGeneratedText1C(hint.quickActionLabel)
      : undefined,
  };
}

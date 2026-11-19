import {
  BusinessOperation,
  DocumentField1C,
  JournalPosting,
  OpeningBalanceEntry,
  OrganizationCard,
  PitfallWarning,
  SmartLinkRule,
  VatMathBreakdown,
} from '@/types/accounting';
import { getAccountInfo } from '@/data/chartOfAccounts';

/**
 * Rounds monetary amounts strictly to kopecks (2 decimal places),
 * preventing IEEE-754 floating-point drift such as 0.00000001 or -0.
 */
export function roundMoney(val: number): number {
  if (!Number.isFinite(val) || val === 0) return 0;
  const sign = val < 0 ? -1 : 1;
  const rounded = (sign * Math.round((Math.abs(val) + Number.EPSILON) * 100)) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Formats a ruble amount cleanly in Russian accounting notation (e.g. "1 236 900 ₽" or "15 611,70 ₽").
 * Uses standard ASCII spaces so string comparisons and copy-paste work reliably everywhere.
 */
export function formatMoneyRu(
  val: number,
  options?: { alwaysDecimals?: boolean; withCurrency?: boolean }
): string {
  const clean = roundMoney(val);
  const sign = clean < 0 ? '−' : '';
  const abs = Math.abs(clean);
  const hasKopecks = Math.abs(abs - Math.round(abs)) >= 0.005;
  const showDecimals = options?.alwaysDecimals || hasKopecks;
  const withCurrency = options?.withCurrency ?? true;

  const fixed = showDecimals ? abs.toFixed(2) : Math.round(abs).toString();
  const [intPart, decPart] = fixed.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const numberStr = decPart !== undefined ? `${formattedInt},${decPart}` : formattedInt;
  return `${sign}${numberStr}${withCurrency ? ' ₽' : ''}`;
}

const RU_MONTHS: Record<string, number> = {
  янв: 1,
  фев: 2,
  мар: 3,
  апр: 4,
  мая: 5,
  май: 5,
  июн: 6,
  июл: 7,
  авг: 8,
  сен: 9,
  окт: 10,
  ноя: 11,
  дек: 12,
};

/**
 * Parses ISO ("2026-04-03"), Russian ("03.04.2026", "03.04"), or verbal ("3 апр", "15 апр.") dates
 * into a numeric YYYYMMDD integer for deterministic chronological sorting.
 */
export function parseDateToSortKey(dateStr: string, fallbackYear = 2026): number {
  if (!dateStr) return fallbackYear * 10000 + 101;
  const trimmed = dateStr.trim();

  // YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    return y * 10000 + m * 100 + d;
  }

  // DD.MM.YYYY or DD.MM.YY or DD.MM
  const dotMatch = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(trimmed);
  if (dotMatch) {
    const d = Number(dotMatch[1]);
    const m = Number(dotMatch[2]);
    let y = dotMatch[3] ? Number(dotMatch[3]) : fallbackYear;
    if (y < 100) y += 2000;
    return y * 10000 + m * 100 + d;
  }

  // "3 апр" / "15 апр. 2026" / "03 апреля"
  const verbalMatch = /(\d{1,2})\s+([а-яё]{3,})/i.exec(trimmed);
  if (verbalMatch) {
    const d = Number(verbalMatch[1]);
    const monthPrefix = verbalMatch[2].slice(0, 3).toLowerCase();
    const m = RU_MONTHS[monthPrefix] || 4;
    const yearMatch = /(\d{4})/.exec(trimmed);
    const y = yearMatch ? Number(yearMatch[1]) : fallbackYear;
    return y * 10000 + m * 100 + d;
  }

  return fallbackYear * 10000 + 101;
}

/**
 * Formats ISO, dot, or verbal date into readable DD.MM.YYYY Russian format.
 */
export function formatDateRu(dateStr: string, fallbackYear = 2026): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`;
  }
  const shortDotMatch = /^(\d{1,2})\.(\d{1,2})$/.exec(trimmed);
  if (shortDotMatch) {
    const d = shortDotMatch[1].padStart(2, '0');
    const m = shortDotMatch[2].padStart(2, '0');
    return `${d}.${m}.${fallbackYear}`;
  }
  const verbalMatch = /^(\d{1,2})\s+([а-яё]{3,})/i.exec(trimmed);
  if (verbalMatch) {
    const d = verbalMatch[1].padStart(2, '0');
    const mNum = RU_MONTHS[verbalMatch[2].slice(0, 3).toLowerCase()] || 4;
    const m = String(mNum).padStart(2, '0');
    return `${d}.${m}.${fallbackYear}`;
  }
  return trimmed;
}

function normalizeTextForMatch(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/\b(ооо|ао|пао|зао|оао|ип)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContractToken(contractStr?: string): string {
  if (!contractStr) return '';
  const cleaned = contractStr
    .trim()
    .replace(/^(?:договор[ауеом]?|дог\.?)\s*(?:№|n|#)?\s*/i, '')
    .replace(/\s+от\s+\d{1,2}[./]\d{1,2}[./]\d{2,4}.*$/i, '')
    .trim();
  return cleaned || contractStr.trim();
}

function containsContractToken(haystack: string, token: string): boolean {
  if (!haystack || !token) return false;
  const h = haystack.toLowerCase().replace(/ё/g, 'е');
  const t = token.toLowerCase().replace(/ё/g, 'е');
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Ensure numeric contract like "177" doesn't accidentally match "1770" or "2177"
  const boundaryRegex = new RegExp(`(^|[^0-9a-zа-я])${escaped}($|[^0-9a-zа-я])`, 'i');
  return boundaryRegex.test(h);
}

function splitSmartLinkAccountTokens(accountCode: string): string[] {
  return (accountCode || '')
    .split(/(?:[,+;/]|\s+и\s+|\s*&\s*)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Infers a SmartLinkRule from Russian operation text when `explicitAmount === null`
 * and no explicit `smartLink` rule was attached yet.
 */
export function inferSmartLinkFromDescription(rawDescription: string): SmartLinkRule | undefined {
  if (!rawDescription) return undefined;
  const text = rawDescription.toLowerCase().replace(/ё/g, 'е');

  // Support both "договору №177", "договору 177", and "дог.177" / "дог. 177"
  const contractMatch =
    /(?:договор[ауеом]?|дог\.?)\s*(?:№|n|#)?\s*([0-9a-zа-я/-]+)/i.exec(rawDescription);
  const matchContract = contractMatch ? contractMatch[1] : undefined;

  // Prefer entity after "в пользу ..." if present (e.g. writ of execution), else first legal entity
  const favorMatch =
    /в\s+пользу\s+((?:ООО|АО|ПАО|ЗАО|ОАО)\s*[«"]([^»"]+)[»"]|ИП\s+[А-ЯЁ][а-яё]+)/i.exec(
      rawDescription
    );
  const quotedEntityMatch =
    favorMatch ||
    /((?:ООО|АО|ПАО|ЗАО|ОАО)\s*[«"]([^»"]+)[»"]|ИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.)/i.exec(
      rawDescription
    );
  const matchSubconto1 = quotedEntityMatch ? quotedEntityMatch[1].trim() : undefined;

  // 1. Combined taxes + insurance contributions (e.g. "задолженности по налогам и взносам" -> 68 + 69!)
  if (
    /(задолженност|перечислен|уплачен)/i.test(text) &&
    /налог/i.test(text) &&
    /взнос/i.test(text)
  ) {
    return {
      accountCode: '68,69',
      side: 'credit',
      description:
        'Сумма кредитовых остатков по счетам 68 «Расчеты по налогам и сборам» и 69 «Страховые взносы» на начало периода',
    };
  }

  // 2. Specific tax & contribution debts (68 / 69)
  if (
    /(задолженност|недоимк|остат[ока]+).*(ндс|налог[ауом]*\s+на\s+добавленн)/i.test(text) ||
    /(перечислен|уплачен).*(ндс).*(прошл|предыдущ|квартал|бюджет)/i.test(text)
  ) {
    return {
      accountCode: '68.02',
      side: 'credit',
      description: 'Кредитовое сальдо счета 68.02 «Налог на добавленную стоимость» на начало периода',
    };
  }

  if (/(задолженност|перечислен|уплачен).*(ндфл|подоходн)/i.test(text)) {
    return {
      accountCode: '68.01',
      side: 'credit',
      description: 'Кредитовое сальдо счета 68.01 «НДФЛ» на начало периода',
    };
  }

  if (/(задолженност|перечислен|уплачен).*(налог[ау]*\s+на\s+прибыл)/i.test(text)) {
    return {
      accountCode: '68.04.1',
      side: 'credit',
      description: 'Кредитовое сальдо счета 68.04.1 «Налог на прибыль» на начало периода',
    };
  }

  if (
    /(задолженност|перечислен|уплачен).*(страхов[ымих]*\s+взнос|сфр|фсс|пфр|едином[у]*\s+тариф)/i.test(
      text
    )
  ) {
    return {
      accountCode: '69',
      side: 'credit',
      description: 'Кредитовое сальдо счета 69 «Страховые взносы» на начало периода',
    };
  }

  if (/(задолженност).*(по\s+налог|в\s+бюджет)/i.test(text)) {
    return {
      accountCode: '68',
      side: 'credit',
      description: 'Кредитовое сальдо счета 68 «Расчеты по налогам и сборам» на начало периода',
    };
  }

  // 3. Prior-month salary payout (70)
  if (
    /(выплачен|выдан|перечислен).*(зарплат|заработн[аяойую]+\s+плат|оплат[ау]\s+труда)/i.test(
      text
    ) ||
    /(задолженност).*(по\s+зарплат|по\s+оплате\s+труда|перед\s+персоналом)/i.test(text)
  ) {
    return {
      accountCode: '70',
      side: 'credit',
      description: 'Кредитовое сальдо счета 70 «Расчеты с персоналом по оплате труда» на начало периода',
    };
  }

  // 4. Bank write-off / payment of creditor debt (including writ of execution "списаны с р/сч ... в пользу ООО Сбыт в размере задолженности по дог.177")
  if (
    /(списан[ыао]?\s+с\s+(?:расчетного\s+счета|р\/сч?)|в\s+пользу|исполнительн[огому]+\s+лист)/i.test(
      text
    ) &&
    /(задолженност|долг|договор|дог\.)/i.test(text)
  ) {
    return {
      accountCode: '60.01',
      side: 'credit',
      matchSubconto1,
      matchContract,
      description: `Кредитовое сальдо счета 60.01${matchSubconto1 ? ` (${matchSubconto1})` : ''}${matchContract ? ` по договору №${matchContract}` : ''}`,
    };
  }

  if (
    /(списан[ао]?|погашен[ао]?|перечислен[ао]?|оплачен[ао]?).*(кредиторск|задолженност[ьи]\s+поставщик|задолженност[ьи]\s+подрядчик|долг\s+поставщик)/i.test(
      text
    )
  ) {
    return {
      accountCode: '60.01',
      side: 'credit',
      matchSubconto1,
      matchContract,
      description: `Кредитовое сальдо счета 60.01${matchSubconto1 ? ` (${matchSubconto1})` : ''}${matchContract ? ` по договору №${matchContract}` : ''}`,
    };
  }

  // 5. Accounts receivable write-off / repayment (62.01)
  if (
    /(списан[ао]?|погашен[ао]?|поступил[ао]?).*(дебиторск|задолженност[ьи]\s+покупател|задолженност[ьи]\s+заказчик)/i.test(
      text
    ) ||
    (/(списан[ао]?|погашен[ао]?).*(задолженност|долг)/i.test(text) &&
      !/кредиторск|поставщик|с\s+расчетного\s+счета/i.test(text) &&
      (matchContract || matchSubconto1))
  ) {
    return {
      accountCode: '62.01',
      side: 'debit',
      matchSubconto1,
      matchContract,
      description: `Дебетовое сальдо счета 62.01${matchSubconto1 ? ` (${matchSubconto1})` : ''}${matchContract ? ` по договору №${matchContract}` : ''}`,
    };
  }

  // 6. Receipt of goods/materials/services following an earlier 100% advance (e.g. Op 3 from Op 2 on 60.02!)
  if (
    /^(поступил[иоа]?|принят[ыоа]?|оприходован[ыоа]?)/i.test(text.trim()) &&
    matchSubconto1
  ) {
    return {
      accountCode: '60.02',
      side: 'debit',
      matchSubconto1,
      matchContract,
      description: `Сумма ранее перечисленного 100% аванса поставщику ${matchSubconto1} (счет 60.02)`,
    };
  }

  return undefined;
}

function matchOpeningBalanceAmount(
  rule: SmartLinkRule,
  openingBalances: OpeningBalanceEntry[]
): { matchedEntries: OpeningBalanceEntry[]; amount: number } {
  const tokens = splitSmartLinkAccountTokens(rule.accountCode);
  if (tokens.length === 0) {
    return { matchedEntries: [], amount: 0 };
  }

  // Match across one or multiple account prefixes (e.g. ["68", "69"])
  let candidates = openingBalances.filter((entry) =>
    tokens.some(
      (targetAcc) =>
        entry.accountCode === targetAcc || entry.accountCode.startsWith(`${targetAcc}.`)
    )
  );

  // Fallback for e.g. rule="69.09" when user entered "69" or "69.02.7", or rule="60.01" when user entered "60"
  if (candidates.length === 0) {
    const roots = tokens.map((t) => (t.includes('.') ? t.split('.')[0] : t));
    candidates = openingBalances.filter((entry) =>
      roots.some(
        (rootAcc) =>
          entry.accountCode === rootAcc ||
          ((rootAcc === '68' || rootAcc === '69') && entry.accountCode.startsWith(`${rootAcc}.`))
      )
    );
  }

  // Contract filter (strict when specified, e.g. contract "177")
  if (rule.matchContract) {
    const contractToken = extractContractToken(rule.matchContract);
    candidates = candidates.filter((entry) => {
      const combined = [entry.subconto2, entry.subconto3, entry.comment, entry.subconto1]
        .filter(Boolean)
        .join(' | ');
      return containsContractToken(combined, contractToken);
    });
  }

  // Subconto1 (Counterparty / Tax) filter
  if (rule.matchSubconto1 && candidates.length > 0) {
    const normTarget = normalizeTextForMatch(rule.matchSubconto1);
    const subcontoMatched = candidates.filter((entry) => {
      const s1 = normalizeTextForMatch(entry.subconto1);
      const comment = normalizeTextForMatch(entry.comment);
      return (
        (s1 && (s1.includes(normTarget) || normTarget.includes(s1))) ||
        (comment && comment.includes(normTarget))
      );
    });

    if (subcontoMatched.length > 0) {
      candidates = subcontoMatched;
    } else {
      const roots = tokens.map((t) => (t.includes('.') ? t.split('.')[0] : t));
      const isTaxOrSalary = roots.every((r) => r === '68' || r === '69' || r === '70');
      if (!isTaxOrSalary && !rule.matchContract) {
        candidates = [];
      }
    }
  }

  const amount = roundMoney(
    candidates.reduce((sum, entry) => {
      if (rule.side === 'debit') return sum + (entry.debit || 0);
      if (rule.side === 'credit') return sum + (entry.credit || 0);
      return sum + Math.abs((entry.debit || 0) - (entry.credit || 0));
    }, 0)
  );

  return { matchedEntries: candidates, amount };
}

/**
 * Resolves intra-period supplier/buyer advance from prior operations when `openingBalances` is 0
 * (e.g. Op 3 receipt of 133 window blocks resolved from Op 2's 100% advance of 1 236 900 ₽ on 60.02!).
 */
function matchPriorOperationAdvance(
  op: BusinessOperation,
  rule: SmartLinkRule | undefined,
  priorResolvedOps: BusinessOperation[]
): number {
  const targetAccount = rule?.accountCode?.trim() || '60.02';
  if (targetAccount !== '60.02' && targetAccount !== '62.02') {
    return 0;
  }

  const cpFromRule = normalizeTextForMatch(rule?.matchSubconto1);
  const cpFromField = normalizeTextForMatch(
    op.documentFields.find((f) => /^(контрагент|поставщик|покупатель)/i.test(f.label))?.value
  );
  const targetCp = cpFromRule || cpFromField;

  let netAdvance = 0;
  for (const prior of priorResolvedOps) {
    if (prior.status === 'needs_data') continue;
    for (const p of prior.postings) {
      if (targetAccount === '60.02') {
        const matchesCpDebit =
          !targetCp ||
          normalizeTextForMatch(p.debitSubconto[0]).includes(targetCp) ||
          normalizeTextForMatch(prior.rawDescription).includes(targetCp);
        const matchesCpCredit =
          !targetCp ||
          normalizeTextForMatch(p.creditSubconto[0]).includes(targetCp) ||
          normalizeTextForMatch(prior.rawDescription).includes(targetCp);

        if (p.debitAccount === '60.02' && matchesCpDebit) {
          netAdvance = roundMoney(netAdvance + p.amount);
        }
        if (p.creditAccount === '60.02' && matchesCpCredit) {
          netAdvance = roundMoney(netAdvance - p.amount);
        }
      } else if (targetAccount === '62.02') {
        const matchesCpCredit =
          !targetCp ||
          normalizeTextForMatch(p.creditSubconto[0]).includes(targetCp) ||
          normalizeTextForMatch(prior.rawDescription).includes(targetCp);
        const matchesCpDebit =
          !targetCp ||
          normalizeTextForMatch(p.debitSubconto[0]).includes(targetCp) ||
          normalizeTextForMatch(prior.rawDescription).includes(targetCp);

        if (p.creditAccount === '62.02' && matchesCpCredit) {
          netAdvance = roundMoney(netAdvance + p.amount);
        }
        if (p.debitAccount === '62.02' && matchesCpDebit) {
          netAdvance = roundMoney(netAdvance - p.amount);
        }
      }
    }
  }

  if (netAdvance > 0) {
    return netAdvance;
  }

  // Fallback if Op 2 had unitPrice & quantity matching Op 3
  if (op.vatBreakdown && op.vatBreakdown.quantity && op.vatBreakdown.unitPrice) {
    return roundMoney(op.vatBreakdown.quantity * op.vatBreakdown.unitPrice);
  }

  return 0;
}

function buildMissingBalanceMessage(rule: SmartLinkRule): string {
  const tokens = splitSmartLinkAccountTokens(rule.accountCode);
  const sideLabel =
    rule.side === 'debit'
      ? 'дебетовый остаток (Дт)'
      : rule.side === 'credit'
        ? 'кредитовый остаток (Кт)'
        : 'начальный остаток';
  const cleanContract = rule.matchContract ? extractContractToken(rule.matchContract) : '';

  if (tokens.length > 1) {
    return `Отсутствуют или равны нулю кредитовые остатки по счетам ${tokens.join(' и ')} (налоги и страховые взносы). Внесите входящую задолженность по счетам ${tokens.join(', ')} во вкладке «Начальные остатки».`;
  }

  if (rule.accountCode === '60.02') {
    return `Не найдена сумма предоплаты поставщику${rule.matchSubconto1 ? ` ${rule.matchSubconto1}` : ''} на счете 60.02 (проверьте предыдущую операцию перечисления аванса или начальный остаток 60.02).`;
  }

  const accInfo = getAccountInfo(rule.accountCode);
  if (cleanContract && rule.matchSubconto1) {
    return `Не заполнен ${sideLabel} по счету ${rule.accountCode} по контрагенту ${rule.matchSubconto1} (Договор №${cleanContract}). Внесите сумму во вкладке «Начальные остатки», чтобы автоматически рассчитать операцию.`;
  }
  if (cleanContract) {
    return `Не заполнен ${sideLabel} по счету ${rule.accountCode} «${accInfo.name}» по договору №${cleanContract}. Укажите остаток во вкладке «Начальные остатки».`;
  }
  if (rule.matchSubconto1) {
    return `Не заполнен ${sideLabel} по счету ${rule.accountCode} (${rule.matchSubconto1}). Заполните строку счета ${rule.accountCode} во вкладке «Начальные остатки».`;
  }
  return `Отсутствует или равен нулю ${sideLabel} по счету ${rule.accountCode} «${accInfo.name}». Введите сумму начального сальдо во вкладке «Начальные остатки» (Главное → Помощник ввода остатков).`;
}

function doesOperationExplicitlyOverrideVat(
  op: BusinessOperation,
  orgDefaultRate: number
): boolean {
  if (!op.vatBreakdown) return true;
  if (op.vatBreakdown.vatMode === 'none') return true;

  const text = op.rawDescription.toLowerCase();
  if (/без\s+ндс|ндс\s+не\s+облагается/i.test(text)) {
    return true;
  }

  if (
    op.vatBreakdown.vatRate === 10 &&
    orgDefaultRate >= 20 &&
    /\b10\s*%/.test(text)
  ) {
    return true;
  }

  return false;
}

function recalculateVatBreakdown(
  existing: VatMathBreakdown,
  targetTotalOrBase: number,
  effectiveRate: number,
  taxSystem: OrganizationCard['taxSystem']
): VatMathBreakdown {
  const isNoVat = effectiveRate <= 0 || (taxSystem !== 'OSNO' && effectiveRate <= 0);
  const cleanRate = Math.max(0, effectiveRate);

  if (isNoVat) {
    const total = roundMoney(targetTotalOrBase);
    const rateLabel =
      effectiveRate < 0 || taxSystem !== 'OSNO' ? 'Без НДС' : 'Ставка НДС 0%';
    const steps: string[] = [];
    if (existing.quantity && existing.unitPrice) {
      steps.push(
        `1. Стоимость партии: ${existing.quantity} ${existing.unit || 'шт.'} × ${formatMoneyRu(existing.unitPrice)} = ${formatMoneyRu(total)}`
      );
    }
    steps.push(
      `${steps.length + 1}. ${rateLabel}: сумма НДС = 0 ₽, сумма к отражению в учете = ${formatMoneyRu(total)}`
    );

    return {
      ...existing,
      totalWithVat: total,
      vatRate: 0,
      vatMode: effectiveRate < 0 || taxSystem !== 'OSNO' ? 'none' : existing.vatMode,
      vatAmount: 0,
      amountWithoutVat: total,
      steps,
    };
  }

  if (existing.vatMode === 'on_top') {
    const baseWithoutVat =
      existing.amountWithoutVat > 0
        ? roundMoney(existing.amountWithoutVat)
        : roundMoney(targetTotalOrBase);
    const vatAmount = roundMoney((baseWithoutVat * cleanRate) / 100);
    const totalWithVat = roundMoney(baseWithoutVat + vatAmount);
    const steps: string[] = [];
    if (existing.quantity && existing.unitPrice) {
      steps.push(
        `1. Сумма без НДС: ${existing.quantity} ${existing.unit || 'шт.'} × ${formatMoneyRu(existing.unitPrice)} = ${formatMoneyRu(baseWithoutVat)}`
      );
    } else {
      steps.push(`1. Налоговая база (без НДС): ${formatMoneyRu(baseWithoutVat)}`);
    }
    steps.push(
      `2. НДС сверху (${cleanRate}%): ${formatMoneyRu(baseWithoutVat)} × ${cleanRate}% = ${formatMoneyRu(vatAmount)}`
    );
    steps.push(
      `3. Итого с НДС: ${formatMoneyRu(baseWithoutVat)} + ${formatMoneyRu(vatAmount)} = ${formatMoneyRu(totalWithVat)}`
    );

    return {
      ...existing,
      totalWithVat,
      vatRate: cleanRate,
      vatAmount,
      amountWithoutVat: baseWithoutVat,
      steps,
    };
  }

  const totalWithVat = roundMoney(targetTotalOrBase);
  const vatAmount = roundMoney((totalWithVat * cleanRate) / (100 + cleanRate));
  const amountWithoutVat = roundMoney(totalWithVat - vatAmount);

  const steps: string[] = [];
  if (existing.quantity && existing.unitPrice) {
    steps.push(
      `1. Общая сумма с НДС: ${existing.quantity} ${existing.unit || 'шт.'} × ${formatMoneyRu(existing.unitPrice)} = ${formatMoneyRu(totalWithVat)}`
    );
  } else {
    steps.push(`1. Общая сумма документа (в т.ч. НДС ${cleanRate}%): ${formatMoneyRu(totalWithVat)}`);
  }
  steps.push(
    `2. Выделяем НДС по расчетной ставке ${cleanRate}/${100 + cleanRate}: ${formatMoneyRu(totalWithVat)} × ${cleanRate} / ${100 + cleanRate} = ${formatMoneyRu(vatAmount)}`
  );
  steps.push(
    `3. Стоимость без НДС (база для счета учета затрат/ТМЦ/выручки): ${formatMoneyRu(totalWithVat)} − ${formatMoneyRu(vatAmount)} = ${formatMoneyRu(amountWithoutVat)}`
  );

  return {
    ...existing,
    totalWithVat,
    vatRate: cleanRate,
    vatAmount,
    amountWithoutVat,
    steps,
  };
}

function inferPostingProportion(
  posting: JournalPosting,
  hasVatBreakdown: boolean
): 'full' | 'net_without_vat' | 'vat_only' | 'custom' {
  if (posting.proportionOfTotal) {
    return posting.proportionOfTotal;
  }

  const d = posting.debitAccount;
  const c = posting.creditAccount;

  if (d.startsWith('19') || c.startsWith('19') || d === '90.03') {
    return 'vat_only';
  }

  if (hasVatBreakdown) {
    if (d.startsWith('90.02') && (c.startsWith('41') || c.startsWith('43'))) {
      return 'custom';
    }
    if (
      c.startsWith('60') &&
      (d.startsWith('41') ||
        d.startsWith('10') ||
        d.startsWith('20') ||
        d.startsWith('25') ||
        d.startsWith('26') ||
        d.startsWith('44') ||
        d.startsWith('08'))
    ) {
      return 'net_without_vat';
    }
    if (
      (d === '60.01' && c === '60.02') ||
      (d === '62.02' && c === '62.01') ||
      (d.startsWith('62') && c.startsWith('90.01'))
    ) {
      return 'full';
    }
  }

  return 'full';
}

/**
 * Builds synchronized per-subaccount tax/contribution payment postings when an operation
 * pays multiple opening tax/contribution debts (`68.*` + `69.*` -> `Кт 51`).
 */
function syncMultiTaxPostingsFromBalances(
  existingPostings: JournalPosting[],
  matchedEntries: OpeningBalanceEntry[],
  isNeedsData: boolean
): JournalPosting[] {
  if (isNeedsData) {
    return existingPostings.map((p) => ({
      ...p,
      debitSubconto: [...p.debitSubconto],
      creditSubconto: [...p.creditSubconto],
      amount: 0,
    }));
  }

  const creditByAccount = new Map<string, { amount: number; subconto1?: string }>();
  for (const entry of matchedEntries) {
    const cr = roundMoney(entry.credit || 0);
    if (cr <= 0) continue;
    const prev = creditByAccount.get(entry.accountCode);
    creditByAccount.set(entry.accountCode, {
      amount: roundMoney((prev?.amount || 0) + cr),
      subconto1: prev?.subconto1 || entry.subconto1,
    });
  }

  const handledAccounts = new Set<string>();
  const updated: JournalPosting[] = [];

  for (const p of existingPostings) {
    const found = creditByAccount.get(p.debitAccount);
    if (found && !handledAccounts.has(p.debitAccount)) {
      handledAccounts.add(p.debitAccount);
      updated.push({
        ...p,
        debitSubconto: [...p.debitSubconto],
        creditSubconto: [...p.creditSubconto],
        amount: found.amount,
      });
    } else if (
      (p.debitAccount.startsWith('68') || p.debitAccount.startsWith('69')) &&
      p.creditAccount === '51'
    ) {
      // Zero out if user removed/zeroed this specific tax subaccount in Opening Balances
      handledAccounts.add(p.debitAccount);
    } else {
      updated.push({
        ...p,
        debitSubconto: [...p.debitSubconto],
        creditSubconto: [...p.creditSubconto],
      });
    }
  }

  // Append postings for any additional 68.* / 69.* opening balance rows added by the user
  let extraIdx = 0;
  for (const [accCode, info] of Array.from(creditByAccount.entries())) {
    if (!handledAccounts.has(accCode) && info.amount > 0) {
      extraIdx += 1;
      const accInfo = getAccountInfo(accCode);
      const bankSubconto = existingPostings[0]?.creditSubconto?.length
        ? [...existingPostings[0].creditSubconto]
        : ['Основной банковский счет', 'Уплата налогов и взносов'];
      updated.push({
        id: `tax-auto-${accCode}-${extraIdx}`,
        debitAccount: accCode,
        debitSubconto: [info.subconto1 || 'Налог (взносы): начислено / уплачено'],
        creditAccount: '51',
        creditSubconto: bankSubconto,
        amount: info.amount,
        comment: `Перечислена задолженность в бюджет: ${accInfo.name} (Кт ${accCode})`,
        formulaHint: `Входящее сальдо Кт ${accCode} = ${formatMoneyRu(info.amount, { alwaysDecimals: true })}`,
        proportionOfTotal: 'custom',
      });
    }
  }

  return updated;
}

function updatePostingsAmounts(
  postings: JournalPosting[],
  smartBaseAmount: number,
  vatBreakdown: VatMathBreakdown | undefined,
  forceZeroAll: boolean,
  runningCashBeforeOp?: number,
  effectiveSmartLink?: SmartLinkRule
): JournalPosting[] {
  if (forceZeroAll) {
    return postings.map((p) => ({
      ...p,
      debitSubconto: [...p.debitSubconto],
      creditSubconto: [...p.creditSubconto],
      amount: 0,
    }));
  }

  if (postings.length === 0) {
    return [];
  }

  if (postings.length === 1 && (!vatBreakdown || vatBreakdown.vatMode === 'none')) {
    return [
      {
        ...postings[0],
        debitSubconto: [...postings[0].debitSubconto],
        creditSubconto: [...postings[0].creditSubconto],
        amount: roundMoney(smartBaseAmount),
      },
    ];
  }

  // Special check: paired cash withdrawal (Дт 50.01 Кт 51) + cash salary payout (Дт 70 Кт 50.01) inside one operation
  const hasCashWithdrawalAndSalary =
    postings.length === 2 &&
    postings.some((p) => p.debitAccount === '50.01' && p.creditAccount === '51') &&
    postings.some((p) => p.debitAccount === '70' && p.creditAccount === '50.01');

  if (hasCashWithdrawalAndSalary) {
    const oldSalary = postings.find((p) => p.debitAccount === '70')?.amount ?? 0;
    const oldWithdraw = postings.find((p) => p.debitAccount === '50.01')?.amount ?? 0;
    const wasFullWithdrawal = Math.abs(oldWithdraw - oldSalary) < 0.01 && oldSalary > 0;

    return postings.map((p) => {
      const cloned: JournalPosting = {
        ...p,
        debitSubconto: [...p.debitSubconto],
        creditSubconto: [...p.creditSubconto],
      };
      if (cloned.debitAccount === '70' && cloned.creditAccount === '50.01') {
        cloned.amount = roundMoney(smartBaseAmount);
      } else if (cloned.debitAccount === '50.01' && cloned.creditAccount === '51') {
        if (wasFullWithdrawal || cloned.proportionOfTotal === 'full') {
          cloned.amount = roundMoney(smartBaseAmount);
        } else {
          const cashAvail = Math.max(0, runningCashBeforeOp ?? 0);
          cloned.amount = roundMoney(Math.max(0, smartBaseAmount - cashAvail));
        }
      }
      return cloned;
    });
  }

  return postings.map((p) => {
    const cloned: JournalPosting = {
      ...p,
      debitSubconto: [...p.debitSubconto],
      creditSubconto: [...p.creditSubconto],
    };

    const proportion = inferPostingProportion(
      cloned,
      Boolean(vatBreakdown && vatBreakdown.vatMode !== 'none')
    );

    // If a hybrid operation (like writ of execution Op 4) tagged its principal settlement posting
    // as 'custom' (`Дт 60.01 Кт 51`), keep it dynamically synced with the smart-linked balance!
    const isSmartPrincipalSettlement =
      Boolean(effectiveSmartLink) &&
      !vatBreakdown &&
      ((effectiveSmartLink!.side === 'credit' &&
        cloned.debitAccount === effectiveSmartLink!.accountCode) ||
        (effectiveSmartLink!.side === 'debit' &&
          cloned.creditAccount === effectiveSmartLink!.accountCode));

    if (isSmartPrincipalSettlement) {
      cloned.amount = roundMoney(smartBaseAmount);
      return cloned;
    }

    if (proportion === 'custom') {
      return cloned;
    }

    if (vatBreakdown) {
      if (proportion === 'full') {
        cloned.amount = roundMoney(vatBreakdown.totalWithVat);
      } else if (proportion === 'net_without_vat') {
        cloned.amount = roundMoney(vatBreakdown.amountWithoutVat);
      } else if (proportion === 'vat_only') {
        cloned.amount = roundMoney(vatBreakdown.vatAmount);
      }
    } else if (proportion === 'full') {
      cloned.amount = roundMoney(smartBaseAmount);
    }

    return cloned;
  });
}

function updateDocumentFieldsForOperation(
  fields: DocumentField1C[],
  resolvedAmount: number,
  isSmartLinked: boolean,
  isNeedsData: boolean,
  studentName: string
): DocumentField1C[] {
  const cleanStudent = (studentName || '').trim();
  return fields.map((field) => {
    const cloned = { ...field };
    if (cleanStudent && /фио\s+студента/i.test(cloned.value)) {
      cloned.value = cloned.value.replace(/\(?\s*фио\s+студента\s*\)?/gi, cleanStudent).trim();
    }
    if (
      isSmartLinked &&
      /^(сумма|сумма\s+платежа|сумма\s+выплаты|сумма\s+выдачи|сумма\s+списания|к\s+выплате|итого|общая\s+сумма)/i.test(
        cloned.label.trim()
      )
    ) {
      cloned.value = isNeedsData
        ? 'Требуется начальный остаток'
        : formatMoneyRu(resolvedAmount, { alwaysDecimals: true });
    }
    return cloned;
  });
}

function upsertPitfallByCheckType(
  pitfalls: PitfallWarning[],
  warning: PitfallWarning
): PitfallWarning[] {
  if (!warning.checkType || warning.checkType === 'general') {
    return [...pitfalls, warning];
  }
  const idx = pitfalls.findIndex((p) => p.checkType === warning.checkType);
  if (idx === -1) {
    if (warning.severity === 'critical' || warning.severity === 'warning') {
      return [warning, ...pitfalls];
    }
    return [...pitfalls, warning];
  }
  const next = [...pitfalls];
  next[idx] = warning;
  return next;
}

/**
 * Runs chronological live accounting control checks across resolved operations:
 * 1) Cash balance check on 50.01 before every Кт 50.01
 * 2) Bank account check on 51 before every Кт 51
 * 3) Supplier / Buyer advance availability check on 60.02 & 62.02 before advance offset
 */
export function enrichDynamicPitfalls(
  operations: BusinessOperation[],
  openingBalances: OpeningBalanceEntry[],
  fallbackYear = 2026
): BusinessOperation[] {
  const startCash50 = roundMoney(
    openingBalances
      .filter((b) => b.accountCode === '50.01' || b.accountCode === '50')
      .reduce((acc, b) => acc + (b.debit || 0) - (b.credit || 0), 0)
  );

  const startBank51 = roundMoney(
    openingBalances
      .filter((b) => b.accountCode === '51')
      .reduce((acc, b) => acc + (b.debit || 0) - (b.credit || 0), 0)
  );

  const startAdvSupplier60_02 = roundMoney(
    openingBalances
      .filter((b) => b.accountCode === '60.02')
      .reduce((acc, b) => acc + (b.debit || 0) - (b.credit || 0), 0)
  );

  const startAdvBuyer62_02 = roundMoney(
    openingBalances
      .filter((b) => b.accountCode === '62.02')
      .reduce((acc, b) => acc + (b.credit || 0) - (b.debit || 0), 0)
  );

  const indexed = operations.map((op, index) => ({
    op,
    index,
    sortKey: parseDateToSortKey(op.date, fallbackYear),
  }));
  indexed.sort((a, b) => (a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : a.index - b.index));

  let projCash = startCash50;
  let compCash = startCash50;
  const uncompletedCashInflows: { number: number | string; amount: number }[] = [];

  let projBank = startBank51;
  let compBank = startBank51;

  let projAdv60 = startAdvSupplier60_02;
  let compAdv60 = startAdvSupplier60_02;
  const uncompletedAdv60Ops: { number: number | string; amount: number }[] = [];

  let projAdv62 = startAdvBuyer62_02;
  let compAdv62 = startAdvBuyer62_02;

  const updatedByIndex = new Map<number, BusinessOperation>();

  for (const item of indexed) {
    const op = item.op;
    let pitfalls = op.pitfalls.map((p) => ({ ...p }));

    if (op.status !== 'needs_data' && op.postings.length > 0) {
      const debit50 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '50.01' || p.debitAccount === '50')
          .reduce((s, p) => s + p.amount, 0)
      );
      const credit50 = roundMoney(
        op.postings
          .filter((p) => p.creditAccount === '50.01' || p.creditAccount === '50')
          .reduce((s, p) => s + p.amount, 0)
      );

      const debit51 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '51')
          .reduce((s, p) => s + p.amount, 0)
      );
      const credit51 = roundMoney(
        op.postings
          .filter((p) => p.creditAccount === '51')
          .reduce((s, p) => s + p.amount, 0)
      );

      const debit60_02 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '60.02')
          .reduce((s, p) => s + p.amount, 0)
      );
      const credit60_02 = roundMoney(
        op.postings
          .filter((p) => p.creditAccount === '60.02')
          .reduce((s, p) => s + p.amount, 0)
      );
      const offset60_02 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '60.01' && p.creditAccount === '60.02')
          .reduce((s, p) => s + p.amount, 0)
      );

      const credit62_02 = roundMoney(
        op.postings
          .filter((p) => p.creditAccount === '62.02')
          .reduce((s, p) => s + p.amount, 0)
      );
      const debit62_02 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '62.02')
          .reduce((s, p) => s + p.amount, 0)
      );
      const offset62_02 = roundMoney(
        op.postings
          .filter((p) => p.debitAccount === '62.02' && p.creditAccount === '62.01')
          .reduce((s, p) => s + p.amount, 0)
      );

      // 1. Check Cash 50.01 before Кт 50.01
      if (credit50 > 0) {
        const projBefore = roundMoney(projCash + debit50);
        const projAfter = roundMoney(projBefore - credit50);
        const compBefore = roundMoney(compCash + (op.status === 'done' ? debit50 : 0));
        const compAfter = roundMoney(compBefore - credit50);

        if (projAfter < -0.005) {
          const shortage = roundMoney(Math.abs(projAfter));
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'critical',
            checkType: 'cash_balance',
            title: 'Критическая ошибка: отрицательный остаток кассы (счет 50.01)!',
            description: `Остаток по счету 50.01 перед выплатой составляет ${formatMoneyRu(projBefore)}, а требуется выдать ${formatMoneyRu(credit50)} — возникнет «краснота» ${formatMoneyRu(projAfter)}! Счет 50.01 активный: обязательно сначала оформите ПКО «Получение наличных в банке» (Дт 50.01 Кт 51) минимум на ${formatMoneyRu(shortage)} (без отдельного проведения Списания с р/сч, чтобы не задвоить проводку!).`,
          });
        } else if (debit50 > 0) {
          // Combined withdrawal + payout inside same operation (e.g. SPb Op 6)
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'warning',
            checkType: 'cash_balance',
            title: 'Контроль кассы 50.01: соблюдайте порядок документов (ПКО раньше РКО!)',
            description: `Входящий остаток кассы 50.01 был ${formatMoneyRu(projCash)}. С учетом снятия наличных с р/сч Дт 50.01 Кт 51 (${formatMoneyRu(debit50)}) в кассе становится ${formatMoneyRu(projBefore)}, после выдачи зарплаты ${formatMoneyRu(credit50)} остаток составит ${formatMoneyRu(projAfter)}. В 1С оформите ПКО «Получение наличных в банке» по времени раньше РКО «Выплата заработной платы»!`,
          });
        } else if (compAfter < -0.005 && op.status !== 'done') {
          const priorHint =
            uncompletedCashInflows.length > 0
              ? ` (операция №${uncompletedCashInflows[uncompletedCashInflows.length - 1].number} на ${formatMoneyRu(uncompletedCashInflows[uncompletedCashInflows.length - 1].amount)} еще не отмечена выполненной)`
              : '';
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'critical',
            checkType: 'cash_balance',
            title: 'Контроль кассы 50.01: сначала проведите снятие наличных с р/сч!',
            description: `Подтвержденный остаток в кассе сейчас ${formatMoneyRu(compBefore)}, а к выдаче ${formatMoneyRu(credit50)} — без предварительного прихода возникнет краснота ${formatMoneyRu(compAfter)}${priorHint}. Обязательно сначала проведите ПКО «Получение наличных в банке» (Дт 50.01 Кт 51), чтобы остаток стал ${formatMoneyRu(projBefore)} (после выплаты останется ${formatMoneyRu(projAfter)})!`,
          });
        } else {
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'info',
            checkType: 'cash_balance',
            title: 'Контроль остатка кассы 50.01 соблюден',
            description: `Остаток наличных на счете 50.01 перед выдачей: ${formatMoneyRu(projBefore)}. После списания ${formatMoneyRu(credit50)} остаток в кассе составит ${formatMoneyRu(projAfter)}. В 1С убедитесь, что время документа прихода (Дт 50.01 Кт 51) раньше времени выдачи (Кт 50.01)!`,
          });
        }
      }

      // 2. Check Bank 51 before Кт 51
      if (credit51 > 0) {
        const projBankBefore = roundMoney(projBank + debit51);
        const projBankAfter = roundMoney(projBankBefore - credit51);
        const compBankBefore = roundMoney(compBank + (op.status === 'done' ? debit51 : 0));
        const compBankAfter = roundMoney(compBankBefore - credit51);

        if (projBankAfter < -0.005) {
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'critical',
            checkType: 'bank_balance',
            title: 'Недостаточно средств на расчетном счете 51!',
            description: `Перед списанием ${formatMoneyRu(credit51)} доступный остаток на счете 51 составляет ${formatMoneyRu(projBankBefore)} (возникнет отрицательное сальдо ${formatMoneyRu(projBankAfter)}). Проверьте начальный остаток по счету 51 во вкладке «Начальные остатки» и поступления от покупателей.`,
          });
        } else if (compBankAfter < -0.005 && op.status !== 'done') {
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'warning',
            checkType: 'bank_balance',
            title: 'Контроль р/сч 51: требуется проведение предыдущих поступлений',
            description: `Текущий остаток по выполненным операциям на счете 51 (${formatMoneyRu(compBankBefore)}) меньше суммы платежа (${formatMoneyRu(credit51)}). После проведения предшествующих поступлений остаток составит ${formatMoneyRu(projBankBefore)} (после списания: ${formatMoneyRu(projBankAfter)}).`,
          });
        }
      }

      // 3. Check Supplier Advance 60.02 before Дт 60.01 Кт 60.02
      if (offset60_02 > 0) {
        const existingAdvPitfall = pitfalls.find((p) => p.checkType === 'advance_offset');
        if (projAdv60 < offset60_02 - 0.01) {
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'critical',
            checkType: 'advance_offset',
            title: 'Не хватает аванса на счете 60.02 для зачета!',
            description: `В операции зачитывается аванс поставщику (Дт 60.01 Кт 60.02) на сумму ${formatMoneyRu(offset60_02)}, но доступное дебетовое сальдо на счете 60.02 составляет только ${formatMoneyRu(projAdv60)}. Проверьте проведение предоплаты поставщику (Дт 60.02 Кт 51) или начальные остатки.`,
          });
        } else if (compAdv60 < offset60_02 - 0.01 && op.status !== 'done') {
          const priorAdvInfo =
            uncompletedAdv60Ops.length > 0
              ? ` (сначала проведите операцию №${uncompletedAdv60Ops[uncompletedAdv60Ops.length - 1].number} на сумму ${formatMoneyRu(uncompletedAdv60Ops[uncompletedAdv60Ops.length - 1].amount)})`
              : '';
          pitfalls = upsertPitfallByCheckType(pitfalls, {
            severity: 'warning',
            checkType: 'advance_offset',
            title:
              existingAdvPitfall?.title ||
              'Контроль зачета аванса 60.02 → 60.01: соблюдайте хронологию и договор!',
            description: `Для автоматического зачета аванса Дт 60.01 Кт 60.02 на сумму ${formatMoneyRu(offset60_02)} в 1С обязательно проведите списание с р/сч раньше документа поступления${priorAdvInfo} и выберите строго тот же элемент справочника «Договоры» (реквизит «Зачет авансов: Автоматически»).`,
          });
        }
      }

      // 4. Check Buyer Advance 62.02 before Дт 62.02 Кт 62.01
      if (offset62_02 > 0 && projAdv62 < offset62_02 - 0.01) {
        pitfalls = upsertPitfallByCheckType(pitfalls, {
          severity: 'critical',
          checkType: 'advance_offset',
          title: 'Не хватает полученного аванса на счете 62.02!',
          description: `Сумма зачета аванса покупателя (Дт 62.02 Кт 62.01: ${formatMoneyRu(offset62_02)}) превышает доступный остаток на счете 62.02 (${formatMoneyRu(projAdv62)}). Проверьте поступление предоплаты от покупателя (Дт 51 Кт 62.02) и совпадение договора.`,
        });
      }

      // Advance running trackers AFTER checking current operation
      projCash = roundMoney(projCash + debit50 - credit50);
      if (op.status === 'done') {
        compCash = roundMoney(compCash + debit50 - credit50);
      } else if (debit50 > 0) {
        uncompletedCashInflows.push({ number: op.number, amount: debit50 });
      }

      projBank = roundMoney(projBank + debit51 - credit51);
      if (op.status === 'done') {
        compBank = roundMoney(compBank + debit51 - credit51);
      }

      projAdv60 = roundMoney(projAdv60 + debit60_02 - credit60_02);
      if (op.status === 'done') {
        compAdv60 = roundMoney(compAdv60 + debit60_02 - credit60_02);
      } else if (debit60_02 > 0) {
        uncompletedAdv60Ops.push({ number: op.number, amount: debit60_02 });
      }

      projAdv62 = roundMoney(projAdv62 + credit62_02 - debit62_02);
      if (op.status === 'done') {
        compAdv62 = roundMoney(compAdv62 + credit62_02 - debit62_02);
      }
    }

    updatedByIndex.set(item.index, {
      ...op,
      pitfalls,
    });
  }

  return operations.map((op, index) => updatedByIndex.get(index) || op);
}

/**
 * Resolves smart opening-balance links (including multi-account 68+69 taxes, intra-period
 * 60.02 advances like Op 2 -> Op 3, hybrid principal + penalty operations like Op 4, and
 * HR hiring operations with 0 postings like Op 5), dynamically updates VAT calculations
 * when `organization.defaultVatRate` changes, and enriches live accounting pitfalls.
 */
export function resolveOperationsWithSmartLinks(
  operations: BusinessOperation[],
  openingBalances: OpeningBalanceEntry[],
  organization: OrganizationCard
): BusinessOperation[] {
  const periodYearMatch = /(\d{4})/.exec(organization.periodStartDate || '');
  const fallbackYear = periodYearMatch ? Number(periodYearMatch[1]) : 2026;
  const orgVatRate =
    typeof organization.defaultVatRate === 'number' ? organization.defaultVatRate : 20;

  // Process in chronological order so intra-period links (e.g. Op 2 advance -> Op 3 receipt) see prior ops
  const chronological = operations
    .map((op, index) => ({
      op,
      index,
      sortKey: parseDateToSortKey(op.date, fallbackYear),
    }))
    .sort((a, b) => (a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : a.index - b.index));

  const resolvedByIndex = new Map<number, BusinessOperation>();
  const priorResolved: BusinessOperation[] = [];

  let runningCash50 = roundMoney(
    openingBalances
      .filter((b) => b.accountCode === '50.01' || b.accountCode === '50')
      .reduce((acc, b) => acc + (b.debit || 0) - (b.credit || 0), 0)
  );

  for (const { op, index } of chronological) {
    const effectiveSmartLink =
      op.smartLink ||
      (op.explicitAmount === null ? inferSmartLinkFromDescription(op.rawDescription) : undefined);

    const isSmartLinked = Boolean(effectiveSmartLink || op.explicitAmount === null);
    let smartBaseAmount =
      op.explicitAmount !== null ? roundMoney(op.explicitAmount) : roundMoney(op.resolvedAmount);
    let resolvedAmount = smartBaseAmount;
    let status = op.status;
    let missingDataReason: string | undefined = undefined;
    let isNeedsData = false;
    let matchedOpeningEntries: OpeningBalanceEntry[] = [];

    if (isSmartLinked) {
      if (effectiveSmartLink) {
        const matchRes = matchOpeningBalanceAmount(effectiveSmartLink, openingBalances);
        matchedOpeningEntries = matchRes.matchedEntries;
        let matchedVal = matchRes.amount;

        // If opening balance is 0 and rule targets 60.02/62.02 (or receipt after 100% advance), check prior ops!
        if (matchedVal <= 0) {
          matchedVal = matchPriorOperationAdvance(op, effectiveSmartLink, priorResolved);
        }

        if (matchedVal > 0) {
          smartBaseAmount = matchedVal;
          resolvedAmount = matchedVal;
          missingDataReason = undefined;
          if (status === 'needs_data') {
            status = 'pending';
          }
        } else {
          smartBaseAmount = 0;
          resolvedAmount = 0;
          status = 'needs_data';
          isNeedsData = true;
          missingDataReason = buildMissingBalanceMessage(effectiveSmartLink);
        }
      } else {
        // explicitAmount === null without smartLink: try intra-period advance fallback before marking needs_data
        const priorAdv = matchPriorOperationAdvance(op, undefined, priorResolved);
        if (priorAdv > 0) {
          smartBaseAmount = priorAdv;
          resolvedAmount = priorAdv;
          if (status === 'needs_data') status = 'pending';
        } else {
          smartBaseAmount = 0;
          resolvedAmount = 0;
          status = 'needs_data';
          isNeedsData = true;
          missingDataReason =
            'Сумма операции не указана в условии задачи. Проверьте начальные остатки во вкладке «Начальные остатки» или уточните условие.';
        }
      }
    } else if (status === 'needs_data' && resolvedAmount > 0) {
      status = 'pending';
    }

    const baseAmountChanged =
      Math.abs(smartBaseAmount - roundMoney(op.resolvedAmount)) >= 0.005;

    // Determine whether VAT needs dynamic recalculation
    let nextVatBreakdown = op.vatBreakdown
      ? { ...op.vatBreakdown, steps: [...op.vatBreakdown.steps] }
      : undefined;

    let vatChanged = false;
    if (nextVatBreakdown && !isNeedsData) {
      const explicitOverride = doesOperationExplicitlyOverrideVat(op, orgVatRate);
      const targetVatRate = explicitOverride ? nextVatBreakdown.vatRate : orgVatRate;
      const currentComparableRate =
        nextVatBreakdown.vatMode === 'none' ? -1 : nextVatBreakdown.vatRate;
      const targetComparableRate =
        targetVatRate < 0 || (organization.taxSystem !== 'OSNO' && targetVatRate <= 0)
          ? -1
          : targetVatRate;

      if (
        currentComparableRate !== targetComparableRate ||
        baseAmountChanged ||
        Math.abs(nextVatBreakdown.totalWithVat - smartBaseAmount) >= 0.01
      ) {
        nextVatBreakdown = recalculateVatBreakdown(
          nextVatBreakdown,
          smartBaseAmount,
          targetVatRate,
          organization.taxSystem
        );
        if (nextVatBreakdown.vatMode === 'on_top' && op.explicitAmount !== null) {
          resolvedAmount = nextVatBreakdown.totalWithVat;
        }
        vatChanged = true;
      }
    } else if (nextVatBreakdown && isNeedsData) {
      nextVatBreakdown = {
        ...nextVatBreakdown,
        totalWithVat: 0,
        vatAmount: 0,
        amountWithoutVat: 0,
      };
      vatChanged = true;
    }

    // Check if this is a multi-account 68+69 tax payment operation
    const smartTokens = effectiveSmartLink
      ? splitSmartLinkAccountTokens(effectiveSmartLink.accountCode)
      : [];
    const isMultiTaxOp =
      smartTokens.length > 1 &&
      smartTokens.every((t) => t.startsWith('68') || t.startsWith('69'));

    let nextPostings: JournalPosting[];
    if (isMultiTaxOp) {
      nextPostings = syncMultiTaxPostingsFromBalances(
        op.postings,
        matchedOpeningEntries,
        isNeedsData
      );
    } else if (
      isNeedsData ||
      isSmartLinked ||
      baseAmountChanged ||
      vatChanged ||
      (op.postings.length > 0 &&
        op.postings.some((p) => p.amount === 0 && smartBaseAmount > 0))
    ) {
      nextPostings = updatePostingsAmounts(
        op.postings,
        smartBaseAmount,
        nextVatBreakdown,
        isNeedsData,
        runningCash50,
        effectiveSmartLink
      );
    } else {
      nextPostings = op.postings.map((p) => ({
        ...p,
        debitSubconto: [...p.debitSubconto],
        creditSubconto: [...p.creditSubconto],
      }));
    }

    // For hybrid smart-linked operations (like Op 4: contract 177 principal + fixed 3 000 + 5 000 penalties),
    // compute resolvedAmount cleanly so fixed penalties are reflected alongside the smart-linked principal!
    if (!isNeedsData && isSmartLinked && !nextVatBreakdown && nextPostings.length > 1) {
      const fixedPenaltyAccruals = roundMoney(
        nextPostings
          .filter(
            (p) =>
              p.proportionOfTotal === 'custom' &&
              (p.debitAccount === '91.02' || p.debitAccount === '99.02.3')
          )
          .reduce((s, p) => s + p.amount, 0)
      );
      if (fixedPenaltyAccruals > 0) {
        const bankPaid = roundMoney(
          nextPostings
            .filter((p) => p.creditAccount === '51')
            .reduce((s, p) => s + p.amount, 0)
        );
        resolvedAmount =
          bankPaid > smartBaseAmount
            ? bankPaid
            : roundMoney(smartBaseAmount + fixedPenaltyAccruals);
      }
    }

    const nextDocumentFields = updateDocumentFieldsForOperation(
      op.documentFields,
      resolvedAmount,
      isSmartLinked,
      isNeedsData,
      organization.studentName
    );

    if (!isNeedsData && nextPostings.length > 0) {
      const d50 = nextPostings
        .filter((p) => p.debitAccount === '50.01' || p.debitAccount === '50')
        .reduce((s, p) => s + p.amount, 0);
      const c50 = nextPostings
        .filter((p) => p.creditAccount === '50.01' || p.creditAccount === '50')
        .reduce((s, p) => s + p.amount, 0);
      runningCash50 = roundMoney(runningCash50 + d50 - c50);
    }

    const resolvedOp: BusinessOperation = {
      ...op,
      resolvedAmount,
      status,
      missingDataReason,
      smartLink: effectiveSmartLink ? { ...effectiveSmartLink } : op.smartLink,
      documentFields: nextDocumentFields,
      vatBreakdown: nextVatBreakdown,
      postings: nextPostings,
      pitfalls: op.pitfalls.map((p) => ({ ...p })),
    };

    resolvedByIndex.set(index, resolvedOp);
    priorResolved.push(resolvedOp);
  }

  const orderedList = operations.map((op, idx) => resolvedByIndex.get(idx) || op);
  return enrichDynamicPitfalls(orderedList, openingBalances, fallbackYear);
}

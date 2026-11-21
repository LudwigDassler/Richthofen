import * as XLSX from 'xlsx';
import {
  isLikely1CDatabaseExport,
  normalize1CDatabaseExport,
  normalizeAccountCode1C,
  normalizeDateISO,
  parseRussianNumber,
} from '@/lib/import1c/json1CSyncNormalizer';
import {
  attachVirtualStateStep00ToOperations,
  BatchSequentialContext,
  bindAndGenerateOperation,
  RawDraftOperationInput,
} from '@/lib/engine/postingEngine';
import {
  advanceVirtual1CStateWithOperation,
  createInitialVirtual1CState,
} from '@/lib/engine/virtual1CState';
import { resolveBankInfoByBik } from '@/lib/egrul/egrulLookup';
import {
  BatchImportCompletenessStats,
  Database1CSnapshot,
  DEFAULT_REPORTING_YEAR,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_CORR,
  DEFAULT_SBERBANK_NAME,
  QueuedOperation,
  SkippedExcelRowReason,
} from '@/types/accounting';

export interface BatchImportFileInput {
  name: string;
  buffer: ArrayBuffer;
}

export interface BatchImportOptions {
  reportingYear?: number;
  priorOperations?: QueuedOperation[];
}

export interface BatchImportResult {
  updatedDb1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  fileSummaries: Array<{
    fileName: string;
    kind: '1c_db_json' | 'operations';
    parsedCount: number;
    duplicatesCount: number;
    notes?: string;
  }>;
  completenessStats: BatchImportCompletenessStats;
  errors: string[];
}

export function decodeSmartText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (utf8.includes('\uFFFD') || /Кодировка\s*=\s*Windows/i.test(utf8)) {
    try {
      const win1251 = new TextDecoder('windows-1251', { fatal: false }).decode(bytes);
      if (/[А-Яа-яЁё]/.test(win1251)) {
        return win1251.replace(/^\uFEFF/, '');
      }
    } catch {
      // Fallback to utf8
    }
  }
  return utf8.replace(/^\uFEFF/, '');
}

const RU_MONTHS_MAP: Array<{ re: RegExp; month: number }> = [
  { re: /^янв/i, month: 1 },
  { re: /^фев/i, month: 2 },
  { re: /^мар/i, month: 3 },
  { re: /^апр/i, month: 4 },
  { re: /^ма[йя]/i, month: 5 },
  { re: /^июн/i, month: 6 },
  { re: /^июл/i, month: 7 },
  { re: /^авг/i, month: 8 },
  { re: /^сен/i, month: 9 },
  { re: /^окт/i, month: 10 },
  { re: /^ноя/i, month: 11 },
  { re: /^дек/i, month: 12 },
];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function buildSafeIsoDate(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const maxDaysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  const clampedDay = Math.min(day, maxDaysInMonth);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    clampedDay
  ).padStart(2, '0')}`;
}

/**
 * Strictly normalizes any Excel date (Date object, Excel serial number, "01.04.2020",
 * "2024-04-02", "02.04", "1 апр", "15 мая 2020 г.") into the target `reportingYear` (default 2026),
 * preserving day and month so stray 2020/2024 template years never leak into postings.
 */
export function normalizeOperationDateToReportingYear(
  raw: unknown,
  reportingYear: number = DEFAULT_REPORTING_YEAR
): string {
  const targetYear =
    reportingYear >= 1990 && reportingYear <= 2100 ? reportingYear : DEFAULT_REPORTING_YEAR;

  if (raw === null || raw === undefined) return '';

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // Shift by +4h if near UTC midnight previous day from local timezone offset
    const adjusted =
      raw.getUTCHours() >= 20 ? new Date(raw.getTime() + 4 * 3600 * 1000) : raw;
    return buildSafeIsoDate(
      targetYear,
      adjusted.getUTCMonth() + 1,
      adjusted.getUTCDate()
    );
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial date range (~1954 to ~2091)
    if (raw >= 20000 && raw <= 70000) {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed && parsed.m >= 1 && parsed.m <= 12 && parsed.d >= 1 && parsed.d <= 31) {
        return buildSafeIsoDate(targetYear, parsed.m, parsed.d);
      }
    }
    return '';
  }

  const s = String(raw).trim();
  if (!s) return '';

  // Pure numeric string representing Excel serial date
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (num >= 20000 && num <= 70000) {
      const parsed = XLSX.SSF.parse_date_code(num);
      if (parsed && parsed.m >= 1 && parsed.d >= 1) {
        return buildSafeIsoDate(targetYear, parsed.m, parsed.d);
      }
    }
  }

  // ISO YYYY-MM-DD (or YYYY/MM/DD)
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    return buildSafeIsoDate(targetYear, Number(isoMatch[2]), Number(isoMatch[3]));
  }

  // DD.MM.YYYY or DD/MM/YY
  const dmyMatch = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s*г\.?)?$/i);
  if (dmyMatch) {
    return buildSafeIsoDate(targetYear, Number(dmyMatch[2]), Number(dmyMatch[1]));
  }

  // DD.MM or D/M without year (e.g. "01.04", "2.04")
  const dmOnlyMatch = s.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (dmOnlyMatch) {
    const d = Number(dmOnlyMatch[1]);
    const m = Number(dmOnlyMatch[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return buildSafeIsoDate(targetYear, m, d);
    }
  }

  // Russian textual month: "1 апр", "02 апреля", "15 мая 2020 г.", "апр 1"
  const ruDayFirst = s.match(
    /^(\d{1,2})\s*[-.\s]?\s*([А-Яа-яЁё]{3,10})\.?(?:\s+\d{2,4}(?:\s*г\.?)?)?$/u
  );
  if (ruDayFirst) {
    const day = Number(ruDayFirst[1]);
    const word = ruDayFirst[2];
    const foundMonth = RU_MONTHS_MAP.find((m) => m.re.test(word));
    if (foundMonth) {
      return buildSafeIsoDate(targetYear, foundMonth.month, day);
    }
  }

  // US/Excel formatted M/D/YY from sheet_to_json string fallback if unambiguous or standard
  const fallbackIso = normalizeDateISO(s);
  if (fallbackIso) {
    const parts = fallbackIso.split('-');
    if (parts.length === 3) {
      return buildSafeIsoDate(targetYear, Number(parts[1]), Number(parts[2]));
    }
  }

  return '';
}

function inferDefaultMonthStartFromContext(
  sheetName: string,
  fileName: string,
  headerTexts: string[],
  reportingYear: number
): string {
  const combined = `${sheetName} ${fileName} ${headerTexts.join(' ')}`.toLowerCase();
  for (const item of RU_MONTHS_MAP) {
    const tokens = combined.match(/[а-яё]+/giu) ?? [];
    if (tokens.some((tok) => item.re.test(tok))) {
      return buildSafeIsoDate(reportingYear, item.month, 1);
    }
  }
  if (/1\s*кв|i\s*кв/i.test(combined)) return buildSafeIsoDate(reportingYear, 1, 1);
  if (/2\s*кв|ii\s*кв/i.test(combined)) return buildSafeIsoDate(reportingYear, 4, 1);
  if (/3\s*кв|iii\s*кв/i.test(combined)) return buildSafeIsoDate(reportingYear, 7, 1);
  if (/4\s*кв|iv\s*кв/i.test(combined)) return buildSafeIsoDate(reportingYear, 10, 1);
  return '';
}

export interface ExtractedFreeTextRequisites {
  inn: string;
  kpp: string;
  bankAccount: string;
  corrAccount: string;
  bik: string;
  bankName: string;
  counterparty: string;
  contractNumber: string;
  contractDate: string;
  docNumber: string;
  quantity?: number;
  unitPrice?: number;
  nomenclatureHint?: string;
  employeeHint?: string;
  employeePositionHint?: string;
  monthlySalaryHint?: number;
  usefulLifeMonthsHint?: number;
  productionObjectHint?: string;
  alimonyRecipientHint?: string;
  alimonyRatePercentHint?: number;
  alimonyShareLabelHint?: string;
  financialNotesSummaryHint?: string;
  multiSumTotal?: number;
  multiSumNote?: string;
}

const DATIVE_ROLE_TO_NOMINATIVE: Array<{ re: RegExp; label: string }> = [
  { re: /^каменщику$/iu, label: 'Каменщик' },
  { re: /^сварщику$/iu, label: 'Сварщик' },
  { re: /^монтажнику$/iu, label: 'Монтажник' },
  { re: /^слесарю$/iu, label: 'Слесарь' },
  { re: /^токарю$/iu, label: 'Токарь' },
  { re: /^электрику$/iu, label: 'Электрик' },
  { re: /^мастеру$/iu, label: 'Мастер' },
  { re: /^прорабу$/iu, label: 'Прораб' },
  { re: /^водителю$/iu, label: 'Водитель' },
  { re: /^кладовщику$/iu, label: 'Кладовщик' },
  { re: /^маляру$/iu, label: 'Маляр' },
  { re: /^штукатуру$/iu, label: 'Штукатур' },
  { re: /^плотнику$/iu, label: 'Плотник' },
  { re: /^грузчику$/iu, label: 'Грузчик' },
  { re: /^инженеру$/iu, label: 'Инженер' },
  { re: /^технологу$/iu, label: 'Технолог' },
  { re: /^бухгалтеру$/iu, label: 'Бухгалтер' },
  { re: /^директору$/iu, label: 'Директор' },
  { re: /^рабочему$/iu, label: 'Рабочий' },
  { re: /^работнику$/iu, label: 'Работник' },
  { re: /^сотруднику$/iu, label: 'Сотрудник' },
];

function normalizeRussianItemPhraseToNominative(rawPhrase: string): string {
  const cleaned = rawPhrase
    .replace(/^[«"'„“]|[»"'”]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const words = cleaned.split(' ').map((word, idx) => {
    const lower = word.toLowerCase();
    const exactAccMap: Record<string, string> = {
      спецодежду: 'спецодежда',
      спецоснастку: 'спецоснастка',
      спецобувь: 'спецобувь',
      каску: 'каска',
      форму: 'форма',
      куртку: 'куртка',
      жилетку: 'жилетка',
      арматуру: 'арматура',
      краску: 'краска',
      грунтовку: 'грунтовка',
      штукатурку: 'штукатурка',
      шпаклевку: 'шпаклевка',
      шпатлевку: 'шпатлевка',
      плитку: 'плитка',
      доску: 'доска',
      фанеру: 'фанера',
      трубу: 'труба',
      проволоку: 'проволока',
      сетку: 'сетка',
      пленку: 'пленка',
      плёнку: 'плёнка',
      бумагу: 'бумага',
      смазку: 'смазка',
      бетономешалку: 'бетономешалка',
      продукцию: 'продукция',
      упаковку: 'упаковка',
      рабочую: 'рабочая',
      защитную: 'защитная',
      строительную: 'строительная',
      готовую: 'готовая',
    };
    if (exactAccMap[lower]) {
      const mapped = exactAccMap[lower];
      return idx === 0 ? mapped.charAt(0).toUpperCase() + mapped.slice(1) : mapped;
    }
    return idx === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  });

  return words.join(' ').trim();
}

function normalizeInflectedPersonPhrase(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Handle "супруге Валеева" / "супруги Валеева" -> "Супруга Валеева"
  const spouseMatch = cleaned.match(/^супруг[еиуой]\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?)?)$/iu);
  if (spouseMatch) {
    return `Супруга ${spouseMatch[1].trim()}`;
  }

  // Handle masculine genitive/dative surname + initials (with optional trailing dot: "Валеева В.В" or "Валеева В.В.")
  const mascInit = cleaned.match(
    /^([А-ЯЁ][а-яё]+(?:ова|ева|ёва|ина|ына|ову|еву|ёву|ину|ыну))\s+([А-ЯЁ])\.\s*([А-ЯЁ])\.?$/u
  );
  if (mascInit) {
    const surNom = mascInit[1].slice(0, -1);
    return `${surNom} ${mascInit[2]}.${mascInit[3]}.`;
  }

  // Handle feminine genitive/dative surname + optional initials ("Валеевой" -> "Валеева", "Валеевой А.С." -> "Валеева А.С.")
  const femMatch = cleaned.match(
    /^([А-ЯЁ][а-яё]+(?:овой|евой|ёвой|иной|ыной|ской|цкой))(?:\s+([А-ЯЁ])\.\s*([А-ЯЁ])\.?)?$/u
  );
  if (femMatch) {
    const surNom = /(?:ской|цкой)$/iu.test(femMatch[1])
      ? femMatch[1].replace(/ой$/iu, 'ая')
      : femMatch[1].replace(/ой$/iu, 'а');
    if (femMatch[2] && femMatch[3]) {
      return `${surNom} ${femMatch[2]}.${femMatch[3]}.`;
    }
    return surNom;
  }

  return normalizeDativeEmployeeHint(cleaned);
}

function extractMultiSumAndFinancialNotes(text: string): {
  multiSumTotal?: number;
  multiSumNote?: string;
  financialNotesSummaryHint?: string;
} {
  const isMultiValueContext =
    /вексел|облигац|ценн\p{L}*\s+бумаг|(?:два|две|три|четыре|несколько)\s+\p{L}+.*(?:один|одн[ао]|перв\p{L}*).*(?:второ\p{L}*|друг\p{L}*)|(?:один|перв\p{L}*)\s+(?:на|за|по|номиналом|-|—)\s*\d[\d\s\u00A0]*.*(?:второ\p{L}*)\s*(?:на|за|по|номиналом|-|—)?\s*\d/iu.test(
      text
    );
  if (!isMultiValueContext) return {};

  // Scrub dates, requisite codes, doc numbers, percentages, and physical quantities/months
  const scrubbed = text
    .replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/(?:инн|кпп|огрн|бик|р\/сч?|к\/сч?|сч[её]т)[\s.:№-]*\d{5,20}/giu, ' ')
    .replace(/№\s*[А-Яа-яA-Za-z0-9/_-]+/gu, ' ')
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(
      /\d+(?:[.,]\d+)?\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|мес\p{L}*|лет|год\p{L}*|дн\p{L}*)/giu,
      ' '
    );

  const rawMatches = Array.from(
    scrubbed.matchAll(/(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\b\d{4,9}(?:[.,]\d{1,2})?\b)/g)
  );
  const amounts = rawMatches
    .map((m) => parseRussianNumber(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 100);

  if (amounts.length < 2) return {};

  const sum = Math.round((amounts.reduce((a, b) => a + b, 0) + Number.EPSILON) * 100) / 100;
  const pctMatches = Array.from(text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)).map((m) => m[1]);

  let financialNotesSummaryHint: string | undefined;
  if (/вексел|облигац|ценн\p{L}*\s+бумаг/iu.test(text)) {
    const labelBase = /облигац/iu.test(text) ? 'Облигация' : 'Вексель';
    financialNotesSummaryHint = amounts
      .map((amt, idx) => {
        const pct = pctMatches[idx] ? ` (под ${pctMatches[idx]}%)` : '';
        return `${labelBase} №${idx + 1}: ${amt.toLocaleString('ru-RU')} ₽${pct}`;
      })
      .join(', ');
  }

  const partsText = amounts.map((a) => `${a.toLocaleString('ru-RU')} ₽`).join(' + ');
  return {
    multiSumTotal: sum,
    multiSumNote: `Суммированы номиналы / части из условия: ${partsText} = ${sum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`,
    financialNotesSummaryHint,
  };
}

function normalizeDativeEmployeeHint(rawEmp: string): string {
  const trimmed = rawEmp.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const tokens = trimmed.split(' ');
  const first = tokens[0];
  const roleEntry = DATIVE_ROLE_TO_NOMINATIVE.find((r) => r.re.test(first));
  if (roleEntry) {
    if (tokens.length === 1) return roleEntry.label;
    const restNorm = normalizeDativeEmployeeHint(tokens.slice(1).join(' '));
    return `${roleEntry.label} ${restNorm}`.trim();
  }
  // Masculine dative surname + initials: e.g. "Федорову Ф.Ф.", "Кузнецову А.И.", "Бельскому С.В."
  if (
    /^(?:[А-ЯЁ][а-яё]+(?:ову|еву|ёву|ину|ыну|скому|цкому))(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?|\s+[А-ЯЁ]\.)?$/u.test(
      trimmed
    )
  ) {
    const surNom = /(?:скому|цкому)$/iu.test(tokens[0])
      ? tokens[0].replace(/(?:скому|цкому)$/iu, (m) => `${m.slice(0, -3)}ий`)
      : tokens[0].replace(/у$/iu, '');
    return [surNom, ...tokens.slice(1)].join(' ');
  }
  // Feminine dative surname + initials: e.g. "Федоровой А.В.", "Бельской Е.С."
  if (
    /^(?:[А-ЯЁ][а-яё]+(?:овой|евой|ёвой|иной|ыной|ской|цкой))(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?|\s+[А-ЯЁ]\.)$/u.test(
      trimmed
    )
  ) {
    const surNom = /(?:ской|цкой)$/iu.test(tokens[0])
      ? tokens[0].replace(/ой$/iu, 'ая')
      : tokens[0].replace(/ой$/iu, 'а');
    return [surNom, ...tokens.slice(1)].join(' ');
  }
  // Full 3-part dative FIO: e.g. "Федорову Федору Федоровичу" / "Петровой Анне Сергеевне"
  if (tokens.length === 3) {
    const [sur, given, patr] = tokens;
    if (/(?:овичу|евичу|ичу)$/iu.test(patr) && /[уе]$/iu.test(given)) {
      const surNom = /(?:ову|еву|ёву|ину|ыну)$/iu.test(sur)
        ? sur.slice(0, -1)
        : /(?:скому|цкому)$/iu.test(sur)
          ? `${sur.slice(0, -3)}ий`
          : /у$/iu.test(sur)
            ? sur.slice(0, -1)
            : sur;
      const givenNom = /ю$/iu.test(given) ? `${given.slice(0, -1)}й` : given.replace(/[уе]$/iu, '');
      const patrNom = patr.slice(0, -1);
      return `${surNom} ${givenNom} ${patrNom}`;
    }
    if (/(?:овне|евне|ичне)$/iu.test(patr) && /е$/iu.test(given)) {
      const surNom = /(?:овой|евой|ёвой|иной|ыной)$/iu.test(sur)
        ? `${sur.slice(0, -2)}а`
        : sur;
      const givenNom = `${given.slice(0, -1)}а`;
      const patrNom = `${patr.slice(0, -1)}а`;
      return `${surNom} ${givenNom} ${patrNom}`;
    }
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function inferVatFromTextAndCell(
  description: string,
  vatRateCell = ''
): {
  vatRate?: number;
  vatRule?: 'included' | 'on_top' | 'none';
} {
  const combined = `${vatRateCell} ${description}`.trim();
  if (/ндс\s+не\s+облаг|не\s+облаг\p{L}*\s+ндс|без\s+налога\s*\(?\s*ндс/iu.test(combined)) {
    return { vatRule: 'none', vatRate: 0 };
  }
  if (
    /(?:по\s+)?цен\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|стоимост\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|кроме\s+того\s+ндс|плюс\s*ндс|сверху\s*ндс|\+\s*ндс|ндс\s+сверху|начисл\p{L}*\s+ндс\s+сверху/iu.test(
      combined
    )
  ) {
    const m = combined.match(/(\d{1,2})\s*%/);
    return {
      vatRule: 'on_top',
      vatRate: m ? Number(m[1]) : 20,
    };
  }
  if (/без\s*ндс/iu.test(combined)) {
    return { vatRule: 'none', vatRate: 0 };
  }
  if (vatRateCell) {
    const m = vatRateCell.match(/(\d{1,2})/);
    if (m) {
      const r = Number(m[1]);
      return { vatRate: r, vatRule: r === 0 ? 'none' : 'included' };
    }
  }
  const descRate = description.match(/ндс\s*\(?(\d{1,2})\s*%\)?/iu);
  if (descRate) {
    const r = Number(descRate[1]);
    return { vatRate: r, vatRule: r === 0 ? 'none' : 'included' };
  }
  return {};
}

export function extractRequisitesFromFreeText(
  text: string,
  reportingYear?: number
): ExtractedFreeTextRequisites {
  const innMatch = text.match(/ИНН[\s.:№-]*(\d{10}|\d{12})\b/i);
  const kppMatch = text.match(/КПП[\s.:№-]*(\d{9})\b/i);
  const rsMatch = text.match(
    /(?:р\/сч?|расч[её]тн\p{L}*\s+сч[её]т|казначейск\p{L}*\s+сч[её]т)[\s.:№-]*(\d{20})\b/iu
  );
  const ksMatch = text.match(
    /(?:к\/сч?|корр?(?:еспондентск\p{L}*)?\s+сч[её]т|екс)[\s.:№-]*(\d{20})\b/iu
  );
  const bikMatch = text.match(/БИК[\s.:№-]*(\d{9})\b/i);

  let counterparty = '';
  // 1. Quoted legal entity with Russian or straight/curly quotes
  const legalQuoted = text.match(
    /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ЗАО|НАО|ГУП|МУП|ФГУП|АНО|НКО)\s*[«"'„“]([^»"'”]{2,80})[»"'”]/iu
  );
  if (legalQuoted) {
    counterparty = `${legalQuoted[1].toUpperCase()} «${legalQuoted[2].trim()}»`;
  }

  // 2. Tax / Treasury / Social Fund agency (e.g. "МИ ФНС №10 по СПб", "ИФНС № 15", "УФК по г. Санкт-Петербургу")
  if (!counterparty) {
    const govMatch = text.match(
      /(?:^|[^\p{L}\p{N}])((?:МИ\s*ФНС|Межрайонн\p{L}+\s+ИФНС|ИФНС|УФНС|УФК|ОСФР|СФР|ФНС)(?:\s+России)?(?:\s*№\s*\d+)?(?:\s+по\s+(?:г\.\s*)?[А-Яа-яЁё.-]+(?:\s+[А-Яа-яЁё.-]+)?)?)(?=\s*[,(;]|$|\s+ИНН|\s+КПП|\s+р\/с)/iu
    );
    if (govMatch) {
      counterparty = govMatch[1].replace(/\s+/g, ' ').trim();
    }
  }

  // 3. Individual entrepreneur (ИП Фамилия И.О. / ИП Фамилия Имя Отчество)
  if (!counterparty) {
    const ipMatch = text.match(
      /(?:^|[^\p{L}\p{N}])(ИП\s+[А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё.]+)){1,2})/u
    );
    if (ipMatch) {
      counterparty = ipMatch[1].replace(/\s+/g, ' ').trim();
    }
  }

  // 4. Unquoted legal entity (e.g. "ПАО МегаФон", "ПАО Сбербанк", "АО Ростелеком", "ООО Комус")
  if (!counterparty) {
    const legalUnquoted = text.match(
      /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ЗАО|ГУП|МУП)\s+([А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9-]{2,40}(?:\s+[А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9-]{2,30})?)/u
    );
    if (legalUnquoted) {
      counterparty = `${legalUnquoted[1].toUpperCase()} «${legalUnquoted[2].trim()}»`;
    }
  }

  let contractNumber = '';
  let contractDate = '';
  const ctrMatch = text.match(
    /договор[ауом]?\s*(?:поставки|подряда|аренды|оказания услуг|купли-продажи)?\s*№\s*([А-Яа-яA-Za-z0-9/_-]+)(?:\s*от\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{4}-\d{2}-\d{2}))?/i
  );
  if (ctrMatch) {
    contractNumber = ctrMatch[1].trim();
    if (ctrMatch[2]) {
      contractDate = reportingYear
        ? normalizeOperationDateToReportingYear(ctrMatch[2], reportingYear)
        : normalizeDateISO(ctrMatch[2]);
    }
  }

  let docNumber = '';
  const docMatch = text.match(
    /(?:счет-фактур\w*|счёт-фактур\w*|с\/ф|упд|накладн\w*|торг-12|акт\w*|п\/п|платежн\w+\s+поручен\w*)\s*№\s*([А-Яа-яA-Za-z0-9/_-]+)/i
  );
  if (docMatch) {
    docNumber = docMatch[1].trim();
  }

  // Extract quantity, nomenclature & unitPrice from text:
  // Supports both "133 шт по 9300 руб" AND "226 шт Панель из ПВХ и МДФ по цене без НДС 1 500 руб."
  let quantity: number | undefined;
  let unitPrice: number | undefined;
  let nomenclatureHint: string | undefined;
  let employeeHint: string | undefined;
  let productionObjectHint: string | undefined;

  const qtyPriceAdjacentMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|рул\.?|п\.?\s*м\.?|кв\.?\s*м\.?|м2|м3|кг|т|тонн\p{L}*|л)\s*(?:по\s*(?:цене\s*)?(?:(?:без\s*(?:уч[её]та\s*)?ндс(?:\s*\d+\s*%)?|с\s*(?:уч[её]том\s*)?ндс(?:\s*\d+\s*%)?|в\s*т\.?\s*ч\.?\s*ндс(?:\s*\d+\s*%)?)\s*)?|[*×xх]\s*)(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)/iu
  );
  const qtyItemPriceMatch = !qtyPriceAdjacentMatch
    ? text.match(
        /(\d+(?:[.,]\d+)?)\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|рул\.?|п\.?\s*м\.?|кв\.?\s*м\.?|м2|м3|кг|т|тонн\p{L}*|л)\s+([А-Яа-яЁёA-Za-z«»"'-][А-Яа-яЁёA-Za-z0-9\s«»"'-]{1,70}?)\s+(?:по\s+цене|по\s+стоимости|по)(?:\s+(?:без\s*(?:уч[её]та\s*)?ндс(?:\s*\d+\s*%)?|с\s*(?:уч[её]том\s*)?ндс(?:\s*\d+\s*%)?|в\s*т\.?\s*ч\.?\s*ндс(?:\s*\d+\s*%)?|за\s+(?:шт|ед)\.?))*\s*(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)/iu
      )
    : null;

  if (qtyPriceAdjacentMatch) {
    const q = parseRussianNumber(qtyPriceAdjacentMatch[1]);
    const p = parseRussianNumber(qtyPriceAdjacentMatch[2]);
    if (q > 0) quantity = q;
    if (p > 0) unitPrice = p;
  } else if (qtyItemPriceMatch) {
    const q = parseRussianNumber(qtyItemPriceMatch[1]);
    const rawBetweenItem = qtyItemPriceMatch[2]
      .replace(/^(?:продукци[яию]|товар[аыов]*|материал[аыов]*|издели[яй])\s+/iu, '')
      .trim();
    const p = parseRussianNumber(qtyItemPriceMatch[3]);
    if (q > 0) quantity = q;
    if (p > 0) unitPrice = p;
    if (rawBetweenItem.length >= 2) {
      nomenclatureHint = normalizeRussianItemPhraseToNominative(rawBetweenItem);
    }
  } else {
    const qtyOnlyMatch = text.match(
      /(?:в\s+кол(?:-ве|ичестве)\s*)?(\d+(?:[.,]\d+)?)\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|рул\.?|кв\.?\s*м\.?|м2|м3|кг|тонн\p{L}*)(?=$|[^\p{L}])/iu
    );
    if (qtyOnlyMatch) {
      const q = parseRussianNumber(qtyOnlyMatch[1]);
      if (q > 0) quantity = q;
    }
  }

  // A. Internal write-off to object / production: e.g. "Передан кирпич на объект для производства трубы"
  const internalWriteoffMatch = text.match(
    /(?:передан\p{L}*|списан\p{L}*|отпущен\p{L}*|израсходован\p{L}*|направлен\p{L}*)\s+(?:со\s+склада\s+)?([А-Яа-яЁё][А-Яа-яЁё0-9\s«»"'-]{1,45}?)(?:\s+\d+(?:[.,]\d+)?\s*(?:шт|ед|компл|упак|рул|м2|м3|кг|т|л)\.?)?\s+(?:на\s+объект|в\s+производств\p{L}*|на\s+строительств\p{L}*|для\s+производств\p{L}*|для\s+строительств\p{L}*|для\s+изготовлен\p{L}*|в\s+цех|на\s+участок|на\s+нужды|на\s+ремонт)(?:\s+(?:для\s+)?(производств\p{L}*\s+[А-Яа-яЁё0-9\s«»"'-]{2,40}|строительств\p{L}*\s+[А-Яа-яЁё0-9\s«»"'-]{2,40}|изготовлен\p{L}*\s+[А-Яа-яЁё0-9\s«»"'-]{2,40}|[А-Яа-яЁё0-9«»"'-]{2,35}))?/iu
  );
  if (internalWriteoffMatch && !/(?:^|\s)от\s+(?:ООО|АО|ПАО|ЗАО|ИП)\b/iu.test(text)) {
    const rawItem = internalWriteoffMatch[1]
      .replace(/^(?:материалы?|сырь[её]|строительн\p{L}+\s+материалы?)\s+/iu, '')
      .trim();
    const normItem = normalizeRussianItemPhraseToNominative(rawItem);
    if (normItem.length >= 2) {
      nomenclatureHint = normItem;
    }

    const tailPurposeMatch = text.match(
      /(?:для\s+|на\s+)(производств[аоуе]\s+[А-Яа-яЁё0-9\s«»"'-]{2,40}|строительств[аоуе]\s+[А-Яа-яЁё0-9\s«»"'-]{2,40}|изготовлени[яею]\s+[А-Яа-яЁё0-9\s«»"'-]{2,40})/iu
    );
    if (tailPurposeMatch && tailPurposeMatch[1]) {
      const phrase = tailPurposeMatch[1]
        .replace(/\s+(?:по\s+требован|со\s+склад|в\s+кол|сумма|без\s+ндс).*$/iu, '')
        .trim();
      const normalizedPurpose = phrase
        .replace(/^производства(?=\s|$)/iu, 'Производство')
        .replace(/^производство(?=\s|$)/iu, 'Производство')
        .replace(/^строительства(?=\s|$)/iu, 'Строительство')
        .replace(/^строительство(?=\s|$)/iu, 'Строительство')
        .replace(/^изготовления(?=\s|$)/iu, 'Изготовление');
      productionObjectHint =
        normalizedPurpose.charAt(0).toUpperCase() + normalizedPurpose.slice(1);
    } else if (/на\s+объект(?=$|[^\p{L}])/iu.test(text)) {
      productionObjectHint = 'Основной объект строительства (производства)';
    }
  }

  // B. Workwear / special tooling / inventory issued to employee: e.g. "Выдали спецодежду каменщику" / "Выдана каска мастеру Петрову И.И."
  const workwearMatch = text.match(
    /(?:выда(?:ли|н[аоы]?)|передан[аоы]?)\s+(?:со\s+склада\s+)?((?:рабоч\p{L}*\s+|защитн\p{L}*\s+)?(?:спецодежд\p{L}*|спецоснастк\p{L}*|спецобув\p{L}*|сиз|инвентар\p{L}*|хозпринадлежност\p{L}*|инструмент\p{L}*|каск\p{L}*|форм\p{L}*|халат\p{L}*|комбинезон\p{L}*|перчатк\p{L}*|костюм\p{L}*|жилет\p{L}*))(?:\s+\d+(?:[.,]\d+)?\s*(?:шт|компл|ед|пар)\.?)?(?:\s+(?:в\s+эксплуатацию\s+)?([А-Яа-яЁё]+(?:\s+[А-ЯЁ][а-яё.]+(?:\s*[А-ЯЁ]\.?)?)?))?/iu
  );
  if (workwearMatch) {
    const normWw = normalizeRussianItemPhraseToNominative(workwearMatch[1]);
    if (normWw.length >= 2) {
      nomenclatureHint = normWw;
    }
    if (workwearMatch[2]) {
      const rawEmp = workwearMatch[2]
        .replace(/^(?:в|на|со|по|для)\b.*$/iu, '')
        .trim();
      if (rawEmp.length >= 3) {
        employeeHint = normalizeDativeEmployeeHint(rawEmp);
      }
    }
  }

  // C. Fixed asset commissioning / Production output (supports both "Введен в эксплуатацию X" and "Введен бетоносмеситель в эксплуатацию (СПИ 28 мес)")
  if (!nomenclatureHint) {
    const osCommBetweenMatch = text.match(
      /(?:введ[её]н[аоы]?|передан[аоы]?)\s+(?:объект\s+ос\s+|основн\p{L}*\s+средств\p{L}*\s+)?([А-Яа-яЁё][А-Яа-яЁё0-9\s«»"'-]{2,45}?)\s+в\s+эксплуатац/iu
    );
    const osCommAfterMatch = !osCommBetweenMatch
      ? text.match(
          /(?:введ[её]н\p{L}*\s+в\s+эксплуатац\p{L}*|ввод\s+в\s+эксплуатац\p{L}*|принят\p{L}*\s+к\s+уч[её]ту(?:\s+объект\s+ОС)?)\s+([А-Яа-яЁё][А-Яа-яЁё0-9\s«»"'-]{2,45}?)(?=\s*(?:[,.;()]|$|\s+и\s+принят|\s+принят\p{L}*\s+к\s+уч|\s+в\s+состав|\s+на\s+сч[её]т|\s+по\s+акту|\s+по\s+первоначальн|\s+стоимост|\s+на\s+сумму|\s+инв))/iu
        )
      : null;
    const rawOsItem = (osCommBetweenMatch?.[1] || osCommAfterMatch?.[1] || '').trim();
    if (
      rawOsItem &&
      !/^(?:спецодежд|спецоснастк|спецобув|инвентар|хозпринадлежност)/iu.test(rawOsItem)
    ) {
      nomenclatureHint = normalizeRussianItemPhraseToNominative(rawOsItem);
    }
  }

  if (!nomenclatureHint) {
    const prodOutMatch = text.match(
      /(?:выпущен\p{L}*|оприходован\p{L}*\s+из\s+производств\p{L}*|сдан\p{L}*\s+на\s+склад)\s+(?:готов\p{L}*\s+продукци\p{L}*\s*)?([А-Яа-яЁё][А-Яа-яЁё0-9\s«»"'-]{2,45}?)(?=\s*(?:\d+\s*(?:шт|ед|т|м)|[,.;()]|$|\s+по\s+планов|\s+на\s+сумму))/iu
    );
    if (prodOutMatch && prodOutMatch[1]) {
      const rawProd = prodOutMatch[1].replace(/^готовая\s+продукция\s*/iu, '').trim();
      nomenclatureHint = normalizeRussianItemPhraseToNominative(rawProd || 'Готовая продукция');
    }
  }

  // D. Extract nomenclature hint before quantity (purchases & sales: "за оконные блоки 133 шт", "Поставлена продукция Панель ПВХ 226 шт", "Отгружены товары ...")
  if (!nomenclatureHint) {
    const nomBeforeQty = text.match(
      /(?:за\s+|поставлен[аыо]?(?:\s+(?:готов\p{L}*\s+)?продукци[яию]|\s+товар\p{L}*)?\s+|отгружен[аыо]?(?:\s+(?:готов\p{L}*\s+)?продукци[яию]|\s+товар\p{L}*)?\s+|реализован[аыо]?(?:\s+(?:готов\p{L}*\s+)?продукци[яию]|\s+товар\p{L}*)?\s+|продан[аыо]?(?:\s+товар\p{L}*|\s+продукци[яию])?\s+|поступил[аио]?(?:\s+от\s+(?:ООО|АО|ПАО|ЗАО|ИП)\s*(?:[«"'„“][^»"'”]+[»"'”]|\S+))?\s+|приобретен[аыо]?(?:\s+у\s+(?:ООО|АО|ПАО|ЗАО|ИП)\s*(?:[«"'„“][^»"'”]+[»"'”]|\S+))?\s+|оприходован[аыо]?\s+)([А-Яа-яЁёA-Za-z«»"'-][А-Яа-яЁёA-Za-z0-9\s«»"'-]{2,55}?)\s+\d+(?:[.,]\d+)?\s*(?:шт|ед|компл|упак|рул|м2|м3|кг|т|л)/iu
    );
    if (nomBeforeQty && nomBeforeQty[1]) {
      const cleanedNom = nomBeforeQty[1]
        .replace(/^(?:товары|материалы|сырье|оборудование|готовая\s+продукция|продукция)\s+/iu, '')
        .trim();
      if (cleanedNom.length >= 2) {
        nomenclatureHint = normalizeRussianItemPhraseToNominative(cleanedNom);
      }
    }
  }

  // E. Purchase or sale of named item without explicit quantity right after item (including "Поступила смазка для автомобилей")
  if (!nomenclatureHint) {
    const nomPurchaseSimple = text.match(
      /(?:поступил[аио]?|приобретен[аыо]?|купил[аи]?|закуплен[аыо]?|поставлен[аыо]?|отгружен[аыо]?|реализован[аыо]?)\s+(?:продукци[яию]\s+|товар[ыа]?\s+|материал[ыа]?\s+)?([А-Яа-яЁёA-Za-z«»"'-][А-Яа-яЁёA-Za-z0-9\s«»"'-]{2,50}?)(?=\s*(?:[,.;()]|$|\s+(?:от|у|покупател\p{L}*|заказчик\p{L}*|поставщик\p{L}*|на\s+склад|по\s+накладн|по\s+счет|по\s+упд|по\s+цене|на\s+сумму|в\s+сумме|за\s+\d|стоимост)))/iu
    );
    if (
      nomPurchaseSimple &&
      nomPurchaseSimple[1] &&
      !/^(?:на\s+р\/с|на\s+расч|оплата|аванс|выручка|денежные|доля|вклад|исполнительн\p{L}*\s+лист|(?:два|три|четыре|несколько)?\s*вексел|облигац)/iu.test(
        nomPurchaseSimple[1].trim()
      )
    ) {
      nomenclatureHint = normalizeRussianItemPhraseToNominative(nomPurchaseSimple[1]);
    }
  }

  // E2. Accountable person FIO (счёт 71.01): "Выдано Федорову Ф.Ф. подотчет", "Авансовый отчет Петрова И.И.", "Возвращен остаток подотчетных сумм Сидоровым С.С."
  if (!employeeHint) {
    const accBeforeMatch = text.match(
      /(?:[Вв]ыда(?:но|н[аы]?|ли)|[Пп]еречислен[аоы]?|[Вв]ыплачен[аоы]?)\s+(?:из\s+кассы\s+|с\s+р\/с(?:ч)?\s+|с\s+расч[её]тн\p{L}*\s+сч[её]та\s+|на\s+карту\s+)?(?:сотруднику\s+|работнику\s+|подотч[её]тному\s+лицу\s+)?([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё.]+)){0,2})\s+(?:[Пп]од\s*отч[её]т|[Пп]одотч[её]т|на\s+хоз(?:яйственн\p{L}*)?\s*нужд|на\s+командиров)/u
    );
    const accAfterMatch = !accBeforeMatch
      ? text.match(
          /(?:[Пп]од\s*отч[её]т|[Пп]одотч[её]т|[Аа]вансов\p{L}*\s+отч[её]т(?:\s*№\s*\S+)?|[Оо]статок\s+подотч[её]тн\p{L}*\s+сумм|[Оо]т\s+подотч[её]тн\p{L}*\s+лица|[Оо]тчитал(?:ся|ась))\s+(?:сотрудник[ауом]?\s+|работник[ауом]?\s+|подотч[её]тн\p{L}*\s+лиц[ауом]?\s+)?([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё.]+)){0,2})/u
        )
      : null;
    const rawAccFio = (accBeforeMatch?.[1] || accAfterMatch?.[1] || '')
      .replace(/\s+(?:на\s+сумму|в\s+сумме|на\s+хоз|на\s+командиров|за\s+приобретен|по\s+рко|по\s+пко).*$/iu, '')
      .trim();
    if (rawAccFio.length >= 2) {
      employeeHint = normalizeDativeEmployeeHint(rawAccFio);
    }
  }

  // F. HR hiring / employment order: e.g. "Принят на работу Иванов И.И. на должность прораба с окладом 80 000 руб."
  let employeePositionHint: string | undefined;
  let monthlySalaryHint: number | undefined;
  let usefulLifeMonthsHint: number | undefined;

  const hireMatch = text.match(
    /(?:[Пп]ринят[аы]?\s+на\s+работу|[Пп]ри[её]м\s+на\s+работу|[Оо]формлен[аы]?\s+в\s+штат|[Зз]аключ[её]н\s+трудовой\s+договор\s+с)\s+(?:(?:сотрудник[аом]?|работник[аом]?)\s+)?(?:([а-яё-]{3,25}(?:\s+[а-яё-]{3,25})?)\s+)?([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё.]+)){0,2})/u
  );
  if (hireMatch && hireMatch[2]) {
    const preRole = (hireMatch[1] ?? '').trim();
    if (
      preRole &&
      !/^(?:на\s+должность|в\s+должности|в\s+штат|по\s+совместительству)$/iu.test(preRole)
    ) {
      employeePositionHint = preRole;
    }
    const candEmp = hireMatch[2]
      .replace(/\s+(?:на\s+должност|в\s+должност|с\s+оклад|по\s+оклад|в\s+основн|в\s+отдел).*$/iu, '')
      .trim();
    if (candEmp.length >= 2) {
      employeeHint = candEmp;
    }
  }

  const posMatch = text.match(
    /(?:на\s+должность|в\s+должности|должность)[\s:«"']*([А-Яа-яЁё0-9\s-]{3,40}?)(?=\s*(?:[,.;()«»"']|$|\s+с\s+окладом|\s+оклад|\s+по\s+трудов|\s+в\s+подразделен|\s+в\s+цех|\s+в\s+отдел))/iu
  );
  if (posMatch && posMatch[1]) {
    employeePositionHint = posMatch[1].trim();
  }

  const salaryMatch = text.match(
    /(?:с\s+окладом|должностн\p{L}*\s+оклад\p{L}*|оклад(?:\s+составляет)?|тарифн\p{L}*\s+ставк\p{L}*|фот(?:\s+за\s+месяц|\s+составляет)?)[\s:=—-]*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)/iu
  );
  if (salaryMatch && salaryMatch[1]) {
    const sal = parseRussianNumber(salaryMatch[1]);
    if (sal > 0) {
      monthlySalaryHint = sal;
    }
  }

  // G. Useful life (СПИ) for Fixed Assets commissioning / depreciation: e.g. "СПИ 60 мес", "срок полезного использования 5 лет"
  const spiMatch = text.match(
    /(?:(?:^|[^\p{L}])спи(?=$|[^\p{L}])|срок\p{L}*\s+полезн\p{L}*\s+использован\p{L}*|срок\p{L}*\s+служб\p{L}*)[\s:=—()-]*(\d{1,3})\s*(мес\p{L}*|лет|год\p{L}*)/iu
  );
  if (spiMatch && spiMatch[1]) {
    const rawVal = Number(spiMatch[1]);
    const unit = spiMatch[2].toLowerCase();
    if (rawVal > 0) {
      usefulLifeMonthsHint = /^(?:лет|год)/.test(unit) ? rawVal * 12 : rawVal;
    }
  }

  // H. Writ of Execution (Исполнительный лист) & Alimony Remittance (76.41)
  let alimonyRecipientHint: string | undefined;
  let alimonyRatePercentHint: number | undefined;
  let alimonyShareLabelHint: string | undefined;

  const isWritText =
    /исполнительн\p{L}*\s+лист/iu.test(text) &&
    !/перечислен|выплачен|уплачен|списан|погашен/iu.test(text);
  const isAlimonyPayoutText =
    /(?:перечислен|выплачен|уплачен|списан|погашен)\p{L}*.*(?:алимент|по\s+исполнительн\p{L}*\s+лист\p{L}*\s+(?:алимент|супруг|в\s+пользу))/iu.test(
      text
    );

  if (isWritText) {
    const debtorMatch = text.match(
      /(?:взыскан\p{L}*|удержан\p{L}*)\s+(?:алимент\p{L}*\s+)?с\s+(?:сотрудника\s+|работника\s+)?([А-ЯЁ][а-яё]{2,}(?:\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?)?)/u
    );
    if (debtorMatch && debtorMatch[1]) {
      employeeHint = normalizeInflectedPersonPhrase(debtorMatch[1]);
    }
    const benefitMatch = text.match(
      /в\s+пользу\s+([А-Яа-яЁё][А-Яа-яЁё.\s-]{2,45}?)(?=\s*(?:[,;()]|\.{2,}|$|\s+в\s+размер|\s+на\s+содержан|\s+по\s+|\s+от\s+|\s+инн|\s+\d))/iu
    );
    if (benefitMatch && benefitMatch[1]) {
      const cleanedRec = benefitMatch[1].replace(/\.+$/, '').trim();
      alimonyRecipientHint = normalizeInflectedPersonPhrase(cleanedRec);
    } else if (employeeHint) {
      alimonyRecipientHint = `Получатель алиментов (${employeeHint})`;
    }

    const pctExplicit = text.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
    if (pctExplicit) {
      alimonyRatePercentHint = Number(pctExplicit[1].replace(',', '.'));
      alimonyShareLabelHint = `${pctExplicit[1]}%`;
    } else if (/\b1\s*\/\s*4\b|четверт|одного\s+реб[её]нк/iu.test(text)) {
      alimonyRatePercentHint = 25;
      alimonyShareLabelHint = '1/4 (25%)';
    } else if (/\b1\s*\/\s*3\b|трет\p{L}*|двух\s+дет/iu.test(text)) {
      alimonyRatePercentHint = 33.33;
      alimonyShareLabelHint = '1/3 (33,33%)';
    } else if (/\b1\s*\/\s*2\b|половин|тр[её]х\s+дет/iu.test(text)) {
      alimonyRatePercentHint = 50;
      alimonyShareLabelHint = '1/2 (50%)';
    } else if (/алимент/iu.test(text)) {
      alimonyRatePercentHint = 25;
      alimonyShareLabelHint = '1/4 (25%)';
    }
  } else if (isAlimonyPayoutText) {
    const recPayoutMatch = text.match(
      /алимент\p{L}*\s+([А-Яа-яЁё][А-Яа-яЁё.\s-]{2,45}?)(?=\s*(?:[,;()]|$|\s+инн|\s+р\/с|\s+бик|\s+на\s+сумму|\s+в\s+сумме))/iu
    );
    if (recPayoutMatch && recPayoutMatch[1]) {
      alimonyRecipientHint = normalizeInflectedPersonPhrase(recPayoutMatch[1].trim());
    }
  }

  // I. Multi-sum promissory notes / securities ("Приобретено два векселя (один на 280 000 под 13% , второй - 540 000 под 11%)")
  const multiSum = extractMultiSumAndFinancialNotes(text);
  if (!nomenclatureHint && multiSum.financialNotesSummaryHint) {
    nomenclatureHint = /облигац/iu.test(text)
      ? 'Долговые ценные бумаги (облигации)'
      : 'Векселя третьих лиц';
  }

  const cleanBik = bikMatch ? bikMatch[1] : '';
  const bankInfo = cleanBik ? resolveBankInfoByBik(cleanBik) : undefined;

  return {
    inn: innMatch ? innMatch[1] : '',
    kpp: kppMatch ? kppMatch[1] : '',
    bankAccount: rsMatch ? rsMatch[1] : '',
    corrAccount: ksMatch ? ksMatch[1] : bankInfo?.corrAccount || '',
    bik: cleanBik,
    bankName: bankInfo?.bankName || '',
    counterparty,
    contractNumber,
    contractDate,
    docNumber,
    quantity,
    unitPrice,
    nomenclatureHint,
    employeeHint,
    employeePositionHint,
    monthlySalaryHint,
    usefulLifeMonthsHint,
    productionObjectHint,
    alimonyRecipientHint,
    alimonyRatePercentHint,
    alimonyShareLabelHint,
    financialNotesSummaryHint: multiSum.financialNotesSummaryHint,
    multiSumTotal: multiSum.multiSumTotal,
    multiSumNote: multiSum.multiSumNote,
  };
}

export interface SheetGlobalDefaults {
  defaultBik: string;
  defaultBankName: string;
  defaultCorrAccount: string;
  orgBankAccount: string;
  rawHeaderNotes: string[];
}

export function extractSheetHeaderDefaults(
  matrix: unknown[][],
  headerRowIdx: number
): SheetGlobalDefaults {
  let foundBik = '';
  let foundOrgAccount = '';
  const rawHeaderNotes: string[] = [];

  const scanLimit = headerRowIdx > 0 ? headerRowIdx : Math.min(matrix.length, 8);
  const rowsToInspect: unknown[][] = [];
  for (let i = 0; i < scanLimit; i++) {
    if (Array.isArray(matrix[i])) rowsToInspect.push(matrix[i]);
  }
  // Also inspect top 5 rows across all columns (in case bank BIK is in a right-side note cell on the header row!)
  for (let i = scanLimit; i < Math.min(matrix.length, scanLimit + 4); i++) {
    if (Array.isArray(matrix[i])) {
      const joined = matrix[i].map((c) => String(c ?? '')).join(' ');
      if (/бик\s+сбербанк|банк\s+по\s+умолчан|044030653/i.test(joined)) {
        rowsToInspect.push(matrix[i]);
      }
    }
  }

  for (const row of rowsToInspect) {
    const lineText = row
      .map((c) => (c instanceof Date ? '' : String(c ?? '').trim()))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!lineText) continue;

    // Skip pure column header lines
    if (/^№\s+дата\s+содержан/i.test(lineText)) continue;

    if (lineText.length >= 4 && rawHeaderNotes.length < 6) {
      rawHeaderNotes.push(lineText);
    }

    const bikExplicit =
      lineText.match(/БИК(?:\s+[А-Яа-яЁёA-Za-z«»"'-]+){0,3}[\s.:№=-]*(\d{9})\b/iu) ||
      lineText.match(/\b(04\d{7})\b/);
    if (bikExplicit && !foundBik) {
      foundBik = bikExplicit[1];
    }

    const accExplicit = lineText.match(
      /(?:р\/сч?|расч[её]тн\p{L}*\s+сч[её]т)[\s.:№=-]*(\d{20})\b/iu
    );
    if (accExplicit && !foundOrgAccount) {
      foundOrgAccount = accExplicit[1];
    }
  }

  const effectiveBik = foundBik || DEFAULT_SBERBANK_BIK;
  const bankInfo = resolveBankInfoByBik(
    effectiveBik,
    effectiveBik === DEFAULT_SBERBANK_BIK ? DEFAULT_SBERBANK_NAME : ''
  );

  return {
    defaultBik: bankInfo.bik,
    defaultBankName: bankInfo.bankName,
    defaultCorrAccount: bankInfo.corrAccount || DEFAULT_SBERBANK_CORR,
    orgBankAccount: foundOrgAccount,
    rawHeaderNotes,
  };
}

export function parse1CClientBankExchange(
  text: string,
  fileName: string,
  db1C: Database1CSnapshot | null,
  options?: { reportingYear?: number }
): RawDraftOperationInput[] {
  const lines = text.split(/\r?\n/);
  const headerAccounts = new Set<string>();
  if (db1C?.organization.bankAccount) {
    headerAccounts.add(db1C.organization.bankAccount.replace(/\D/g, ''));
  }
  for (const b of db1C?.bankAccounts ?? []) {
    if (b.accountNumber) headerAccounts.add(b.accountNumber.replace(/\D/g, ''));
  }

  const orgInn = (db1C?.organization.inn ?? '').replace(/\D/g, '');

  const drafts: RawDraftOperationInput[] = [];
  let inDoc = false;
  let currentDoc: Record<string, string> = {};
  let docIdx = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!inDoc && /^РасчСчет\s*=/i.test(line)) {
      const acc = line.split('=').slice(1).join('=').trim().replace(/\D/g, '');
      if (acc) headerAccounts.add(acc);
      continue;
    }

    if (/^СекцияДокумент/i.test(line)) {
      inDoc = true;
      currentDoc = {};
      const kind = line.split('=').slice(1).join('=').trim();
      if (kind) currentDoc['ВидДокумента'] = kind;
      continue;
    }

    if (/^КонецДокумента/i.test(line)) {
      if (inDoc) {
        docIdx++;
        const amount = parseRussianNumber(currentDoc['Сумма']);
        if (amount > 0) {
          const payerAcc = (currentDoc['ПлательщикСчет'] || currentDoc['ПлательщикРасчСчет'] || '').replace(/\D/g, '');
          const receiverAcc = (currentDoc['ПолучательСчет'] || currentDoc['ПолучательРасчСчет'] || '').replace(/\D/g, '');
          const payerInn = (currentDoc['ПлательщикИНН'] || '').replace(/\D/g, '');
          const receiverInn = (currentDoc['ПолучательИНН'] || '').replace(/\D/g, '');
          const payerBik = (currentDoc['ПлательщикБИК'] || '').replace(/\D/g, '');
          const receiverBik = (currentDoc['ПолучательБИК'] || '').replace(/\D/g, '');

          let direction: 'in' | 'out' = 'out';
          if (
            currentDoc['ДатаПоступило'] ||
            (orgInn && receiverInn === orgInn && payerInn !== orgInn) ||
            (receiverAcc && headerAccounts.has(receiverAcc) && !headerAccounts.has(payerAcc))
          ) {
            direction = 'in';
          } else if (
            currentDoc['ДатаСписано'] ||
            (orgInn && payerInn === orgInn) ||
            (payerAcc && headerAccounts.has(payerAcc))
          ) {
            direction = 'out';
          }

          const cpName =
            direction === 'out'
              ? currentDoc['Получатель1'] || currentDoc['Получатель'] || ''
              : currentDoc['Плательщик1'] || currentDoc['Плательщик'] || '';
          const cpInn = direction === 'out' ? receiverInn : payerInn;
          const cpKpp =
            direction === 'out'
              ? (currentDoc['ПолучательКПП'] || '').replace(/\D/g, '')
              : (currentDoc['ПлательщикКПП'] || '').replace(/\D/g, '');
          const cpBankAcc = direction === 'out' ? receiverAcc : payerAcc;
          const cpBik = direction === 'out' ? receiverBik : payerBik;

          const rawDateStr =
            (direction === 'out'
              ? currentDoc['ДатаСписано'] || currentDoc['Дата']
              : currentDoc['ДатаПоступило'] || currentDoc['Дата']) || currentDoc['Дата'];

          const date = options?.reportingYear
            ? normalizeOperationDateToReportingYear(rawDateStr, options.reportingYear)
            : normalizeDateISO(rawDateStr);

          const purpose = currentDoc['НазначениеПлатежа'] || '';
          const reqFromPurpose = extractRequisitesFromFreeText(purpose, options?.reportingYear);

          let vatRate: number | undefined;
          let vatRule: 'included' | 'on_top' | 'none' | undefined;
          let vatAmount: number | undefined;

          if (/без налога|без ндс|ндс не облагается/i.test(purpose)) {
            vatRule = 'none';
            vatRate = 0;
            vatAmount = 0;
          } else {
            const vatRateMatch = purpose.match(/ндс\s*\(?(\d{1,2})\s*%\)?/i);
            if (vatRateMatch) {
              vatRate = Number(vatRateMatch[1]);
              vatRule = 'included';
            }
            const vatSumMatch = purpose.match(
              /ндс(?:\s*\(?\d{1,2}\s*%\)?)?[\s—:-]*(\d[\d\s]*[.,-]\d{2})/i
            );
            if (vatSumMatch) {
              const rawVatStr = vatSumMatch[1].replace(/-(\d{2})$/, '.$1');
              const parsedVat = parseRussianNumber(rawVatStr);
              if (parsedVat > 0 && parsedVat < amount) {
                vatAmount = parsedVat;
              }
            }
          }

          drafts.push({
            rowKey: `bank_${fileName}_${docIdx}`,
            sourceFileName: fileName,
            date,
            docNumber: currentDoc['Номер'] || '',
            description:
              purpose ||
              `${currentDoc['ВидДокумента'] || 'Платёжное поручение'} № ${currentDoc['Номер'] || ''}`,
            amount,
            vatRate,
            vatRule,
            vatAmount,
            counterpartyName: cpName.trim(),
            counterpartyInn: cpInn,
            counterpartyKpp: cpKpp,
            counterpartyBankAccount: cpBankAcc || reqFromPurpose.bankAccount || undefined,
            counterpartyBik: cpBik || reqFromPurpose.bik || undefined,
            counterpartySource: cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : undefined,
            contractNumber: reqFromPurpose.contractNumber || undefined,
            contractDate: reqFromPurpose.contractDate || undefined,
            directionHint: direction,
          });
        }
      }
      inDoc = false;
      currentDoc = {};
      continue;
    }

    if (inDoc && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (k) currentDoc[k] = v;
    }
  }

  return drafts;
}

interface RowMapOutcome {
  draft: RawDraftOperationInput | null;
  skipReason?: string;
  isSilentStructuralRow?: boolean;
}

function mapTabularRowToDraft(params: {
  headers: string[];
  rawCells: unknown[];
  formattedCells: string[];
  fileName: string;
  rowKey: string;
  reportingYear: number;
  inheritedDate: string;
  sheetDefaults: SheetGlobalDefaults;
}): RowMapOutcome {
  const {
    headers,
    rawCells,
    formattedCells,
    fileName,
    rowKey,
    reportingYear,
    inheritedDate,
    sheetDefaults,
  } = params;

  const findColIdx = (patterns: RegExp[]): number => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h) => pat.test(h));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const getFormattedCol = (patterns: RegExp[]): string => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h) => pat.test(h));
      if (idx >= 0) {
        const fmt = (formattedCells[idx] ?? '').trim();
        if (fmt) return fmt;
        const raw = rawCells[idx];
        if (raw !== undefined && raw !== null) {
          if (raw instanceof Date) {
            return normalizeOperationDateToReportingYear(raw, reportingYear);
          }
          const s = String(raw).trim();
          if (s) return s;
        }
      }
    }
    return '';
  };

  const getRawCol = (patterns: RegExp[]): unknown => {
    const idx = findColIdx(patterns);
    return idx >= 0 ? rawCells[idx] : undefined;
  };

  // Detect repeated header row or column numbering row ("1 | 2 | 3 | 4")
  const nonEmptyStrings = formattedCells.map((c) => c.trim()).filter(Boolean);
  if (nonEmptyStrings.length === 0) {
    return { draft: null, isSilentStructuralRow: true };
  }
  if (
    nonEmptyStrings.length >= 2 &&
    nonEmptyStrings.every((s, idx) => s === String(idx + 1))
  ) {
    return { draft: null, isSilentStructuralRow: true };
  }
  if (
    nonEmptyStrings.some((s) => /^(дата|содержание\s*операции|хозяйственная\s*операция)$/i.test(s)) &&
    nonEmptyStrings.some((s) => /сумма|№/i.test(s))
  ) {
    return { draft: null, isSilentStructuralRow: true };
  }

  const amountPatterns = [
    /^сумма$/i,
    /сумма\s*(с\s*ндс|документа|операции|платежа|рубл|,?\s*руб)/i,
    /^сумма[,\s]/i,
    /^amount$/i,
    /^оборот$/i,
  ];
  const rawAmtCell = getRawCol(amountPatterns);
  const fmtAmtCell = getFormattedCol(amountPatterns);
  let amount =
    typeof rawAmtCell === 'number'
      ? rawAmtCell
      : parseRussianNumber(fmtAmtCell || rawAmtCell);

  // Also support separate Приход / Расход columns in bank/cash Excel tables
  let directionHint: 'in' | 'out' | undefined;
  if (Math.abs(amount) < 0.01) {
    const income = parseRussianNumber(getFormattedCol([/^приход/i, /^поступлен/i, /^кредит\s*сумма/i]));
    const outcome = parseRussianNumber(getFormattedCol([/^расход/i, /^списан/i, /^дебет\s*сумма/i]));
    if (income > 0) {
      amount = income;
      directionHint = 'in';
    } else if (outcome > 0) {
      amount = outcome;
      directionHint = 'out';
    }
  }

  const datePatterns = [/^дата/i, /^период/i, /^число$/i, /^date$/i];
  const rawDateVal = getRawCol(datePatterns);
  const fmtDateVal = getFormattedCol(datePatterns);
  const parsedDate =
    normalizeOperationDateToReportingYear(rawDateVal, reportingYear) ||
    normalizeOperationDateToReportingYear(fmtDateVal, reportingYear);
  const date = parsedDate || inheritedDate;

  const docNumber = getFormattedCol([/^номер/i, /^№\s*(?:п\/п|док|операц)?$/i, /^№$/i, /док.*№/i, /^doc/i]);
  const description = getFormattedCol([
    /содержан/i,
    /хозяйственн.*операц/i,
    /наименован.*операц/i,
    /текст.*операц/i,
    /назначен/i,
    /описан/i,
    /операци/i,
    /комментар/i,
    /основан/i,
    /^description$/i,
  ]);
  const counterpartyCell = getFormattedCol([
    /^контрагент/i,
    /^поставщик/i,
    /^покупатель/i,
    /^плательщик/i,
    /^получатель/i,
    /^организаци/i,
    /^counterparty/i,
  ]);
  const innCell = getFormattedCol([/^инн/i, /инн\s*контрагент/i, /^inn$/i]);
  const kppCell = getFormattedCol([/^кпп/i, /кпп\s*контрагент/i, /^kpp$/i]);
  const contractCell = getFormattedCol([/^договор/i, /^contract/i]);
  const nomCell = getFormattedCol([/^номенклатур/i, /^товар/i, /^наименован.*(?:товар|тмц|материал|ос)/i, /^услуг/i, /^item/i]);
  const whCell = getFormattedCol([/^склад/i, /^warehouse/i]);
  const expCell = getFormattedCol([/стать[яи]\s*затрат/i, /^субконто/i]);
  const nomGroupCell = getFormattedCol([/номенклатурн.*групп/i, /^объект(?:\s*строительств|\s*производств|\s*затрат)?$/i]);
  const empCell = getFormattedCol([/^сотрудник/i, /^работник/i, /^физ.*лиц/i, /^мол$/i, /материально.*ответствен/i]);
  const ddsCell = getFormattedCol([/стать[яи]\s*ддс/i, /движен.*денежн/i]);
  const qtyCell = getFormattedCol([/^количеств/i, /^кол-во/i, /^qty/i]);
  const priceCell = getFormattedCol([/^цена/i, /^стоимость\s*ед/i, /^price/i]);
  const vatCell = getFormattedCol([/^сумма\s*ндс/i, /^ндс\s*сумма/i, /^ндс[,\s]*руб/i]);
  const vatRateCell = getFormattedCol([/^ставка\s*ндс/i, /^%\s*ндс/i, /^ндс$/i]);
  const debitCell = normalizeAccountCode1C(getFormattedCol([/^счет\s*дт/i, /^счет\s*затрат/i, /^дебет$/i, /^дт$/i]));
  const creditCell = normalizeAccountCode1C(getFormattedCol([/^счет\s*кт/i, /^кредит$/i, /^кт$/i]));

  // Skip summary/total rows ("Итого", "Всего", "Сальдо")
  const joinedText = `${description} ${counterpartyCell} ${nomCell}`.trim();
  if (/^(итого|всего|обороты\s+за|сальдо)(?=$|[^\p{L}])/iu.test(joinedText)) {
    return { draft: null, isSilentStructuralRow: true };
  }

  // If row has NO meaningful text (neither description, counterparty, nomenclature, nor explicit accounts) and no amount -> skip with reason if non-empty
  if (!joinedText && !debitCell && !creditCell && Math.abs(amount) < 0.01) {
    // Check if it was just a global note like "БИК Сбербанка 044030653" placed below
    const rawLinePreview = nonEmptyStrings.join(' | ');
    if (/бик\s*сбербанк|044030653|примечан/i.test(rawLinePreview)) {
      return { draft: null, isSilentStructuralRow: true };
    }
    return {
      draft: null,
      skipReason: 'Строка не содержит описания хозяйственной операции, контрагента или проводки',
    };
  }

  const extracted = extractRequisitesFromFreeText(
    `${description} ${counterpartyCell} ${contractCell}`,
    reportingYear
  );

  const inferredVat = inferVatFromTextAndCell(description, vatRateCell);
  const vatRate = inferredVat.vatRate;
  const vatRule = inferredVat.vatRule;

  const vatAmountParsed = parseRussianNumber(vatCell);
  const qtyParsed = parseRussianNumber(qtyCell) || extracted.quantity || 0;
  const unitPriceParsed = parseRussianNumber(priceCell) || extracted.unitPrice || 0;

  let effectiveAmount = Math.abs(amount);
  let amountCalculationNote: string | undefined;
  if (effectiveAmount < 0.01 && extracted.multiSumTotal && extracted.multiSumTotal > 0) {
    effectiveAmount = extracted.multiSumTotal;
    amountCalculationNote = extracted.multiSumNote;
  } else if (effectiveAmount < 0.01 && qtyParsed > 0 && unitPriceParsed > 0) {
    effectiveAmount = Math.round((qtyParsed * unitPriceParsed + Number.EPSILON) * 100) / 100;
    amountCalculationNote = `Рассчитано из текста операции: ${qtyParsed} × ${unitPriceParsed.toFixed(2)} ₽ = ${effectiveAmount.toFixed(2)} ₽`;
  } else if (
    effectiveAmount < 0.01 &&
    description &&
    !/принят\p{L}*\s+на\s+работу|при[её]м\s+на\s+работу|оформлен\p{L}*\s+в\s+штат|поступил\p{L}*\s+исполнительн\p{L}*\s+лист/iu.test(
      description
    )
  ) {
    const inlineSumMatch =
      description.match(
        /(?:на\s+сумму|в\s+сумме|в\s+размере|стоимостью)[\s:=—-]*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/iu
      ) ||
      description.match(
        /(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{3,}(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р(?=$|[^\p{L}]))/iu
      );
    if (inlineSumMatch && inlineSumMatch[1]) {
      const parsedInline = parseRussianNumber(inlineSumMatch[1]);
      if (parsedInline > 0) {
        effectiveAmount = parsedInline;
      }
    }
  }

  const finalInn = innCell.replace(/\D/g, '') || extracted.inn;
  const finalKpp = kppCell.replace(/\D/g, '') || extracted.kpp;

  return {
    draft: {
      rowKey,
      sourceFileName: fileName,
      date,
      docNumber: docNumber || extracted.docNumber,
      description: description || nomCell || counterpartyCell || 'Хозяйственная операция',
      amount: effectiveAmount,
      needsAmount: effectiveAmount < 0.01 ? true : undefined,
      amountCalculationNote,
      vatRate,
      vatRule,
      vatAmount: vatAmountParsed > 0 ? vatAmountParsed : undefined,
      quantity: qtyParsed > 0 ? qtyParsed : undefined,
      unitPrice: unitPriceParsed > 0 ? unitPriceParsed : undefined,
      counterpartyName: counterpartyCell || extracted.counterparty,
      counterpartyInn: finalInn,
      counterpartyKpp: finalKpp,
      counterpartyBankAccount: extracted.bankAccount || undefined,
      counterpartyBik: extracted.bik || undefined,
      counterpartyBankName: extracted.bankName || undefined,
      counterpartyCorrAccount: extracted.corrAccount || undefined,
      counterpartySource:
        finalInn.length === 10 || finalInn.length === 12 ? 'excel_explicit' : undefined,
      organizationBik: sheetDefaults.defaultBik,
      organizationBankName: sheetDefaults.defaultBankName,
      organizationBankAccount: sheetDefaults.orgBankAccount || undefined,
      contractName: contractCell,
      contractNumber: extracted.contractNumber || undefined,
      contractDate: extracted.contractDate || undefined,
      nomenclatureName: nomCell || extracted.nomenclatureHint || '',
      nomenclatureGroupHint: nomGroupCell || extracted.productionObjectHint || undefined,
      warehouseName: whCell,
      expenseItemName: expCell,
      cashFlowItemName: ddsCell,
      employeeName: empCell || extracted.employeeHint || undefined,
      employeePosition: extracted.employeePositionHint,
      monthlySalary: extracted.monthlySalaryHint,
      usefulLifeMonths: extracted.usefulLifeMonthsHint,
      alimonyRecipientName: extracted.alimonyRecipientHint,
      alimonyRecipientInn: extracted.alimonyRecipientHint ? finalInn || undefined : undefined,
      alimonyRatePercent: extracted.alimonyRatePercentHint,
      alimonyShareLabel: extracted.alimonyShareLabelHint,
      financialNotesSummary: extracted.financialNotesSummaryHint,
      directionHint,
      explicitDebit: debitCell || undefined,
      explicitCredit: creditCell || undefined,
    },
  };
}

interface ParsedMatrixResult {
  drafts: RawDraftOperationInput[];
  skipped: SkippedExcelRowReason[];
  sheetDefaults: SheetGlobalDefaults;
}

function parseRowsMatrixDetailed(params: {
  rawMatrix: unknown[][];
  formattedMatrix?: string[][];
  fileName: string;
  fileIndex: number;
  sheetName: string;
  reportingYear: number;
}): ParsedMatrixResult {
  const {
    rawMatrix,
    formattedMatrix,
    fileName,
    fileIndex,
    sheetName,
    reportingYear,
  } = params;

  const emptyDefaults: SheetGlobalDefaults = {
    defaultBik: DEFAULT_SBERBANK_BIK,
    defaultBankName: DEFAULT_SBERBANK_NAME,
    defaultCorrAccount: DEFAULT_SBERBANK_CORR,
    orgBankAccount: '',
    rawHeaderNotes: [],
  };

  if (rawMatrix.length === 0) {
    return { drafts: [], skipped: [], sheetDefaults: emptyDefaults };
  }

  // Locate header row within first 25 rows
  let headerRowIdx = -1;
  let bestScore = 0;

  const headerPatterns = [
    /дата|период|число|date/i,
    /сумма|приход|расход|amount|оборот/i,
    /контрагент|поставщик|покупатель|плательщик|получатель/i,
    /содержан|хозяйственн|назначен|описан|операци|номенклатур/i,
    /номер|^№|дебет|кредит|инн/i,
  ];

  for (let i = 0; i < Math.min(rawMatrix.length, 25); i++) {
    const row = formattedMatrix?.[i] ?? rawMatrix[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => String(c ?? '').trim());
    let score = 0;
    for (const pat of headerPatterns) {
      if (cells.some((c) => c.length > 0 && c.length <= 55 && pat.test(c))) score++;
    }
    if (score > bestScore && score >= 2) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  const sheetDefaults = extractSheetHeaderDefaults(rawMatrix, headerRowIdx);
  let lastValidDate =
    inferDefaultMonthStartFromContext(
      sheetName,
      fileName,
      sheetDefaults.rawHeaderNotes,
      reportingYear
    ) || buildSafeIsoDate(reportingYear, 1, 1);

  if (headerRowIdx >= 0) {
    const headerSource = formattedMatrix?.[headerRowIdx] ?? rawMatrix[headerRowIdx];
    const headers = headerSource.map((c) => String(c ?? '').trim());
    const drafts: RawDraftOperationInput[] = [];
    const skipped: SkippedExcelRowReason[] = [];

    for (let r = headerRowIdx + 1; r < rawMatrix.length; r++) {
      const rawRow = rawMatrix[r];
      const fmtRow =
        formattedMatrix?.[r] ??
        (Array.isArray(rawRow)
          ? rawRow.map((c) =>
              c instanceof Date
                ? normalizeOperationDateToReportingYear(c, reportingYear)
                : String(c ?? '').trim()
            )
          : []);

      if (
        !Array.isArray(rawRow) ||
        rawRow.every((c, idx) => {
          const f = (fmtRow[idx] ?? '').trim();
          return (c === null || c === undefined || String(c).trim() === '') && !f;
        })
      ) {
        continue;
      }

      const rowKey = `${fileIndex}_${sheetName}_${r + 1}`;
      const outcome = mapTabularRowToDraft({
        headers,
        rawCells: rawRow,
        formattedCells: fmtRow,
        fileName,
        rowKey,
        reportingYear,
        inheritedDate: lastValidDate,
        sheetDefaults,
      });

      if (outcome.draft) {
        if (outcome.draft.date) {
          lastValidDate = outcome.draft.date;
        } else {
          outcome.draft.date = lastValidDate;
        }
        drafts.push(outcome.draft);
      } else if (!outcome.isSilentStructuralRow && outcome.skipReason) {
        skipped.push({
          fileName,
          sheetName,
          rowNumber: r + 1,
          rawPreview: fmtRow.filter(Boolean).join(' | ').slice(0, 120),
          reason: outcome.skipReason,
        });
      }
    }

    return { drafts, skipped, sheetDefaults };
  }

  // Fallback: headerless rows [№?, date?, description, amount?] — NEVER drop rows with empty amount if description is meaningful!
  const drafts: RawDraftOperationInput[] = [];
  const skipped: SkippedExcelRowReason[] = [];

  for (let r = 0; r < rawMatrix.length; r++) {
    const row = rawMatrix[r];
    if (!Array.isArray(row) || row.length < 1) continue;
    const fmtRow =
      formattedMatrix?.[r] ??
      row.map((c) =>
        c instanceof Date
          ? normalizeOperationDateToReportingYear(c, reportingYear)
          : String(c ?? '').trim()
      );

    const nonEmpty = fmtRow.map((s) => s.trim()).filter(Boolean);
    if (nonEmpty.length === 0) continue;

    const joinedPreview = nonEmpty.join(' ');
    if (/бик\s*сбербанк|044030653|^(итого|всего|сальдо)\b/iu.test(joinedPreview)) {
      continue;
    }

    let rowDate = '';
    let dateColIndex = -1;
    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const cand =
        normalizeOperationDateToReportingYear(row[cIdx], reportingYear) ||
        normalizeOperationDateToReportingYear(fmtRow[cIdx], reportingYear);
      if (cand && String(fmtRow[cIdx] ?? row[cIdx]).trim().length <= 22) {
        rowDate = cand;
        dateColIndex = cIdx;
        break;
      }
    }

    if (rowDate) {
      lastValidDate = rowDate;
    }

    // Find rightmost numeric amount column (excluding short row index in col 0 and 10/12-digit INN)
    let amount = 0;
    let amountColIndex = -1;
    for (let cIdx = row.length - 1; cIdx >= 0; cIdx--) {
      if (cIdx === dateColIndex) continue;
      if (cIdx === 0 && /^\d{1,3}[.)]?$/.test((fmtRow[0] ?? '').trim())) continue;
      const cellStr = (fmtRow[cIdx] ?? String(row[cIdx] ?? '')).trim();
      if (!cellStr || /[А-Яа-яЁёA-Za-z]{4,}/.test(cellStr)) continue;
      if (/^\d{9,20}$/.test(cellStr.replace(/\s/g, ''))) continue;
      const num =
        typeof row[cIdx] === 'number'
          ? (row[cIdx] as number)
          : parseRussianNumber(cellStr);
      if (num > 0) {
        amount = num;
        amountColIndex = cIdx;
        break;
      }
    }

    const descParts = fmtRow.filter((cell, idx) => {
      const t = cell.trim();
      if (!t) return false;
      if (idx === dateColIndex || idx === amountColIndex) return false;
      if (idx === 0 && /^\d{1,3}[.)]?$/.test(t)) return false;
      return t.length >= 3;
    });
    const desc = descParts.join(' — ').trim();

    if (desc.length >= 6) {
      const req = extractRequisitesFromFreeText(desc, reportingYear);
      let effectiveAmt = amount;
      let amountNote: string | undefined;
      if (effectiveAmt < 0.01 && req.multiSumTotal && req.multiSumTotal > 0) {
        effectiveAmt = req.multiSumTotal;
        amountNote = req.multiSumNote;
      } else if (effectiveAmt < 0.01 && req.quantity && req.unitPrice) {
        effectiveAmt = Math.round((req.quantity * req.unitPrice + Number.EPSILON) * 100) / 100;
        amountNote = `Рассчитано из текста: ${req.quantity} × ${req.unitPrice.toFixed(2)} ₽ = ${effectiveAmt.toFixed(2)} ₽`;
      } else if (
        effectiveAmt < 0.01 &&
        !/принят\p{L}*\s+на\s+работу|при[её]м\s+на\s+работу|оформлен\p{L}*\s+в\s+штат|поступил\p{L}*\s+исполнительн\p{L}*\s+лист/iu.test(
          desc
        )
      ) {
        const inlineSumMatch =
          desc.match(
            /(?:на\s+сумму|в\s+сумме|в\s+размере|стоимостью)[\s:=—-]*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/iu
          ) ||
          desc.match(
            /(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{3,}(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р(?=$|[^\p{L}]))/iu
          );
        if (inlineSumMatch && inlineSumMatch[1]) {
          const parsedInline = parseRussianNumber(inlineSumMatch[1]);
          if (parsedInline > 0) {
            effectiveAmt = parsedInline;
          }
        }
      }

      const inferredRowVat = inferVatFromTextAndCell(desc);

      drafts.push({
        rowKey: `${fileIndex}_${sheetName}_${r + 1}`,
        sourceFileName: fileName,
        date: rowDate || lastValidDate,
        docNumber: req.docNumber || (/^\d{1,3}$/.test((fmtRow[0] ?? '').trim()) ? fmtRow[0].trim() : ''),
        description: desc,
        amount: effectiveAmt,
        vatRate: inferredRowVat.vatRate,
        vatRule: inferredRowVat.vatRule,
        needsAmount: effectiveAmt < 0.01 ? true : undefined,
        amountCalculationNote: amountNote,
        quantity: req.quantity,
        unitPrice: req.unitPrice,
        nomenclatureName: req.nomenclatureHint,
        nomenclatureGroupHint: req.productionObjectHint,
        employeeName: req.employeeHint,
        employeePosition: req.employeePositionHint,
        monthlySalary: req.monthlySalaryHint,
        usefulLifeMonths: req.usefulLifeMonthsHint,
        alimonyRecipientName: req.alimonyRecipientHint,
        alimonyRecipientInn: req.alimonyRecipientHint ? req.inn || undefined : undefined,
        alimonyRatePercent: req.alimonyRatePercentHint,
        alimonyShareLabel: req.alimonyShareLabelHint,
        financialNotesSummary: req.financialNotesSummaryHint,
        counterpartyName: req.counterparty,
        counterpartyInn: req.inn,
        counterpartyKpp: req.kpp,
        counterpartyBankAccount: req.bankAccount || undefined,
        counterpartyBik: req.bik || undefined,
        counterpartyBankName: req.bankName || undefined,
        counterpartyCorrAccount: req.corrAccount || undefined,
        counterpartySource:
          req.inn.length === 10 || req.inn.length === 12 ? 'excel_explicit' : undefined,
        organizationBik: sheetDefaults.defaultBik,
        organizationBankName: sheetDefaults.defaultBankName,
        organizationBankAccount: sheetDefaults.orgBankAccount || undefined,
        contractNumber: req.contractNumber || undefined,
        contractDate: req.contractDate || undefined,
      });
    }
  }

  return { drafts, skipped, sheetDefaults };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

export function parseFreeTextOrDelimitedOperations(
  text: string,
  fileName: string,
  db1C: Database1CSnapshot | null,
  options?: { reportingYear?: number }
): RawDraftOperationInput[] {
  if (/1CClientBankExchange|СекцияДокумент\s*=/i.test(text)) {
    return parse1CClientBankExchange(text, fileName, db1C, options);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const effYear = options?.reportingYear ?? DEFAULT_REPORTING_YEAR;

  const sampleLines = lines.slice(0, 5);
  const countChar = (ch: string) =>
    sampleLines.reduce((acc, l) => acc + (l.split(ch).length - 1), 0);

  const tabCount = countChar('\t');
  const semiCount = countChar(';');
  const commaCount = countChar(',');

  if (tabCount >= sampleLines.length) {
    const matrix = text
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => l.split('\t').map((c) => c.trim()));
    const parsed = parseRowsMatrixDetailed({
      rawMatrix: matrix,
      formattedMatrix: matrix,
      fileName,
      fileIndex: 0,
      sheetName: 'TSV',
      reportingYear: effYear,
    });
    if (parsed.drafts.length > 0) return parsed.drafts;
  }

  if (semiCount >= sampleLines.length * 2) {
    const matrix = lines.map((l) => splitDelimitedLine(l, ';'));
    const parsed = parseRowsMatrixDetailed({
      rawMatrix: matrix,
      formattedMatrix: matrix,
      fileName,
      fileIndex: 0,
      sheetName: 'CSV',
      reportingYear: effYear,
    });
    if (parsed.drafts.length > 0) return parsed.drafts;
  }

  if (lines.length >= 2 && commaCount >= sampleLines.length * 3) {
    const matrix = lines.map((l) => splitDelimitedLine(l, ','));
    const parsed = parseRowsMatrixDetailed({
      rawMatrix: matrix,
      formattedMatrix: matrix,
      fileName,
      fileIndex: 0,
      sheetName: 'CSV',
      reportingYear: effYear,
    });
    if (parsed.drafts.length > 0) return parsed.drafts;
  }

  // Parse free-form / numbered / tab-pasted Russian accounting operation lines
  const drafts: RawDraftOperationInput[] = [];
  let lastLineDate = options?.reportingYear
    ? `${options.reportingYear}-01-01`
    : db1C?.periodStart ?? `${DEFAULT_REPORTING_YEAR}-01-01`;

  lines.forEach((rawLine, lineIdx) => {
    const tabParts = rawLine.includes('\t')
      ? rawLine.split('\t').map((p) => p.trim()).filter(Boolean)
      : null;

    let trailingTabAmount = 0;
    let cleanedLineText = rawLine;
    if (tabParts && tabParts.length >= 2) {
      const lastCell = tabParts[tabParts.length - 1];
      const digitsOnly = lastCell.replace(/\D/g, '');
      if (
        /^[-+]?\d[\d\s\u00A0]*(?:[.,]\d{1,2})?(?:\s*(?:₽|руб\.?|р\.?))?$/iu.test(lastCell) &&
        digitsOnly.length <= 15 &&
        digitsOnly.length !== 20
      ) {
        trailingTabAmount = Math.abs(parseRussianNumber(lastCell));
      }
      // Build clean description without pure-date first column or pure-amount last column
      const descParts = tabParts.filter((cell, idx) => {
        if (idx === 0 && /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/.test(cell)) {
          return false;
        }
        if (idx === tabParts.length - 1 && trailingTabAmount > 0) {
          return false;
        }
        return true;
      });
      if (descParts.length > 0) {
        cleanedLineText = descParts.join(' ');
      }
    }

    const line = cleanedLineText
      .replace(/^(?!\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\d+[.)]\s+/, '')
      .trim();
    if (line.length < 8) return;

    const dateSource = tabParts ? rawLine : line;
    const dateMatch = dateSource.match(
      /(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}|\b\d{1,2}\s+(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё.]*)/iu
    );
    let date = '';
    if (dateMatch) {
      date = options?.reportingYear
        ? normalizeOperationDateToReportingYear(dateMatch[1], options.reportingYear)
        : normalizeDateISO(dateMatch[1]) ||
          normalizeOperationDateToReportingYear(dateMatch[1], DEFAULT_REPORTING_YEAR);
    }
    if (date) {
      lastLineDate = date;
    } else {
      date = lastLineDate;
    }

    const req = extractRequisitesFromFreeText(line, options?.reportingYear);

    let amount = trailingTabAmount;
    let lineAmountNote: string | undefined;
    if (amount <= 0) {
      if (req.multiSumTotal && req.multiSumTotal > 0) {
        amount = req.multiSumTotal;
        lineAmountNote = req.multiSumNote;
      } else if (req.quantity && req.unitPrice && req.quantity > 0 && req.unitPrice > 0) {
        amount = Math.round((req.quantity * req.unitPrice + Number.EPSILON) * 100) / 100;
      } else if (!/поступил\p{L}*\s+исполнительн\p{L}*\s+лист/iu.test(line)) {
        const rubMatch = line.match(
          /(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р(?=$|[^\p{L}]))/iu
        );
        if (rubMatch) {
          amount = parseRussianNumber(rubMatch[1]);
        } else {
          const sumMatch = line.match(
            /(?:на\s+сумму|сумма|оплат\w+|перечислен\w+|начислен\w+)[^0-9]*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{4,}(?:[.,]\d{1,2})?)/i
          );
          if (sumMatch) {
            amount = parseRussianNumber(sumMatch[1]);
          }
        }
      }
    }

    const looksLikeAccountingOp =
      amount > 0 ||
      Boolean(req.monthlySalaryHint) ||
      Boolean(req.alimonyRecipientHint) ||
      /перечислен|поступил|оплачен|реализован|отгружен|начислен|выда[лн]|выплат|уплат|списан|принят|при[её]м\s+на\s+работу|оформлен\p{L}*\s+в\s+штат|оказан|передан|отпущен|израсходован|введ[её]н|выпущен|оприходован|перемещ|снят|внесен|закрыт|амортизац|приобретен|исполнительн\p{L}*\s+лист|вексел/iu.test(
        line
      );

    if (!looksLikeAccountingOp) return;

    const inferredLineVat = inferVatFromTextAndCell(line);

    drafts.push({
      rowKey: `txt_${fileName}_${lineIdx + 1}`,
      sourceFileName: fileName,
      date,
      docNumber: req.docNumber,
      description: line,
      amount,
      amountCalculationNote: lineAmountNote,
      vatRate: inferredLineVat.vatRate,
      vatRule: inferredLineVat.vatRule,
      needsAmount: amount <= 0 ? true : undefined,
      quantity: req.quantity,
      unitPrice: req.unitPrice,
      nomenclatureName: req.nomenclatureHint,
      nomenclatureGroupHint: req.productionObjectHint,
      employeeName: req.employeeHint,
      employeePosition: req.employeePositionHint,
      monthlySalary: req.monthlySalaryHint,
      usefulLifeMonths: req.usefulLifeMonthsHint,
      alimonyRecipientName: req.alimonyRecipientHint,
      alimonyRecipientInn: req.alimonyRecipientHint ? req.inn || undefined : undefined,
      alimonyRatePercent: req.alimonyRatePercentHint,
      alimonyShareLabel: req.alimonyShareLabelHint,
      financialNotesSummary: req.financialNotesSummaryHint,
      counterpartyName: req.counterparty,
      counterpartyInn: req.inn,
      counterpartyKpp: req.kpp,
      counterpartyBankAccount: req.bankAccount || undefined,
      counterpartyBik: req.bik || undefined,
      counterpartyBankName: req.bankName || undefined,
      counterpartyCorrAccount: req.corrAccount || undefined,
      counterpartySource:
        req.inn.length === 10 || req.inn.length === 12 ? 'excel_explicit' : undefined,
      contractNumber: req.contractNumber || undefined,
      contractDate: req.contractDate || undefined,
    });
  });

  return drafts;
}

export function parseXml1CDocuments(
  xmlText: string,
  fileName: string,
  options?: { reportingYear?: number }
): RawDraftOperationInput[] {
  const drafts: RawDraftOperationInput[] = [];

  const getTag = (block: string, tagNames: string[]): string => {
    for (const tag of tagNames) {
      const re = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i');
      const m = block.match(re);
      if (m && m[1]) {
        const inner = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (inner) return inner;
      }
    }
    return '';
  };

  const docRegex =
    /<(?:[\w-]+:)?(Документ\.[А-Яа-яЁёA-Za-z0-9_]+|Документ|DocumentObject\.[A-Za-z0-9_]+)(?=\s|>|\/)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/gi;

  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = docRegex.exec(xmlText)) !== null) {
    idx++;
    const tagType = match[1];
    const body = match[2];

    const rawDate = getTag(body, ['Дата', 'ДатаДокумента', 'Date']);
    const date = options?.reportingYear
      ? normalizeOperationDateToReportingYear(rawDate, options.reportingYear)
      : normalizeDateISO(rawDate);
    const docNumber = getTag(body, ['Номер', 'НомерДокумента', 'Number']);
    const amount = parseRussianNumber(
      getTag(body, ['Сумма', 'СуммаДокумента', 'СуммаВзаиморасчетов', 'Amount'])
    );
    if (amount <= 0) continue;

    const cpBlockMatch = body.match(
      /<(?:[\w-]+:)?(Контрагент|Плательщик|Получатель|Поставщик|Покупатель)>([\s\S]*?)<\/(?:[\w-]+:)?\1>/i
    );
    const cpBlock = cpBlockMatch ? cpBlockMatch[2] : body;
    const cpName = getTag(cpBlock, ['Наименование', 'НаименованиеПолное', 'Name']);
    const cpInn = getTag(cpBlock, ['ИНН', 'INN']).replace(/\D/g, '');
    const cpKpp = getTag(cpBlock, ['КПП', 'KPP']).replace(/\D/g, '');

    const ctrBlockMatch = body.match(
      /<(?:[\w-]+:)?(Договор|ДоговорКонтрагента)>([\s\S]*?)<\/(?:[\w-]+:)?\1>/i
    );
    const ctrName = ctrBlockMatch
      ? getTag(ctrBlockMatch[2], ['Наименование', 'Номер'])
      : '';

    const comment =
      getTag(body, ['НазначениеПлатежа', 'Комментарий', 'Содержание']) ||
      `Документ XML (${tagType}) № ${docNumber}`;
    const vatSum = parseRussianNumber(getTag(body, ['СуммаНДС', 'НДС']));

    let directionHint: 'in' | 'out' | undefined;
    if (/СписаниеБезналичных|ПлатежноеПоручениеИсходящее|ВыдачаНаличных/i.test(tagType)) {
      directionHint = 'out';
    } else if (/ПоступлениеБезналичных|ПоступлениеНаРасчетныйСчет|ПоступлениеНаличных/i.test(tagType)) {
      directionHint = 'in';
    }

    const descriptionPrefix =
      /Реализация|АктВыполненныхРабот/i.test(tagType) && !/реализац/i.test(comment)
        ? `Реализация: ${comment}`
        : /ПоступлениеТоваров|ПоступлениеАкты/i.test(tagType) && !/поступлен/i.test(comment)
          ? `Поступление: ${comment}`
          : comment;

    drafts.push({
      rowKey: `xml_${fileName}_${idx}`,
      sourceFileName: fileName,
      date,
      docNumber,
      description: descriptionPrefix,
      amount,
      vatAmount: vatSum > 0 ? vatSum : undefined,
      counterpartyName: cpName,
      counterpartyInn: cpInn,
      counterpartyKpp: cpKpp,
      counterpartySource: cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : undefined,
      contractName: ctrName,
      directionHint,
      hasInvoiceSF: /СчетФактура|УПД/i.test(body),
    });
  }

  return drafts;
}

function parseJsonOperationsArray(
  raw: unknown,
  fileName: string,
  reportingYear: number
): RawDraftOperationInput[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as Record<string, unknown>).operations)
      ? ((raw as Record<string, unknown>).operations as unknown[])
      : [];

  const drafts: RawDraftOperationInput[] = [];
  arr.forEach((item, idx) => {
    if (typeof item !== 'object' || item === null) return;
    const r = item as Record<string, unknown>;
    const amount = parseRussianNumber(
      r['Сумма'] ?? r['СуммаДокумента'] ?? r['amount'] ?? r['total']
    );
    const description = String(
      r['Содержание'] ?? r['НазначениеПлатежа'] ?? r['Описание'] ?? r['description'] ?? ''
    ).trim();
    if (amount <= 0 && !description) return;

    const rawDate = r['Дата'] ?? r['Период'] ?? r['date'] ?? '';
    const date = normalizeOperationDateToReportingYear(rawDate, reportingYear);
    const req = extractRequisitesFromFreeText(description, reportingYear);
    const cpInn =
      String(r['ИНН'] ?? r['counterpartyInn'] ?? '').replace(/\D/g, '') || req.inn;

    drafts.push({
      rowKey: `json_${fileName}_${idx + 1}`,
      sourceFileName: fileName,
      date,
      docNumber: String(r['Номер'] ?? r['docNumber'] ?? req.docNumber ?? '').trim(),
      description: description || 'Операция JSON',
      amount: Math.max(0, amount),
      needsAmount: amount <= 0 ? true : undefined,
      vatRate: r['СтавкаНДС'] !== undefined ? Number(r['СтавкаНДС']) : undefined,
      vatAmount: r['СуммаНДС'] !== undefined ? parseRussianNumber(r['СуммаНДС']) : undefined,
      counterpartyName:
        String(r['Контрагент'] ?? r['counterpartyName'] ?? r['counterparty'] ?? '').trim() ||
        req.counterparty,
      counterpartyInn: cpInn,
      counterpartyKpp:
        String(r['КПП'] ?? r['counterpartyKpp'] ?? '').replace(/\D/g, '') || req.kpp,
      counterpartyBankAccount: req.bankAccount || undefined,
      counterpartyBik: req.bik || undefined,
      counterpartySource: cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : undefined,
      contractName: String(r['Договор'] ?? r['contractName'] ?? '').trim(),
      nomenclatureName: String(r['Номенклатура'] ?? r['nomenclatureName'] ?? req.nomenclatureHint ?? '').trim(),
      nomenclatureGroupHint:
        String(r['НоменклатурнаяГруппа'] ?? r['Объект'] ?? req.productionObjectHint ?? '').trim() ||
        undefined,
      employeeName:
        String(r['Сотрудник'] ?? r['МОЛ'] ?? r['employeeName'] ?? req.employeeHint ?? '').trim() ||
        undefined,
      warehouseName: String(r['Склад'] ?? r['warehouseName'] ?? '').trim(),
      explicitDebit: normalizeAccountCode1C(String(r['Дебет'] ?? r['СчетДт'] ?? '')),
      explicitCredit: normalizeAccountCode1C(String(r['Кредит'] ?? r['СчетКт'] ?? '')),
    });
  });
  return drafts;
}

function expandWorksheetVerticalDateMerges(sheet: XLSX.WorkSheet, rawMatrix: unknown[][], fmtMatrix: string[][]): void {
  const merges = sheet['!merges'];
  if (!Array.isArray(merges) || merges.length === 0) return;

  for (const m of merges) {
    // Only propagate vertical 1-column merges (e.g. merged "Дата" cell across multiple operations on the same day)
    if (m.s.c === m.e.c && m.e.r > m.s.r) {
      const col = m.s.c;
      const topRaw = rawMatrix[m.s.r]?.[col];
      const topFmt = fmtMatrix[m.s.r]?.[col] ?? '';
      // Propagate only if top cell looks like a date/period (never duplicate monetary sums!)
      const looksLikeDate =
        topRaw instanceof Date ||
        Boolean(normalizeOperationDateToReportingYear(topRaw, DEFAULT_REPORTING_YEAR)) ||
        Boolean(normalizeOperationDateToReportingYear(topFmt, DEFAULT_REPORTING_YEAR));
      if (!looksLikeDate) continue;

      for (let r = m.s.r + 1; r <= m.e.r; r++) {
        if (Array.isArray(rawMatrix[r]) && (rawMatrix[r][col] === '' || rawMatrix[r][col] === undefined || rawMatrix[r][col] === null)) {
          rawMatrix[r][col] = topRaw;
        }
        if (Array.isArray(fmtMatrix[r]) && !fmtMatrix[r][col]) {
          fmtMatrix[r][col] = topFmt;
        }
      }
    }
  }
}

export function processBatchFiles(
  files: BatchImportFileInput[],
  currentDb1C: Database1CSnapshot | null,
  options?: BatchImportOptions
): BatchImportResult {
  const reportingYear = options?.reportingYear ?? DEFAULT_REPORTING_YEAR;
  let workingDb = currentDb1C;
  let updatedDb1C: Database1CSnapshot | null = null;
  const rawDraftsQueue: RawDraftOperationInput[] = [];
  const fileSummaries: BatchImportResult['fileSummaries'] = [];
  const errors: string[] = [];
  const allSkippedReasons: SkippedExcelRowReason[] = [];

  let detectedDefaultBik = DEFAULT_SBERBANK_BIK;
  let detectedDefaultBankName = DEFAULT_SBERBANK_NAME;
  let detectedDefaultCorr = DEFAULT_SBERBANK_CORR;
  const collectedHeaderNotes: string[] = [];

  // First pass: check if any uploaded file is a 1C JSON database export so subsequent files in the SAME batch bind against it
  const nonDbFiles: Array<{ file: BatchImportFileInput; fileIndex: number }> = [];
  files.forEach((file, idx) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'json') {
      try {
        const text = decodeSmartText(file.buffer);
        const parsed = JSON.parse(text);
        if (isLikely1CDatabaseExport(parsed)) {
          const snapshot = normalize1CDatabaseExport(parsed, file.name);
          workingDb = snapshot;
          updatedDb1C = snapshot;
          if (snapshot.organization.bik) {
            detectedDefaultBik = snapshot.organization.bik;
            detectedDefaultBankName = snapshot.organization.bankName || detectedDefaultBankName;
          }
          fileSummaries.push({
            fileName: file.name,
            kind: '1c_db_json',
            parsedCount:
              snapshot.rawBalances.length + snapshot.postings.length + snapshot.documents.length,
            duplicatesCount: 0,
            notes: `База 1С загружена: ${snapshot.organization.name || 'Организация'}`,
          });
          return;
        }
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Ошибка чтения JSON'}`);
        return;
      }
    }
    nonDbFiles.push({ file, fileIndex: idx + 1 });
  });

  // Second pass: extract all operation rows from every file WITHOUT dropping empty-amount rows or deduplicating across files
  const draftsCountPerFile = new Map<number, RawDraftOperationInput[]>();

  for (const { file, fileIndex } of nonDbFiles) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      const fileDrafts: RawDraftOperationInput[] = [];

      if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
        const wb = XLSX.read(file.buffer, { type: 'array', cellDates: false });
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: '',
          });
          const formattedMatrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            raw: false,
            defval: '',
          });

          expandWorksheetVerticalDateMerges(sheet, rawMatrix, formattedMatrix);

          const parsedSheet = parseRowsMatrixDetailed({
            rawMatrix,
            formattedMatrix,
            fileName: file.name,
            fileIndex,
            sheetName,
            reportingYear,
          });

          if (parsedSheet.sheetDefaults.defaultBik) {
            detectedDefaultBik = parsedSheet.sheetDefaults.defaultBik;
            detectedDefaultBankName = parsedSheet.sheetDefaults.defaultBankName;
            detectedDefaultCorr = parsedSheet.sheetDefaults.defaultCorrAccount;
          }
          for (const note of parsedSheet.sheetDefaults.rawHeaderNotes) {
            if (!collectedHeaderNotes.includes(note) && collectedHeaderNotes.length < 8) {
              collectedHeaderNotes.push(note);
            }
          }

          fileDrafts.push(...parsedSheet.drafts);
          allSkippedReasons.push(...parsedSheet.skipped);
        }
      } else if (ext === 'xml') {
        const xmlText = decodeSmartText(file.buffer);
        fileDrafts.push(...parseXml1CDocuments(xmlText, file.name, { reportingYear }));
      } else if (ext === 'json') {
        const jsonText = decodeSmartText(file.buffer);
        const parsed = JSON.parse(jsonText);
        fileDrafts.push(...parseJsonOperationsArray(parsed, file.name, reportingYear));
      } else {
        const text = decodeSmartText(file.buffer);
        fileDrafts.push(
          ...parseFreeTextOrDelimitedOperations(text, file.name, workingDb, {
            reportingYear,
          })
        );
      }

      draftsCountPerFile.set(fileIndex, fileDrafts);
      rawDraftsQueue.push(...fileDrafts);
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Не удалось разобрать файл'}`);
    }
  }

  // Third pass: Stable chronological ordering across all uploaded files (date -> fileIndex -> rowOrder)
  // so hiring in Q1 feeds payroll in Q1-Q3, advances feed receipts, and OS commissioning feeds depreciation!
  const indexedDrafts = rawDraftsQueue.map((draft, origIdx) => {
    const m = (draft.rowKey ?? '').match(/^(\d+)_/);
    const fIdx = m ? Number(m[1]) : 999;
    return { draft, fIdx, origIdx };
  });
  indexedDrafts.sort((a, b) => {
    const dA = a.draft.date || '9999-12-31';
    const dB = b.draft.date || '9999-12-31';
    if (dA !== dB) return dA.localeCompare(dB);
    if (a.fIdx !== b.fIdx) return a.fIdx - b.fIdx;
    return a.origIdx - b.origIdx;
  });

  const priorExistingOps = options?.priorOperations ?? [];
  let runningVirtualState = createInitialVirtual1CState(workingDb);
  priorExistingOps.forEach((pOp, idx) => {
    if (pOp.includeInProcessing) {
      advanceVirtual1CStateWithOperation(runningVirtualState, pOp, idx + 1);
    }
  });

  const rawGeneratedOperations: QueuedOperation[] = [];
  const generatedByFileIndex = new Map<number, QueuedOperation[]>();

  indexedDrafts.forEach(({ draft, fIdx }, globalIdx) => {
    const seqContext: BatchSequentialContext = {
      priorOperations: [...priorExistingOps, ...rawGeneratedOperations],
      virtualStateBefore: runningVirtualState,
      reportingYear,
      defaultBik: detectedDefaultBik,
      defaultBankName: detectedDefaultBankName,
      assumeInvoiceOnVatPurchase: true,
    };

    const deterministicId = `op-${reportingYear}-${globalIdx + 1}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const op = bindAndGenerateOperation(draft, workingDb, deterministicId, seqContext);
    rawGeneratedOperations.push(op);
    if (op.includeInProcessing) {
      advanceVirtual1CStateWithOperation(
        runningVirtualState,
        op,
        priorExistingOps.length + rawGeneratedOperations.length
      );
    }
  });

  const allCombinedWithStep00 = attachVirtualStateStep00ToOperations(
    [...priorExistingOps, ...rawGeneratedOperations],
    workingDb
  );
  const generatedOperations = allCombinedWithStep00.slice(priorExistingOps.length);
  indexedDrafts.forEach(({ fIdx }, idx) => {
    const op = generatedOperations[idx];
    if (op && fIdx > 0 && fIdx < 999) {
      const list = generatedByFileIndex.get(fIdx) ?? [];
      list.push(op);
      generatedByFileIndex.set(fIdx, list);
    }
  });

  for (const { file, fileIndex } of nonDbFiles) {
    const fileOps =
      generatedByFileIndex.get(fileIndex) ??
      generatedOperations.filter((o) => o.sourceFileName === file.name);
    const dupCount = fileOps.filter((o) => o.isDuplicateIn1C).length;
    const postingsInFile = fileOps.reduce((s, o) => s + o.entries.length, 0);
    fileSummaries.push({
      fileName: file.name,
      kind: 'operations',
      parsedCount: fileOps.length,
      duplicatesCount: dupCount,
      notes: `Импортировано операций: ${fileOps.length}, сформировано проводок: ${postingsInFile}`,
    });
  }

  const totalGeneratedPostings = generatedOperations.reduce(
    (sum, op) => sum + op.entries.length,
    0
  );

  const completenessStats: BatchImportCompletenessStats = {
    filesUploaded: nonDbFiles.length,
    excelOperationRowsTotal: generatedOperations.length + allSkippedReasons.length,
    importedOperationsCount: generatedOperations.length,
    generatedPostingsCount: totalGeneratedPostings,
    skippedRowsCount: allSkippedReasons.length,
    skippedReasons: allSkippedReasons,
    sheetDefaults: {
      defaultBik: detectedDefaultBik,
      defaultBankName: detectedDefaultBankName,
      defaultCorrAccount: detectedDefaultCorr,
      reportingYear,
      rawHeaderNotes: collectedHeaderNotes,
    },
  };

  return {
    updatedDb1C,
    operations: generatedOperations,
    fileSummaries,
    completenessStats,
    errors,
  };
}

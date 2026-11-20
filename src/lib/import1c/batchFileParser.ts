import * as XLSX from 'xlsx';
import {
  isLikely1CDatabaseExport,
  normalize1CDatabaseExport,
  normalizeAccountCode1C,
  normalizeDateISO,
  parseRussianNumber,
} from '@/lib/import1c/json1CSyncNormalizer';
import {
  BatchSequentialContext,
  bindAndGenerateOperation,
  RawDraftOperationInput,
} from '@/lib/engine/postingEngine';
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

  // Extract quantity & unitPrice from text: e.g. "133 шт по 9300 руб за шт с НДС" or "133 шт. * 9 300,00 руб."
  let quantity: number | undefined;
  let unitPrice: number | undefined;
  const qtyPriceMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|рул\.?|п\.?\s*м\.?|кв\.?\s*м\.?|м2|кг|т|тонн\p{L}*|л)\s*(?:по\s*(?:цене\s*)?|[*×xх]\s*)(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)/iu
  );
  if (qtyPriceMatch) {
    const q = parseRussianNumber(qtyPriceMatch[1]);
    const p = parseRussianNumber(qtyPriceMatch[2]);
    if (q > 0) quantity = q;
    if (p > 0) unitPrice = p;
  } else {
    const qtyOnlyMatch = text.match(
      /(?:в\s+кол(?:-ве|ичестве)\s*)?(\d+(?:[.,]\d+)?)\s*(?:шт\.?|ед\.?|компл\.?|упак\.?|рул\.?|кв\.?\s*м\.?|м2|кг|тонн\p{L}*)(?=$|[^\p{L}])/iu
    );
    if (qtyOnlyMatch) {
      const q = parseRussianNumber(qtyOnlyMatch[1]);
      if (q > 0) quantity = q;
    }
  }

  // Extract nomenclature hint before quantity (e.g. "за оконные блоки 133 шт" / "Поступили от ООО «Конкурент» оконные блоки 133 шт")
  let nomenclatureHint: string | undefined;
  const nomBeforeQty = text.match(
    /(?:за\s+|поступили(?:\s+от\s+(?:ООО|АО|ПАО|ЗАО|ИП)\s*(?:[«"'„“][^»"'”]+[»"'”]|\S+))?\s+|приобретены\s+|оприходованы\s+)([А-Яа-яЁё][А-Яа-яЁё0-9\s-]{2,45}?)\s+\d+(?:[.,]\d+)?\s*(?:шт|ед|компл|упак|рул|м2|кг|т)/iu
  );
  if (nomBeforeQty && nomBeforeQty[1]) {
    const cleanedNom = nomBeforeQty[1]
      .replace(/^(?:товары|материалы|сырье)\s+/iu, '')
      .trim();
    if (cleanedNom.length >= 3) {
      nomenclatureHint = cleanedNom.charAt(0).toUpperCase() + cleanedNom.slice(1);
    }
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
  const nomCell = getFormattedCol([/^номенклатур/i, /^товар/i, /^наименован.*товар/i, /^услуг/i, /^item/i]);
  const whCell = getFormattedCol([/^склад/i, /^warehouse/i]);
  const expCell = getFormattedCol([/стать[яи]\s*затрат/i, /^субконто/i]);
  const ddsCell = getFormattedCol([/стать[яи]\s*ддс/i, /движен.*денежн/i]);
  const qtyCell = getFormattedCol([/^количеств/i, /^кол-во/i, /^qty/i]);
  const priceCell = getFormattedCol([/^цена/i, /^стоимость\s*ед/i, /^price/i]);
  const vatCell = getFormattedCol([/^сумма\s*ндс/i, /^ндс\s*сумма/i, /^ндс[,\s]*руб/i]);
  const vatRateCell = getFormattedCol([/^ставка\s*ндс/i, /^%\s*ндс/i, /^ндс$/i]);
  const debitCell = normalizeAccountCode1C(getFormattedCol([/^счет\s*дт/i, /^дебет$/i, /^дт$/i]));
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

  let vatRate: number | undefined;
  let vatRule: 'included' | 'on_top' | 'none' | undefined;
  if (/без\s*ндс|не\s*облаг/i.test(`${vatRateCell} ${description}`)) {
    vatRule = 'none';
    vatRate = 0;
  } else if (/плюс\s*ндс|сверху\s*ндс|\+\s*ндс/i.test(description)) {
    vatRule = 'on_top';
    const m = `${vatRateCell} ${description}`.match(/(\d{1,2})\s*%/);
    if (m) vatRate = Number(m[1]);
  } else if (vatRateCell) {
    const m = vatRateCell.match(/(\d{1,2})/);
    if (m) vatRate = Number(m[1]);
  }

  const vatAmountParsed = parseRussianNumber(vatCell);
  const qtyParsed = parseRussianNumber(qtyCell) || extracted.quantity || 0;
  const unitPriceParsed = parseRussianNumber(priceCell) || extracted.unitPrice || 0;

  let effectiveAmount = Math.abs(amount);
  let amountCalculationNote: string | undefined;
  if (effectiveAmount < 0.01 && qtyParsed > 0 && unitPriceParsed > 0) {
    effectiveAmount = Math.round((qtyParsed * unitPriceParsed + Number.EPSILON) * 100) / 100;
    amountCalculationNote = `Рассчитано из текста операции: ${qtyParsed} × ${unitPriceParsed.toFixed(2)} ₽ = ${effectiveAmount.toFixed(2)} ₽`;
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
      warehouseName: whCell,
      expenseItemName: expCell,
      cashFlowItemName: ddsCell,
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
      if (effectiveAmt < 0.01 && req.quantity && req.unitPrice) {
        effectiveAmt = Math.round((req.quantity * req.unitPrice + Number.EPSILON) * 100) / 100;
        amountNote = `Рассчитано из текста: ${req.quantity} × ${req.unitPrice.toFixed(2)} ₽ = ${effectiveAmt.toFixed(2)} ₽`;
      }

      drafts.push({
        rowKey: `${fileIndex}_${sheetName}_${r + 1}`,
        sourceFileName: fileName,
        date: rowDate || lastValidDate,
        docNumber: req.docNumber || (/^\d{1,3}$/.test((fmtRow[0] ?? '').trim()) ? fmtRow[0].trim() : ''),
        description: desc,
        amount: effectiveAmt,
        needsAmount: effectiveAmt < 0.01 ? true : undefined,
        amountCalculationNote: amountNote,
        quantity: req.quantity,
        unitPrice: req.unitPrice,
        nomenclatureName: req.nomenclatureHint,
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

  if (tabCount >= sampleLines.length * 2) {
    const matrix = lines.map((l) => l.split('\t').map((c) => c.trim()));
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

  // Parse free-form / numbered Russian accounting operation lines
  const drafts: RawDraftOperationInput[] = [];
  let lastLineDate = options?.reportingYear
    ? `${options.reportingYear}-01-01`
    : db1C?.periodStart ?? `${DEFAULT_REPORTING_YEAR}-01-01`;

  lines.forEach((rawLine, lineIdx) => {
    const line = rawLine
      .replace(/^(?!\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\d+[.)]\s+/, '')
      .trim();
    if (line.length < 8) return;

    const dateMatch = line.match(
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

    let amount = 0;
    if (req.quantity && req.unitPrice && req.quantity > 0 && req.unitPrice > 0) {
      amount = Math.round((req.quantity * req.unitPrice + Number.EPSILON) * 100) / 100;
    } else {
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

    const looksLikeAccountingOp =
      amount > 0 ||
      /перечислен|поступил|оплачен|реализован|отгружен|начислен|выдан|уплат|списан|принят|оказан/iu.test(
        line
      );

    if (!looksLikeAccountingOp) return;

    drafts.push({
      rowKey: `txt_${fileName}_${lineIdx + 1}`,
      sourceFileName: fileName,
      date,
      docNumber: req.docNumber,
      description: line,
      amount,
      needsAmount: amount <= 0 ? true : undefined,
      quantity: req.quantity,
      unitPrice: req.unitPrice,
      nomenclatureName: req.nomenclatureHint,
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

  // Third pass: Sequential binding & multi-entry generation across the entire queue
  // so Row 1 sees 68/69 balances and Row 3 sees Row 2's 100% supplier advance!
  const priorExistingOps = options?.priorOperations ?? [];
  const generatedOperations: QueuedOperation[] = [];
  const generatedByFileIndex = new Map<number, QueuedOperation[]>();

  rawDraftsQueue.forEach((draft, globalIdx) => {
    const seqContext: BatchSequentialContext = {
      priorOperations: [...priorExistingOps, ...generatedOperations],
      reportingYear,
      defaultBik: detectedDefaultBik,
      defaultBankName: detectedDefaultBankName,
      assumeInvoiceOnVatPurchase: true,
    };

    const deterministicId = `op-${reportingYear}-${globalIdx + 1}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const op = bindAndGenerateOperation(draft, workingDb, deterministicId, seqContext);
    generatedOperations.push(op);

    // Track per-file summary
    const m = (draft.rowKey ?? '').match(/^(\d+)_/);
    const fIdx = m ? Number(m[1]) : -1;
    if (fIdx > 0) {
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

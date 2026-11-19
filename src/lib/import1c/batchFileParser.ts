import * as XLSX from 'xlsx';
import {
  isLikely1CDatabaseExport,
  normalize1CDatabaseExport,
  normalizeAccountCode1C,
  normalizeDateISO,
  parseRussianNumber,
} from '@/lib/import1c/json1CSyncNormalizer';
import {
  bindAndGenerateOperation,
  RawDraftOperationInput,
} from '@/lib/engine/postingEngine';
import { Database1CSnapshot, QueuedOperation } from '@/types/accounting';

export interface BatchImportFileInput {
  name: string;
  buffer: ArrayBuffer;
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
  errors: string[];
}

export function decodeSmartText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // 1CClientBankExchange and Russian bank CSVs often use Windows-1251
  if (utf8.includes('\uFFFD') || /Кодировка\s*=\s*Windows/i.test(utf8)) {
    try {
      const win1251 = new TextDecoder('windows-1251', { fatal: false }).decode(bytes);
      // Verify win1251 actually decoded Cyrillic letters
      if (/[А-Яа-яЁё]/.test(win1251)) {
        return win1251.replace(/^\uFEFF/, '');
      }
    } catch {
      // Fallback to utf8
    }
  }
  return utf8.replace(/^\uFEFF/, '');
}

function extractRequisitesFromFreeText(text: string): {
  inn: string;
  kpp: string;
  counterparty: string;
  contractNumber: string;
  contractDate: string;
  docNumber: string;
} {
  const innMatch = text.match(/ИНН[\s:№]*(\d{10}|\d{12})\b/i);
  const kppMatch = text.match(/КПП[\s:№]*(\d{9})\b/i);

  let counterparty = '';
  const legalQuoted = text.match(
    /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ЗАО|ГУП|МУП)\s*[«"„“]([^»"”]+)[»"”]/iu
  );
  if (legalQuoted) {
    counterparty = `${legalQuoted[1].toUpperCase()} «${legalQuoted[2].trim()}»`;
  } else {
    const ipMatch = text.match(
      /(?:^|[^\p{L}\p{N}])(ИП\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё.]+){1,2})/u
    );
    if (ipMatch) {
      counterparty = ipMatch[1].trim();
    }
  }

  let contractNumber = '';
  let contractDate = '';
  const ctrMatch = text.match(
    /договор[ауом]?\s*(?:поставки|подряда|аренды|оказания услуг)?\s*№\s*([А-Яа-яA-Za-z0-9/_-]+)(?:\s*от\s*(\d{2}[./]\d{2}[./]\d{2,4}|\d{4}-\d{2}-\d{2}))?/i
  );
  if (ctrMatch) {
    contractNumber = ctrMatch[1].trim();
    if (ctrMatch[2]) contractDate = normalizeDateISO(ctrMatch[2]);
  }

  let docNumber = '';
  const docMatch = text.match(
    /(?:счет-фактур\w*|упд|накладн\w*|акт\w*|п\/п|платежн\w+\s+поручен\w*)\s*№\s*([А-Яа-яA-Za-z0-9/_-]+)/i
  );
  if (docMatch) {
    docNumber = docMatch[1].trim();
  }

  return {
    inn: innMatch ? innMatch[1] : '',
    kpp: kppMatch ? kppMatch[1] : '',
    counterparty,
    contractNumber,
    contractDate,
    docNumber,
  };
}

export function parse1CClientBankExchange(
  text: string,
  fileName: string,
  db1C: Database1CSnapshot | null
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
        const amount = parseRussianNumber(currentDoc['Сумма']);
        if (amount > 0) {
          const payerAcc = (currentDoc['ПлательщикСчет'] || currentDoc['ПлательщикРасчСчет'] || '').replace(/\D/g, '');
          const receiverAcc = (currentDoc['ПолучательСчет'] || currentDoc['ПолучательРасчСчет'] || '').replace(/\D/g, '');
          const payerInn = (currentDoc['ПлательщикИНН'] || '').replace(/\D/g, '');
          const receiverInn = (currentDoc['ПолучательИНН'] || '').replace(/\D/g, '');

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

          const date =
            normalizeDateISO(
              direction === 'out'
                ? currentDoc['ДатаСписано'] || currentDoc['Дата']
                : currentDoc['ДатаПоступило'] || currentDoc['Дата']
            ) || normalizeDateISO(currentDoc['Дата']);

          const purpose = currentDoc['НазначениеПлатежа'] || '';
          const reqFromPurpose = extractRequisitesFromFreeText(purpose);

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
            sourceFileName: fileName,
            date,
            docNumber: currentDoc['Номер'] || '',
            description: purpose || `${currentDoc['ВидДокумента'] || 'Платёжное поручение'} № ${currentDoc['Номер'] || ''}`,
            amount,
            vatRate,
            vatRule,
            vatAmount,
            counterpartyName: cpName.trim(),
            counterpartyInn: cpInn,
            counterpartyKpp: cpKpp,
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

function mapTabularRowToDraft(
  headers: string[],
  cells: unknown[],
  fileName: string
): RawDraftOperationInput | null {
  const getCol = (patterns: RegExp[]): string => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h) => pat.test(h));
      if (idx >= 0 && cells[idx] !== undefined && cells[idx] !== null) {
        const val = cells[idx];
        if (val instanceof Date) {
          return val.toISOString().slice(0, 10);
        }
        const s = String(val).trim();
        if (s) return s;
      }
    }
    return '';
  };

  const amountRaw = getCol([
    /^сумма$/i,
    /сумма\s*(с\s*ндс|документа|операции|платежа|рубл)/i,
    /^amount$/i,
    /^итого$/i,
    /^оборот$/i,
  ]);
  let amount = parseRussianNumber(amountRaw);

  // Also support separate Приход / Расход columns in bank/cash Excel tables
  let directionHint: 'in' | 'out' | undefined;
  if (amount === 0) {
    const income = parseRussianNumber(getCol([/^приход/i, /^поступлен/i, /^кредит\s*сумма/i]));
    const outcome = parseRussianNumber(getCol([/^расход/i, /^списан/i, /^дебет\s*сумма/i]));
    if (income > 0) {
      amount = income;
      directionHint = 'in';
    } else if (outcome > 0) {
      amount = outcome;
      directionHint = 'out';
    }
  }

  if (Math.abs(amount) < 0.01) return null;

  const dateRaw = getCol([/^дата/i, /^период/i, /^date$/i]);
  const date = normalizeDateISO(dateRaw);
  const docNumber = getCol([/^номер/i, /^№/i, /док.*№/i, /^doc/i]);
  const description = getCol([
    /содержан/i,
    /назначен/i,
    /описан/i,
    /операци/i,
    /комментар/i,
    /основан/i,
    /^description$/i,
  ]);
  const counterpartyCell = getCol([
    /^контрагент/i,
    /^поставщик/i,
    /^покупатель/i,
    /^плательщик/i,
    /^получатель/i,
    /^организаци/i,
    /^counterparty/i,
  ]);
  const innCell = getCol([/^инн/i, /инн\s*контрагент/i, /^inn$/i]);
  const kppCell = getCol([/^кпп/i, /кпп\s*контрагент/i, /^kpp$/i]);
  const contractCell = getCol([/^договор/i, /^contract/i]);
  const nomCell = getCol([/^номенклатур/i, /^товар/i, /^наименован.*товар/i, /^услуг/i, /^item/i]);
  const whCell = getCol([/^склад/i, /^warehouse/i]);
  const expCell = getCol([/стать[яи]\s*затрат/i, /^субконто/i]);
  const ddsCell = getCol([/стать[яи]\s*ддс/i, /движен.*денежн/i]);
  const qtyCell = getCol([/^количеств/i, /^кол-во/i, /^qty/i]);
  const vatCell = getCol([/^сумма\s*ндс/i, /^ндс\s*сумма/i]);
  const vatRateCell = getCol([/^ставка\s*ндс/i, /^%\s*ндс/i, /^ндс$/i]);
  const debitCell = normalizeAccountCode1C(getCol([/^счет\s*дт/i, /^дебет$/i, /^дт$/i]));
  const creditCell = normalizeAccountCode1C(getCol([/^счет\s*кт/i, /^кредит$/i, /^кт$/i]));

  // Skip summary rows ("Итого", "Всего")
  const joinedText = `${description} ${counterpartyCell} ${nomCell}`.trim();
  if (/^(итого|всего|сальдо)(?=$|[^\p{L}])/iu.test(joinedText) && !date) {
    return null;
  }

  const extracted = extractRequisitesFromFreeText(`${description} ${counterpartyCell} ${contractCell}`);

  let vatRate: number | undefined;
  let vatRule: 'included' | 'on_top' | 'none' | undefined;
  if (/без\s*ндс|не\s*облаг/i.test(`${vatRateCell} ${description}`)) {
    vatRule = 'none';
    vatRate = 0;
  } else if (vatRateCell) {
    const m = vatRateCell.match(/(\d{1,2})/);
    if (m) vatRate = Number(m[1]);
  }

  const vatAmountParsed = parseRussianNumber(vatCell);
  const qtyParsed = parseRussianNumber(qtyCell);

  return {
    sourceFileName: fileName,
    date,
    docNumber: docNumber || extracted.docNumber,
    description: description || nomCell || counterpartyCell || 'Хозяйственная операция',
    amount: Math.abs(amount),
    vatRate,
    vatRule,
    vatAmount: vatAmountParsed > 0 ? vatAmountParsed : undefined,
    quantity: qtyParsed > 0 ? qtyParsed : undefined,
    counterpartyName: counterpartyCell || extracted.counterparty,
    counterpartyInn: innCell.replace(/\D/g, '') || extracted.inn,
    counterpartyKpp: kppCell.replace(/\D/g, '') || extracted.kpp,
    contractName: contractCell,
    contractNumber: extracted.contractNumber || undefined,
    contractDate: extracted.contractDate || undefined,
    nomenclatureName: nomCell,
    warehouseName: whCell,
    expenseItemName: expCell,
    cashFlowItemName: ddsCell,
    directionHint,
    explicitDebit: debitCell || undefined,
    explicitCredit: creditCell || undefined,
  };
}

function parseRowsMatrix(matrix: unknown[][], fileName: string): RawDraftOperationInput[] {
  if (matrix.length === 0) return [];

  // Locate header row within first 15 rows
  let headerRowIdx = -1;
  let bestScore = 0;

  const headerPatterns = [
    /дата|период|date/i,
    /сумма|приход|расход|amount|оборот/i,
    /контрагент|поставщик|покупатель|плательщик|получатель/i,
    /содержан|назначен|описан|операци|номенклатур/i,
    /номер|№|дебет|кредит|инн/i,
  ];

  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const row = matrix[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map((c) => String(c ?? '').trim());
    let score = 0;
    for (const pat of headerPatterns) {
      if (cells.some((c) => c.length <= 45 && pat.test(c))) score++;
    }
    if (score > bestScore && score >= 2) {
      bestScore = score;
      headerRowIdx = i;
    }
  }

  if (headerRowIdx >= 0) {
    const headers = matrix[headerRowIdx].map((c) => String(c ?? '').trim());
    const drafts: RawDraftOperationInput[] = [];
    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row) || row.every((c) => c === null || c === undefined || String(c).trim() === '')) {
        continue;
      }
      const draft = mapTabularRowToDraft(headers, row, fileName);
      if (draft) drafts.push(draft);
    }
    return drafts;
  }

  // Fallback: headerless rows [date, description, amount]
  const drafts: RawDraftOperationInput[] = [];
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const strCells = row.map((c) =>
      c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim()
    );
    const dateCell = strCells.map(normalizeDateISO).find(Boolean) || '';
    const numCandidates = strCells
      .filter((c) => !normalizeDateISO(c) && !/^\d{10,12}$/.test(c.replace(/\s/g, '')))
      .map(parseRussianNumber)
      .filter((n) => n > 0);
    const amount = numCandidates[numCandidates.length - 1] ?? 0;
    const desc = strCells
      .filter((c) => c.length > 4 && !normalizeDateISO(c) && parseRussianNumber(c) !== amount)
      .join(' — ');
    if (amount > 0 && desc) {
      const req = extractRequisitesFromFreeText(desc);
      drafts.push({
        sourceFileName: fileName,
        date: dateCell,
        docNumber: req.docNumber,
        description: desc,
        amount,
        counterpartyName: req.counterparty,
        counterpartyInn: req.inn,
        counterpartyKpp: req.kpp,
        contractNumber: req.contractNumber,
        contractDate: req.contractDate,
      });
    }
  }
  return drafts;
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
  db1C: Database1CSnapshot | null
): RawDraftOperationInput[] {
  if (/1CClientBankExchange|СекцияДокумент\s*=/i.test(text)) {
    return parse1CClientBankExchange(text, fileName, db1C);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // Detect TSV / semicolon CSV / comma CSV
  const sampleLines = lines.slice(0, 5);
  const countChar = (ch: string) =>
    sampleLines.reduce((acc, l) => acc + (l.split(ch).length - 1), 0);

  const tabCount = countChar('\t');
  const semiCount = countChar(';');
  const commaCount = countChar(',');

  if (tabCount >= sampleLines.length * 2) {
    const matrix = lines.map((l) => l.split('\t').map((c) => c.trim()));
    const parsed = parseRowsMatrix(matrix, fileName);
    if (parsed.length > 0) return parsed;
  }

  if (semiCount >= sampleLines.length * 2) {
    const matrix = lines.map((l) => splitDelimitedLine(l, ';'));
    const parsed = parseRowsMatrix(matrix, fileName);
    if (parsed.length > 0) return parsed;
  }

  if (commaCount >= sampleLines.length * 3) {
    const matrix = lines.map((l) => splitDelimitedLine(l, ','));
    const parsed = parseRowsMatrix(matrix, fileName);
    if (parsed.length > 0) return parsed;
  }

  // Parse free-form / numbered Russian accounting operation lines
  const drafts: RawDraftOperationInput[] = [];
  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^(?!\d{1,2}[./]\d{1,2}[./]\d{2,4})\d+[.)]\s+/, '')
      .trim();
    if (line.length < 8) continue;

    // Extract date if present
    const dateMatch = line.match(/(\d{2}[./]\d{2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? normalizeDateISO(dateMatch[1]) : db1C?.periodStart ?? '';

    // Extract amount (prefer explicit ruble marker first, then standalone monetary figure)
    let amount = 0;
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

    if (amount <= 0) continue;

    const req = extractRequisitesFromFreeText(line);
    drafts.push({
      sourceFileName: fileName,
      date,
      docNumber: req.docNumber,
      description: line,
      amount,
      counterpartyName: req.counterparty,
      counterpartyInn: req.inn,
      counterpartyKpp: req.kpp,
      contractNumber: req.contractNumber,
      contractDate: req.contractDate,
    });
  }

  return drafts;
}

export function parseXml1CDocuments(
  xmlText: string,
  fileName: string
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

  // Match EnterpriseData Document.* blocks or CommerceML <Документ> blocks
  const docRegex =
    /<(?:[\w-]+:)?(Документ\.[А-Яа-яЁёA-Za-z0-9_]+|Документ|DocumentObject\.[A-Za-z0-9_]+)(?=\s|>|\/)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = docRegex.exec(xmlText)) !== null) {
    const tagType = match[1];
    const body = match[2];

    const date = normalizeDateISO(getTag(body, ['Дата', 'ДатаДокумента', 'Date']));
    const docNumber = getTag(body, ['Номер', 'НомерДокумента', 'Number']);
    const amount = parseRussianNumber(
      getTag(body, ['Сумма', 'СуммаДокумента', 'СуммаВзаиморасчетов', 'Amount'])
    );
    if (amount <= 0) continue;

    // Counterparty block
    const cpBlockMatch = body.match(
      /<(?:[\w-]+:)?(Контрагент|Плательщик|Получатель|Поставщик|Покупатель)>([\s\S]*?)<\/(?:[\w-]+:)?\1>/i
    );
    const cpBlock = cpBlockMatch ? cpBlockMatch[2] : body;
    const cpName = getTag(cpBlock, ['Наименование', 'НаименованиеПолное', 'Name']);
    const cpInn = getTag(cpBlock, ['ИНН', 'INN']).replace(/\D/g, '');
    const cpKpp = getTag(cpBlock, ['КПП', 'KPP']).replace(/\D/g, '');

    // Contract block
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
      sourceFileName: fileName,
      date,
      docNumber,
      description: descriptionPrefix,
      amount,
      vatAmount: vatSum > 0 ? vatSum : undefined,
      counterpartyName: cpName,
      counterpartyInn: cpInn,
      counterpartyKpp: cpKpp,
      contractName: ctrName,
      directionHint,
      hasInvoiceSF: /СчетФактура|УПД/i.test(body),
    });
  }

  return drafts;
}

function parseJsonOperationsArray(raw: unknown, fileName: string): RawDraftOperationInput[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as Record<string, unknown>).operations)
      ? ((raw as Record<string, unknown>).operations as unknown[])
      : [];

  const drafts: RawDraftOperationInput[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const amount = parseRussianNumber(
      r['Сумма'] ?? r['СуммаДокумента'] ?? r['amount'] ?? r['total']
    );
    if (amount <= 0) continue;

    const date = normalizeDateISO(r['Дата'] ?? r['Период'] ?? r['date'] ?? '');
    const description = String(
      r['Содержание'] ?? r['НазначениеПлатежа'] ?? r['Описание'] ?? r['description'] ?? 'Операция JSON'
    ).trim();

    drafts.push({
      sourceFileName: fileName,
      date,
      docNumber: String(r['Номер'] ?? r['docNumber'] ?? '').trim(),
      description,
      amount,
      vatRate: r['СтавкаНДС'] !== undefined ? Number(r['СтавкаНДС']) : undefined,
      vatAmount: r['СуммаНДС'] !== undefined ? parseRussianNumber(r['СуммаНДС']) : undefined,
      counterpartyName: String(r['Контрагент'] ?? r['counterpartyName'] ?? r['counterparty'] ?? '').trim(),
      counterpartyInn: String(r['ИНН'] ?? r['counterpartyInn'] ?? '').replace(/\D/g, ''),
      counterpartyKpp: String(r['КПП'] ?? r['counterpartyKpp'] ?? '').replace(/\D/g, ''),
      contractName: String(r['Договор'] ?? r['contractName'] ?? '').trim(),
      nomenclatureName: String(r['Номенклатура'] ?? r['nomenclatureName'] ?? '').trim(),
      warehouseName: String(r['Склад'] ?? r['warehouseName'] ?? '').trim(),
      explicitDebit: normalizeAccountCode1C(String(r['Дебет'] ?? r['СчетДт'] ?? '')),
      explicitCredit: normalizeAccountCode1C(String(r['Кредит'] ?? r['СчетКт'] ?? '')),
    });
  }
  return drafts;
}

export function processBatchFiles(
  files: BatchImportFileInput[],
  currentDb1C: Database1CSnapshot | null
): BatchImportResult {
  let workingDb = currentDb1C;
  let updatedDb1C: Database1CSnapshot | null = null;
  const rawDraftsQueue: RawDraftOperationInput[] = [];
  const fileSummaries: BatchImportResult['fileSummaries'] = [];
  const errors: string[] = [];

  // First pass: check if any uploaded file is a 1C JSON database export so subsequent files in the SAME batch bind against it!
  const nonDbFiles: BatchImportFileInput[] = [];
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'json') {
      try {
        const text = decodeSmartText(file.buffer);
        const parsed = JSON.parse(text);
        if (isLikely1CDatabaseExport(parsed)) {
          const snapshot = normalize1CDatabaseExport(parsed, file.name);
          workingDb = snapshot;
          updatedDb1C = snapshot;
          fileSummaries.push({
            fileName: file.name,
            kind: '1c_db_json',
            parsedCount:
              snapshot.rawBalances.length + snapshot.postings.length + snapshot.documents.length,
            duplicatesCount: 0,
            notes: `База 1С загружена: ${snapshot.organization.name || 'Организация'}`,
          });
          continue;
        }
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Ошибка чтения JSON'}`);
        continue;
      }
    }
    nonDbFiles.push(file);
  }

  // Second pass: parse all operation files against workingDb
  for (const file of nonDbFiles) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      let drafts: RawDraftOperationInput[] = [];

      if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
        const wb = XLSX.read(file.buffer, { type: 'array', cellDates: true });
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            defval: '',
          });
          drafts.push(...parseRowsMatrix(matrix, file.name));
        }
      } else if (ext === 'xml') {
        const xmlText = decodeSmartText(file.buffer);
        drafts = parseXml1CDocuments(xmlText, file.name);
      } else if (ext === 'json') {
        const jsonText = decodeSmartText(file.buffer);
        const parsed = JSON.parse(jsonText);
        drafts = parseJsonOperationsArray(parsed, file.name);
      } else {
        // .txt, .csv, .tsv, or any text format
        const text = decodeSmartText(file.buffer);
        drafts = parseFreeTextOrDelimitedOperations(text, file.name, workingDb);
      }

      const generatedForFile = drafts.map((d) => bindAndGenerateOperation(d, workingDb));
      const dupCount = generatedForFile.filter((op) => op.isDuplicateIn1C).length;

      rawDraftsQueue.push(...drafts);
      fileSummaries.push({
        fileName: file.name,
        kind: 'operations',
        parsedCount: generatedForFile.length,
        duplicatesCount: dupCount,
      });
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Не удалось разобрать файл'}`);
    }
  }

  const operations = rawDraftsQueue.map((draft) => bindAndGenerateOperation(draft, workingDb));

  return {
    updatedDb1C,
    operations,
    fileSummaries,
    errors,
  };
}

import type {
  BusinessOperation,
  CounterpartyCard1C,
  DocumentField1C,
  EmployeeCard1C,
  ExtractedDirectories1C,
  JournalPosting,
  NomenclatureCard1C,
  PitfallWarning,
  SmartLinkRule,
  VatMathBreakdown,
} from '@/types/accounting';

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function formatRub(val: number): string {
  return `${val.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

interface RawParsedRow {
  number: number | string;
  date: string;
  description: string;
  amountCell?: string;
}

const NUMBER_TOKEN_SOURCE = `(?:\\d{1,3}(?:[\\s\\u00A0]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?`;

function isLikelyBankOrTaxRequisiteNumber(raw: string): boolean {
  const digitsOnly = raw.replace(/[\s\u00A0]/g, '').replace(/[.,].*$/, '');
  if (!digitsOnly) return false;
  // BIK (9 digits starting with 04 or stripped leading zero 8 digits 44030xxx / 44525xxx), INN (10/12), KPP (9), Bank account (20)
  if (/^(?:0?4\d{7}|\d{9,20})$/.test(digitsOnly)) return true;
  return false;
}

function parseRussianNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (
    /^(?:\?|—|–|-|нет|пусто|не\s*указан[ао]?|определить|из\s*остатков|см\.?\s*остатки)$/i.test(
      cleaned
    )
  ) {
    return null;
  }

  // Reject bank/tax codes (BIK 044030653 / 44030653, INN 7841000019, KPP 783901001, r/s 40702...)
  if (
    !/(?:руб|₽|тыс\.)/i.test(cleaned) &&
    !/\s/.test(cleaned.replace(/^(?:руб\.?|₽)\s*/i, '')) &&
    isLikelyBankOrTaxRequisiteNumber(cleaned)
  ) {
    return null;
  }

  const match = cleaned.match(new RegExp(`(-?${NUMBER_TOKEN_SOURCE})`));
  if (!match) return null;

  const normalized = match[1].replace(/[\s\u00A0]/g, '').replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;

  if (/тыс\.?\s*(?:руб|₽|р(?=$|[\s.,;)]))/i.test(cleaned)) {
    return round2(num * 1000);
  }
  return round2(num);
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (!inQuotes && current.trim().length === 0) {
        inQuotes = true;
      } else if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (inQuotes && (i + 1 === line.length || line[i + 1] === delimiter || /^\s+$/.test(line.slice(i + 1)))) {
        inQuotes = false;
      } else {
        current += '"';
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function mergeMultilineQuotedRecords(rawText: string): string[] {
  const records: string[] = [];
  let buffer = '';
  let quoteCount = 0;
  const physicalLines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const line of physicalLines) {
    buffer = buffer ? `${buffer} ${line.trim()}` : line;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') quoteCount++;
    }
    if (quoteCount % 2 === 0) {
      records.push(buffer);
      buffer = '';
      quoteCount = 0;
    }
  }
  if (buffer.trim()) {
    records.push(buffer);
  }
  return records;
}

function isHeaderOrFooterCells(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase();
  if (!joined.trim()) return true;
  if (/^[\s|:-]+$/.test(joined)) return true;

  const nonEmptyCells = cells.filter((c) => c.trim().length > 0);
  if (
    nonEmptyCells.length <= 2 &&
    /^(?:хозяйственные\s+операции|журнал\s+операций|реквизит|остатк|справочник|таблица|раздел|условие\s+задач|задание|данные\s+для\s+ввода)/i.test(
      nonEmptyCells.join(' ').trim()
    )
  ) {
    return true;
  }

  // Also check explicit document/personnel number column so we never use `Номер документа` or `Табельный номер` as amount
  let hasHeaderWords =
    (/(?:^|\s)(?:№|номер|n\s*п\/п|п\/п|номер\s+документ|табельный\s+номер)(?:\s|$)/i.test(joined) &&
      /(?:дата|содержание|операци|наименование|сумма|фио|должность|оклад)/i.test(joined)) ||
    (/содержание\s+(?:хозяйственной\s+)?операции/i.test(joined) && /сумма/i.test(joined)) ||
    (/^дата$/i.test((cells[0] || '').trim()) && /содержание|операци/i.test(cells[1] || ''));

  // Keep track if this looks like a pure table header
  if (hasHeaderWords) return true;
  if (/^(?:итого|всего\s+за\s+период|всего\s+оборотов|оборот[ы]?)\b/i.test((cells[0] || '').trim())) return true;
  if (/^(?:итого|всего)\b/i.test((cells[1] || '').trim()) && cells[1].length < 20) return true;
  return false;
}

type SectionPeriodMode = 'unknown' | 'q1_skip' | 'q2_april' | 'metadata_skip';

function detectSectionHeaderMode(cells: string[]): SectionPeriodMode | null {
  const nonEmpty = cells.map((c) => c.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return null;
  const joined = nonEmpty.join(' ').toLowerCase();

  // Only treat as section header when 1-2 cells OR explicitly starts with section title keywords without operation description
  const looksLikeSectionTitle =
    nonEmpty.length <= 2 ||
    /^(?:хозяйственные\s+операции|раздел|таблица|часть|блок)\b/i.test(joined);

  if (!looksLikeSectionTitle) return null;

  if (
    /(?:за\s*(?:1|i)\s*квартал|1[\s-]*й\s*квартал|январ|феврал|март(?:а|е)?\b|предшествующ.*период)/i.test(
      joined
    ) &&
    !/апрел|2\s*квартал/i.test(joined)
  ) {
    return 'q1_skip';
  }
  if (/(?:за\s*(?:2|ii)\s*квартал|2[\s-]*й\s*квартал|апрел|текущ\w*\s+месяц)/i.test(joined)) {
    return 'q2_april';
  }
  if (
    /^(?:реквизит\w*|наша\s+организация|начальные\s+остатки|входящие\s+остатки|остатки\s+по\s+счетам|справочник\w*|контрагент\w*|сотрудник\w*|штатное\s+расписание)/i.test(
      joined
    )
  ) {
    return 'metadata_skip';
  }
  return null;
}

function getDateMonthNumber(dateStr: string): number {
  const m = dateStr.match(/^\d{1,2}[./](\d{1,2})[./]\d{2,4}$/);
  if (!m) return 4;
  return Number(m[1]);
}

interface ColumnLayoutHint {
  numCol: number;
  dateCol: number;
  descCol: number;
  amountCol: number;
}

function detectTableColumnLayout(cells: string[]): ColumnLayoutHint | null {
  const lowerCells = cells.map((c) => c.trim().toLowerCase());
  const joined = lowerCells.join(' ');
  if (!/(?:содержание|операци|наименование|сотрудник|фио)/i.test(joined)) return null;

  let numCol = -1;
  let dateCol = -1;
  let descCol = -1;
  let amountCol = -1;

  lowerCells.forEach((c, idx) => {
    if (
      numCol === -1 &&
      /^(?:№|№\s*п\/п|n\s*п\/п|п\/п|номер\s*(?:пп|п\/п|операции)?)$/i.test(c)
    ) {
      numCol = idx;
    } else if (/дата/i.test(c) && dateCol === -1) {
      dateCol = idx;
    } else if (/содержание|наименование\s+операц|описание\s+операц|суть\s+операц/i.test(c) && descCol === -1) {
      descCol = idx;
    } else if (/сумма|итого\s*\(?руб|стоимость|оклад/i.test(c) && !/ндс|документ|табельн/i.test(c)) {
      amountCol = idx;
    }
  });

  if (descCol === -1) return null;
  return { numCol, dateCol, descCol, amountCol };
}

function normalizeDate(rawDate: string | undefined, fallbackYear = '2026', fallbackMonth = '04'): string {
  if (!rawDate) return `01.${fallbackMonth}.${fallbackYear}`;
  const trimmed = rawDate.trim();
  const fullMatch = trimmed.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (fullMatch) {
    const dd = fullMatch[1].padStart(2, '0');
    const mm = fullMatch[2].padStart(2, '0');
    const yyyy = fullMatch[3].length === 2 ? `20${fullMatch[3]}` : fullMatch[3];
    return `${dd}.${mm}.${yyyy}`;
  }
  const shortMatch = trimmed.match(/(\d{1,2})[./](\d{1,2})(?!\d)/);
  if (shortMatch) {
    const dd = shortMatch[1].padStart(2, '0');
    const mm = shortMatch[2].padStart(2, '0');
    return `${dd}.${mm}.${fallbackYear}`;
  }
  const ruMonths: Record<string, string> = {
    янв: '01',
    фев: '02',
    мар: '03',
    апр: '04',
    мая: '05',
    май: '05',
    июн: '06',
    июл: '07',
    авг: '08',
    сен: '09',
    окт: '10',
    ноя: '11',
    дек: '12',
  };
  const wordMonthMatch = trimmed.match(/(\d{1,2})\s+([а-яё]{3,8})(?:\.?\s*(\d{4}))?/i);
  if (wordMonthMatch) {
    const dd = wordMonthMatch[1].padStart(2, '0');
    const prefix = wordMonthMatch[2].slice(0, 3).toLowerCase();
    const mm = ruMonths[prefix] || fallbackMonth;
    const yyyy = wordMonthMatch[3] || fallbackYear;
    return `${dd}.${mm}.${yyyy}`;
  }
  return `01.${fallbackMonth}.${fallbackYear}`;
}

function extractRowsFromRawText(rawText: string): {
  detectedTitle: string;
  rows: RawParsedRow[];
} {
  const lines = mergeMultilineQuotedRecords(rawText)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let detectedTitle = 'Журнал хозяйственных операций (1С 8.3)';
  if (lines.length === 0) {
    return { detectedTitle, rows: [] };
  }

  if (
    lines.length > 1 &&
    !lines[0].includes('\t') &&
    !lines[0].startsWith('|') &&
    (lines[0].match(/;/g) || []).length < 2 &&
    !/^\s*(?:\d+[.)]|операция\s*№?\s*\d+|\d{1,2}[./]\d{1,2}|\d{1,2}\s+[а-яё]{3})/i.test(lines[0]) &&
    /(?:задача|вариант|журнал|ооо|ао|зао|ип|операци)/i.test(lines[0])
  ) {
    detectedTitle = lines[0].replace(/^#+\s*/, '').trim();
  }

  // 1. TSV (copied from Excel / Word)
  const tabLines = lines.filter((l) => l.includes('\t'));
  if (tabLines.length >= 1) {
    const rows: RawParsedRow[] = [];
    let autoNum = 1;
    let sectionMode: SectionPeriodMode = 'unknown';
    let colLayout: ColumnLayoutHint | null = null;

    for (const line of lines) {
      const cells = line.includes('\t') ? splitDelimitedLine(line, '\t') : [line];
      const secChange = detectSectionHeaderMode(cells);
      if (secChange) {
        sectionMode = secChange;
        colLayout = null;
        continue;
      }

      if (!line.includes('\t')) continue;

      const maybeCols = detectTableColumnLayout(cells);
      if (maybeCols) {
        colLayout = maybeCols;
        continue;
      }

      if (isHeaderOrFooterCells(cells)) continue;

      const mapped = mapCellsToRawRow(cells, autoNum, colLayout);
      if (!mapped) continue;

      const rowMonth = getDateMonthNumber(mapped.date);
      // If a date >= 01.04 explicitly appears, switch out of q1_skip into q2_april
      if (sectionMode === 'q1_skip' && rowMonth >= 4 && /\d{1,2}[./]\d{1,2}|апр/i.test(cells.join(' '))) {
        sectionMode = 'q2_april';
      }

      if (sectionMode === 'q1_skip' || sectionMode === 'metadata_skip') continue;
      if (rowMonth < 4) continue; // Strictly filter out Jan/Feb/Mar operations!

      rows.push(mapped);
      autoNum++;
    }
    if (rows.length > 0) return { detectedTitle, rows };
  }

  // 2. Markdown Pipe Table
  const pipeLines = lines.filter((l) => (l.match(/\|/g) || []).length >= 2);
  if (pipeLines.length >= 1) {
    const rows: RawParsedRow[] = [];
    let autoNum = 1;
    let sectionMode: SectionPeriodMode = 'unknown';
    let colLayout: ColumnLayoutHint | null = null;

    for (const line of lines) {
      if (!line.includes('|')) {
        const secChange = detectSectionHeaderMode([line]);
        if (secChange) {
          sectionMode = secChange;
          colLayout = null;
        }
        continue;
      }
      let trimmed = line.trim();
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
      const cells = trimmed.split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;

      const secChange = detectSectionHeaderMode(cells);
      if (secChange) {
        sectionMode = secChange;
        colLayout = null;
        continue;
      }

      const maybeCols = detectTableColumnLayout(cells);
      if (maybeCols) {
        colLayout = maybeCols;
        continue;
      }

      if (isHeaderOrFooterCells(cells)) continue;
      const mapped = mapCellsToRawRow(cells, autoNum, colLayout);
      if (!mapped) continue;

      const rowMonth = getDateMonthNumber(mapped.date);
      if (sectionMode === 'q1_skip' && rowMonth >= 4 && /\d{1,2}[./]\d{1,2}|апр/i.test(cells.join(' '))) {
        sectionMode = 'q2_april';
      }
      if (sectionMode === 'q1_skip' || sectionMode === 'metadata_skip') continue;
      if (rowMonth < 4) continue;

      rows.push(mapped);
      autoNum++;
    }
    if (rows.length > 0) return { detectedTitle, rows };
  }

  // 3. Semicolon CSV (`;`)
  const semiLines = lines.filter((l) => (l.match(/;/g) || []).length >= 2);
  if (semiLines.length >= 1) {
    const rows: RawParsedRow[] = [];
    let autoNum = 1;
    let sectionMode: SectionPeriodMode = 'unknown';
    let colLayout: ColumnLayoutHint | null = null;

    for (const line of lines) {
      const cells = line.includes(';') ? splitDelimitedLine(line, ';') : [line];
      const secChange = detectSectionHeaderMode(cells);
      if (secChange) {
        sectionMode = secChange;
        colLayout = null;
        continue;
      }
      if ((line.match(/;/g) || []).length < 2) continue;

      const maybeCols = detectTableColumnLayout(cells);
      if (maybeCols) {
        colLayout = maybeCols;
        continue;
      }

      if (isHeaderOrFooterCells(cells)) continue;
      const mapped = mapCellsToRawRow(cells, autoNum, colLayout);
      if (!mapped) continue;

      const rowMonth = getDateMonthNumber(mapped.date);
      if (sectionMode === 'q1_skip' && rowMonth >= 4 && /\d{1,2}[./]\d{1,2}|апр/i.test(cells.join(' '))) {
        sectionMode = 'q2_april';
      }
      if (sectionMode === 'q1_skip' || sectionMode === 'metadata_skip') continue;
      if (rowMonth < 4) continue;

      rows.push(mapped);
      autoNum++;
    }
    if (rows.length > 0) return { detectedTitle, rows };
  }

  // 4. Comma CSV when structured
  const looksLikeCommaCsv =
    lines.length >= 2 &&
    (/(?:№|номер|дата)\s*,\s*(?:дата|содержание|операци)/i.test(lines[0]) ||
      lines.filter((l) => /^\s*"?\d+"?\s*,\s*"?(?:\d{1,2}[./]\d{1,2}|\d{1,2}\s+[а-яё]{3})/i.test(l))
        .length >= 1);
  if (looksLikeCommaCsv) {
    const rows: RawParsedRow[] = [];
    let autoNum = 1;
    let sectionMode: SectionPeriodMode = 'unknown';
    let colLayout: ColumnLayoutHint | null = null;

    for (const line of lines) {
      const cells = splitDelimitedLine(line, ',');
      const secChange = detectSectionHeaderMode(cells);
      if (secChange) {
        sectionMode = secChange;
        colLayout = null;
        continue;
      }
      const maybeCols = detectTableColumnLayout(cells);
      if (maybeCols) {
        colLayout = maybeCols;
        continue;
      }
      if (cells.length < 2 || isHeaderOrFooterCells(cells)) continue;
      const mapped = mapCellsToRawRow(cells, autoNum, colLayout);
      if (!mapped) continue;

      const rowMonth = getDateMonthNumber(mapped.date);
      if (sectionMode === 'q1_skip' || sectionMode === 'metadata_skip') continue;
      if (rowMonth < 4) continue;

      rows.push(mapped);
      autoNum++;
    }
    if (rows.length > 0) return { detectedTitle, rows };
  }

  // 5. Numbered or dated plain-text lines
  const rows: RawParsedRow[] = [];
  let current: RawParsedRow | null = null;
  let autoNum = 1;
  let plainSectionMode: SectionPeriodMode = 'unknown';

  for (const line of lines) {
    if (line === detectedTitle) continue;
    const secChange = detectSectionHeaderMode([line]);
    if (secChange) {
      if (current) {
        rows.push(current);
        current = null;
      }
      plainSectionMode = secChange;
      continue;
    }
    if (/^(?:хозяйственные\s+операции|журнал\s+операций|таблица\s+\d+)/i.test(line) && line.length < 70) {
      continue;
    }

    const opMatch = line.match(
      /^(?:операция\s*№?\s*(\d+)|№\s*(\d+)|(\d+)\s*[.):-]\s*(?!\d{1,2}[./]\d{2,4}\s*$))(.*)$/i
    );
    const dateStartMatch = !opMatch
      ? line.match(/^(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\s+[а-яё]{3,8})\s*[-—:]?\s+(.+)$/i)
      : null;

    if (opMatch) {
      if (current) rows.push(current);
      const numStr = opMatch[1] || opMatch[2] || opMatch[3];
      let rest = (opMatch[4] || '').trim();
      let date = `${String(Math.min(autoNum, 28)).padStart(2, '0')}.04.2026`;

      const leadingDate = rest.match(
        /^(?:\(?от\s+)?(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\s+[а-яё]{3,8}(?:\.?\s*\d{4})?)\)?\s*[:\-—]?\s*(.+)$/i
      );
      if (leadingDate) {
        date = normalizeDate(leadingDate[1]);
        rest = leadingDate[2].trim();
      }

      if (plainSectionMode === 'q1_skip' && getDateMonthNumber(date) >= 4 && leadingDate) {
        plainSectionMode = 'q2_april';
      }

      let amountCell: string | undefined;
      const trailingSum = rest.match(
        /^(.*?)(?:\s+[—–-]\s+)(\?|—|(?:(?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(?:руб\.?|₽|р\.?)?)\s*$/i
      );
      if (trailingSum && trailingSum[1].length > 12) {
        amountCell = trailingSum[2].trim();
      }

      current =
        plainSectionMode === 'q1_skip' || plainSectionMode === 'metadata_skip' || getDateMonthNumber(date) < 4
          ? null
          : {
              number: Number(numStr) || numStr,
              date,
              description: rest,
              amountCell,
            };
      autoNum++;
    } else if (dateStartMatch) {
      if (current) rows.push(current);
      const date = normalizeDate(dateStartMatch[1]);
      if (plainSectionMode === 'q1_skip' && getDateMonthNumber(date) >= 4) {
        plainSectionMode = 'q2_april';
      }
      current =
        plainSectionMode === 'q1_skip' || plainSectionMode === 'metadata_skip' || getDateMonthNumber(date) < 4
          ? null
          : {
              number: autoNum,
              date,
              description: dateStartMatch[2].trim(),
            };
      autoNum++;
    } else if (current) {
      current.description = `${current.description} ${line}`.trim();
    } else if (
      line.length > 10 &&
      plainSectionMode !== 'q1_skip' &&
      plainSectionMode !== 'metadata_skip'
    ) {
      current = {
        number: autoNum,
        date: '01.04.2026',
        description: line,
      };
      autoNum++;
    }
  }

  if (current) rows.push(current);
  return { detectedTitle, rows };
}

function mapCellsToRawRow(
  cells: string[],
  fallbackNumber: number,
  colLayout?: ColumnLayoutHint | null
): RawParsedRow | null {
  const nonEmpty = cells.filter((c) => c !== '');
  if (nonEmpty.length === 0) return null;

  let number: number | string = fallbackNumber;
  let date = `${String(Math.min(fallbackNumber * 2, 28)).padStart(2, '0')}.04.2026`;
  let description = '';
  let amountCell: string | undefined;

  const isShortInt = (s: string) => /^\d{1,3}[.)]?$/.test(s.trim());
  const isDateLike = (s: string) =>
    /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/.test(s.trim()) ||
    /^\d{1,2}\s+[а-яё]{3,8}(?:\.?\s*\d{4})?$/i.test(s.trim());

  if (colLayout && colLayout.descCol < cells.length) {
    description = (cells[colLayout.descCol] || '').trim();
    if (colLayout.numCol >= 0 && cells[colLayout.numCol]) {
      const n = parseInt(cells[colLayout.numCol], 10);
      if (Number.isFinite(n) && n > 0) number = n;
    }
    if (colLayout.dateCol >= 0 && cells[colLayout.dateCol] && isDateLike(cells[colLayout.dateCol])) {
      date = normalizeDate(cells[colLayout.dateCol]);
    }
    if (colLayout.amountCol >= 0 && colLayout.amountCol < cells.length) {
      amountCell = cells[colLayout.amountCol];
    }
    if (colLayout.dateCol < 0 && colLayout.descCol < cells.length) {
      const embeddedDate = description.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/);
      if (embeddedDate) date = normalizeDate(embeddedDate[1]);
    }
  } else if (cells.length >= 4 && isShortInt(cells[0]) && isDateLike(cells[1])) {
    number = parseInt(cells[0], 10) || fallbackNumber;
    date = normalizeDate(cells[1]);
    description = cells[2];
    amountCell = cells[3] !== undefined ? cells[3] : cells[cells.length - 1];
  } else if (cells.length >= 3 && isShortInt(cells[0]) && !isDateLike(cells[1])) {
    number = parseInt(cells[0], 10) || fallbackNumber;
    description = cells[1];
    amountCell = cells[2];
    const embeddedDate = description.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/);
    if (embeddedDate) date = normalizeDate(embeddedDate[1]);
  } else if (cells.length >= 3 && isDateLike(cells[0])) {
    date = normalizeDate(cells[0]);
    description = cells[1];
    amountCell = cells[2];
  } else if (cells.length === 2) {
    if (isShortInt(cells[0])) {
      number = parseInt(cells[0], 10) || fallbackNumber;
      description = cells[1];
    } else {
      description = cells[0];
      amountCell = cells[1];
    }
  } else {
    let longestIdx = 0;
    for (let i = 1; i < cells.length; i++) {
      if (cells[i].length > cells[longestIdx].length) longestIdx = i;
    }
    description = cells[longestIdx];
    if (longestIdx > 0 && isShortInt(cells[0])) {
      number = parseInt(cells[0], 10) || fallbackNumber;
    }
    for (let i = 0; i < longestIdx; i++) {
      if (isDateLike(cells[i])) date = normalizeDate(cells[i]);
    }
    if (longestIdx < cells.length - 1) {
      amountCell = cells[cells.length - 1];
    }
  }

  // Filter out pure requisite / metadata rows (e.g. "БИК | 044030653", "ИНН | 7841529035")
  if (
    /^(?:инн|кпп|огрн|бик|расчетный\s+счет|р\/сч?|корр\.?\s*счет|банк|юридический\s+адрес|адрес|директор|руководитель|главный\s+бухгалтер)\b/i.test(
      description.trim()
    )
  ) {
    return null;
  }

  if (!description || description.trim().length < 3) return null;
  return {
    number,
    date,
    description: description.trim(),
    amountCell: amountCell?.trim(),
  };
}

interface QuantityPriceMatch {
  quantity: number;
  unit: string;
  unitPrice: number;
  computedTotal: number;
}

function extractQtyAndPrice(description: string): QuantityPriceMatch | null {
  const regex = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(шт\\.?|ед\\.?|уп\\.?|компл\\.?|м2|кв\\.?\\s*м|м3|куб\\.?\\s*м|п\\.?\\s*м|кг|т|тонн[аы]?|л|рул\\.?|пач\\.?|меш\\.?)\\s*(?:по(?:\\s+цене)?|[×xх*])\\s*(${NUMBER_TOKEN_SOURCE})(?:\\s*(?:руб\\.?|₽|р\\b))?`,
    'i'
  );
  const match = description.match(regex);
  if (!match) return null;

  const quantity = Number(match[1].replace(',', '.'));
  const unit = match[2].replace(/\.$/, '').trim();
  const unitPrice = parseRussianNumber(match[3]);
  if (!Number.isFinite(quantity) || quantity <= 0 || !unitPrice) return null;

  return {
    quantity,
    unit,
    unitPrice,
    computedTotal: round2(quantity * unitPrice),
  };
}

function extractOnlyQuantity(description: string): { quantity: number; unit: string } | null {
  const m = description.match(
    /(\d+(?:[.,]\d+)?)\s*(шт\.?|ед\.?|уп\.?|компл\.?|м2|м3|кг|т|рул\.?)(?!\s*(?:%|по|[×xх*]))/i
  );
  if (!m) return null;
  const q = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(q) || q <= 0) return null;
  return { quantity: q, unit: m[2].replace(/\.$/, '').trim() };
}

function extractAmountFromProse(description: string): number | null {
  // Do NOT extract partial penalty numbers as the whole operation amount when principal comes from debt balance!
  if (/в\s+размере\s+задолженност/i.test(description)) {
    return null;
  }

  const masked = description
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, ' ')
    .replace(/(?:№|N|#)\s*[\wА-ЯЁа-яё/-]+/gi, ' ')
    .replace(/дог(?:овор[ауеом]?)?\.?\s*(?:№\s*)?[\wА-ЯЁа-яё/-]+/gi, ' ')
    .replace(/(?:ИНН|КПП|БИК|ОГРН|р\/сч?|к\/сч?|корр?\.?\s*сч\.?|таб\.?\s*№?)\s*[:№]?\s*\d+/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/(?:сч(?:ет[ауе]?)?|Д|К|Дт|Кт)\s*\d{2}(?:\.\d{1,2}(?:\.\d)?)?/gi, ' ')
    .replace(/\b0?4\d{7}\b/g, ' ') // BIK (044030653 or 44030653)
    .replace(/\b\d{9,20}\b/g, ' ')
    .replace(/[А-ЯЁA-Z]+-\d+\b/g, ' '); // e.g., М-150, СП-171

  const explicitPatterns = [
    new RegExp(
      `(?:на\\s+сумму|в\\s+сумме|в\\s+размере|с\\s+окладом|оклад[аом]?|=)\\s*(${NUMBER_TOKEN_SOURCE})\\s*(?:тыс\\.?\\s*)?(?:руб\\.?|₽|р\\b)?`,
      'gi'
    ),
    new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*(?:тыс\\.?\\s*)?(?:руб(?:лей|ля|\\.)?|₽)`, 'gi'),
  ];

  const found: number[] = [];
  for (const pat of explicitPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(masked)) !== null) {
      const parsed = parseRussianNumber(m[1] || m[0]);
      if (parsed !== null && parsed > 0) {
        found.push(parsed);
      }
    }
    if (found.length > 0) {
      return Math.max(...found);
    }
  }

  return null;
}

interface ExtractedRequisites {
  inn?: string;
  kpp?: string;
  bankAccount?: string;
  bik?: string;
}

function extractInlineRequisites(description: string): ExtractedRequisites {
  const inn = description.match(/ИНН\s*(\d{10}|\d{12})/i)?.[1];
  const kpp = description.match(/КПП\s*(\d{9})/i)?.[1];
  const bankAccount = description.match(/(?:р\/сч?|расч\.?\s*сч\.?)\s*(\d{20})/i)?.[1];
  const bik = description.match(/БИК\s*(\d{9})/i)?.[1];
  return { inn, kpp, bankAccount, bik };
}

function extractCounterparty(description: string): string | undefined {
  const legalMatch = description.match(
    /(?:^|[\s(«",.;:-])(ООО|АО|ПАО|ЗАО|НАО|ГУП|МУП)\s*(?:«([^»"]+)»|"([^"]+)"|„([^“”]+)"|([А-ЯЁA-Z][\wА-ЯЁа-яё-]{2,}))/
  );
  if (legalMatch) {
    const form = legalMatch[1];
    const rawName = (legalMatch[2] || legalMatch[3] || legalMatch[4] || legalMatch[5] || '').trim();
    return `${form} «${rawName}»`;
  }
  const fnsMatch = description.match(
    /(?:^|[\s(«",.;:-])((?:МИ\s*)?ФНС\s*№?\s*\d+(?:\s+по\s+[А-ЯЁа-яё.\s-]+?)?)(?=\s*\(|\s*,|\s*\.|$)/i
  );
  if (fnsMatch) {
    return fnsMatch[1].trim();
  }
  const ipMatch = description.match(
    /(?:^|[\s(«",.;:-])ИП\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.|\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)?)/
  );
  if (ipMatch) {
    return `ИП ${ipMatch[1].trim()}`;
  }
  return undefined;
}

function extractContractInfo(description: string): {
  number?: string;
  fullLabel?: string;
  date?: string;
} {
  const m = description.match(
    /(?:договор[ауеом]?|дог\.)\s*(?:подряда\s+|поставки\s+|субподряда\s+|купли-продажи\s+)?(?:№\s*|N\s*)?([0-9][0-9А-ЯЁA-Zа-яё/-]*|[А-ЯЁA-Z0-9]+-[А-ЯЁA-Z0-9]+)(?:\s+от\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4}))?/i
  );
  if (m) {
    const num = m[1].trim().replace(/\.$/, '');
    const dt = m[2] ? normalizeDate(m[2]) : undefined;
    return {
      number: num,
      fullLabel: `Договор №${num}${dt ? ` от ${dt}` : ''}`,
      date: dt,
    };
  }
  return {};
}

function extractUpdOrDocNum(description: string): string | undefined {
  const upd = description.match(/УПД\s*(?:№\s*)?([\wА-ЯЁа-яё/-]+)/i);
  if (upd) return `УПД №${upd[1]}`;
  const sfNum = description.match(/счет[ауе]?-фактур[еыу]?\s*(?:№\s*)([\wА-ЯЁа-яё/-]+)/i);
  if (sfNum) return `Счет-фактура №${sfNum[1]}`;
  if (/счет[ауе]?-фактур/i.test(description)) return 'Счет-фактура полученный';
  const nakl = description.match(/накладн(?:ой|ая)\s*(?:ТОРГ-12\s*)?(?:№\s*)([\wА-ЯЁа-яё/-]+)/i);
  if (nakl) return `Накладная №${nakl[1]}`;
  return undefined;
}

function extractQuotedObject(description: string, counterpartyName?: string): string | undefined {
  const explicitObj = description.match(
    /(?:объект[ауе]?|по\s+объекту|на\s+объекте|групп[аеы]|заказ[ауе]?)\s*(?:строительства\s*)?(?:«([^»]+)»|"([^"]+)")/i
  );
  if (explicitObj) {
    return (explicitObj[1] || explicitObj[2]).trim();
  }

  const allQuoted = Array.from(description.matchAll(/«([^»]+)»|"([^"]+)"/g));
  for (const q of allQuoted) {
    const candidate = (q[1] || q[2] || '').trim();
    if (!candidate) continue;
    if (counterpartyName && counterpartyName.includes(candidate)) continue;
    const idx = q.index ?? 0;
    const prefix = description.slice(Math.max(0, idx - 8), idx);
    if (/(?:ООО|АО|ПАО|ЗАО|НАО|ГУП|МУП)\s*$/i.test(prefix)) continue;
    if (candidate.length >= 4) return candidate;
  }
  return undefined;
}

function extractGoodsItemName(description: string): string | undefined {
  if (/оконн[а-яё]*\s+блок/i.test(description)) return 'Оконные блоки';
  if (/кровельн[а-яё]*\s+аэратор/i.test(description)) return 'Кровельные аэраторы';
  if (/аэратор/i.test(description)) return 'Кровельные аэраторы';
  if (/кирпич/i.test(description)) return 'Кирпич строительный М-150';
  const zaMatch = description.match(/(?:^|\s)за\s+([а-яёa-z0-9\s-]{4,35}?)(?=\s+в\s+кол|\s+\d|\s+по\s+цене|\s+для|,|\.)/i);
  if (zaMatch && !/предыдущ|прошл|месяц|квартал/i.test(zaMatch[1])) {
    const raw = zaMatch[1].trim();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return undefined;
}

function computeVatBreakdown(
  baseAmount: number,
  description: string,
  defaultVatRate: number,
  qtyMatch: QuantityPriceMatch | null
): VatMathBreakdown {
  const lower = description.toLowerCase();
  let vatRate = defaultVatRate;
  const explicitRateMatch = description.match(/ндс\s*(\d{1,2})\s*%/i);
  if (explicitRateMatch) {
    vatRate = Number(explicitRateMatch[1]);
  }

  if (/без\s+ндс|ндс\s+не\s+облагается|усн/i.test(lower) || vatRate <= 0) {
    return {
      quantity: qtyMatch?.quantity,
      unit: qtyMatch?.unit,
      unitPrice: qtyMatch?.unitPrice,
      totalWithVat: round2(baseAmount),
      vatRate: 0,
      vatMode: 'none',
      vatAmount: 0,
      amountWithoutVat: round2(baseAmount),
      steps: [
        ...(qtyMatch
          ? [
              `Количество × Цена: ${qtyMatch.quantity} ${qtyMatch.unit} × ${formatRub(qtyMatch.unitPrice)} = ${formatRub(baseAmount)}`,
            ]
          : []),
        `Операция без НДС: итоговая сумма = ${formatRub(baseAmount)}`,
      ],
    };
  }

  const isVatOnTop = /кроме\s+того\s+ндс|плюс\s+ндс|ндс\s+сверху|без\s+учета\s+ндс/i.test(lower);
  if (isVatOnTop) {
    const amountWithoutVat = round2(baseAmount);
    const vatAmount = round2((amountWithoutVat * vatRate) / 100);
    const totalWithVat = round2(amountWithoutVat + vatAmount);
    return {
      quantity: qtyMatch?.quantity,
      unit: qtyMatch?.unit,
      unitPrice: qtyMatch?.unitPrice,
      totalWithVat,
      vatRate,
      vatMode: 'on_top',
      vatAmount,
      amountWithoutVat,
      steps: [
        ...(qtyMatch
          ? [
              `База без НДС: ${qtyMatch.quantity} ${qtyMatch.unit} × ${formatRub(qtyMatch.unitPrice)} = ${formatRub(amountWithoutVat)}`,
            ]
          : [`Стоимость без НДС: ${formatRub(amountWithoutVat)}`]),
        `НДС сверху (${vatRate}%): ${formatRub(amountWithoutVat)} × ${vatRate}% = ${formatRub(vatAmount)}`,
        `Итого с НДС: ${formatRub(amountWithoutVat)} + ${formatRub(vatAmount)} = ${formatRub(totalWithVat)}`,
      ],
    };
  }

  const totalWithVat = round2(baseAmount);
  const vatAmount = round2((totalWithVat * vatRate) / (100 + vatRate));
  const amountWithoutVat = round2(totalWithVat - vatAmount);
  return {
    quantity: qtyMatch?.quantity,
    unit: qtyMatch?.unit,
    unitPrice: qtyMatch?.unitPrice,
    totalWithVat,
    vatRate,
    vatMode: 'included',
    vatAmount,
    amountWithoutVat,
    steps: [
      ...(qtyMatch
        ? [
            `Общая сумма с НДС: ${qtyMatch.quantity} ${qtyMatch.unit} × ${formatRub(qtyMatch.unitPrice)} = ${formatRub(totalWithVat)}`,
          ]
        : [`Общая сумма с НДС: ${formatRub(totalWithVat)}`]),
      `Выделяем НДС (${vatRate}/${100 + vatRate}): ${formatRub(totalWithVat)} × ${vatRate} / ${100 + vatRate} = ${formatRub(vatAmount)}`,
      `Стоимость без НДС (на счет учета): ${formatRub(totalWithVat)} − ${formatRub(vatAmount)} = ${formatRub(amountWithoutVat)}`,
    ],
  };
}

function deterministicDigits(seed: string, length: number, prefix = ''): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let digits = prefix;
  let state = Math.abs(hash) || 1234567;
  while (digits.length < length) {
    state = (state * 1664525 + 1013904223) % 2147483647;
    digits += String(state % 10);
  }
  return digits.slice(0, length);
}

interface TrackedAdvanceLot {
  remainingAmount: number;
  originalAmount: number;
  qtyMatch: QuantityPriceMatch | null;
  isForResale: boolean;
  itemName?: string;
}

export function parseTaskLocally(
  rawText: string,
  defaultVatRate = 20
): {
  title: string;
  operations: BusinessOperation[];
  directories: ExtractedDirectories1C;
  warnings: string[];
} {
  const warnings: string[] = [];
  const { detectedTitle, rows } = extractRowsFromRawText(rawText || '');

  const counterpartiesMap = new Map<string, CounterpartyCard1C>();
  const nomenclatureMap = new Map<string, NomenclatureCard1C>();
  const nomenclatureGroupsSet = new Set<string>();
  const expenseItemsSet = new Set<string>();
  const cashFlowItemsSet = new Set<string>();
  const employeesMap = new Map<string, EmployeeCard1C>();

  const supplierAdvances = new Map<string, TrackedAdvanceLot>();
  const buyerAdvances = new Map<string, number>();
  const goodsInventoryTracker: { name: string; quantity: number; netCost: number }[] = [];

  const registerCounterparty = (
    name: string | undefined,
    contractKind: CounterpartyCard1C['contractKind'],
    contractNumber?: string,
    contractDate?: string,
    reqs?: ExtractedRequisites
  ): string => {
    if (!name) {
      return contractKind === 'С покупателем' ? 'Покупатель (Основной)' : 'Поставщик (Основной)';
    }
    const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
    const existing = counterpartiesMap.get(key);
    if (existing) {
      if (contractNumber && existing.contractNumber === 'Договор №1') {
        existing.contractNumber = `Договор №${contractNumber}`;
      }
      if (reqs?.inn) existing.inn = reqs.inn;
      if (reqs?.kpp) existing.kpp = reqs.kpp;
      if (reqs?.bankAccount) existing.bankAccount = reqs.bankAccount;
      if (reqs?.bik) existing.bik = reqs.bik;
      return existing.name;
    }
    const inn = reqs?.inn || deterministicDigits(key, 10, '78');
    const kpp = reqs?.kpp || `${inn.slice(0, 4)}01001`;
    const bankAccount = reqs?.bankAccount || deterministicDigits(`${key}-acc`, 20, '4070281043800');
    const bik = reqs?.bik || '044030653';
    const card: CounterpartyCard1C = {
      id: `cp-local-${counterpartiesMap.size + 1}`,
      name,
      fullName: name.startsWith('ООО ')
        ? name.replace(/^ООО\s+/, 'Общество с ограниченной ответственностью ')
        : name.startsWith('АО ')
          ? name.replace(/^АО\s+/, 'Акционерное общество ')
          : name,
      inn,
      kpp,
      bankAccount,
      bankName: bik === '044030001' ? 'Северо-Западное ГУ Банка России' : 'ПАО Сбербанк',
      bik,
      contractKind,
      contractNumber: contractNumber ? `Договор №${contractNumber}` : 'Договор №1',
      contractDate: contractDate || '01.04.2026',
      createdIn1C: false,
    };
    counterpartiesMap.set(key, card);
    return card.name;
  };

  const registerNomenclature = (
    name: string,
    kind: NomenclatureCard1C['kind'],
    unit: string,
    accountCode: string,
    vatAccountCode: string,
    nomenclatureGroup?: string,
    expenseItem?: string
  ) => {
    const key = `${kind}:${name.toLowerCase().trim()}`;
    if (nomenclatureGroup) nomenclatureGroupsSet.add(nomenclatureGroup);
    if (expenseItem) expenseItemsSet.add(expenseItem);
    if (!nomenclatureMap.has(key)) {
      nomenclatureMap.set(key, {
        id: `nom-local-${nomenclatureMap.size + 1}`,
        name,
        kind,
        unit,
        accountCode,
        vatAccountCode,
        nomenclatureGroup,
        expenseItem,
        defaultVatRate,
        createdIn1C: false,
      });
    }
  };

  const operations: BusinessOperation[] = rows.map((row, index) => {
    const opId = `op-local-${index + 1}`;
    const desc = row.description;
    const lower = desc.toLowerCase();

    let qtyMatch = extractQtyAndPrice(desc);
    const cellAmount = parseRussianNumber(row.amountCell);
    const proseAmount = cellAmount === null ? extractAmountFromProse(desc) : null;
    const reqs = extractInlineRequisites(desc);

    let explicitAmount: number | null = cellAmount;
    if (explicitAmount === null) {
      if (qtyMatch) {
        if (/кроме\s+того\s+ндс|плюс\s+ндс|ндс\s+сверху/i.test(lower) && defaultVatRate > 0) {
          explicitAmount = round2(qtyMatch.computedTotal * (1 + defaultVatRate / 100));
        } else {
          explicitAmount = qtyMatch.computedTotal;
        }
      } else if (proseAmount !== null) {
        const multiRubMatches = Array.from(
          desc.matchAll(new RegExp(`(${NUMBER_TOKEN_SOURCE})\\s*(?:руб(?:лей|ля|\\.)?|₽)`, 'gi'))
        )
          .map((m) => parseRussianNumber(m[1]))
          .filter((n): n is number => n !== null && n > 0);
        if (
          multiRubMatches.length === 2 &&
          !/=\s*\d/.test(desc) &&
          /(?:исполнительн|неустойк|штраф|санкци)/i.test(lower)
        ) {
          explicitAmount = round2(multiRubMatches[0] + multiRubMatches[1]);
        } else {
          explicitAmount = proseAmount;
        }
      }
    }

    const rawCp = extractCounterparty(desc);
    const contractInfo = extractContractInfo(desc);
    const updOrDoc = extractUpdOrDocNum(desc);
    const quotedObject = extractQuotedObject(desc, rawCp);

    let smartLink: SmartLinkRule | undefined;
    let menuPath1C: string[] = ['Операции', 'Бухгалтерский учет', 'Операции, введенные вручную'];
    let documentType1C = 'Операция, введенная вручную';
    let operationKind1C = 'Операция';
    let hasUpdOrSf = false;
    let updLabel: string | undefined;
    let documentFields: DocumentField1C[] = [];
    let vatBreakdown: VatMathBreakdown | undefined;
    let postings: JournalPosting[] = [];
    let pitfalls: PitfallWarning[] = [];

    let workingAmount = explicitAmount ?? 0;

    // =========================================================================
    // RULE 1: Исполнительные листы, штрафы, пени, неустойки и налоговые санкции
    // =========================================================================
    if (/(?:исполнительн.*лист|неустойк|штраф|пен[яией]|налогов.*санкц|санкци.*ифнс)/i.test(lower)) {
      const hasPrincipalDebtFromBalance = /в\s+размере\s+задолженност/i.test(lower);
      const cpName = registerCounterparty(
        rawCp,
        hasPrincipalDebtFromBalance ? 'С поставщиком' : 'Прочее',
        contractInfo.number,
        row.date,
        reqs
      );
      expenseItemsSet.add('Штрафы, пени и неустойки к получению (уплате)');

      // Parse explicit `неустойка = 3000` and `штраф = 5000` / `налоговые санкции 10 000`
      const neustoykaMatch = desc.match(new RegExp(`неустойк[а-яё]*[^\\d=]{0,25}=?\\s*(${NUMBER_TOKEN_SOURCE})`, 'i'));
      const shtrafMatch = desc.match(
        new RegExp(`(?:налогов[а-яё]*\\s+санкц[а-яё]*|штраф[а-яё]*)[^\\d=]{0,25}=?\\s*(${NUMBER_TOKEN_SOURCE})`, 'i')
      );

      const isPaidNow = /(?:уплачен|перечислен|списан.*с\s+расчетн|списан.*р\/с|оплачен)/i.test(lower);
      const isTaxIfns = /(?:ифнс|фнс|налогов.*санкц|налогов.*штраф)/i.test(lower);

      let commercialAmt = neustoykaMatch ? parseRussianNumber(neustoykaMatch[1]) || 0 : 0;
      let sanction99Amt = shtrafMatch ? parseRussianNumber(shtrafMatch[1]) || 0 : 0;

      if (commercialAmt === 0 && sanction99Amt === 0 && workingAmount > 0) {
        if (/99\.02|налогов.*санкц|ифнс/i.test(lower) && /91\.02|неустойк/i.test(lower)) {
          commercialAmt = round2(workingAmount * 0.7);
          sanction99Amt = round2(workingAmount - commercialAmt);
        } else if (/99\.02|налогов.*санкц|ифнс/i.test(lower)) {
          sanction99Amt = workingAmount;
        } else {
          commercialAmt = workingAmount;
        }
      }

      if (hasPrincipalDebtFromBalance && cellAmount === null) {
        explicitAmount = null;
        workingAmount = 0;
        smartLink = {
          accountCode: '60.01',
          side: 'credit',
          matchSubconto1: rawCp,
          matchContract: contractInfo.number,
          description: `Погашение задолженности перед ${cpName}${
            contractInfo.number ? ` по договору №${contractInfo.number}` : ''
          } из начальных остатков счета 60.01 (+ начисленные неустойка ${formatRub(commercialAmt)} и штраф ${formatRub(sanction99Amt)})`,
        };
      }

      menuPath1C = isPaidNow
        ? ['Операции', 'Бухгалтерский учет', 'Операции, введенные вручную (+ Банковские выписки → Списание)']
        : ['Операции', 'Бухгалтерский учет', 'Операции, введенные вручную'];
      documentType1C = isPaidNow
        ? 'Операция, введенная вручную + Списание с расчетного счета'
        : 'Операция, введенная вручную';
      operationKind1C = 'Раздельное отражение неустойки (91.02) и штрафа/санкций (99.02.3)';
      hasUpdOrSf = false;

      const sanctionCreditAcc = isTaxIfns ? '68.10' : '76.02';
      const sanctionCreditSub = isTaxIfns
        ? ['ИФНС России', 'Штрафы и санкции']
        : [cpName, contractInfo.fullLabel || 'Исполнительный лист'];

      documentFields = [
        { label: 'Дата операции', value: row.date, copyable: true },
        { label: 'Контрагент / Взыскатель', value: cpName, copyable: true },
        ...(contractInfo.fullLabel
          ? [{ label: 'Договор', value: contractInfo.fullLabel, copyable: true, highlight: true }]
          : []),
        ...(commercialAmt > 0
          ? [{ label: 'Неустойка (Дт 91.02 Кт 76.02), ₽', value: String(commercialAmt), copyable: true, highlight: true }]
          : []),
        ...(sanction99Amt > 0
          ? [
              {
                label: `Штраф / санкции (Дт 99.02.3 Кт ${sanctionCreditAcc}), ₽`,
                value: String(sanction99Amt),
                copyable: true,
                highlight: true,
              },
            ]
          : []),
      ];

      if (commercialAmt > 0) {
        postings.push({
          id: `${opId}-p1`,
          debitAccount: '91.02',
          debitSubconto: ['Штрафы, пени и неустойки к получению (уплате)'],
          creditAccount: '76.02',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Исполнительный лист'],
          amount: commercialAmt,
          comment: 'Начислена неустойка по исполнительному листу (прочие расходы)',
          proportionOfTotal: hasPrincipalDebtFromBalance || sanction99Amt > 0 ? 'custom' : 'full',
        });
      }

      if (sanction99Amt > 0) {
        postings.push({
          id: `${opId}-p2`,
          debitAccount: '99.02.3',
          debitSubconto: ['Штрафы и санкции'],
          creditAccount: sanctionCreditAcc,
          creditSubconto: sanctionCreditSub,
          amount: sanction99Amt,
          comment: 'Начислен штраф на счет 99.02.3 по исполнительному листу',
          proportionOfTotal: hasPrincipalDebtFromBalance || commercialAmt > 0 ? 'custom' : 'full',
        });
      }

      if (isPaidNow) {
        cashFlowItemsSet.add('Прочие платежи по текущим операциям');
        if (hasPrincipalDebtFromBalance) {
          postings.push({
            id: `${opId}-p3`,
            debitAccount: '60.01',
            debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
            creditAccount: '51',
            creditSubconto: ['Основной расчетный счет'],
            amount: workingAmount,
            comment: `Списана с р/сч основная задолженность по ${contractInfo.fullLabel || 'договору'} (из начальных остатков)`,
            proportionOfTotal: 'full',
          });
        }
        const total76 = round2(commercialAmt + (sanctionCreditAcc === '76.02' ? sanction99Amt : 0));
        if (total76 > 0) {
          postings.push({
            id: `${opId}-p4`,
            debitAccount: '76.02',
            debitSubconto: [cpName, contractInfo.fullLabel || 'Исполнительный лист'],
            creditAccount: '51',
            creditSubconto: ['Основной расчетный счет'],
            amount: total76,
            comment: 'Списаны с расчетного счета начисленные санкции по исполнительному листу',
            proportionOfTotal: 'custom',
          });
        }
        if (sanctionCreditAcc === '68.10' && sanction99Amt > 0) {
          postings.push({
            id: `${opId}-p5`,
            debitAccount: '68.10',
            debitSubconto: ['ИФНС России', 'Штрафы и санкции'],
            creditAccount: '51',
            creditSubconto: ['Основной расчетный счет'],
            amount: sanction99Amt,
            comment: 'Уплачены налоговые санкции ИФНС с расчетного счета',
            proportionOfTotal: 'custom',
          });
        }
      }

      pitfalls.push({
        severity: 'critical',
        title: 'Раздельный учет санкций на счетах 91.02 и 99.02.3!',
        description:
          'Обратите внимание на раздельное отражение: договорная неустойка относится в дебет счета 91.02 «Прочие расходы», а штраф по условию задачи — напрямую в дебет счета 99.02.3 (не уменьшает налогооблагаемую прибыль!). При списании долга с р/сч сумма основного долга подтягивается из начального сальдо счета 60.01 по указанному договору.',
        checkType: 'penalty_split',
      });
    }

    // =========================================================================
    // RULE 2: Снятие наличных в кассу из банка (50.01 / 51) или взнос в банк
    // =========================================================================
    else if (/(?:снят.*наличн|получен.*наличн.*в\s+касс|с\s+р\/с.*в\s+касс|по\s+чеку.*в\s+касс)/i.test(lower)) {
      cashFlowItemsSet.add('Получение наличных из банка');
      menuPath1C = ['Банк и касса', 'Касса', 'Кассовые документы', 'Поступление (ПКО)'];
      documentType1C = 'Поступление наличных (Приходный кассовый ордер)';
      operationKind1C = 'Получение наличных в банке';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Вид операции ПКО', value: 'Получение наличных в банке', copyable: true, highlight: true },
        { label: 'Дата документа', value: row.date, copyable: true },
        { label: 'Счет кредита (Банк)', value: '51', copyable: true },
        { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
        { label: 'Статья ДДС', value: 'Получение наличных из банка', copyable: true },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: '50.01',
          debitSubconto: ['Получение наличных из банка'],
          creditAccount: '51',
          creditSubconto: ['Основной расчетный счет'],
          amount: workingAmount,
          comment: 'Оприходованы в кассу наличные, снятые с расчетного счета',
          proportionOfTotal: 'full',
        },
      ];

      pitfalls = [
        {
          severity: 'critical',
          title: 'Оформляйте ТОЛЬКО Приходный кассовый ордер (ПКО), чтобы не задвоить проводку!',
          description:
            'В 1С:Бухгалтерия 8.3 при снятии наличных с расчетного счета проводку Дт 50.01 Кт 51 формирует ТОЛЬКО кассовый документ «Поступление наличных (ПКО)» с видом операции «Получение наличных в банке». Создавать и проводить дополнительно «Списание с расчетного счета» НЕЛЬЗЯ — иначе сумма по счетам 50.01 и 51 пройдет дважды!',
          checkType: 'cash_balance',
        },
      ];
    } else if (/(?:внесен.*наличн.*на\s+р\/с|сдан.*наличн.*в\s+банк|инкассац|из\s+касс.*на\s+р\/с)/i.test(lower)) {
      cashFlowItemsSet.add('Взнос наличными в банк');
      menuPath1C = ['Банк и касса', 'Касса', 'Кассовые документы', 'Выдача (РКО)'];
      documentType1C = 'Выдача наличных (Расходный кассовый ордер)';
      operationKind1C = 'Взнос наличными в банк';
      hasUpdOrSf = false;
      documentFields = [
        { label: 'Вид операции РКО', value: 'Взнос наличными в банк', copyable: true, highlight: true },
        { label: 'Дата', value: row.date, copyable: true },
        { label: 'Счет дебета', value: '51', copyable: true },
        { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
      ];
      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: '51',
          debitSubconto: ['Основной расчетный счет'],
          creditAccount: '50.01',
          creditSubconto: ['Взнос наличными в банк'],
          amount: workingAmount,
          comment: 'Внесены наличные из кассы на расчетный счет в банке',
          proportionOfTotal: 'full',
        },
      ];
      pitfalls = [
        {
          severity: 'warning',
          title: 'Проводку формирует только РКО!',
          description:
            'При взносе наличных в банк в 1С 8.3 проводку Дт 51 Кт 50.01 делает только «Выдача наличных (РКО)».',
          checkType: 'cash_balance',
        },
      ];
    }

    // =========================================================================
    // RULE 3A: Кадровый прием на работу («Принят на работу ... с окладом»)
    // =========================================================================
    else if (/(?:принят[аоы]?\s+на\s+работ|прием\s+на\s+работ|трудоустроен)/i.test(lower)) {
      const isProdWorker = /(?:прораб|рабоч|строител|монтажник|инженер\s+объект)/i.test(lower);
      const costAcc = isProdWorker ? '20.01' : '26';
      const roleMatch = desc.match(/(?:П|п)ринят[аоы]?\s+на\s+работ[у]\s+([А-ЯЁа-яё\s-]+?)(?=\s*\(|\s+с\s+оклад|$)/);
      const position = roleMatch
        ? roleMatch[1].trim().replace(/^./, (c) => c.toUpperCase())
        : 'Главный бухгалтер';
      const empName = /фио\s+студента/i.test(lower)
        ? `${position} (ФИО студента)`
        : position;

      if (workingAmount > 0) {
        employeesMap.set(empName, {
          id: `emp-local-${employeesMap.size + 1}`,
          fullName: empName,
          position,
          department: isProdWorker ? 'Производственный участок' : 'Администрация',
          salary: workingAmount,
          hireDate: row.date,
          costAccount: costAcc,
          nomenclatureGroup: isProdWorker ? quotedObject || 'Строительно-монтажные работы' : undefined,
          createdIn1C: false,
        });
      }

      menuPath1C = ['Зарплата и кадры', 'Кадровый учет', 'Приемы, переводы, увольнения', 'Создать → Прием на работу'];
      documentType1C = 'Прием на работу';
      operationKind1C = 'Кадровый приказ о приеме (регистрация сотрудника и планового оклада)';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Дата приема', value: row.date, copyable: true, highlight: true },
        {
          label: 'Сотрудник',
          value: /фио\s+студента/i.test(lower) ? 'Укажите ваши собственные ФИО студента!' : empName,
          copyable: true,
          highlight: true,
        },
        { label: 'Подразделение', value: isProdWorker ? 'Производственный участок' : 'Администрация', copyable: true },
        { label: 'Должность', value: position, copyable: true },
        { label: 'Вид начисления / Оклад, ₽', value: `Оплата по окладу — ${workingAmount}`, copyable: true, highlight: true },
        { label: 'Учет расходов по зарплате', value: `Счет ${costAcc}`, copyable: true },
      ];

      postings = [];

      pitfalls = [
        {
          severity: 'info',
          title: 'Кадровый документ «Прием на работу» не формирует проводок Дт/Кт в день приема!',
          description: `В 1С:Бухгалтерия 8.3 документ «Прием на работу» от ${row.date} фиксирует оклад (${formatRub(workingAmount)}) и способ отражения расходов (счет ${costAcc}) в регистрах сведений. Сами бухгалтерские проводки по начислению зарплаты (Дт ${costAcc} Кт 70), НДФЛ 13% (Дт 70 Кт 68.01) и страховых взносов 30,2% будут сформированы в конце месяца документом «Начисление зарплаты»!`,
          checkType: 'general',
        },
        ...(/фио\s+студента/i.test(lower)
          ? [
              {
                severity: 'warning' as const,
                title: 'Персонализация: подставьте ваше ФИО студента!',
                description:
                  'Во вкладке «Начальные остатки → Карточка нашей организации» заполните поле «ФИО студента» и включите галочку «Подставить ФИО студента как Главного бухгалтера» — система автоматически подставит ваши данные в карточки 1С!',
                checkType: 'general' as const,
              },
            ]
          : []),
      ];
    }

    // =========================================================================
    // RULE 3B: Выплата заработной платы (70 / 50.01 или 70 / 51)
    // =========================================================================
    else if (
      /(?:выплачен|выдан|перечислен).*(?:заработн.*плат|зарплат|з\/п|оплат.*труд)/i.test(lower) &&
      !/налог|ндфл|взнос/i.test(lower)
    ) {
      const isFromCash =
        /(?:из\s+касс|через\s+касс|в\s+касс|наличн|по\s+рко)/i.test(lower) ||
        !/(?:р\/с|банк|карт|безналичн)/i.test(lower);
      cashFlowItemsSet.add('Оплата труда');

      if (explicitAmount === null) {
        smartLink = {
          accountCode: '70',
          side: 'credit',
          description: 'Выплата задолженности по заработной плате за предыдущий месяц (сальдо Кт 70 на начало периода)',
        };
      }

      if (isFromCash) {
        menuPath1C = ['Банк и касса', 'Касса', 'Кассовые документы', 'Выдача (РКО)'];
        documentType1C = 'Выдача наличных (РКО) на основании Ведомости в кассу';
        operationKind1C = 'Выплата заработной платы по ведомостям';
        documentFields = [
          {
            label: 'Шаг 1 (Ведомость)',
            value: 'Зарплата и кадры → Ведомости в кассу → Создать',
            copyable: false,
            highlight: true,
          },
          {
            label: 'Вид операции РКО',
            value: 'Выплата заработной платы по ведомостям',
            copyable: true,
            highlight: true,
          },
          { label: 'Дата выплаты', value: row.date, copyable: true },
          { label: 'Счет дебета', value: '70', copyable: true },
          {
            label: 'Сумма к выплате, ₽',
            value: explicitAmount !== null ? String(workingAmount) : 'По входящему остатку Кт 70',
            copyable: explicitAmount !== null,
          },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: '70',
            debitSubconto: ['Работники организации'],
            creditAccount: '50.01',
            creditSubconto: ['Оплата труда'],
            amount: workingAmount,
            comment: 'Выплачена заработная плата за предыдущий месяц через кассу организации',
            proportionOfTotal: 'full',
          },
        ];
        pitfalls = [
          {
            severity: 'critical',
            title: 'Обязательно проверьте остаток наличных в кассе (счет 50.01) перед выдачей!',
            description:
              'Если входящего остатка Дт 50.01 недостаточно для выплаты всей суммы зарплаты (Кт 70), в 1С 8.3 сначала необходимо снять недостающую сумму с расчетного счета в кассу документом ПКО «Получение наличных в банке» (Дт 50.01 Кт 51, время документа раньше РКО!). Иначе по счету 50.01 возникнет недопустимое красное (отрицательное) сальдо!',
            checkType: 'cash_balance',
          },
        ];
      } else {
        menuPath1C = ['Банк и касса', 'Банк', 'Банковские выписки', 'Списание'];
        documentType1C = 'Списание с расчетного счета (по Ведомости в банк)';
        operationKind1C = 'Перечисление заработной платы по ведомостям';
        documentFields = [
          { label: 'Вид операции', value: 'Перечисление заработной платы по ведомостям', copyable: true, highlight: true },
          { label: 'Дата', value: row.date, copyable: true },
          { label: 'Счет дебета', value: '70', copyable: true },
          {
            label: 'Сумма, ₽',
            value: explicitAmount !== null ? String(workingAmount) : 'По входящему остатку Кт 70',
            copyable: explicitAmount !== null,
          },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: '70',
            debitSubconto: ['Работники организации'],
            creditAccount: '51',
            creditSubconto: ['Основной расчетный счет'],
            amount: workingAmount,
            comment: 'Перечислена заработная плата с расчетного счета по ведомости в банк',
            proportionOfTotal: 'full',
          },
        ];
        pitfalls = [
          {
            severity: 'info',
            title: 'Сначала создайте «Ведомость в банк»',
            description:
              'В 1С 8.3 сначала заполняется «Зарплата и кадры → Ведомости в банк», затем на основании формируется «Списание с расчетного счета».',
            checkType: 'bank_balance',
          },
        ];
      }
    }

    // =========================================================================
    // RULE 3C: Начисление заработной платы, НДФЛ и страховых взносов
    // =========================================================================
    else if (/(?:начислен|удержан).*(?:заработн.*плат|зарплат|оплат.*труд|ндфл|страхов.*взнос)/i.test(lower)) {
      const isProductionSalary = /(?:основн.*производств|рабоч|прораб|строител|цех|объект)/i.test(lower);
      const costAcc = isProductionSalary ? '20.01' : '26';
      const nomGroup = isProductionSalary ? quotedObject || 'Основная номенклатурная группа' : undefined;
      if (nomGroup) nomenclatureGroupsSet.add(nomGroup);
      expenseItemsSet.add('Оплата труда');
      expenseItemsSet.add('Страховые взносы');

      menuPath1C = ['Зарплата и кадры', 'Зарплата', 'Все начисления', 'Начисление зарплаты'];
      documentType1C = 'Начисление зарплаты';
      operationKind1C = 'Окончательный расчет (зарплата, НДФЛ 13%, страховые взносы 30,2%)';
      hasUpdOrSf = false;

      const ndfl = round2(workingAmount * 0.13);
      const unifiedContrib = round2(workingAmount * 0.3);
      const accidentContrib = round2(workingAmount * 0.002);

      documentFields = [
        { label: 'Дата начисления', value: row.date, copyable: true },
        { label: 'Счет затрат', value: costAcc, copyable: true, highlight: true },
        { label: 'Начислено (ФОТ), ₽', value: String(workingAmount), copyable: true },
        { label: 'НДФЛ 13% (68.01), ₽', value: String(ndfl), copyable: true },
        { label: 'Взносы 30% + 0,2% (69.09 / 69.11), ₽', value: `${unifiedContrib} + ${accidentContrib}`, copyable: true },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: costAcc,
          debitSubconto: nomGroup ? [nomGroup, 'Оплата труда'] : ['Оплата труда'],
          creditAccount: '70',
          creditSubconto: ['Работники организации'],
          amount: workingAmount,
          comment: 'Начислена заработная плата сотрудникам за месяц',
          proportionOfTotal: 'full',
        },
        {
          id: `${opId}-p2`,
          debitAccount: '70',
          debitSubconto: ['Работники организации'],
          creditAccount: '68.01',
          creditSubconto: ['Налог (взносы): начислено / уплачено'],
          amount: ndfl,
          comment: 'Удержан НДФЛ 13% из начисленной заработной платы',
          proportionOfTotal: 'custom',
        },
        {
          id: `${opId}-p3`,
          debitAccount: costAcc,
          debitSubconto: nomGroup ? [nomGroup, 'Страховые взносы'] : ['Страховые взносы'],
          creditAccount: '69.09',
          creditSubconto: ['Налог (взносы): начислено / уплачено'],
          amount: unifiedContrib,
          comment: 'Начислены страховые взносы по единому тарифу (30%)',
          proportionOfTotal: 'custom',
        },
        {
          id: `${opId}-p4`,
          debitAccount: costAcc,
          debitSubconto: nomGroup ? [nomGroup, 'Страховые взносы'] : ['Страховые взносы'],
          creditAccount: '69.11',
          creditSubconto: ['Налог (взносы): начислено / уплачено'],
          amount: accidentContrib,
          comment: 'Начислены взносы на страхование от НС и ПЗ (0,2%)',
          proportionOfTotal: 'custom',
        },
      ];

      pitfalls = [
        {
          severity: 'info',
          title: 'Документ «Начисление зарплаты» формирует сразу все проводки по ФОТ, НДФЛ и взносам',
          description: 'Проверьте способ учета зарплаты (счет 20.01 для производственного персонала, счет 26 для АУП).',
          checkType: 'closing_subconto',
        },
      ];
    }

    // =========================================================================
    // RULE 4: Перечисление налогов и страховых взносов в бюджет (68.*, 69.* / 51)
    // =========================================================================
    else if (
      /(?:перечислен|уплачен|оплачен|погашен.*задолженност)/i.test(lower) &&
      /(?:в\s+бюджет|в\s+(?:ми\s*)?фнс|в\s+ифнс|в\s+сфр|задолженност.*по\s+(?:ндс|ндфл|налог|страхов|взнос)|(?:перечислен|уплачен)[аыо]?\s+(?:в\s+бюджет\s+)?(?:ндс|ндфл|налог|страхов.*взнос|единый\s+налог))/i.test(
        lower
      ) &&
      !/(?:аванс\s+в\s+ооо|предоплат.*поставщик|для\s+дальнейшей\s+продаж)/i.test(lower)
    ) {
      cashFlowItemsSet.add('Уплата налогов и взносов');
      if (rawCp) {
        registerCounterparty(rawCp, 'Прочее', 'Бюджетные платежи', row.date, reqs);
      }

      const bothTaxesAndContribs = /(?:налог[а-я]*\s+и\s+(?:страхов[а-я]*\s+)?взнос)/i.test(lower);

      let taxAccount = '68.02';
      let taxName = 'НДС';
      if (bothTaxesAndContribs) {
        taxAccount = '68.02';
        taxName = 'Налоги и страховые взносы (счета 68 и 69)';
      } else if (/ндфл/i.test(lower)) {
        taxAccount = '68.01';
        taxName = 'НДФЛ при исполнении обязанностей налогового агента';
      } else if (/прибыл/i.test(lower)) {
        taxAccount = '68.04.1';
        taxName = 'Налог на прибыль организаций';
      } else if (/травматизм|нс\s+и\s+пз/i.test(lower)) {
        taxAccount = '69.11';
        taxName = 'Страховые взносы от НС и ПЗ';
      } else if (/взнос|сфр|пфр|омс|социальн/i.test(lower)) {
        taxAccount = '69.09';
        taxName = 'Страховые взносы по единому тарифу';
      } else if (/ндс/i.test(lower)) {
        taxAccount = '68.02';
        taxName = 'Налог на добавленную стоимость (НДС)';
      } else {
        taxAccount = '68.10';
        taxName = 'Прочие налоги и сборы';
      }

      if (explicitAmount === null) {
        smartLink = {
          accountCode: bothTaxesAndContribs ? '68+69' : taxAccount,
          side: 'credit',
          description: bothTaxesAndContribs
            ? 'Погашение входящей задолженности перед бюджетом по налогам (счет 68) и страховым взносам (счет 69) из начальных остатков'
            : `Погашение задолженности перед бюджетом (${taxName}) по кредитовому сальдо счета ${taxAccount} на начало периода`,
        };
      }

      menuPath1C = ['Банк и касса', 'Банк', 'Банковские выписки', 'Списание'];
      documentType1C = 'Списание с расчетного счета';
      operationKind1C = 'Уплата налога';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Вид операции', value: 'Уплата налога', copyable: true, highlight: true },
        { label: 'Дата выписки', value: row.date, copyable: true },
        ...(rawCp ? [{ label: 'Получатель (ФНС)', value: rawCp, copyable: true }] : []),
        ...(reqs.inn ? [{ label: 'ИНН / КПП получателя', value: `${reqs.inn} / ${reqs.kpp || ''}`, copyable: true }] : []),
        ...(reqs.bankAccount ? [{ label: 'Счет казначейства / БИК', value: `${reqs.bankAccount} (БИК ${reqs.bik || ''})`, copyable: true }] : []),
        { label: 'Налог / взнос', value: taxName, copyable: true, highlight: true },
        {
          label: 'Сумма платежа, ₽',
          value:
            explicitAmount !== null
              ? String(workingAmount)
              : bothTaxesAndContribs
                ? 'Сумма входящих остатков Кт 68 + Кт 69'
                : `По начальному остатку Кт ${taxAccount}`,
          copyable: explicitAmount !== null,
        },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: taxAccount,
          debitSubconto: ['Налог (взносы): начислено / уплачено'],
          creditAccount: '51',
          creditSubconto: ['Основной расчетный счет'],
          amount: workingAmount,
          comment: `Перечислена с расчетного счета задолженность в бюджет (${taxName})`,
          proportionOfTotal: 'full',
        },
      ];

      pitfalls = [
        {
          severity: 'warning',
          title: bothTaxesAndContribs
            ? 'При уплате нескольких налогов и взносов проверьте каждое сальдо по счетам 68 и 69!'
            : `Проверьте Вид операции «Уплата налога» и субконто счета ${taxAccount}`,
          description: bothTaxesAndContribs
            ? 'В 1С:Бухгалтерия 8.3 создайте отдельные документы «Списание с расчетного счета» (вид операции «Уплата налога») по каждому налогу/взносу из начальных остатков (68.01, 68.02, 69.09 и др.) либо единое перечисление ЕНП, чтобы все входящие кредитовые остатки по счетам 68 и 69 закрылись в ноль.'
            : `В документе «Списание с расчетного счета» выберите вид операции «Уплата налога» и укажите «Налог (взносы): начислено / уплачено», чтобы закрыть кредитовое сальдо счета ${taxAccount}.`,
          checkType: 'bank_balance',
        },
      ];
    }

    // =========================================================================
    // RULE 5: Списание дебиторской/кредиторской задолженности (Корректировка долга)
    // =========================================================================
    else if (/(?:списан.*задолженност|корректировк.*долг|истечени.*срок.*исков.*давност|нереальн.*к\s+взыскан)/i.test(lower)) {
      const isCreditor = /кредиторск/i.test(lower);
      const cpName = registerCounterparty(
        rawCp,
        isCreditor ? 'С поставщиком' : 'С покупателем',
        contractInfo.number,
        row.date,
        reqs
      );
      expenseItemsSet.add('Списание дебиторской (кредиторской) задолженности');

      if (explicitAmount === null) {
        smartLink = {
          accountCode: isCreditor ? '60.01' : '62.01',
          side: isCreditor ? 'credit' : 'debit',
          matchSubconto1: rawCp,
          matchContract: contractInfo.number,
          description: `Списание ${isCreditor ? 'кредиторской (Кт 60.01)' : 'дебиторской (Дт 62.01)'} задолженности${
            contractInfo.number ? ` по договору №${contractInfo.number}` : ''
          } из начальных остатков`,
        };
      }

      menuPath1C = [isCreditor ? 'Покупки' : 'Продажи', 'Расчеты с контрагентами', 'Корректировка долга'];
      documentType1C = 'Корректировка долга';
      operationKind1C = 'Списание задолженности';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Вид операции', value: 'Списание задолженности', copyable: true, highlight: true },
        { label: 'Списать', value: isCreditor ? 'Задолженность поставщику' : 'Задолженность покупателя', copyable: true },
        { label: 'Дата документа', value: row.date, copyable: true },
        { label: isCreditor ? 'Поставщик' : 'Покупатель', value: cpName, copyable: true },
        { label: 'Договор', value: contractInfo.fullLabel || 'Основной договор', copyable: true, highlight: Boolean(contractInfo.number) },
        {
          label: 'Закладка «Счет списания»',
          value: isCreditor
            ? '91.01 — Списание дебиторской (кредиторской) задолженности'
            : '91.02 — Списание дебиторской (кредиторской) задолженности',
          copyable: true,
          highlight: true,
        },
      ];

      postings = [
        isCreditor
          ? {
              id: `${opId}-p1`,
              debitAccount: '60.01',
              debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
              creditAccount: '91.01',
              creditSubconto: ['Списание дебиторской (кредиторской) задолженности'],
              amount: workingAmount,
              comment: 'Списана кредиторская задолженность в прочие доходы',
              proportionOfTotal: 'full',
            }
          : {
              id: `${opId}-p1`,
              debitAccount: '91.02',
              debitSubconto: ['Списание дебиторской (кредиторской) задолженности'],
              creditAccount: '62.01',
              creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
              amount: workingAmount,
              comment: 'Списана дебиторская задолженность покупателя в прочие расходы',
              proportionOfTotal: 'full',
            },
      ];

      pitfalls = [
        {
          severity: 'warning',
          title: 'Нажмите «Заполнить → Заполнить остатками по взаиморасчетам» и проверьте вкладку «Счет списания»!',
          description: `В документе «Корректировка долга» используйте кнопку «Заполнить», чтобы 1С автоматически подтянула договор${
            contractInfo.number ? ` №${contractInfo.number}` : ''
          } из начальных остатков, и укажите счет ${isCreditor ? '91.01' : '91.02'} на вкладке «Счет списания».`,
          checkType: 'general',
        },
      ];
    }

    // =========================================================================
    // RULE 6: Предоплата / аванс или оплата поставщику с р/сч (60.02 или 60.01 / 51)
    // =========================================================================
    else if (
      /(?:перечислен|оплачен|списан.*р\/с|платежн.*поручен)/i.test(lower) &&
      /(?:поставщик|подрядчик|исполнител|предоплат|аванс|за\s+товар|за\s+материал|за\s+оконн|за\s+аэратор|по\s+счету|по\s+договору)/i.test(
        lower
      ) &&
      !/(?:от\s+покупател|от\s+заказчик|на\s+р\/с\s+от)/i.test(lower)
    ) {
      const isAdvance = /(?:предоплат|аванс|предварительн|в\s+счет\s+предстоящ)/i.test(lower);
      const cpName = registerCounterparty(
        rawCp,
        'С поставщиком',
        contractInfo.number,
        contractInfo.date || row.date,
        reqs
      );
      cashFlowItemsSet.add('Оплата поставщикам (подрядчикам) за сырье, материалы, работы, услуги');

      vatBreakdown = computeVatBreakdown(workingAmount, desc, defaultVatRate, qtyMatch);
      const finalAmt = vatBreakdown.totalWithVat || workingAmount;

      if (isAdvance && finalAmt > 0) {
        const lotInfo: TrackedAdvanceLot = {
          remainingAmount: finalAmt,
          originalAmount: finalAmt,
          qtyMatch,
          isForResale: /(?:для\s+дальнейшей\s+продаж|для\s+перепродаж|товар|оконн.*блок|аэратор)/i.test(lower),
          itemName: extractGoodsItemName(desc),
        };
        const advKey = `${cpName.toLowerCase()}|${(contractInfo.number || '').toLowerCase()}`;
        supplierAdvances.set(advKey, { ...lotInfo });
        supplierAdvances.set(cpName.toLowerCase(), { ...lotInfo });
      }

      if (explicitAmount === null && !isAdvance) {
        smartLink = {
          accountCode: '60.01',
          side: 'credit',
          matchSubconto1: rawCp,
          matchContract: contractInfo.number,
          description: 'Погашение задолженности перед поставщиком по сальдо Кт 60.01 на начало периода',
        };
      }

      menuPath1C = ['Банк и касса', 'Банк', 'Банковские выписки', 'Списание'];
      documentType1C = 'Списание с расчетного счета';
      operationKind1C = 'Оплата поставщику';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Вид операции', value: 'Оплата поставщику', copyable: true, highlight: true },
        { label: 'Дата выписки', value: row.date, copyable: true },
        { label: 'Получатель (Поставщик)', value: cpName, copyable: true },
        { label: 'Договор / Счет', value: contractInfo.fullLabel || 'Основной договор (Счет на оплату)', copyable: true, highlight: true },
        { label: 'Сумма платежа, ₽', value: String(finalAmt), copyable: true },
        { label: 'Ставка НДС в платежке', value: vatBreakdown.vatRate > 0 ? `${vatBreakdown.vatRate}%` : 'Без НДС', copyable: true },
        { label: 'Счет расчетов / Счет авансов', value: '60.01 / 60.02 (Погашение: Автоматически)', copyable: true },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: isAdvance ? '60.02' : '60.01',
          debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
          creditAccount: '51',
          creditSubconto: ['Основной расчетный счет'],
          amount: finalAmt,
          comment: isAdvance
            ? 'Перечислен аванс (предоплата) поставщику с расчетного счета'
            : 'Перечислена оплата поставщику в погашение задолженности',
          proportionOfTotal: 'full',
        },
      ];

      pitfalls = [
        {
          severity: 'warning',
          title: isAdvance
            ? 'Аванс отразится на счете 60.02 — следите за совпадением Договора!'
            : 'Проверьте автоматическое погашение долга на 60.01',
          description: isAdvance
            ? `Поскольку отгрузка еще не произошла, 1С 8.3 отнесет всю сумму ${formatRub(finalAmt)} в дебет счета 60.02 «Расчеты по авансам выданным». При последующем поступлении ТМЦ обязательно выберите ТОТ ЖЕ договор с ${cpName}, чтобы автоматически сформировалась проводка зачета аванса Дт 60.01 Кт 60.02!`
            : 'Убедитесь, что договор совпадает с договором поступления / начальных остатков.',
          checkType: 'advance_offset',
        },
      ];
    }

    // =========================================================================
    // RULE 7: Отпуск / списание материалов в производство (20.01 или 26 / 10.01)
    // =========================================================================
    else if (
      /(?:отпущен|передан|списан|направлен|израсходован).*(?:материал|сырь|кирпич|цемент|бетон|доск|краск|инвентарь|топлив|гсм|запчаст)/i.test(
        lower
      ) &&
      /(?:производств|объект|строительств|ремонт|цех|нужд|управлен|офис)/i.test(lower)
    ) {
      const isAdminCost = /(?:общехозяйствен|управленческ|офис|администрац)/i.test(lower);
      const costAcc = isAdminCost ? '26' : '20.01';
      const nomGroup = quotedObject || 'Основная номенклатурная группа';
      const matMatch = desc.match(/(?:материал[ыа]?|сырье)\s*\(([^)]+)\)/i);
      const matName = matMatch ? matMatch[1].trim() : 'Строительные материалы';

      registerNomenclature(
        matName,
        'Материалы',
        qtyMatch?.unit || 'шт',
        '10.01',
        '19.03',
        isAdminCost ? undefined : nomGroup,
        'Материальные расходы'
      );

      menuPath1C = ['Производство', 'Материальные затраты', 'Расход материалов (Требования-накладные)'];
      documentType1C = 'Расход материалов (Требование-накладная)';
      operationKind1C = 'Использование материалов';
      hasUpdOrSf = false;

      documentFields = [
        { label: 'Вид операции', value: 'Использование материалов', copyable: true },
        { label: 'Дата документа', value: row.date, copyable: true },
        { label: 'Материал (10.01)', value: matName, copyable: true },
        { label: 'Счет затрат', value: costAcc, copyable: true, highlight: true },
        ...(isAdminCost ? [] : [{ label: 'Номенклатурная группа (Объект)', value: nomGroup, copyable: true, highlight: true }]),
        { label: 'Статья затрат', value: 'Материальные расходы', copyable: true, highlight: true },
        { label: 'Сумма списания, ₽', value: String(workingAmount), copyable: true },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: costAcc,
          debitSubconto: isAdminCost ? ['Материальные расходы'] : [nomGroup, 'Материальные расходы'],
          creditAccount: '10.01',
          creditSubconto: [matName, 'Основной склад'],
          amount: workingAmount,
          comment: isAdminCost
            ? 'Списаны материалы на общехозяйственные нужды'
            : `Отпущены материалы в производство на объект «${nomGroup}»`,
          proportionOfTotal: 'full',
        },
      ];

      pitfalls = [
        {
          severity: 'warning',
          title: 'Обязательно заполните «Номенклатурную группу» и «Статью затрат»!',
          description: `Укажите Номенклатурную группу «${nomGroup}» на закладке «Счет затрат», чтобы аналитика счета 20.01 была корректной.`,
          checkType: 'closing_subconto',
        },
      ];
    }

    // =========================================================================
    // RULE 8: Поступление услуг / субподрядных СМР (20.01 или 26 + 19.04 + возможная оплата!)
    // =========================================================================
    else if (
      /(?:принят|оказан|выполн(?:ен|ил)|поступил|акт|субподряд)/i.test(lower) &&
      /(?:субподряд|строительно-монтажн|услуг|работ.*по\s+ремонт|работ.*на\s+объект|аренд|связ|интернет|консультац|электроэнерг|коммунальн|доставк)/i.test(
        lower
      ) &&
      !/(?:сдан.*заказчик|реализован.*покупател|выполнен.*для\s+заказчик)/i.test(lower)
    ) {
      const isDirectProduction = /(?:субподряд|объект|строительн|монтажн|производств|ремонт\s+кровли|смр)/i.test(lower);
      const isPaidSimultaneously = /(?:произведена\s+оплата|оплачен[аыо]?|перечислена\s+оплата|списаны\s+с\s+р\/с)/i.test(
        lower
      );
      const costAcc = isDirectProduction ? '20.01' : '26';
      const nomGroup = isDirectProduction ? quotedObject || 'Строительно-монтажные работы' : undefined;
      const expItem = /субподряд/i.test(lower) ? 'Субподрядные работы' : 'Прочие работы и услуги сторонних организаций';

      const cpName = registerCounterparty(
        rawCp,
        'С поставщиком',
        contractInfo.number,
        contractInfo.date || row.date,
        reqs
      );
      const serviceName = /субподряд/i.test(lower)
        ? `Субподрядные СМР${nomGroup ? ` (${nomGroup})` : ''}`
        : 'Услуги сторонней организации';

      registerNomenclature(serviceName, 'Услуги / Субподрядные работы', 'усл', costAcc, '19.04', nomGroup, expItem);

      vatBreakdown = computeVatBreakdown(workingAmount, desc, defaultVatRate, qtyMatch);
      const totalAmt = vatBreakdown.totalWithVat;
      const netAmt = vatBreakdown.amountWithoutVat;
      const vatAmt = vatBreakdown.vatAmount;

      hasUpdOrSf = vatAmt > 0 || /упд|счет-фактур|с\/ф/i.test(lower);
      updLabel = hasUpdOrSf
        ? `${updOrDoc || 'Счет-фактура / УПД полученный'} — вычет НДС со счета 19.04`
        : undefined;

      menuPath1C = isPaidSimultaneously
        ? [
            'Покупки',
            'Поступление (акты, накладные, УПД)',
            'Услуги (акт, УПД) + Банк и касса → Списание с р/сч',
          ]
        : ['Покупки', 'Покупки', 'Поступление (акты, накладные, УПД)', 'Поступление → Услуги (акт, УПД)'];
      documentType1C = isPaidSimultaneously
        ? '1) Поступление: Услуги (акт, УПД) + 2) Списание с расчетного счета'
        : 'Поступление (акты, накладные, УПД)';
      operationKind1C = isPaidSimultaneously
        ? 'Услуги (акт, УПД) + Оплата поставщику'
        : 'Услуги (акт, УПД)';

      documentFields = [
        { label: 'Документ 1 (Акт)', value: 'Покупки → Поступление → Услуги (акт, УПД)', copyable: false, highlight: true },
        { label: 'Дата документа', value: row.date, copyable: true },
        { label: 'Субподрядчик / Исполнитель', value: cpName, copyable: true },
        { label: 'Договор', value: contractInfo.fullLabel || 'Основной договор подряда', copyable: true },
        {
          label: 'Счет затрат в табличной части',
          value: isDirectProduction
            ? `20.01 (Номенклатурная группа: «${nomGroup}», Статья: ${expItem})`
            : `26 (Статья затрат: ${expItem})`,
          copyable: true,
          highlight: true,
        },
        { label: 'Счет учета НДС', value: '19.04', copyable: true, highlight: true },
        { label: 'Сумма с НДС, ₽', value: String(totalAmt), copyable: true },
        ...(isPaidSimultaneously
          ? [
              {
                label: 'Документ 2 (Оплата)',
                value: 'Создать на основании → Списание с расчетного счета (Оплата поставщику)',
                copyable: false,
                highlight: true,
              },
            ]
          : []),
      ];

      const advKey = `${cpName.toLowerCase()}|${(contractInfo.number || '').toLowerCase()}`;
      const availLot = supplierAdvances.get(advKey) || supplierAdvances.get(cpName.toLowerCase());
      const availAdv = availLot?.remainingAmount || 0;
      const offsetAmt = availAdv > 0 ? Math.min(availAdv, totalAmt) : 0;
      if (offsetAmt > 0 && availLot) {
        availLot.remainingAmount = round2(Math.max(0, availAdv - offsetAmt));
        postings.push({
          id: `${opId}-p-adv`,
          debitAccount: '60.01',
          debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор подряда'],
          creditAccount: '60.02',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор подряда'],
          amount: offsetAmt,
          comment: 'Зачет ранее выданного аванса субподрядчику',
          proportionOfTotal: offsetAmt === totalAmt ? 'full' : 'custom',
        });
      }

      postings.push({
        id: `${opId}-p1`,
        debitAccount: costAcc,
        debitSubconto: isDirectProduction && nomGroup ? [nomGroup, expItem] : [expItem],
        creditAccount: '60.01',
        creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор подряда'],
        amount: netAmt,
        comment: isDirectProduction
          ? `Приняты субподрядные СМР на себестоимость объекта «${nomGroup}» (без НДС)`
          : 'Отражены общехозяйственные услуги сторонней организации (без НДС)',
        proportionOfTotal: vatAmt > 0 ? 'net_without_vat' : 'full',
      });

      if (vatAmt > 0) {
        postings.push({
          id: `${opId}-p2`,
          debitAccount: '19.04',
          debitSubconto: [cpName, updOrDoc || 'Счет-фактура полученный'],
          creditAccount: '60.01',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор подряда'],
          amount: vatAmt,
          comment: 'Учтен входящий НДС по субподрядным работам / услугам (субсчет 19.04!)',
          proportionOfTotal: 'vat_only',
        });
        if (hasUpdOrSf) {
          postings.push({
            id: `${opId}-p3`,
            debitAccount: '68.02',
            debitSubconto: ['Налог (взносы): начислено / уплачено'],
            creditAccount: '19.04',
            creditSubconto: [cpName, updOrDoc || 'Счет-фактура полученный'],
            amount: vatAmt,
            comment: 'Принят к вычету НДС по субподрядным работам на основании счета-фактуры',
            proportionOfTotal: 'vat_only',
          });
        }
      }

      if (isPaidSimultaneously) {
        cashFlowItemsSet.add('Оплата поставщикам (подрядчикам) за сырье, материалы, работы, услуги');
        postings.push({
          id: `${opId}-p4`,
          debitAccount: '60.01',
          debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор подряда'],
          creditAccount: '51',
          creditSubconto: ['Основной расчетный счет'],
          amount: round2(totalAmt - offsetAmt),
          comment: 'Произведена оплата субподрядчику с расчетного счета',
          proportionOfTotal: offsetAmt === 0 ? 'full' : 'custom',
        });
      }

      pitfalls = [
        {
          severity: 'warning',
          title: isDirectProduction
            ? `Счет 20.01 (НГ «${nomGroup}») и НДС 19.04!`
            : 'Используйте счет 26 и субсчет НДС 19.04!',
          description: isDirectProduction
            ? `Субподрядные работы формируют прямую производственную себестоимость на счете 20.01 по Номенклатурной группе «${nomGroup}», а НДС учитывается на субсчете 19.04. Важно: если сам объект «${nomGroup}» еще НЕ сдан заказчику в этом месяце (нет выручки по Кт 90.01.1), сумма ${formatRub(netAmt)} законно останется на конец месяца в дебете счета 20.01 как незавершенное производство (НЗП)!`
            : 'Управленческие услуги относятся на счет 26, а входящий НДС — на субсчет 19.04.',
          checkType: 'closing_subconto',
        },
        ...(isPaidSimultaneously
          ? [
              {
                severity: 'info' as const,
                title: 'В 1С 8.3 эта хозяйственная операция вводится ДВУМЯ документами!',
                description:
                  'Сначала проведите «Поступление → Услуги (акт, УПД)» и зарегистрируйте счет-фактуру полученный, а затем прямо из него нажмите кнопку «Создать на основании → Списание с расчетного счета» — все реквизиты и договор подставятся автоматически!',
                checkType: 'bank_balance' as const,
              },
            ]
          : []),
      ];
    }

    // =========================================================================
    // RULE 9: Поступление товаров (41.01) или материалов (10.01) от поставщика
    // =========================================================================
    else if (
      /(?:поступил|оприходован|принят.*к\s+учету|приобретен|закуплен|получен.*от\s+поставщик|получен.*по\s+упд)/i.test(
        lower
      ) &&
      !/(?:на\s+р\/с|в\s+касс)/i.test(lower)
    ) {
      const cpName = registerCounterparty(
        rawCp,
        'С поставщиком',
        contractInfo.number,
        contractInfo.date || row.date,
        reqs
      );

      // Look up prior advance to this supplier (crucial when receipt row omits price/total, e.g. Op 3 after Op 2!)
      const advKey = `${cpName.toLowerCase()}|${(contractInfo.number || '').toLowerCase()}`;
      const trackedLot = supplierAdvances.get(advKey) || supplierAdvances.get(cpName.toLowerCase());

      if (explicitAmount === null && trackedLot && trackedLot.remainingAmount > 0) {
        const onlyQty = extractOnlyQuantity(desc);
        if (
          onlyQty &&
          trackedLot.qtyMatch &&
          trackedLot.qtyMatch.unitPrice > 0 &&
          onlyQty.quantity !== trackedLot.qtyMatch.quantity
        ) {
          qtyMatch = {
            quantity: onlyQty.quantity,
            unit: onlyQty.unit,
            unitPrice: trackedLot.qtyMatch.unitPrice,
            computedTotal: round2(onlyQty.quantity * trackedLot.qtyMatch.unitPrice),
          };
          explicitAmount = qtyMatch.computedTotal;
        } else {
          explicitAmount = trackedLot.remainingAmount;
          if (!qtyMatch && trackedLot.qtyMatch) {
            qtyMatch = trackedLot.qtyMatch;
          }
        }
        workingAmount = explicitAmount;
      }

      const isForResale =
        Boolean(trackedLot?.isForResale) ||
        /(?:товар|для\s+дальнейшей\s+продаж|для\s+перепродаж|оконн.*блок|аэратор|торгов)/i.test(lower) ||
        !/(?:материал|сырь|кирпич|цемент|бетон|доск|краск|топлив|гсм|канцтовар)/i.test(lower);

      const invAcc = isForResale ? '41.01' : '10.01';
      const itemName =
        extractGoodsItemName(desc) ||
        trackedLot?.itemName ||
        (isForResale ? 'Товары для перепродажи' : 'Материалы строительные');

      registerNomenclature(
        itemName,
        isForResale ? 'Товары' : 'Материалы',
        qtyMatch?.unit || 'шт',
        invAcc,
        '19.03',
        isForResale ? 'Оптовая торговля' : undefined,
        isForResale ? undefined : 'Материальные расходы'
      );

      vatBreakdown = computeVatBreakdown(workingAmount, desc, defaultVatRate, qtyMatch);
      const totalAmt = vatBreakdown.totalWithVat;
      const netAmt = vatBreakdown.amountWithoutVat;
      const vatAmt = vatBreakdown.vatAmount;

      if (isForResale && netAmt > 0) {
        goodsInventoryTracker.push({
          name: itemName,
          quantity: qtyMatch?.quantity || 1,
          netCost: netAmt,
        });
      }

      hasUpdOrSf = vatAmt > 0 || /упд|счет-фактур|с\/ф/i.test(lower);
      updLabel = hasUpdOrSf
        ? `${updOrDoc || 'Счет-фактура / УПД полученный'} — вычет НДС Дт 68.02 Кт 19.03`
        : undefined;

      menuPath1C = ['Покупки', 'Покупки', 'Поступление (акты, накладные, УПД)', 'Поступление → Товары (накладная, УПД)'];
      documentType1C = 'Поступление (акты, накладные, УПД)';
      operationKind1C = 'Товары (накладная, УПД)';

      documentFields = [
        { label: 'Вид операции', value: 'Товары (накладная, УПД)', copyable: true, highlight: true },
        { label: 'Дата поступления', value: row.date, copyable: true },
        { label: 'Поставщик', value: cpName, copyable: true },
        { label: 'Договор', value: contractInfo.fullLabel || 'Основной договор', copyable: true, highlight: true },
        { label: 'Склад', value: 'Основной склад', copyable: true },
        { label: 'Номенклатура', value: itemName, copyable: true },
        ...(qtyMatch
          ? [
              { label: 'Количество', value: `${qtyMatch.quantity} ${qtyMatch.unit}`, copyable: true },
              { label: 'Цена за ед. (с НДС), ₽', value: String(qtyMatch.unitPrice), copyable: true },
            ]
          : []),
        { label: 'Счет учета / Счет НДС', value: `${invAcc} / 19.03`, copyable: true, highlight: true },
        { label: 'Итого с НДС, ₽', value: String(totalAmt), copyable: true },
      ];

      const availAdv = trackedLot?.remainingAmount || 0;
      const mentionsAdvanceOffset = /(?:зачет.*аванс|ранее\s+перечислен.*предоплат|в\s+счет\s+предоплат)/i.test(lower);
      const offsetAmt = availAdv > 0 ? Math.min(availAdv, totalAmt) : mentionsAdvanceOffset ? totalAmt : 0;

      if (offsetAmt > 0) {
        if (trackedLot) {
          trackedLot.remainingAmount = round2(Math.max(0, availAdv - offsetAmt));
        }
        postings.push({
          id: `${opId}-p1`,
          debitAccount: '60.01',
          debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
          creditAccount: '60.02',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
          amount: offsetAmt,
          comment: 'Автоматический зачет ранее перечисленного аванса поставщику',
          proportionOfTotal: offsetAmt === totalAmt ? 'full' : 'custom',
        });
      }

      postings.push({
        id: `${opId}-p2`,
        debitAccount: invAcc,
        debitSubconto: [itemName, 'Основной склад'],
        creditAccount: '60.01',
        creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
        amount: netAmt,
        comment: isForResale
          ? 'Оприходованы товары для дальнейшей продажи по стоимости без НДС'
          : 'Оприходованы материалы на склад по стоимости без НДС',
        proportionOfTotal: vatAmt > 0 ? 'net_without_vat' : 'full',
      });

      if (vatAmt > 0) {
        postings.push({
          id: `${opId}-p3`,
          debitAccount: '19.03',
          debitSubconto: [cpName, updOrDoc || 'Счет-фактура полученный'],
          creditAccount: '60.01',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор'],
          amount: vatAmt,
          comment: 'Выделен входящий НДС по поступившим ТМЦ (субсчет 19.03)',
          proportionOfTotal: 'vat_only',
        });

        if (hasUpdOrSf) {
          postings.push({
            id: `${opId}-p4`,
            debitAccount: '68.02',
            debitSubconto: ['Налог (взносы): начислено / уплачено'],
            creditAccount: '19.03',
            creditSubconto: [cpName, updOrDoc || 'Счет-фактура полученный'],
            amount: vatAmt,
            comment: 'Принят к вычету входной НДС на основании счета-фактуры / УПД',
            proportionOfTotal: 'vat_only',
          });
        }
      }

      pitfalls.push({
        severity: isForResale ? 'info' : 'warning',
        title: isForResale
          ? 'Товары «для дальнейшей продажи» приходуются строго на счет 41.01!'
          : 'Материалы приходуются через «Товары (накладная, УПД)» со счетом 10.01!',
        description: isForResale
          ? 'Поскольку ценности предназначены для перепродажи, выбирается Вид номенклатуры «Товары» и счет 41.01 (не 10.01 и не 20.01!). Обязательно зарегистрируйте счет-фактуру полученный (или включите тумблер «УПД»), чтобы НДС закрылся в дебет 68.02.'
          : 'В карточке номенклатуры выберите Вид номенклатуры «Материалы» — тогда 1С подставит счет 10.01.',
        checkType: offsetAmt > 0 ? 'advance_offset' : 'general',
      });

      if (offsetAmt > 0) {
        pitfalls.push({
          severity: 'warning',
          title: `Контроль автоматического зачета аванса ${formatRub(offsetAmt)} (Дт 60.01 Кт 60.02)!`,
          description:
            'Проверьте по кнопке «ДтКт» после проведения документа наличие проводки Дт 60.01 Кт 60.02! Договор в накладной должен совпадать с договором в банковском списании аванса.',
          checkType: 'advance_offset',
        });
      }
    }

    // =========================================================================
    // RULE 10: Реализация товаров / работ / услуг покупателю (62.01 / 90.01.1)
    // =========================================================================
    else if (
      /(?:реализован|отгружен|прода[нж]|сдан.*заказчик|выполнен.*работ.*заказчик|подписан\s+акт.*заказчик)/i.test(
        lower
      )
    ) {
      const isWorksOrServices =
        /(?:сдан.*заказчик|работ|услуг|объект|смр|ремонт\s+кровли)/i.test(lower) &&
        !/(?:оконн.*блок|аэратор|товар|партия\s+товар|(?:^|\s|\d)шт(?=$|\s|[.,;)]))/i.test(lower);

      const cpName = registerCounterparty(
        rawCp,
        'С покупателем',
        contractInfo.number,
        contractInfo.date || row.date,
        reqs
      );
      const nomGroup = isWorksOrServices
        ? quotedObject || 'Строительно-монтажные работы'
        : 'Оптовая торговля';
      nomenclatureGroupsSet.add(nomGroup);

      let inlinePaymentAmount = 0;
      let saleRawAmount = workingAmount;
      const inlinePaymentMatch = desc.match(
        new RegExp(
          `(?:\\+|а\\s+также|и)\\s*(?:получен[ао]?|поступил[ао]?)\\s+оплат[аы]?[^=\\d]*(${NUMBER_TOKEN_SOURCE})`,
          'i'
        )
      );
      if (inlinePaymentMatch) {
        const parsedPay = parseRussianNumber(inlinePaymentMatch[1]);
        if (parsedPay) inlinePaymentAmount = parsedPay;
        const beforePlus = desc.slice(0, inlinePaymentMatch.index ?? desc.length);
        const firstAmt = extractAmountFromProse(beforePlus);
        if (firstAmt) saleRawAmount = firstAmt;
      }

      vatBreakdown = computeVatBreakdown(saleRawAmount, desc, defaultVatRate, qtyMatch);
      const totalSale = vatBreakdown.totalWithVat;
      const vatSale = vatBreakdown.vatAmount;

      hasUpdOrSf = vatSale > 0 || /упд|счет-фактур/i.test(lower);
      updLabel = hasUpdOrSf
        ? `Выписать Счет-фактуру выданный / Тумблер «УПД» ВКЛ (${updOrDoc || 'Книга продаж'})`
        : undefined;

      menuPath1C = [
        'Продажи',
        'Продажи',
        'Реализация (акты, накладные, УПД)',
        isWorksOrServices ? 'Реализация → Услуги (акт, УПД)' : 'Реализация → Товары (накладная, УПД)',
      ];
      documentType1C =
        inlinePaymentAmount > 0
          ? 'Реализация (акты, накладные, УПД) + Поступление на расчетный счет'
          : 'Реализация (акты, накладные, УПД)';
      operationKind1C = isWorksOrServices ? 'Услуги (акт, УПД)' : 'Товары (накладная, УПД)';

      const soldGoodsName = extractGoodsItemName(desc) || 'Товары оптовые';
      if (isWorksOrServices) {
        registerNomenclature(
          `Выполнение работ по объекту «${nomGroup}»`,
          'Продукция / СМР',
          'усл',
          '90.01.1',
          '90.03',
          nomGroup
        );
      } else {
        registerNomenclature(soldGoodsName, 'Товары', qtyMatch?.unit || 'шт', '41.01', '19.03', nomGroup);
      }

      documentFields = [
        { label: 'Вид операции', value: operationKind1C, copyable: true, highlight: true },
        { label: 'Дата реализации', value: row.date, copyable: true },
        { label: 'Покупатель / Заказчик', value: cpName, copyable: true },
        { label: 'Договор', value: contractInfo.fullLabel || 'Основной договор с покупателем', copyable: true },
        { label: 'Номенклатурная группа (90.01.1)', value: nomGroup, copyable: true, highlight: true },
        { label: 'Выручка с НДС, ₽', value: String(totalSale), copyable: true },
        { label: 'В т.ч. НДС (90.03), ₽', value: String(vatSale), copyable: true },
      ];

      const bKey = cpName.toLowerCase();
      const buyerAdv = buyerAdvances.get(bKey) || 0;
      if (buyerAdv > 0) {
        const off = Math.min(buyerAdv, totalSale);
        buyerAdvances.set(bKey, round2(Math.max(0, buyerAdv - off)));
        postings.push({
          id: `${opId}-p-badv`,
          debitAccount: '62.02',
          debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор с покупателем'],
          creditAccount: '62.01',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор с покупателем'],
          amount: off,
          comment: 'Зачет ранее полученного аванса от покупателя',
          proportionOfTotal: 'custom',
        });
      }

      if (!isWorksOrServices) {
        const explicitCostMatch = desc.match(
          new RegExp(`себестоимост[ьию][^\\d]*(${NUMBER_TOKEN_SOURCE})`, 'i')
        );
        let cogs = explicitCostMatch ? parseRussianNumber(explicitCostMatch[1]) || 0 : 0;
        if (cogs === 0 && goodsInventoryTracker.length > 0) {
          const lastLot = goodsInventoryTracker[goodsInventoryTracker.length - 1];
          if (qtyMatch && lastLot.quantity > 0) {
            cogs = round2((lastLot.netCost / lastLot.quantity) * qtyMatch.quantity);
          } else {
            cogs = lastLot.netCost;
          }
        }
        if (cogs > 0) {
          postings.push({
            id: `${opId}-p-cogs`,
            debitAccount: '90.02.1',
            debitSubconto: [nomGroup],
            creditAccount: '41.01',
            creditSubconto: [soldGoodsName, 'Основной склад'],
            amount: cogs,
            comment: 'Списана закупочная себестоимость реализованных товаров со склада 41.01',
            proportionOfTotal: 'custom',
          });
        }
      }

      postings.push({
        id: `${opId}-p1`,
        debitAccount: '62.01',
        debitSubconto: [cpName, contractInfo.fullLabel || 'Основной договор с покупателем'],
        creditAccount: '90.01.1',
        creditSubconto: [nomGroup],
        amount: totalSale,
        comment: isWorksOrServices
          ? `Признана выручка от сдачи работ заказчику по объекту «${nomGroup}»`
          : 'Признана выручка от реализации товаров покупателю',
        proportionOfTotal: 'full',
      });

      if (vatSale > 0) {
        postings.push({
          id: `${opId}-p2`,
          debitAccount: '90.03',
          debitSubconto: [nomGroup],
          creditAccount: '68.02',
          creditSubconto: ['Налог (взносы): начислено / уплачено'],
          amount: vatSale,
          comment: 'Начислен НДС с выручки от реализации (в книгу продаж)',
          proportionOfTotal: 'vat_only',
        });
      }

      if (inlinePaymentAmount > 0) {
        cashFlowItemsSet.add('Поступления от продажи продукции и товаров, выполнения работ, оказания услуг');
        postings.push({
          id: `${opId}-p3`,
          debitAccount: '51',
          debitSubconto: ['Основной расчетный счет'],
          creditAccount: '62.01',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор с покупателем'],
          amount: inlinePaymentAmount,
          comment: 'Поступила оплата от покупателя (заказчика) на расчетный счет',
          proportionOfTotal: 'custom',
        });
      }

      pitfalls = [
        {
          severity: isWorksOrServices ? 'critical' : 'info',
          title: isWorksOrServices
            ? `Проверьте совпадение Номенклатурной группы «${nomGroup}» со счетом 20.01!`
            : 'Не забудьте выписать Счет-фактуру выданный (или включить тумблер УПД)!',
          description: isWorksOrServices
            ? `В документе «Реализация → Услуги» субконто счета 90.01.1 (Номенклатурная группа «${nomGroup}») должно совпадать с Номенклатурной группой затрат на счете 20.01, чтобы счет 20.01 закрылся в конце месяца.`
            : 'Себестоимость товара (Дт 90.02.1 Кт 41.01) рассчитывается в 1С автоматически по стоимости без НДС из документа поступления.',
          checkType: 'closing_subconto',
        },
      ];
    }

    // =========================================================================
    // RULE 11: Поступление оплаты / аванса от покупателя на р/сч (51 / 62.01 или 62.02)
    // =========================================================================
    else if (
      /(?:поступил.*на\s+р\/с|получен.*оплат|зачислен.*на\s+р\/с|получен.*аванс.*от\s+покупател|предоплат.*от\s+покупател|от\s+покупател|от\s+заказчик)/i.test(
        lower
      )
    ) {
      const isBuyerAdvance = /(?:аванс|предоплат|в\s+счет\s+предстоящ)/i.test(lower);
      const cpName = registerCounterparty(
        rawCp,
        'С покупателем',
        contractInfo.number,
        contractInfo.date || row.date,
        reqs
      );
      cashFlowItemsSet.add('Поступления от продажи продукции и товаров, выполнения работ, оказания услуг');

      if (isBuyerAdvance && workingAmount > 0) {
        buyerAdvances.set(cpName.toLowerCase(), round2((buyerAdvances.get(cpName.toLowerCase()) || 0) + workingAmount));
      }

      if (explicitAmount === null && !isBuyerAdvance) {
        smartLink = {
          accountCode: '62.01',
          side: 'debit',
          matchSubconto1: rawCp,
          matchContract: contractInfo.number,
          description: 'Погашение дебиторской задолженности покупателя по сальдо Дт 62.01 на начало периода',
        };
      }

      menuPath1C = ['Банк и касса', 'Банк', 'Банковские выписки', 'Поступление'];
      documentType1C = 'Поступление на расчетный счет';
      operationKind1C = 'Оплата от покупателя';
      hasUpdOrSf = isBuyerAdvance;
      updLabel = isBuyerAdvance ? 'Счет-фактура выданный на аванс (Дт 76.АВ Кт 68.02)' : undefined;

      documentFields = [
        { label: 'Вид операции', value: 'Оплата от покупателя', copyable: true, highlight: true },
        { label: 'Дата выписки', value: row.date, copyable: true },
        { label: 'Плательщик (Покупатель)', value: cpName, copyable: true },
        ...(reqs.inn ? [{ label: 'ИНН / КПП плательщика', value: `${reqs.inn} / ${reqs.kpp || ''}`, copyable: true }] : []),
        { label: 'Договор', value: contractInfo.fullLabel || 'Основной договор с покупателем', copyable: true },
        { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
        { label: 'Счета расчетов', value: '62.01 / 62.02 (Погашение: Автоматически)', copyable: true },
      ];

      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: '51',
          debitSubconto: ['Основной расчетный счет'],
          creditAccount: isBuyerAdvance ? '62.02' : '62.01',
          creditSubconto: [cpName, contractInfo.fullLabel || 'Основной договор с покупателем'],
          amount: workingAmount,
          comment: isBuyerAdvance
            ? 'Получен аванс от покупателя на расчетный счет'
            : 'Поступила оплата от покупателя за реализованные товары / работы',
          proportionOfTotal: 'full',
        },
      ];

      pitfalls = [
        {
          severity: isBuyerAdvance ? 'warning' : 'info',
          title: isBuyerAdvance
            ? 'Не забудьте выставить Счет-фактуру на аванс (76.АВ)!'
            : 'Проверьте совпадение договора для закрытия дебиторской задолженности на 62.01',
          description: isBuyerAdvance
            ? 'При получении аванса от покупателя на ОСНО необходимо зарегистрировать «Счет-фактуру на аванс» (Дт 76.АВ Кт 68.02).'
            : 'Убедитесь, что в банковской выписке выбран тот же договор, что и в документе «Реализация», чтобы дебетовое сальдо по счету 62.01 закрылось в ноль.',
          checkType: 'advance_offset',
        },
      ];
    }

    // =========================================================================
    // RULE 12: Подотчетные лица (71.01), Уставный капитал (75.01 / 80.09), РКО банка
    // =========================================================================
    else if (/(?:под\s+отчет|подотчетн|авансов.*отчет)/i.test(lower)) {
      const isExpenseReport = /авансов.*отчет|утвержден.*отчет|отчитал/i.test(lower);
      if (isExpenseReport) {
        menuPath1C = ['Банк и касса', 'Касса', 'Авансовые отчеты'];
        documentType1C = 'Авансовый отчет';
        operationKind1C = 'Отчет подотчетного лица';
        documentFields = [
          { label: 'Дата отчета', value: row.date, copyable: true },
          { label: 'Подотчетное лицо', value: 'Сотрудник организации', copyable: true },
          { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: /материал|канцтовар|инвентарь|гсм/i.test(lower) ? '10.01' : '26',
            debitSubconto: ['Хозяйственные расходы'],
            creditAccount: '71.01',
            creditSubconto: ['Сотрудник организации'],
            amount: workingAmount,
            comment: 'Утвержден авансовый отчет подотчетного лица',
            proportionOfTotal: 'full',
          },
        ];
        pitfalls = [
          {
            severity: 'warning',
            title: 'Вычет НДС по авансовому отчету возможен только при наличии СФ / УПД!',
            description: 'По кассовому чеку без счета-фактуры НДС к вычету на счет 68.02 не принимается.',
            checkType: 'general',
          },
        ];
      } else {
        const isCash = /из\s+касс|через\s+касс|наличн|рко/i.test(lower) || !/р\/с|банк|карт/i.test(lower);
        menuPath1C = isCash
          ? ['Банк и касса', 'Касса', 'Кассовые документы', 'Выдача (РКО)']
          : ['Банк и касса', 'Банк', 'Банковские выписки', 'Списание'];
        documentType1C = isCash ? 'Выдача наличных (РКО)' : 'Списание с расчетного счета';
        operationKind1C = isCash ? 'Выдача подотчетному лицу' : 'Перечисление подотчетному лицу';
        documentFields = [
          { label: 'Вид операции', value: operationKind1C, copyable: true, highlight: true },
          { label: 'Дата', value: row.date, copyable: true },
          { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: '71.01',
            debitSubconto: ['Сотрудник организации'],
            creditAccount: isCash ? '50.01' : '51',
            creditSubconto: [isCash ? 'Выдача под отчет' : 'Основной расчетный счет'],
            amount: workingAmount,
            comment: 'Выданы денежные средства сотруднику под отчет',
            proportionOfTotal: 'full',
          },
        ];
        pitfalls = [
          {
            severity: 'info',
            title: 'Контролируйте остаток денежных средств',
            description: 'Проверьте достаточность остатка на счете списания.',
            checkType: isCash ? 'cash_balance' : 'bank_balance',
          },
        ];
      }
    } else if (/(?:уставн.*капитал|вклад\s+учредител|формирован.*уставн)/i.test(lower)) {
      const isContribution =
        /(?:внесен|поступил|оплачен.*вклад|на\s+р\/с|в\s+касс)/i.test(lower) &&
        !/сформирован|объявлен|зарегистрирован/i.test(lower);
      if (isContribution) {
        const intoCash = /в\s+касс|наличн/i.test(lower);
        menuPath1C = intoCash
          ? ['Банк и касса', 'Касса', 'Кассовые документы', 'Поступление (ПКО)']
          : ['Банк и касса', 'Банк', 'Банковские выписки', 'Поступление'];
        documentType1C = intoCash ? 'Поступление наличных (ПКО)' : 'Поступление на расчетный счет';
        operationKind1C = 'Взнос в уставный капитал';
        documentFields = [
          { label: 'Вид операции', value: 'Взнос в уставный капитал', copyable: true, highlight: true },
          { label: 'Счет кредита', value: '75.01', copyable: true },
          { label: 'Сумма вклада, ₽', value: String(workingAmount), copyable: true },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: intoCash ? '50.01' : '51',
            debitSubconto: ['Взнос в уставный капитал'],
            creditAccount: '75.01',
            creditSubconto: ['Учредитель организации'],
            amount: workingAmount,
            comment: 'Внесен вклад учредителя в оплату уставного капитала',
            proportionOfTotal: 'full',
          },
        ];
      } else {
        menuPath1C = ['Операции', 'Бухгалтерский учет', 'Формирование уставного капитала'];
        documentType1C = 'Формирование уставного капитала';
        operationKind1C = 'Формирование уставного капитала';
        documentFields = [
          { label: 'Дата регистрации', value: row.date, copyable: true },
          { label: 'Размер уставного капитала, ₽', value: String(workingAmount), copyable: true },
        ];
        postings = [
          {
            id: `${opId}-p1`,
            debitAccount: '75.01',
            debitSubconto: ['Учредитель организации'],
            creditAccount: '80.09',
            creditSubconto: ['Учредитель организации'],
            amount: workingAmount,
            comment: 'Отражена величина уставного капитала и задолженность учредителя по вкладу',
            proportionOfTotal: 'full',
          },
        ];
      }
      pitfalls = [
        {
          severity: 'info',
          title: 'Используйте документ «Операции → Формирование уставного капитала»',
          description: 'В 1С 8.3 ред. 3.0 для проводки Дт 75.01 Кт 80.09 предусмотрен готовый типовой документ.',
          checkType: 'general',
        },
      ];
    } else if (/(?:комисси.*банк|рко\s+банк|услуг.*банк)/i.test(lower)) {
      expenseItemsSet.add('Расходы на услуги банков');
      menuPath1C = ['Банк и касса', 'Банк', 'Банковские выписки', 'Списание'];
      documentType1C = 'Списание с расчетного счета';
      operationKind1C = 'Комиссия банка';
      documentFields = [
        { label: 'Вид операции', value: 'Комиссия банка', copyable: true, highlight: true },
        { label: 'Счет затрат', value: '91.02 (Расходы на услуги банков)', copyable: true },
        { label: 'Сумма, ₽', value: String(workingAmount), copyable: true },
      ];
      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: '91.02',
          debitSubconto: ['Расходы на услуги банков'],
          creditAccount: '51',
          creditSubconto: ['Основной расчетный счет'],
          amount: workingAmount,
          comment: 'Списана комиссия банка за расчетно-кассовое обслуживание',
          proportionOfTotal: 'full',
        },
      ];
      pitfalls = [
        {
          severity: 'info',
          title: 'Комиссия банка не облагается НДС (ст. 149 НК РФ)',
          description: 'Сумма сразу относится в дебет счета 91.02 без выделения НДС.',
          checkType: 'bank_balance',
        },
      ];
    } else {
      documentFields = [
        { label: 'Дата операции', value: row.date, copyable: true },
        { label: 'Содержание', value: desc, copyable: true },
        {
          label: 'Сумма, ₽',
          value: explicitAmount !== null ? String(workingAmount) : 'Требуется уточнить',
          copyable: explicitAmount !== null,
        },
      ];
      postings = [
        {
          id: `${opId}-p1`,
          debitAccount: '26',
          debitSubconto: ['Прочие расходы'],
          creditAccount: '60.01',
          creditSubconto: [rawCp || 'Контрагент'],
          amount: workingAmount,
          comment: desc,
          proportionOfTotal: 'full',
        },
      ];
      pitfalls = [
        {
          severity: 'info',
          title: 'Проверьте корреспонденцию счетов по условию вашей методички',
          description:
            'Операция распознана универсальным правилом — уточните счета учета или подключите API-ключ в «Настройках ИИ» для нестандартных формулировок.',
          checkType: 'general',
        },
      ];
      warnings.push(`Операция №${row.number}: применен базовый шаблон разбора — проверьте счета учета.`);
    }

    const isNeedsData = explicitAmount === null && workingAmount <= 0;

    return {
      id: opId,
      number: row.number,
      date: row.date,
      shortTitle:
        desc.length <= 54
          ? desc
          : `${operationKind1C}${rawCp ? ` (${rawCp})` : ''}`.slice(0, 62),
      rawDescription: desc,
      explicitAmount,
      resolvedAmount: workingAmount,
      status: isNeedsData ? 'needs_data' : 'pending',
      missingDataReason: isNeedsData
        ? smartLink?.description ||
          'Сумма операции не указана в условии — введите связанные начальные остатки во вкладке «Начальные остатки».'
        : undefined,
      smartLink,
      menuPath1C,
      documentType1C,
      operationKind1C,
      hasUpdOrSf,
      updLabel,
      documentFields,
      vatBreakdown,
      postings,
      pitfalls,
    };
  });

  if (operations.length === 0 && rawText.trim().length > 0) {
    warnings.push(
      'Не удалось выделить отдельные строки операций. Проверьте формат таблицы (№, Дата, Содержание, Сумма).'
    );
  }

  return {
    title: detectedTitle,
    operations,
    directories: {
      counterparties: Array.from(counterpartiesMap.values()),
      nomenclature: Array.from(nomenclatureMap.values()),
      nomenclatureGroups: Array.from(nomenclatureGroupsSet),
      expenseItems: Array.from(expenseItemsSet),
      cashFlowItems: Array.from(cashFlowItemsSet),
      employees: Array.from(employeesMap.values()),
    },
    warnings,
  };
}

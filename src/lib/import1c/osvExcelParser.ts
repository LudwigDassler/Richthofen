import * as XLSX from 'xlsx';
import type {
  CounterpartyCard1C,
  EmployeeCard1C,
  OpeningBalanceEntry,
  OrganizationCard,
} from '@/types/accounting';
import { CHART_OF_ACCOUNTS } from '@/data/chartOfAccounts';

function round2(val: number): number {
  if (!Number.isFinite(val) || Math.abs(val) < 0.0001) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

const KNOWN_ACCOUNT_CODES = new Set(CHART_OF_ACCOUNTS.map((a) => a.code));

export interface Partial1COsvParseOutput {
  detectedFormats: string[];
  periodLabel?: string;
  organizationPatch?: Partial<OrganizationCard>;
  generalBalances: OpeningBalanceEntry[];
  detailedBalances: OpeningBalanceEntry[];
  detailedAccountRoots: Set<string>;
  counterparties: CounterpartyCard1C[];
  employees: EmployeeCard1C[];
  warnings: string[];
}

function parse1CCellNumber(cell: unknown): number {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? round2(cell) : 0;
  }
  if (typeof cell !== 'string') return 0;
  const trimmed = cell.trim();
  if (!trimmed || trimmed === '-' || trimmed === '—' || trimmed === '–') return 0;

  // Handle parentheses negative notation `(12 300,00)` in some 1C exports
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/[()₽]/g, '')
    .replace(/руб\.?/gi, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(',', '.');

  const num = Number(cleaned);
  if (!Number.isFinite(num)) return 0;
  return round2(isParenNegative ? -Math.abs(num) : num);
}

function normalizeAccountCodeCandidate(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^сч(?:ет)?\.?\s*/i, '')
    .replace(/,/g, '.')
    .trim();

  if (!cleaned) return null;
  // Match Russian 1C 8.3 account codes: "01", "01.01", "10.08", "68.04.1", "76.АВ", "76.ВА", "000"
  if (/^(?:000|\d{2}(?:\.(?:\d{1,2}|АВ|ВА|Н|У))*(?:\.\d{1,2})?)$/i.test(cleaned)) {
    const upper = cleaned.toUpperCase();
    // Avoid mistaking dates like "31.03" or "01.04" as accounts unless known or valid COA prefix
    const root = upper.split('.')[0];
    if (upper === '31.03' || upper === '01.04' || upper === '01.01.2026') {
      return null;
    }
    const rootNum = Number(root);
    if (upper === '000' || (rootNum >= 1 && rootNum <= 99)) {
      if (KNOWN_ACCOUNT_CODES.has(upper)) return upper;
      // Accept valid 2-digit roots in Russian COA (01..99) except obvious calendar day > 31 with month
      const validRoots = new Set([
        '01', '02', '04', '05', '07', '08', '09', '10', '11', '14', '15', '16', '19',
        '20', '21', '23', '25', '26', '28', '29', '40', '41', '42', '43', '44', '45', '46',
        '50', '51', '52', '55', '57', '58', '59', '60', '62', '63', '66', '67', '68', '69',
        '70', '71', '73', '75', '76', '77', '79', '80', '81', '82', '83', '84', '86',
        '90', '91', '94', '96', '97', '98', '99', '000',
      ]);
      if (validRoots.has(root)) {
        return upper;
      }
    }
  }
  return null;
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

interface DetectedColumns {
  headerEndRow: number;
  accountCol: number;
  nameCol: number;
  subconto1Col: number;
  subconto2Col: number;
  indicatorCol: number;
  endDebitCol: number;
  endCreditCol: number;
}

function detectOsvColumns(grid: string[][]): DetectedColumns | null {
  const maxScan = Math.min(grid.length, 25);

  for (let r = 0; r < maxScan; r++) {
    const row = grid[r].map((c) => c.trim());
    const nextRow = r + 1 < grid.length ? grid[r + 1].map((c) => c.trim()) : [];
    const rowJoined = row.join(' | ').toLowerCase();

    const hasAccountHeader = row.some((c) =>
      /^(?:счет|субсчет|код\s*счета|счет\s*,?\s*наименование|субконто|контрагент)/i.test(c)
    );
    const hasSaldoWords =
      /сальдо|остаток|конец\s+периода|на\s+конец|кон\.\s*дт|конечн/i.test(rowJoined) ||
      /дебет|кредит/i.test(nextRow.join(' | ').toLowerCase());

    if (!hasAccountHeader && !hasSaldoWords) continue;

    let accountCol = 0;
    let nameCol = -1;
    let subconto1Col = -1;
    let subconto2Col = -1;
    let indicatorCol = -1;
    let endDebitCol = -1;
    let endCreditCol = -1;
    let usedTwoRowHeader = false;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c].toLowerCase();
      if (/^(?:счет|субсчет|код\s*счета)$/i.test(cell)) {
        accountCol = c;
      } else if (/наименование|описание/i.test(cell) && nameCol === -1) {
        nameCol = c;
      } else if (/^(?:контрагент|субконто\s*1|работник|сотрудник|вид\s+налога)/i.test(cell)) {
        subconto1Col = c;
      } else if (/^(?:договор|субконто\s*2|договоры)/i.test(cell)) {
        subconto2Col = c;
      } else if (/^показат/i.test(cell)) {
        indicatorCol = c;
      }
    }

    // Check 2-row merged header: Row r has "Сальдо на конец периода", Row r+1 has "Дебет" / "Кредит"
    for (let c = 0; c < row.length; c++) {
      const top = row[c].toLowerCase();
      if (/сальдо\s+на\s+конец|остаток\s+на\s+конец|на\s+конец\s+периода|конечн\w*\s+сальдо/i.test(top)) {
        // Check single-row combined headers first ("Сальдо на конец Дт")
        if (/дебет|(?:^|[\s(.,;/-])дт(?=$|[\s).,;/-])|д-т/i.test(top)) {
          endDebitCol = c;
        } else if (/кредит|(?:^|[\s(.,;/-])кт(?=$|[\s).,;/-])|к-т/i.test(top)) {
          endCreditCol = c;
        } else if (nextRow.length > c) {
          // Merged 2-row 1C header
          const sub1 = (nextRow[c] || '').toLowerCase();
          const sub2 = (nextRow[c + 1] || '').toLowerCase();
          if (/дебет|дт|д-т/i.test(sub1)) {
            endDebitCol = c;
            usedTwoRowHeader = true;
          }
          if (/кредит|кт|к-т/i.test(sub2)) {
            endCreditCol = c + 1;
            usedTwoRowHeader = true;
          }
        }
      } else if (/(?:кон\.?\s*(?:сальдо\s*)?(?:дебет|дт)|дт\s*кон)/i.test(top)) {
        endDebitCol = c;
      } else if (/(?:кон\.?\s*(?:сальдо\s*)?(?:кредит|кт)|кт\s*кон)/i.test(top)) {
        endCreditCol = c;
      }
    }

    // Fallback: collect all "Дебет" and "Кредит" pairs across row or nextRow and take the LAST pair (which in 1C OSV is always Ending Balance!)
    if (endDebitCol === -1 || endCreditCol === -1) {
      const scanTarget = nextRow.filter((x) => /дебет|кредит|^дт$|^кт$/i.test(x)).length >= 2 ? nextRow : row;
      const dtCols: number[] = [];
      const ktCols: number[] = [];
      for (let c = 0; c < scanTarget.length; c++) {
        if (/^(?:дебет|дт|д-т)$/i.test(scanTarget[c])) dtCols.push(c);
        if (/^(?:кредит|кт|к-т)$/i.test(scanTarget[c])) ktCols.push(c);
      }
      if (dtCols.length > 0 && ktCols.length > 0) {
        endDebitCol = dtCols[dtCols.length - 1];
        endCreditCol = ktCols[ktCols.length - 1];
        if (scanTarget === nextRow) usedTwoRowHeader = true;
      }
    }

    if (endDebitCol !== -1 && endCreditCol !== -1) {
      return {
        headerEndRow: usedTwoRowHeader ? r + 1 : r,
        accountCol,
        nameCol,
        subconto1Col,
        subconto2Col,
        indicatorCol,
        endDebitCol,
        endCreditCol,
      };
    }
  }

  return null;
}

function extractHeaderMetadata(grid: string[][], maxRows = 10): {
  orgPatch?: Partial<OrganizationCard>;
  periodLabel?: string;
  targetAccountFromTitle?: string;
} {
  let orgName: string | undefined;
  let inn: string | undefined;
  let kpp: string | undefined;
  let periodLabel: string | undefined;
  let targetAccountFromTitle: string | undefined;

  for (let r = 0; r < Math.min(grid.length, maxRows); r++) {
    const line = grid[r].filter(Boolean).join(' ').trim();
    if (!line) continue;

    const accTitleMatch = line.match(
      /оборотно-сальдовая\s+ведомость\s+по\s+счет[уам]+\s+([0-9.,\sи]+)/i
    );
    if (accTitleMatch) {
      const firstCode = accTitleMatch[1].match(/\d{2}(?:\.\d{1,2})?/);
      if (firstCode) targetAccountFromTitle = firstCode[0];
    }

    const periodMatch = line.match(
      /(?:за\s+)((?:1\s*квартал|I\s*квартал|январь\s*[-–—]\s*март|\d{1,2}\s*[а-яё]+\s*[-–—]\s*\d{1,2}\s*[а-яё]+)\s*\d{4}\s*г?\.?)/i
    );
    if (periodMatch && !periodLabel) {
      periodLabel = periodMatch[1].trim();
    }

    const innM = line.match(/ИНН\s*(\d{10}|\d{12})/i);
    if (innM) inn = innM[1];
    const kppM = line.match(/КПП\s*(\d{9})/i);
    if (kppM) kpp = kppM[1];

    if (!orgName) {
      const orgPrefix = line.match(/(?:организация|предприятие)\s*:\s*(.+?)(?=\s+ИНН|\s*\(|$)/i);
      if (orgPrefix && orgPrefix[1].trim().length > 3) {
        orgName = orgPrefix[1].trim();
      } else if (
        /(?:^|\s)(?:ООО|АО|ПАО|ЗАО|Общество\s+с\s+ограниченной\s+ответственностью|Акционерное\s+общество)\s+[«"][^»"]+[»"]/i.test(
          line
        ) &&
        !/ведомость|контрагент|договор/i.test(line)
      ) {
        const m = line.match(
          /((?:ООО|АО|ПАО|ЗАО|Общество\s+с\s+ограниченной\s+ответственностью|Акционерное\s+общество)\s+[«"][^»"]+[»"])/i
        );
        if (m) orgName = m[1].trim();
      }
    }
  }

  const orgPatch: Partial<OrganizationCard> = {};
  if (orgName) {
    orgPatch.shortName = orgName.startsWith('Общество')
      ? orgName.replace(/Общество\s+с\s+ограниченной\s+ответственностью/i, 'ООО')
      : orgName;
    orgPatch.name = orgName.startsWith('ООО ')
      ? orgName.replace(/^ООО\s+/i, 'Общество с ограниченной ответственностью ')
      : orgName;
  }
  if (inn) orgPatch.inn = inn;
  if (kpp) orgPatch.kpp = kpp;

  return {
    orgPatch: Object.keys(orgPatch).length > 0 ? orgPatch : undefined,
    periodLabel,
    targetAccountFromTitle,
  };
}

function isTaxAccountingRow(row: string[], indicatorCol: number): boolean {
  if (indicatorCol >= 0 && row[indicatorCol]) {
    const ind = row[indicatorCol].trim().toUpperCase();
    if (ind === 'НУ' || ind === 'ПР' || ind === 'ВР' || ind === 'КВ') return true;
  }
  // Sometimes 1C puts БУ/НУ in adjacent column next to account/subconto
  for (let c = 0; c < Math.min(row.length, 4); c++) {
    const val = (row[c] || '').trim().toUpperCase();
    if (val === 'НУ' || val === 'ПР' || val === 'ВР') return true;
  }
  return false;
}

function classifyHierarchyLabel(text: string): 'contract' | 'counterparty' | 'employee' | 'tax_or_other' {
  const trimmed = text.trim();
  if (/^(?:договор|дог\.|контракт|соглашение|счет\s*№|основной\s+договор|исполнительный\s+лист)/i.test(trimmed)) {
    return 'contract';
  }
  if (/(?:^|\s)(?:ООО|АО|ПАО|ЗАО|НАО|ГУП|МУП|ИП|МИ\s*ФНС|ИФНС)(?=$|[\s(«",.;:-])/i.test(trimmed)) {
    return 'counterparty';
  }
  if (/^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?(?:\s*\(.*\))?$/.test(trimmed)) {
    return 'employee';
  }
  return 'tax_or_other';
}

export function parse1COsvSheetGrid(
  grid: string[][],
  sheetName: string,
  out: Partial1COsvParseOutput
): void {
  if (grid.length < 2) return;

  const meta = extractHeaderMetadata(grid);
  if (meta.periodLabel && !out.periodLabel) {
    out.periodLabel = meta.periodLabel;
  }
  if (meta.orgPatch) {
    out.organizationPatch = {
      ...meta.orgPatch,
      ...out.organizationPatch,
    };
  }

  const cols = detectOsvColumns(grid);
  if (!cols) return;

  const sheetAccHintMatch = sheetName.match(/(?:счет[уам]*|осв)\s*(\d{2}(?:\.\d{1,2})?)/i);
  const defaultAccountFromSheet =
    meta.targetAccountFromTitle || (sheetAccHintMatch ? sheetAccHintMatch[1] : undefined);

  const isExplicitlyDetailedSheet =
    Boolean(defaultAccountFromSheet) ||
    cols.subconto1Col !== -1 ||
    /по\s+счет|субконто|контрагент|сотрудник/i.test(sheetName);

  interface RawParsedOsvLine {
    rowIndex: number;
    accountCode?: string;
    label: string;
    subconto1?: string;
    subconto2?: string;
    debit: number;
    credit: number;
  }

  const rawLines: RawParsedOsvLine[] = [];

  for (let r = cols.headerEndRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((c) => !String(c).trim())) continue;
    if (isTaxAccountingRow(row, cols.indicatorCol)) continue;

    const firstCell = (row[cols.accountCol] || '').trim();
    const fallbackNameCol = cols.accountCol + 1;
    const rawSecond =
      cols.nameCol >= 0
        ? (row[cols.nameCol] || '').trim()
        : fallbackNameCol !== cols.indicatorCol && fallbackNameCol < cols.endDebitCol
          ? (row[fallbackNameCol] || '').trim()
          : '';
    const secondCell = /^(?:бу|ну|пр|вр)$/i.test(rawSecond) ? '' : rawSecond;

    if (/^(?:итого|всего|сальдо\s+на\s+конец)/i.test(firstCell) || /^(?:итого|всего)$/i.test(secondCell)) {
      continue;
    }

    const debit = parse1CCellNumber(row[cols.endDebitCol]);
    const credit = parse1CCellNumber(row[cols.endCreditCol]);

    // Check if firstCell starts with an account code (e.g. "60.01" or "60.01 Расчеты с поставщиками")
    let accCode = normalizeAccountCodeCandidate(firstCell);
    let label = secondCell || firstCell;

    if (!accCode && firstCell) {
      const splitLead = firstCell.match(/^(\d{2}(?:\.(?:\d{1,2}|АВ|ВА))?)\s*[—\-:]?\s+(.+)$/i);
      if (splitLead) {
        const cand = normalizeAccountCodeCandidate(splitLead[1]);
        if (cand) {
          accCode = cand;
          label = splitLead[2].trim();
        }
      }
    }

    const explicitSub1 = cols.subconto1Col >= 0 ? (row[cols.subconto1Col] || '').trim() : undefined;
    const explicitSub2 = cols.subconto2Col >= 0 ? (row[cols.subconto2Col] || '').trim() : undefined;

    if (!accCode && !firstCell && !secondCell && !explicitSub1) continue;

    rawLines.push({
      rowIndex: r,
      accountCode: accCode || undefined,
      label: (firstCell && !accCode ? firstCell : label).trim(),
      subconto1: explicitSub1 || undefined,
      subconto2: explicitSub2 || undefined,
      debit,
      credit,
    });
  }

  if (rawLines.length === 0) return;

  // Check if sheet contains non-account subconto rows (hierarchical detailed OSV) or explicit subconto columns
  const hasNonAccountRows = rawLines.some((l) => !l.accountCode && l.label.length > 1 && (l.debit !== 0 || l.credit !== 0));
  const treatAsDetailed = isExplicitlyDetailedSheet || hasNonAccountRows;

  if (!treatAsDetailed) {
    // =========================================================================
    // STANDARD GENERAL 1C OSV (by Accounts & Subaccounts)
    // =========================================================================
    out.detectedFormats.push(`Общая ОСВ 1С (${sheetName})`);

    const accountRows = rawLines.filter((l) => Boolean(l.accountCode));
    const allCodes = accountRows.map((l) => l.accountCode as string);

    for (const line of accountRows) {
      const code = line.accountCode as string;
      // Skip closed/result 90, 91, 99 or technical 000 if zero
      if (code === '000') continue;
      if ((code.startsWith('90') || code.startsWith('91')) && Math.abs(line.debit - line.credit) < 0.01) {
        continue;
      }

      // CRITICAL DEDUPLICATION: skip synthetic parent group row if any child subaccount exists!
      const hasChildSubaccount = allCodes.some(
        (other) => other !== code && other.startsWith(`${code}.`)
      );
      if (hasChildSubaccount) continue;

      if (Math.abs(line.debit) < 0.005 && Math.abs(line.credit) < 0.005) continue;

      // Normalize 1C negative active/passive red balance if any, or standard positive debit/credit
      let debit = line.debit;
      let credit = line.credit;
      if (debit < 0 && credit === 0) {
        credit = Math.abs(debit);
        debit = 0;
      } else if (credit < 0 && debit === 0) {
        debit = Math.abs(credit);
        credit = 0;
      }

      out.generalBalances.push({
        id: `imp-osv-${code}-${out.generalBalances.length + 1}`,
        accountCode: code,
        subconto1: line.label && line.label !== code ? line.label : undefined,
        debit: round2(debit),
        credit: round2(credit),
        comment: 'Перенесено из общей ОСВ 1С за 1 квартал (сальдо на 31.03)',
      });
    }
    return;
  }

  // ===========================================================================
  // DETAILED ACCOUNT OSV («ОСВ по счету 60 / 62 / 68 / 69 / 70 / 76»)
  // ===========================================================================
  out.detectedFormats.push(`ОСВ по счету с аналитикой субконто (${sheetName})`);

  // Flat columns case (`Контрагент` / `Договор` columns explicitly present)
  if (cols.subconto1Col !== -1) {
    let currentAcc = defaultAccountFromSheet || '60.01';
    for (const line of rawLines) {
      if (line.accountCode) currentAcc = line.accountCode;
      if (!line.subconto1 && line.accountCode) continue; // summary row for the account
      if (Math.abs(line.debit) < 0.005 && Math.abs(line.credit) < 0.005) continue;

      const root = currentAcc.split('.')[0];
      out.detailedAccountRoots.add(currentAcc);
      out.detailedAccountRoots.add(root);

      const sub1Clean = cleanRequisitesSuffix(line.subconto1 || line.label);
      out.detailedBalances.push({
        id: `imp-det-${currentAcc}-${out.detailedBalances.length + 1}`,
        accountCode: currentAcc,
        subconto1: sub1Clean || undefined,
        subconto2: line.subconto2 || undefined,
        debit: round2(Math.max(0, line.debit)),
        credit: round2(Math.max(0, line.credit)),
        comment: `Перенесено из ОСВ по счету ${currentAcc} (${sheetName})`,
      });

      registerEntityFromDetailedRow(root, currentAcc, line.subconto1 || line.label, line.subconto2, line.credit, out);
    }
    return;
  }

  // Hierarchical 1C 8.3 rows case: Account -> Subaccount -> Subconto 1 (Counterparty / Tax / Employee) -> Subconto 2 (Contract)
  const allExplicitAccounts = rawLines
    .map((l) => l.accountCode)
    .filter((c): c is string => Boolean(c));

  let activeAccount = defaultAccountFromSheet || allExplicitAccounts[0] || '60.01';
  let activeSubconto1: string | undefined;
  let activeSubconto1Raw: string | undefined;

  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];

    if (cur.accountCode) {
      activeAccount = cur.accountCode;
      activeSubconto1 = undefined;
      activeSubconto1Raw = undefined;

      // Check if this leaf subaccount has NO subconto children beneath it before the next account row
      const hasChildAccount = allExplicitAccounts.some(
        (other) => other !== cur.accountCode && other.startsWith(`${cur.accountCode}.`)
      );
      if (hasChildAccount) continue;

      const nextLine = rawLines[i + 1];
      const hasSubcontoRowsBelow = Boolean(nextLine && !nextLine.accountCode);
      if (!hasSubcontoRowsBelow && (Math.abs(cur.debit) >= 0.005 || Math.abs(cur.credit) >= 0.005)) {
        const root = activeAccount.split('.')[0];
        out.detailedAccountRoots.add(activeAccount);
        out.detailedAccountRoots.add(root);
        out.detailedBalances.push({
          id: `imp-det-${activeAccount}-${out.detailedBalances.length + 1}`,
          accountCode: activeAccount,
          subconto1: cur.label && cur.label !== activeAccount ? cur.label : undefined,
          debit: round2(Math.max(0, cur.debit)),
          credit: round2(Math.max(0, cur.credit)),
          comment: `Перенесено из ОСВ по счету (${sheetName})`,
        });
      }
      continue;
    }

    // Non-account row: determine whether it's Subconto 1 (Counterparty/Employee/Tax) or Subconto 2 (Contract)
    const kind = classifyHierarchyLabel(cur.label);
    const nextLine = rawLines[i + 1];
    const nextKind =
      nextLine && !nextLine.accountCode ? classifyHierarchyLabel(nextLine.label) : null;

    if (kind !== 'contract') {
      activeSubconto1Raw = cur.label;
      activeSubconto1 = cleanRequisitesSuffix(cur.label);

      // If immediately followed by Contract row(s), do NOT emit this parent Counterparty row — emit only the leaf Contract rows!
      if (nextKind === 'contract') {
        continue;
      }

      if (Math.abs(cur.debit) < 0.005 && Math.abs(cur.credit) < 0.005) continue;

      const root = activeAccount.split('.')[0];
      out.detailedAccountRoots.add(activeAccount);
      out.detailedAccountRoots.add(root);

      out.detailedBalances.push({
        id: `imp-det-${activeAccount}-${out.detailedBalances.length + 1}`,
        accountCode: activeAccount,
        subconto1: activeSubconto1,
        debit: round2(Math.max(0, cur.debit)),
        credit: round2(Math.max(0, cur.credit)),
        comment: `Перенесено из ОСВ по счету ${activeAccount} (${sheetName})`,
      });

      registerEntityFromDetailedRow(root, activeAccount, activeSubconto1Raw, undefined, cur.credit, out);
    } else {
      // Contract leaf row!
      const root = activeAccount.split('.')[0];
      registerEntityFromDetailedRow(
        root,
        activeAccount,
        activeSubconto1Raw || activeSubconto1 || 'Контрагент',
        cur.label,
        cur.credit,
        out
      );

      if (Math.abs(cur.debit) < 0.005 && Math.abs(cur.credit) < 0.005) continue;

      out.detailedAccountRoots.add(activeAccount);
      out.detailedAccountRoots.add(root);

      out.detailedBalances.push({
        id: `imp-det-${activeAccount}-${out.detailedBalances.length + 1}`,
        accountCode: activeAccount,
        subconto1: activeSubconto1,
        subconto2: cur.label,
        debit: round2(Math.max(0, cur.debit)),
        credit: round2(Math.max(0, cur.credit)),
        comment: `Перенесено из ОСВ по счету ${activeAccount} (${sheetName})`,
      });
    }
  }
}

function cleanRequisitesSuffix(raw: string): string {
  return raw
    .replace(/\s*\((?:ИНН|КПП|таб\.|должность|оклад)[^)]*\)\s*$/i, '')
    .trim();
}

function registerEntityFromDetailedRow(
  root: string,
  accountCode: string,
  rawSub1: string,
  sub2: string | undefined,
  creditAmount: number,
  out: Partial1COsvParseOutput
): void {
  const cleanName = cleanRequisitesSuffix(rawSub1);

  if (root === '60' || root === '62' || root === '76') {
    if (!cleanName || /^налог|^работники/i.test(cleanName)) return;
    const innMatch = rawSub1.match(/ИНН\s*(\d{10}|\d{12})/i);
    const kppMatch = rawSub1.match(/КПП\s*(\d{9})/i);
    const dateMatch = sub2?.match(/от\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i);

    const inn = innMatch ? innMatch[1] : deterministicDigits(cleanName.toLowerCase(), 10, '78');
    const kpp = kppMatch ? kppMatch[1] : `${inn.slice(0, 4)}01001`;
    const contractKind: CounterpartyCard1C['contractKind'] =
      root === '62' ? 'С покупателем' : root === '60' ? 'С поставщиком' : 'Прочее';

    const existing = out.counterparties.find(
      (c) =>
        c.name.toLowerCase() === cleanName.toLowerCase() &&
        (!sub2 || c.contractNumber.toLowerCase() === sub2.toLowerCase())
    );
    if (!existing) {
      out.counterparties.push({
        id: `imp-cp-${out.counterparties.length + 1}`,
        name: cleanName,
        fullName: cleanName.startsWith('ООО ')
          ? cleanName.replace(/^ООО\s+/, 'Общество с ограниченной ответственностью ')
          : cleanName,
        inn,
        kpp,
        bankAccount: deterministicDigits(`${cleanName}-rs`, 20, '4070281055500'),
        bankName: 'Северо-Западный банк ПАО Сбербанк',
        bik: '044030653',
        contractKind,
        contractNumber: sub2 || 'Основной договор',
        contractDate: dateMatch ? dateMatch[1] : '10.01.2026',
        createdIn1C: true,
      });
    }
  } else if (root === '70') {
    if (!cleanName || /работники\s+организации|всего|сводно/i.test(cleanName)) return;
    const roleMatch = rawSub1.match(/[—\-,(]\s*([А-ЯЁа-яё\s.]{3,35}?)\)?$/);
    const position = roleMatch ? roleMatch[1].trim() : 'Сотрудник штата';
    const pureFio = cleanName.replace(/\s*[—\-,]\s*[А-ЯЁа-яё\s.]{3,35}$/, '').trim() || cleanName;
    const isProd = /прораб|рабоч|строител|монтажник|мастер/i.test(rawSub1);

    if (!out.employees.some((e) => e.fullName.toLowerCase() === pureFio.toLowerCase())) {
      out.employees.push({
        id: `imp-emp-${out.employees.length + 1}`,
        fullName: pureFio,
        position,
        department: isProd ? 'Строительный участок' : 'Основное подразделение',
        salary: creditAmount > 0 ? round2(creditAmount / 0.87) : 70000,
        hireDate: '10.01.2026',
        costAccount: isProd ? '20.01' : accountCode === '20.01' ? '20.01' : '26',
        createdIn1C: true,
      });
    }
  }
}

export function parse1CExcelBuffer(
  buffer: ArrayBuffer,
  filename: string,
  out: Partial1COsvParseOutput
): void {
  const workbook = XLSX.read(buffer, { type: 'array' });
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });
    const grid: string[][] = rawRows.map((row) =>
      Array.isArray(row) ? row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))) : []
    );
    parse1COsvSheetGrid(grid, `${filename} → ${sheetName}`, out);
  }
}

export function parse1CCsvText(
  csvText: string,
  filename: string,
  out: Partial1COsvParseOutput
): void {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;

  const semiCount = lines.slice(0, 5).reduce((s, l) => s + (l.match(/;/g) || []).length, 0);
  const tabCount = lines.slice(0, 5).reduce((s, l) => s + (l.match(/\t/g) || []).length, 0);
  const delimiter = tabCount > semiCount ? '\t' : semiCount > 0 ? ';' : ',';

  const grid = lines.map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (!inQ && cur.trim().length === 0) inQ = true;
        else if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (inQ && (i + 1 === line.length || line[i + 1] === delimiter)) {
          inQ = false;
        } else {
          cur += '"';
        }
      } else if (ch === delimiter && !inQ) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });

  parse1COsvSheetGrid(grid, filename, out);
}

export function mergeGeneralAndDetailedBalances(out: Partial1COsvParseOutput): OpeningBalanceEntry[] {
  if (out.detailedBalances.length === 0) {
    return out.generalBalances;
  }

  // Keep general balances ONLY for accounts that were NOT replaced by detailed subconto sheets!
  const keptGeneral = out.generalBalances.filter((gb) => {
    const root = gb.accountCode.split('.')[0];
    if (out.detailedAccountRoots.has(gb.accountCode)) return false;
    // If detailed sheet covered specific subaccounts under 68/69/60/62/70, check if all subaccounts or root was covered
    const hasDetailedSameRoot = out.detailedBalances.some(
      (db) => db.accountCode === gb.accountCode || db.accountCode.split('.')[0] === gb.accountCode
    );
    if (hasDetailedSameRoot) return false;
    // Also if general had aggregate root like "68" and detailed has "68.01" + "68.02"
    if (out.detailedAccountRoots.has(root) && gb.accountCode === root) return false;
    return true;
  });

  const combined = [...keptGeneral, ...out.detailedBalances];
  combined.sort((a, b) => a.accountCode.localeCompare(b.accountCode, 'ru'));
  return combined;
}

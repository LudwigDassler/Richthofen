import type {
  BusinessOperation,
  CounterpartyCard1C,
  EmployeeCard1C,
  OpeningBalanceEntry,
  OrganizationCard,
  Synced1CSnapshot,
} from '@/types/accounting';
import { resolveOperationsWithSmartLinks } from '@/lib/engine';
import {
  mergeGeneralAndDetailedBalances,
  parse1CCsvText,
  parse1CExcelBuffer,
  Partial1COsvParseOutput,
} from './osvExcelParser';
import {
  decode1CTextBuffer,
  parse1CClientBankTxt,
  parse1CXml,
} from './xmlAndBankParser';
import { generateSample1CQ1Workbook } from './sampleGenerator1C';
import {
  buildSample1CSyncErrorPayload,
  normalize1CSyncPayload,
} from './json1CSyncNormalizer';

export {
  generateSample1CQ1Workbook,
  normalize1CSyncPayload,
  buildSample1CSyncErrorPayload,
};

export interface Parsed1CAutoFillItem {
  operationId: string;
  operationNumber: number | string;
  description: string;
  resolvedAmount: number;
  explanation: string;
}

export interface Parsed1CImportResult {
  detectedFormats: string[];
  periodLabel?: string;
  accountsCount: number;
  counterpartiesAndContractsCount: number;
  autoFilledOperationsCount: number;
  autoFilledOperations: Parsed1CAutoFillItem[];
  openingBalances: OpeningBalanceEntry[];
  organizationPatch?: Partial<OrganizationCard>;
  counterparties: CounterpartyCard1C[];
  employees: EmployeeCard1C[];
  synced1CSnapshot?: Synced1CSnapshot;
  warnings: string[];
}

function fmtRub(val: number): string {
  return `${val.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₽`;
}

function buildAutoFillExplanation(
  op: BusinessOperation,
  resolvedOp: BusinessOperation,
  openingBalances: OpeningBalanceEntry[]
): string {
  const rule = resolvedOp.smartLink || op.smartLink;
  if (!rule) {
    return `Автоматически рассчитано из входящих остатков 1С: ${fmtRub(resolvedOp.resolvedAmount)}`;
  }

  const tokens = rule.accountCode
    .split(/[+,;/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const matchingRows = openingBalances.filter((b) =>
    tokens.some((tok) => b.accountCode === tok || b.accountCode.startsWith(`${tok}.`))
  );

  if (rule.matchContract) {
    const contractRow = matchingRows.find((b) =>
      `${b.subconto1 || ''} ${b.subconto2 || ''}`
        .toLowerCase()
        .includes(rule.matchContract!.toLowerCase())
    );
    if (contractRow) {
      const baseDebt = rule.side === 'debit' ? contractRow.debit : contractRow.credit;
      const diffExtra = Math.round((resolvedOp.resolvedAmount - baseDebt) * 100) / 100;
      if (diffExtra > 0) {
        return `Счет ${contractRow.accountCode} (${contractRow.subconto1 || 'Контрагент'}, ${contractRow.subconto2 || `дог. ${rule.matchContract}`}): ${fmtRub(baseDebt)} + санкции ${fmtRub(diffExtra)} = ${fmtRub(resolvedOp.resolvedAmount)}`;
      }
      return `Счет ${contractRow.accountCode} (${contractRow.subconto1 || 'Контрагент'}, ${contractRow.subconto2 || `дог. ${rule.matchContract}`}): ${fmtRub(baseDebt)}`;
    }
  }

  if (matchingRows.length > 1) {
    const byAcc = new Map<string, number>();
    for (const r of matchingRows) {
      const val = rule.side === 'debit' ? r.debit : r.credit;
      if (val > 0) {
        byAcc.set(r.accountCode, Math.round(((byAcc.get(r.accountCode) || 0) + val) * 100) / 100);
      }
    }
    if (byAcc.size > 1) {
      const parts = Array.from(byAcc.entries()).map(([acc, sum]) => `${acc}: ${fmtRub(sum)}`);
      return `Сальдо на 31.03 (${parts.join(' + ')}) = ${fmtRub(resolvedOp.resolvedAmount)}`;
    }
    const subParts = matchingRows
      .slice(0, 3)
      .map((r) => `${r.subconto1 || r.accountCode}: ${fmtRub(rule.side === 'debit' ? r.debit : r.credit)}`);
    return `Счет ${matchingRows[0].accountCode} (${subParts.join(', ')}) = ${fmtRub(resolvedOp.resolvedAmount)}`;
  }

  if (matchingRows.length === 1) {
    const r = matchingRows[0];
    return `Сальдо счета ${r.accountCode}${r.subconto1 ? ` (${r.subconto1})` : ''} на 31.03 = ${fmtRub(resolvedOp.resolvedAmount)}`;
  }

  return rule.description || `Подставлено из остатков 1С: ${fmtRub(resolvedOp.resolvedAmount)}`;
}

function deduplicateCounterparties(list: CounterpartyCard1C[]): CounterpartyCard1C[] {
  const map = new Map<string, CounterpartyCard1C>();
  for (const item of list) {
    const normName = item.name.toLowerCase().replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
    const normContract = (item.contractNumber || '').toLowerCase().trim();
    const key = `${normName}|${normContract}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
    } else {
      if (existing.inn.endsWith('000000') && !item.inn.endsWith('000000')) {
        existing.inn = item.inn;
        existing.kpp = item.kpp;
      }
      if (existing.bankAccount.endsWith('000000') && !item.bankAccount.endsWith('000000')) {
        existing.bankAccount = item.bankAccount;
        existing.bankName = item.bankName;
        existing.bik = item.bik;
      }
    }
  }
  return Array.from(map.values());
}

function deduplicateEmployees(list: EmployeeCard1C[]): EmployeeCard1C[] {
  const map = new Map<string, EmployeeCard1C>();
  for (const emp of list) {
    const key = emp.fullName.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!map.has(key)) {
      map.set(key, emp);
    }
  }
  return Array.from(map.values());
}

async function parseBuffersInternal(
  inputs: Array<{ name: string; buffer: ArrayBuffer }>,
  currentOperations: BusinessOperation[],
  currentOrganization: OrganizationCard
): Promise<Parsed1CImportResult> {
  const osvState: Partial1COsvParseOutput = {
    detectedFormats: [],
    generalBalances: [],
    detailedBalances: [],
    detailedAccountRoots: new Set<string>(),
    counterparties: [],
    employees: [],
    warnings: [],
  };

  let mergedOrgPatch: Partial<OrganizationCard> = {};
  const extraBankBalances: OpeningBalanceEntry[] = [];
  const extraXmlBalances: OpeningBalanceEntry[] = [];
  let explicitJsonSnapshot: Synced1CSnapshot | undefined;

  for (const file of inputs) {
    const lowerName = file.name.toLowerCase();
    try {
      if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
        parse1CExcelBuffer(file.buffer, file.name, osvState);
      } else if (lowerName.endsWith('.json')) {
        const jsonText = decode1CTextBuffer(file.buffer).trim();
        const rawJson = JSON.parse(jsonText) as unknown;
        const snap = normalize1CSyncPayload(rawJson, 'file-upload');
        explicitJsonSnapshot = snap;
        osvState.detectedFormats.push(`1С JSON выгрузка (${file.name})`);
        if (snap.organization) {
          mergedOrgPatch = { ...mergedOrgPatch, ...snap.organization };
        }
        extraXmlBalances.push(...snap.openingBalances);
        snap.counterparties.forEach((scp, idx) => {
          const firstContract = scp.contracts[0];
          osvState.counterparties.push({
            id: `imp-json-cp-${idx + 1}`,
            name: scp.name,
            fullName: scp.fullName || scp.name,
            inn: scp.inn || '',
            kpp: scp.kpp || '',
            bankAccount: scp.bankAccount || '',
            bankName: scp.bankName || '',
            bik: scp.bik || '',
            contractKind:
              firstContract?.kind === 'С покупателем' || firstContract?.kind === 'Прочее'
                ? firstContract.kind
                : 'С поставщиком',
            contractNumber: firstContract?.number || '',
            contractDate: firstContract?.date || '2026-04-01',
            createdIn1C: true,
          });
        });
      } else if (lowerName.endsWith('.xml')) {
        const xmlText = decode1CTextBuffer(file.buffer);
        const xmlRes = parse1CXml(xmlText, file.name);
        osvState.detectedFormats.push(xmlRes.detectedFormat);
        if (xmlRes.organizationPatch) {
          mergedOrgPatch = { ...mergedOrgPatch, ...xmlRes.organizationPatch };
        }
        osvState.counterparties.push(...xmlRes.counterparties);
        osvState.employees.push(...xmlRes.employees);
        extraXmlBalances.push(...xmlRes.xmlBalances);
        osvState.warnings.push(...xmlRes.warnings);
      } else if (lowerName.endsWith('.txt')) {
        const txt = decode1CTextBuffer(file.buffer);
        if (/1CClientBankExchange|СекцияРасчСчет|СекцияДокумент/i.test(txt)) {
          const bankRes = parse1CClientBankTxt(txt, file.name);
          osvState.detectedFormats.push(bankRes.detectedFormat);
          if (bankRes.periodLabel && !osvState.periodLabel) {
            osvState.periodLabel = bankRes.periodLabel;
          }
          if (bankRes.organizationPatch) {
            mergedOrgPatch = { ...mergedOrgPatch, ...bankRes.organizationPatch };
          }
          extraBankBalances.push(...bankRes.bankBalances);
          osvState.counterparties.push(...bankRes.counterparties);
          osvState.warnings.push(...bankRes.warnings);
        } else {
          parse1CCsvText(txt, file.name, osvState);
        }
      } else if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
        const csvText = decode1CTextBuffer(file.buffer);
        parse1CCsvText(csvText, file.name, osvState);
      } else {
        osvState.warnings.push(
          `Формат файла «${file.name}» не поддерживается (ожидаются .xlsx, .xls, .csv, .xml, .txt, .json).`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      osvState.warnings.push(`Ошибка чтения файла «${file.name}»: ${msg}`);
    }
  }

  if (osvState.organizationPatch) {
    mergedOrgPatch = { ...osvState.organizationPatch, ...mergedOrgPatch };
  }

  const openingBalances = mergeGeneralAndDetailedBalances(osvState);

  for (const xb of extraXmlBalances) {
    if (!openingBalances.some((b) => b.accountCode === xb.accountCode && b.subconto1 === xb.subconto1)) {
      openingBalances.push(xb);
    }
  }

  for (const bb of extraBankBalances) {
    if (!openingBalances.some((b) => b.accountCode === '51')) {
      openingBalances.push(bb);
    }
  }

  openingBalances.sort((a, b) => a.accountCode.localeCompare(b.accountCode, 'ru'));

  const counterparties = deduplicateCounterparties(osvState.counterparties);
  const employees = deduplicateEmployees(osvState.employees);

  const uniqueAccountCodes = new Set(openingBalances.map((b) => b.accountCode));
  const effectiveOrg: OrganizationCard = {
    ...currentOrganization,
    ...mergedOrgPatch,
  };

  const mainOps = currentOperations.filter((op) => !op.isMonthEndClosing);
  const resolvedWithout1C = resolveOperationsWithSmartLinks(mainOps, [], effectiveOrg);
  const resolvedWith1C = resolveOperationsWithSmartLinks(mainOps, openingBalances, effectiveOrg);

  const autoFilledOperations: Parsed1CAutoFillItem[] = [];
  for (let i = 0; i < mainOps.length; i++) {
    const orig = mainOps[i];
    const withoutBal = resolvedWithout1C[i];
    const withBal = resolvedWith1C[i];

    const wasMissingWithoutBalances =
      (orig.explicitAmount === null || Boolean(orig.smartLink)) &&
      (withoutBal.status === 'needs_data' || withoutBal.resolvedAmount <= 0);

    if (wasMissingWithoutBalances && withBal.status !== 'needs_data' && withBal.resolvedAmount > 0) {
      autoFilledOperations.push({
        operationId: orig.id,
        operationNumber: orig.number,
        description: orig.shortTitle || orig.rawDescription,
        resolvedAmount: withBal.resolvedAmount,
        explanation: buildAutoFillExplanation(orig, withBal, openingBalances),
      });
    }
  }

  if (
    openingBalances.length === 0 &&
    counterparties.length === 0 &&
    Object.keys(mergedOrgPatch).length === 0 &&
    !explicitJsonSnapshot
  ) {
    osvState.warnings.push(
      'В загруженных файлах не найдено ненулевых конечных остатков или карточек контрагентов 1С. Проверьте, что в отчете ОСВ выведена колонка «Сальдо на конец периода».'
    );
  }

  return {
    detectedFormats: Array.from(new Set(osvState.detectedFormats)),
    periodLabel: osvState.periodLabel,
    accountsCount: uniqueAccountCodes.size,
    counterpartiesAndContractsCount: counterparties.length,
    autoFilledOperationsCount: autoFilledOperations.length,
    autoFilledOperations,
    openingBalances,
    organizationPatch: Object.keys(mergedOrgPatch).length > 0 ? mergedOrgPatch : undefined,
    counterparties,
    employees,
    ...(explicitJsonSnapshot ? { synced1CSnapshot: explicitJsonSnapshot } : {}),
    warnings: osvState.warnings,
  };
}

export async function parse1CExportFiles(
  files: File[],
  currentOperations: BusinessOperation[],
  currentOrganization: OrganizationCard
): Promise<Parsed1CImportResult> {
  const inputs: Array<{ name: string; buffer: ArrayBuffer }> = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    inputs.push({ name: f.name, buffer: buf });
  }
  return parseBuffersInternal(inputs, currentOperations, currentOrganization);
}

export async function loadSample1CQ1Preview(
  currentOperations: BusinessOperation[],
  currentOrganization: OrganizationCard
): Promise<Parsed1CImportResult> {
  const { buffer, filename } = generateSample1CQ1Workbook();
  return parseBuffersInternal([{ name: filename, buffer }], currentOperations, currentOrganization);
}

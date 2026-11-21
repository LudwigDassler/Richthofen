import { getAccountInfo } from '@/data/chartOfAccounts';
import {
  AccountingPolicy1C,
  BalanceInterpretationMode,
  BalanceRow1C,
  BankAccount1C,
  Database1CSnapshot,
  DirectoryContract1C,
  DirectoryCounterparty1C,
  DirectoryNomenclature1C,
  DirectorySimpleItem1C,
  DirectoryWarehouse1C,
  DocumentJournalRow1C,
  Organization1C,
  Posting1C,
  TaxSystem1C,
} from '@/types/accounting';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      return String(val);
    }
    if (isRecord(val)) {
      const nested = pickStr(val, [
        'Наименование',
        'Представление',
        'Код',
        'Номер',
        'Name',
        'Presentation',
        'Code',
      ]);
      if (nested) return nested;
    }
  }
  return '';
}

export function parseRussianNumber(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
  }
  if (typeof val !== 'string') return 0;
  const cleaned = val
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/₽|руб\.?|р\.?/gi, '')
    .replace(',', '.')
    .trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      const n = parseRussianNumber(obj[key]);
      if (n !== 0 || String(obj[key]).trim() === '0') {
        return n;
      }
    }
  }
  return 0;
}

function hasAnyKey(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.some(
    (k) => k in obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== ''
  );
}

export function normalizeDateISO(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const s = raw.trim();

  // YYYY-MM-DD or ISO timestamp
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    if (isoMatch[1] === '0001') return '';
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD.MM.YYYY or DD/MM/YYYY
  const ruMatch = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (ruMatch) {
    const d = ruMatch[1].padStart(2, '0');
    const m = ruMatch[2].padStart(2, '0');
    const y = ruMatch[3].length === 2 ? `20${ruMatch[3]}` : ruMatch[3];
    if (y === '0001') return '';
    return `${y}-${m}-${d}`;
  }

  // YYYYMMDD (1C compact format)
  const compactMatch = s.match(/^(\d{4})(\d{2})(\d{2})(?:\d{6})?$/);
  if (compactMatch) {
    if (compactMatch[1] === '0001') return '';
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  return '';
}

export function normalizeAccountCode1C(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^Счет[_\s.:]*/i, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  if (!cleaned) return '';

  // Map Latin lookalikes in 76.АВ / 76.ВА
  if (/^76\.?[AА][BВ]$/i.test(cleaned)) return '76.АВ';
  if (/^76\.?[BВ][AА]$/i.test(cleaned)) return '76.ВА';

  // Normalize leading zeros only when matching standard accounts (keep '01', '02', '08', '000')
  return cleaned;
}

function extractArrayFromCandidate(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) {
    return val.filter(isRecord);
  }
  if (isRecord(val)) {
    for (const k of ['Строки', 'Элементы', 'Данные', 'Список', 'rows', 'items', 'data']) {
      if (Array.isArray(val[k])) {
        return (val[k] as unknown[]).filter(isRecord);
      }
    }
  }
  return [];
}

function detectTaxSystem(raw: string, rawRegisters: Record<string, unknown>): TaxSystem1C {
  const combined = `${raw} ${JSON.stringify(rawRegisters)}`.toLowerCase();
  if (combined.includes('доходы минус расходы') || combined.includes('усн_дмр') || combined.includes('доходыминусрасходы')) {
    return 'УСН (доходы минус расходы)';
  }
  if (combined.includes('упрощен') || /(?:^|[^\p{L}])усн(?=$|[^\p{L}])/iu.test(combined)) {
    // Only if not explicitly OSNO
    if (!combined.includes('общая') && !combined.includes('осно')) {
      return 'УСН (доходы)';
    }
  }
  return 'ОСНО';
}

function extractAccountingPolicy(
  root: Record<string, unknown>,
  orgRecord: Record<string, unknown> | null
): AccountingPolicy1C {
  const rawRegisters: Record<string, unknown> = {};

  for (const key of [
    'РегистрыСведений',
    'УчетнаяПолитика',
    'НастройкиУчета',
    'ПараметрыУчета',
    'InformationRegisters',
    'registers',
  ]) {
    if (isRecord(root[key])) {
      Object.assign(rawRegisters, root[key] as Record<string, unknown>);
    } else if (Array.isArray(root[key])) {
      rawRegisters[key] = root[key];
    }
  }

  const orgTaxHint = orgRecord
    ? pickStr(orgRecord, ['СистемаНалогообложения', 'РежимНалогообложения', 'TaxSystem'])
    : '';
  const policyRecord = isRecord(root['УчетнаяПолитика'])
    ? (root['УчетнаяПолитика'] as Record<string, unknown>)
    : isRecord(rawRegisters['УчетнаяПолитика'])
      ? (rawRegisters['УчетнаяПолитика'] as Record<string, unknown>)
      : null;

  const regTaxHint = policyRecord
    ? pickStr(policyRecord, ['СистемаНалогообложения', 'ПорядокНалогообложения', 'ВидНалогообложения'])
    : '';

  const taxSystem = detectTaxSystem(`${orgTaxHint} ${regTaxHint}`, rawRegisters);

  let vatRate = taxSystem === 'ОСНО' ? 20 : 0;
  if (policyRecord) {
    const explicitVat = pickNum(policyRecord, ['СтавкаНДС', 'ОсновнаяСтавкаНДС', 'vatRate']);
    if (explicitVat > 0) {
      vatRate = explicitVat;
    } else {
      const vatStr = pickStr(policyRecord, ['СтавкаНДС', 'ОсновнаяСтавкаНДС']);
      const m = vatStr.match(/(\d{1,2})/);
      if (m) vatRate = Number(m[1]);
    }
  }

  let directCosting26To9008 = true;
  const regJson = JSON.stringify(rawRegisters).toLowerCase();
  if (
    regJson.includes('"директкостинг":false') ||
    regJson.includes('включатьвстоимостьпродукции') ||
    regJson.includes('на счет 20')
  ) {
    directCosting26To9008 = false;
  }

  const inventoryValuationMethod =
    (policyRecord &&
      pickStr(policyRecord, ['СпособОценкиМПЗ', 'ОценкаМПЗ', 'InventoryValuation'])) ||
    'По средней себестоимости';

  return {
    taxSystem,
    vatRate,
    directCosting26To9008,
    inventoryValuationMethod,
    rawRegisters,
  };
}

function extractRawDirectories(root: Record<string, unknown>): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {};

  const containerCandidates = [
    root['ВсеСправочники'],
    root['Справочники'],
    root['Каталоги'],
    root['directories'],
    root['catalogs'],
  ];

  for (const container of containerCandidates) {
    if (isRecord(container)) {
      for (const [dirName, dirVal] of Object.entries(container)) {
        const rows = extractArrayFromCandidate(dirVal);
        if (rows.length > 0 || Array.isArray(dirVal)) {
          result[dirName] = rows;
        }
      }
    }
  }

  // Also check top-level directory arrays if exported flat
  const topLevelDirKeys: Array<[string, string]> = [
    ['Контрагенты', 'Контрагенты'],
    ['ДоговорыКонтрагентов', 'ДоговорыКонтрагентов'],
    ['Договоры', 'ДоговорыКонтрагентов'],
    ['Номенклатура', 'Номенклатура'],
    ['Склады', 'Склады'],
    ['СтатьиЗатрат', 'СтатьиЗатрат'],
    ['СтатьиДвиженияДенежныхСредств', 'СтатьиДвиженияДенежныхСредств'],
    ['СтатьиДДС', 'СтатьиДвиженияДенежныхСредств'],
    ['Сотрудники', 'Сотрудники'],
    ['ФизическиеЛица', 'ФизическиеЛица'],
    ['БанковскиеСчета', 'БанковскиеСчета'],
    ['БанковскиеСчетаОрганизаций', 'БанковскиеСчетаОрганизаций'],
    ['НоменклатурныеГруппы', 'НоменклатурныеГруппы'],
    ['Подразделения', 'Подразделения'],
    ['ПодразделенияОрганизаций', 'ПодразделенияОрганизаций'],
  ];

  for (const [srcKey, targetKey] of topLevelDirKeys) {
    if (!(targetKey in result) && srcKey in root) {
      const rows = extractArrayFromCandidate(root[srcKey]);
      if (rows.length > 0) {
        result[targetKey] = rows;
      }
    }
  }

  return result;
}

function findDirRows(
  rawDirectories: Record<string, Record<string, unknown>[]>,
  patterns: RegExp[]
): Record<string, unknown>[] {
  const combined: Record<string, unknown>[] = [];
  const usedKeys = new Set<string>();

  for (const pattern of patterns) {
    for (const [key, rows] of Object.entries(rawDirectories)) {
      if (!usedKeys.has(key) && pattern.test(key)) {
        usedKeys.add(key);
        combined.push(...rows);
      }
    }
  }
  return combined;
}

function extractSubcontoList(row: Record<string, unknown>, side: 'Дт' | 'Кт' | 'Debit' | 'Credit'): string[] {
  const list: string[] = [];
  const keys =
    side === 'Дт' || side === 'Debit'
      ? [
          'СубконтоДт',
          'СубконтоДт1',
          'СубконтоДт2',
          'СубконтоДт3',
          'СубконтоДебет',
          'СубконтоДебет1',
          'СубконтоДебет2',
          'СубконтоДебет3',
          'debitSubconto',
          'subcontoDt',
        ]
      : [
          'СубконтоКт',
          'СубконтоКт1',
          'СубконтоКт2',
          'СубконтоКт3',
          'СубконтоКредит',
          'СубконтоКредит1',
          'СубконтоКредит2',
          'СубконтоКредит3',
          'creditSubconto',
          'subcontoKt',
        ];

  for (const k of keys) {
    const val = row[k];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) list.push(item.trim());
        else if (isRecord(item)) {
          const s = pickStr(item, ['Наименование', 'Представление', 'Name']);
          if (s) list.push(s);
        }
      }
    } else if (isRecord(val)) {
      for (const subVal of Object.values(val)) {
        if (typeof subVal === 'string' && subVal.trim()) list.push(subVal.trim());
        else if (isRecord(subVal)) {
          const s = pickStr(subVal, ['Наименование', 'Представление', 'Name']);
          if (s) list.push(s);
        }
      }
    } else if (typeof val === 'string' && val.trim()) {
      list.push(val.trim());
    }
  }
  return Array.from(new Set(list));
}

function detectSmartBalanceMode(
  rawBalances: BalanceRow1C[],
  postings: Posting1C[],
  balanceSectionKey: string,
  balanceDate: string,
  periodStart: string,
  hasPeriodNamedPostingsKey: boolean
): { mode: BalanceInterpretationMode; reason: string } {
  if (rawBalances.length === 0 && postings.length > 0) {
    return {
      mode: 'postings_only',
      reason: 'В выгрузке переданы проводки без таблицы остатков (начальное сальдо = 0)',
    };
  }

  if (rawBalances.length > 0 && postings.length === 0) {
    return {
      mode: 'balances_only',
      reason: 'В выгрузке переданы остатки по счетам без проводок за период',
    };
  }

  if (rawBalances.length === 0 && postings.length === 0) {
    return {
      mode: 'balances_only',
      reason: 'В выгрузке нет строк остатков и проводок',
    };
  }

  const anyExplicitBoth = rawBalances.some((r) => r.hasExplicitStart && r.hasExplicitEnd);
  if (anyExplicitBoth) {
    return {
      mode: 'explicit_start_end',
      reason: 'Из выгрузки 1С приняты явные начальные и конечные остатки (СальдоНач / СальдоКон)',
    };
  }

  const anyExplicitStartOnly = rawBalances.some((r) => r.hasExplicitStart && !r.hasExplicitEnd);
  if (anyExplicitStartOnly || /начальн|opening|start/i.test(balanceSectionKey)) {
    return {
      mode: 'start_balances_forward_end',
      reason: 'Прямой расчёт: в выгрузке переданы начальные остатки → СальдоКон = СальдоНач + ОборотыДт − ОборотыКт',
    };
  }

  const anyExplicitEndOnly = rawBalances.some((r) => !r.hasExplicitStart && r.hasExplicitEnd);
  if (anyExplicitEndOnly || /конечн|ending|current|текущ/i.test(balanceSectionKey)) {
    return {
      mode: 'end_balances_reconstructed_start',
      reason: 'Обратный расчёт: в выгрузке переданы конечные остатки → СальдоНач = СальдоКон − ОборотыДт + ОборотыКт',
    };
  }

  // Check explicit balanceDate if present
  const sortedDates = postings.map((p) => p.date).filter(Boolean).sort();
  const minPostDate = sortedDates[0] || periodStart;
  const maxPostDate = sortedDates[sortedDates.length - 1] || periodStart;

  if (balanceDate && minPostDate) {
    if (balanceDate < minPostDate) {
      return {
        mode: 'start_balances_forward_end',
        reason: `Прямой расчёт: дата остатков (${balanceDate}) предшествует проводкам периода (${minPostDate})`,
      };
    }
    if (balanceDate >= maxPostDate && maxPostDate > minPostDate) {
      return {
        mode: 'end_balances_reconstructed_start',
        reason: `Обратный расчёт: дата остатков (${balanceDate}) соответствует концу выгруженного периода`,
      };
    }
  }

  // Mathematical consistency test between End-anchor vs Start-anchor
  // Build turnover map per account
  const turnMap = new Map<string, { dt: number; kt: number }>();
  for (const p of postings) {
    if (p.debit && p.debit !== '000') {
      const cur = turnMap.get(p.debit) ?? { dt: 0, kt: 0 };
      cur.dt += p.amount;
      turnMap.set(p.debit, cur);
    }
    if (p.credit && p.credit !== '000') {
      const cur = turnMap.get(p.credit) ?? { dt: 0, kt: 0 };
      cur.kt += p.amount;
      turnMap.set(p.credit, cur);
    }
  }

  const rawMap = new Map<string, number>();
  for (const r of rawBalances) {
    rawMap.set(r.account, (rawMap.get(r.account) ?? 0) + (r.rawDebit - r.rawCredit));
  }

  const allAccs = new Set<string>([...rawMap.keys(), ...turnMap.keys()]);
  let redCountIfRawIsEnd = 0;
  let redCountIfRawIsStart = 0;
  let exactMatchTurnoversCount = 0;

  for (const acc of allAccs) {
    const info = getAccountInfo(acc);
    const rawNet = rawMap.get(acc) ?? 0;
    const turn = turnMap.get(acc) ?? { dt: 0, kt: 0 };

    const netTurn = Math.round((turn.dt - turn.kt) * 100) / 100;
    if (Math.abs(rawNet) > 0.01 && Math.abs(rawNet - netTurn) < 0.01) {
      exactMatchTurnoversCount++;
    }

    const startNetIfEnd = Math.round((rawNet - turn.dt + turn.kt) * 100) / 100;
    const endNetIfStart = Math.round((rawNet + turn.dt - turn.kt) * 100) / 100;

    if (info.type === 'active') {
      if (startNetIfEnd < -0.01) redCountIfRawIsEnd++;
      if (endNetIfStart < -0.01) redCountIfRawIsStart++;
    } else if (info.type === 'passive') {
      if (startNetIfEnd > 0.01) redCountIfRawIsEnd++;
      if (endNetIfStart > 0.01) redCountIfRawIsStart++;
    }
  }

  if (redCountIfRawIsEnd < redCountIfRawIsStart) {
    return {
      mode: 'end_balances_reconstructed_start',
      reason:
        'Обратный расчёт: секция Остатки отражает текущее конечное сальдо регистра 1С (СальдоНач = СальдоКон − ОборотыДт + ОборотыКт)',
    };
  }

  if (redCountIfRawIsStart < redCountIfRawIsEnd) {
    return {
      mode: 'start_balances_forward_end',
      reason:
        'Прямой расчёт: секция Остатки отражает входящее сальдо на начало периода (СальдоКон = СальдоНач + ОборотыДт − ОборотыКт)',
    };
  }

  if (exactMatchTurnoversCount > 0 || hasPeriodNamedPostingsKey) {
    return {
      mode: 'end_balances_reconstructed_start',
      reason:
        'Обратный расчёт: секция Остатки 1С интерпретирована как текущие остатки БД с реконструкцией начального сальдо по проводкам периода',
    };
  }

  return {
    mode: 'start_balances_forward_end',
    reason:
      'Прямой расчёт: секция Остатки интерпретирована как начальное сальдо периода (СальдоКон = СальдоНач + ОборотыДт − ОборотыКт)',
  };
}

export function isLikely1CDatabaseExport(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const keys = Object.keys(raw);
  const markers = [
    'Организация',
    'Организации',
    'Остатки',
    'НачальныеОстатки',
    'КонечныеОстатки',
    'ВсеСправочники',
    'Справочники',
    'ВсеДокументы',
    'РегистрыСведений',
    'Проводки',
    'organization',
    'openingBalances',
    'rawBalances',
    'db1C',
  ];
  if (markers.some((m) => keys.includes(m))) return true;
  if (keys.some((k) => /^проводки/i.test(k))) return true;
  return false;
}

export function normalize1CDatabaseExport(
  rawPayload: unknown,
  sourceFileName = '1c_export.json'
): Database1CSnapshot {
  if (!isRecord(rawPayload)) {
    throw new Error('Ожидался JSON-объект выгрузки 1С:Предприятие 8.3.');
  }

  // Support re-importing our own workbench snapshot if uploaded
  if (isRecord(rawPayload.db1C) && rawPayload.version === 2) {
    return rawPayload.db1C as unknown as Database1CSnapshot;
  }

  const root = isRecord(rawPayload.data) && isLikely1CDatabaseExport(rawPayload.data)
    ? (rawPayload.data as Record<string, unknown>)
    : rawPayload;

  // 1. Raw directories
  const rawDirectories = extractRawDirectories(root);

  // Also check if Организации is inside ВсеСправочники
  let orgRecord: Record<string, unknown> | null = null;
  if (isRecord(root['Организация'])) {
    orgRecord = root['Организация'] as Record<string, unknown>;
  } else if (Array.isArray(root['Организация']) && isRecord(root['Организация'][0])) {
    orgRecord = root['Организация'][0] as Record<string, unknown>;
  } else if (Array.isArray(root['Организации']) && isRecord(root['Организации'][0])) {
    orgRecord = root['Организации'][0] as Record<string, unknown>;
  } else if (isRecord(root['organization'])) {
    orgRecord = root['organization'] as Record<string, unknown>;
  } else {
    const orgDir = findDirRows(rawDirectories, [/^организаци/i]);
    if (orgDir.length > 0) {
      orgRecord = orgDir[0];
    }
  }

  // 2. Accounting policy & registers
  const accountingPolicy = extractAccountingPolicy(root, orgRecord);

  // 3. Bank accounts
  const bankAccRows = findDirRows(rawDirectories, [/банковскиесчета/i, /^счетаорганизац/i]);
  const bankAccounts: BankAccount1C[] = bankAccRows.map((row, idx) => ({
    id: `bank-acc-${idx + 1}`,
    code1C: pickStr(row, ['Код', 'Code']),
    name:
      pickStr(row, ['Наименование', 'Представление', 'Name']) ||
      pickStr(row, ['НомерСчета', 'AccountNumber']),
    accountNumber: pickStr(row, ['НомерСчета', 'РасчетныйСчет', 'AccountNumber', 'accountNumber']),
    bik: pickStr(row, ['БИК', 'БИКБанка', 'БанкБИК', 'bik']),
    bankName: pickStr(row, ['Банк', 'НаименованиеБанка', 'БанкНаименование', 'bankName']),
    corrAccount: pickStr(row, ['КоррСчет', 'КорреспондентскийСчет', 'corrAccount']),
    ownerName: pickStr(row, ['Владелец', 'Организация', 'Контрагент', 'Owner']),
  }));

  const orgName = orgRecord
    ? pickStr(orgRecord, [
        'НаименованиеСокращенное',
        'СокращенноеНаименование',
        'Наименование',
        'Представление',
        'name',
      ])
    : '';

  const orgFullName = orgRecord
    ? pickStr(orgRecord, ['НаименованиеПолное', 'ПолноеНаименование', 'fullName']) || orgName
    : '';

  const primaryOrgBank =
    bankAccounts.find((b) => !b.ownerName || (orgName && b.ownerName.includes(orgName))) ||
    bankAccounts[0];

  const organization: Organization1C = {
    name: orgName,
    fullName: orgFullName,
    inn: orgRecord ? pickStr(orgRecord, ['ИНН', 'inn']) : '',
    kpp: orgRecord ? pickStr(orgRecord, ['КПП', 'kpp']) : '',
    ogrn: orgRecord ? pickStr(orgRecord, ['ОГРН', 'ОГРНИП', 'ogrn']) : '',
    taxSystem: accountingPolicy.taxSystem,
    vatRateDefault: accountingPolicy.vatRate,
    bankAccount:
      (orgRecord && pickStr(orgRecord, ['РасчетныйСчет', 'НомерСчета', 'ОсновнойБанковскийСчет', 'bankAccount'])) ||
      primaryOrgBank?.accountNumber ||
      '',
    bankName:
      (orgRecord && pickStr(orgRecord, ['Банк', 'НаименованиеБанка', 'bankName'])) ||
      primaryOrgBank?.bankName ||
      '',
    bik:
      (orgRecord && pickStr(orgRecord, ['БИК', 'БИКБанка', 'bik'])) ||
      primaryOrgBank?.bik ||
      '',
    corrAccount:
      (orgRecord && pickStr(orgRecord, ['КоррСчет', 'КорреспондентскийСчет', 'corrAccount'])) ||
      primaryOrgBank?.corrAccount ||
      '',
    address: orgRecord
      ? pickStr(orgRecord, ['ЮридическийАдрес', 'Адрес', 'ФактическийАдрес', 'address'])
      : '',
    director: orgRecord
      ? pickStr(orgRecord, ['Руководитель', 'ГенеральныйДиректор', 'Директор', 'director'])
      : '',
    chiefAccountant: orgRecord
      ? pickStr(orgRecord, ['ГлавныйБухгалтер', 'Бухгалтер', 'chiefAccountant'])
      : '',
    code1C: orgRecord ? pickStr(orgRecord, ['Код', 'Code']) : undefined,
    guid1C: orgRecord ? pickStr(orgRecord, ['Ссылка', 'УИД', 'Ref_Key', 'GUID']) : undefined,
  };

  // 4. Strongly typed directories from ВсеСправочники
  const cpRows = findDirRows(rawDirectories, [/^контрагент/i, /^counterpart/i]);
  const counterparties: DirectoryCounterparty1C[] = cpRows
    .map((row, idx) => {
      const name = pickStr(row, ['Наименование', 'НаименованиеСокращенное', 'Представление', 'name']);
      if (!name) return null;
      return {
        id: `cp-1c-${idx + 1}`,
        code1C: pickStr(row, ['Код', 'Code']),
        guid1C: pickStr(row, ['Ссылка', 'УИД', 'Ref_Key', 'GUID']),
        name,
        fullName: pickStr(row, ['НаименованиеПолное', 'ПолноеНаименование', 'fullName']) || name,
        inn: pickStr(row, ['ИНН', 'inn']),
        kpp: pickStr(row, ['КПП', 'kpp']),
        kind: pickStr(row, ['ЮридическоеФизическоеЛицо', 'ВидКонтрагента', 'kind']),
        defaultContract: pickStr(row, ['ОсновнойДоговорКонтрагента', 'ОсновнойДоговор', 'Договор']),
        bankAccount: pickStr(row, ['НомерСчета', 'РасчетныйСчет', 'ОсновнойБанковскийСчет']),
        bik: pickStr(row, ['БИК']),
        bankName: pickStr(row, ['Банк', 'НаименованиеБанка']),
        isNewFor1C: false,
      } as DirectoryCounterparty1C;
    })
    .filter((x): x is DirectoryCounterparty1C => x !== null);

  const contractRows = findDirRows(rawDirectories, [/^договор/i, /^contract/i]);
  const contracts: DirectoryContract1C[] = contractRows
    .map((row, idx) => {
      const name = pickStr(row, ['Наименование', 'Представление', 'name']);
      const number = pickStr(row, ['Номер', 'НомерДоговора', 'number']);
      if (!name && !number) return null;
      return {
        id: `ctr-1c-${idx + 1}`,
        code1C: pickStr(row, ['Код', 'Code']),
        guid1C: pickStr(row, ['Ссылка', 'УИД', 'Ref_Key']),
        name: name || `Договор № ${number}`,
        number,
        date: normalizeDateISO(pickStr(row, ['Дата', 'ДатаДоговора', 'date'])),
        counterpartyName: pickStr(row, ['Владелец', 'Контрагент', 'Owner', 'counterpartyName']),
        counterpartyInn: pickStr(row, ['ИННКонтрагента', 'ИННВладельца', 'counterpartyInn']),
        contractKind: pickStr(row, ['ВидДоговора', 'ТипДоговора', 'contractKind']) || 'СПоставщиком',
        currency: pickStr(row, ['ВалютаВзаиморасчетов', 'Валюта', 'currency']) || 'RUB',
        isNewFor1C: false,
      } as DirectoryContract1C;
    })
    .filter((x): x is DirectoryContract1C => x !== null);

  const nomRows = findDirRows(rawDirectories, [/^номенклатур(?!ныегрупп)/i, /^nomenclature$/i]);
  const nomenclature: DirectoryNomenclature1C[] = nomRows
    .map((row, idx) => {
      const name = pickStr(row, ['Наименование', 'Представление', 'name']);
      if (!name) return null;
      const isServiceBool = row['Услуга'] === true || String(row['Услуга']).toLowerCase() === 'да';
      const rawKind = pickStr(row, ['ВидНоменклатуры', 'ТипНоменклатуры', 'itemKind']);
      const itemKind = isServiceBool
        ? 'Услуга'
        : rawKind || 'Товар';
      return {
        id: `nom-1c-${idx + 1}`,
        code1C: pickStr(row, ['Код', 'Code']),
        guid1C: pickStr(row, ['Ссылка', 'УИД', 'Ref_Key']),
        name,
        fullName: pickStr(row, ['НаименованиеПолное', 'ПолноеНаименование']) || name,
        article: pickStr(row, ['Артикул', 'article']),
        unit: pickStr(row, ['ЕдиницаИзмерения', 'БазоваяЕдиницаИзмерения', 'ЕдИзм', 'unit']) || 'шт',
        itemKind,
        vatRate: pickStr(row, ['СтавкаНДС', 'НДС', 'vatRate']) || `${accountingPolicy.vatRate}%`,
        defaultAccount: normalizeAccountCode1C(
          pickStr(row, ['СчетУчета', 'СчетУчетаНоменклатуры', 'defaultAccount'])
        ),
        nomenclatureGroup: pickStr(row, ['НоменклатурнаяГруппа', 'Группа']),
        isNewFor1C: false,
      } as DirectoryNomenclature1C;
    })
    .filter((x): x is DirectoryNomenclature1C => x !== null);

  const whRows = findDirRows(rawDirectories, [/^склад/i, /^местахранен/i, /^warehous/i]);
  const warehouses: DirectoryWarehouse1C[] = whRows
    .map((row, idx): DirectoryWarehouse1C | null => {
      const name = pickStr(row, ['Наименование', 'Представление', 'name']);
      if (!name) return null;
      return {
        id: `wh-1c-${idx + 1}`,
        code1C: pickStr(row, ['Код', 'Code']),
        name,
        warehouseType: pickStr(row, ['ТипСклада', 'ВидСклада']) || 'Оптовый склад',
        isNewFor1C: false,
      };
    })
    .filter((x): x is DirectoryWarehouse1C => x !== null);

  const mapSimpleDir = (patterns: RegExp[], prefix: string): DirectorySimpleItem1C[] =>
    findDirRows(rawDirectories, patterns)
      .map((row, idx): DirectorySimpleItem1C | null => {
        const name = pickStr(row, ['Наименование', 'ФИО', 'Представление', 'name']);
        if (!name) return null;
        const inn = pickStr(row, ['ИНН', 'inn']).replace(/\D/g, '');
        const fullName = pickStr(row, ['НаименованиеПолное', 'ПолноеИмя', 'ФИОПолное', 'fullName']);
        const salaryNum = pickNum(row, ['Оклад', 'РазмерОклада', 'ТарифнаяСтавка', 'ФОТ', 'salary', 'fot']);
        const positionStr = pickStr(row, ['Должность', 'position']);
        const subdivisionStr = pickStr(row, ['Подразделение', 'ПодразделениеОрганизации', 'subdivision']);
        const hireDateStr = normalizeDateISO(pickStr(row, ['ДатаПриема', 'ДатаПриёма', 'hireDate']));
        const extraObj: Record<string, string> = {};
        if (inn) {
          extraObj.inn = inn;
          extraObj['ИНН'] = inn;
        }
        if (fullName) extraObj.fullName = fullName;
        if (salaryNum > 0) {
          extraObj.salary = String(salaryNum);
          extraObj['Оклад'] = String(salaryNum);
        }
        if (positionStr) {
          extraObj.position = positionStr;
          extraObj['Должность'] = positionStr;
        }
        if (subdivisionStr) extraObj['Подразделение'] = subdivisionStr;
        if (hireDateStr) extraObj['ДатаПриема'] = hireDateStr;
        return {
          id: `${prefix}-${idx + 1}`,
          code1C: pickStr(row, ['Код', 'ТабельныйНомер', 'Code']),
          name,
          kind: pickStr(row, ['ВидРасхода', 'ВидДвижения', 'ВидСтатьи', 'Должность', 'ИНН']),
          extra: Object.keys(extraObj).length > 0 ? extraObj : undefined,
        };
      })
      .filter((x): x is DirectorySimpleItem1C => x !== null);

  const expenseItems = mapSimpleDir([/^статьизатрат/i, /^expenseitem/i], 'exp');
  const cashFlowItems = mapSimpleDir([/^статьидвиженияденежныхсредств/i, /^статьиддс/i, /^cashflow/i], 'dds');
  const employees = mapSimpleDir([/^сотрудник/i, /^работники/i, /^employee/i], 'emp');
  const individuals = mapSimpleDir([/^физическиелица/i, /^физлица/i, /^individual/i], 'ind');
  const nomenclatureGroups = mapSimpleDir([/^номенклатурныегруппы/i], 'ng');
  const subdivisions = mapSimpleDir([/^подразделени/i], 'sub');

  // 5. Postings (ПроводкиС_Апреля, Проводки, etc.)
  let hasPeriodNamedPostingsKey = false;
  const rawPostingRows: Record<string, unknown>[] = [];
  for (const [key, val] of Object.entries(root)) {
    if (/^(проводки|движения|журналпроводок|postings)/i.test(key)) {
      if (/проводкис_|проводкиза/i.test(key)) {
        hasPeriodNamedPostingsKey = true;
      }
      rawPostingRows.push(...extractArrayFromCandidate(val));
    }
  }

  const seenPostingSignatures = new Set<string>();
  const postings: Posting1C[] = [];

  rawPostingRows.forEach((row, idx) => {
    const debit = normalizeAccountCode1C(
      pickStr(row, ['СчетДт', 'Дебет', 'СчетДебета', 'AccountDt', 'debit'])
    );
    const credit = normalizeAccountCode1C(
      pickStr(row, ['СчетКт', 'Кредит', 'СчетКредита', 'AccountKt', 'credit'])
    );
    const amount = pickNum(row, ['Сумма', 'СуммаПроводки', 'Оборот', 'Amount', 'amount']);
    if ((!debit && !credit) || Math.abs(amount) < 0.005) return;

    const date = normalizeDateISO(pickStr(row, ['Период', 'Дата', 'ДатаДокумента', 'Date', 'date']));
    const docLabel = pickStr(row, ['Регистратор', 'Документ', 'Основание', 'Recorder', 'documentLabel']);
    const docType =
      pickStr(row, ['ВидДокумента', 'ТипРегистратора', 'ТипДокумента', 'documentType']) ||
      (docLabel.includes(' ') ? docLabel.split(' ')[0] : 'Документ 1С');
    const docNumber = pickStr(row, ['НомерДокумента', 'Номер', 'documentNumber']);
    const description =
      pickStr(row, ['Содержание', 'НазначениеПлатежа', 'Комментарий', 'СодержаниеПроводки', 'description']) ||
      docLabel ||
      'Проводка регистра бухгалтерии 1С';

    const debitSubconto = extractSubcontoList(row, 'Дт');
    const creditSubconto = extractSubcontoList(row, 'Кт');

    const sig = `${date}|${debit}|${credit}|${amount.toFixed(2)}|${docLabel}|${docNumber}|${description}|${debitSubconto.join('/')}|${creditSubconto.join('/')}`;
    if (seenPostingSignatures.has(sig)) return;
    seenPostingSignatures.add(sig);

    postings.push({
      id: `p1c-${idx + 1}`,
      date,
      debit: debit || '000',
      credit: credit || '000',
      amount,
      debitSubconto,
      creditSubconto,
      documentType: docType,
      documentNumber: docNumber,
      documentLabel: docLabel,
      description,
      counterpartyName:
        pickStr(row, ['Контрагент', 'counterpartyName']) ||
        debitSubconto[0] ||
        creditSubconto[0] ||
        undefined,
      contractName: pickStr(row, ['Договор', 'contractName']) || undefined,
      quantityDebit: pickNum(row, ['КоличествоДт', 'КоличествоДебет']),
      quantityCredit: pickNum(row, ['КоличествоКт', 'КоличествоКредит']),
    });
  });

  // 6. All Documents (ВсеДокументы — grouped object or flat array)
  const documents: DocumentJournalRow1C[] = [];
  const docContainerCandidates = [
    root['ВсеДокументы'],
    root['Документы'],
    root['ЖурналДокументов'],
    root['documents'],
  ];

  const pushDocRecord = (docKindHint: string, row: Record<string, unknown>, idx: number) => {
    const docKind =
      pickStr(row, ['ВидДокумента', 'ТипДокумента', 'Метаданные', 'documentKind']) ||
      docKindHint ||
      'Документ';
    const number = pickStr(row, ['Номер', 'НомерДокумента', 'number']);
    const date = normalizeDateISO(pickStr(row, ['Дата', 'ДатаДокумента', 'Период', 'date']));
    const postedRaw = row['Проведен'] ?? row['Проведён'] ?? row['posted'];
    const deletionMark = row['ПометкаУдаления'] === true || String(row['ПометкаУдаления']).toLowerCase() === 'да';
    const posted =
      deletionMark
        ? false
        : postedRaw === undefined
          ? true
          : postedRaw === true ||
            String(postedRaw).toLowerCase() === 'да' ||
            String(postedRaw).toLowerCase() === 'true' ||
            postedRaw === 1;

    const amount = pickNum(row, [
      'СуммаДокумента',
      'Сумма',
      'Итого',
      'СуммаВзаиморасчетов',
      'СуммаПлатежа',
      'amount',
    ]);
    const vatAmount = pickNum(row, ['СуммаНДС', 'НДС', 'vatAmount']);
    const counterparty = pickStr(row, [
      'Контрагент',
      'Плательщик',
      'Получатель',
      'Поставщик',
      'Покупатель',
      'counterparty',
    ]);

    documents.push({
      id: `doc-1c-${documents.length + 1}-${idx}`,
      documentKind: docKind,
      number,
      date,
      posted,
      amount,
      vatAmount: vatAmount || undefined,
      counterparty,
      counterpartyInn: pickStr(row, ['ИННКонтрагента', 'ИНН', 'counterpartyInn']) || undefined,
      contract: pickStr(row, ['ДоговорКонтрагента', 'Договор', 'contract']),
      warehouse: pickStr(row, ['Склад', 'МестоХранения', 'warehouse']) || undefined,
      operationKind: pickStr(row, ['ВидОперации', 'ХозяйственнаяОперация', 'operationKind']) || undefined,
      comment: pickStr(row, [
        'НазначениеПлатежа',
        'Комментарий',
        'Содержание',
        'Основание',
        'comment',
      ]),
      rawFields: row,
    });
  };

  for (const container of docContainerCandidates) {
    if (!container) continue;
    if (Array.isArray(container)) {
      container.filter(isRecord).forEach((row, i) => pushDocRecord('Документ', row, i));
      break;
    } else if (isRecord(container)) {
      for (const [docKindKey, listVal] of Object.entries(container)) {
        const rows = extractArrayFromCandidate(listVal);
        rows.forEach((row, i) => pushDocRecord(docKindKey, row, i));
      }
      break;
    }
  }

  // 7. Balances (Остатки / НачальныеОстатки / КонечныеОстатки / ОСВ)
  let balanceSectionKey = '';
  let rawBalanceItems: Record<string, unknown>[] = [];
  for (const key of [
    'Остатки',
    'ОСВ',
    'ОстаткиПоСчетам',
    'НачальныеОстатки',
    'КонечныеОстатки',
    'rawBalances',
    'openingBalances',
    'balances',
  ]) {
    if (key in root) {
      const arr = extractArrayFromCandidate(root[key]);
      if (arr.length > 0) {
        balanceSectionKey = key;
        rawBalanceItems = arr;
        break;
      }
    }
  }

  const startDebitKeys = ['СальдоНачДт', 'СальдоНачальноеДт', 'СальдоНачальноеДебет', 'СальдоНачДебет', 'ОстатокНачДт', 'ОстатокНачальныйДебет', 'НачальныйОстатокДт', 'startDebit'];
  const startCreditKeys = ['СальдоНачКт', 'СальдоНачальноеКт', 'СальдоНачальноеКредит', 'СальдоНачКредит', 'ОстатокНачКт', 'ОстатокНачальныйКредит', 'НачальныйОстатокКт', 'startCredit'];
  const turnDebitKeys = ['ОборотДт', 'ОборотыДт', 'ОборотДебет', 'ОборотыДебет', 'СуммаОборотДт', 'turnoverDebit'];
  const turnCreditKeys = ['ОборотКт', 'ОборотыКт', 'ОборотКредит', 'ОборотыКредит', 'СуммаОборотКт', 'turnoverCredit'];
  const endDebitKeys = ['СальдоКонДт', 'СальдоКонечноеДт', 'СальдоКонечноеДебет', 'СальдоКонДебет', 'ОстатокКонДт', 'КонечныйОстатокДт', 'endDebit'];
  const endCreditKeys = ['СальдоКонКт', 'СальдоКонечноеКт', 'СальдоКонечноеКредит', 'СальдоКонКредит', 'ОстатокКонКт', 'КонечныйОстатокКт', 'endCredit'];
  const genericDebitKeys = ['СуммаОстатокДт', 'СуммаОстатокДебет', 'ОстатокДт', 'ОстатокДебет', 'Дебет', 'СальдоДт', 'СальдоДебет', 'СуммаДт', 'rawDebit', 'debit'];
  const genericCreditKeys = ['СуммаОстатокКт', 'СуммаОстатокКредит', 'ОстатокКт', 'ОстатокКредит', 'Кредит', 'СальдоКт', 'СальдоКредит', 'СуммаКт', 'rawCredit', 'credit'];

  const rawBalances: BalanceRow1C[] = [];
  rawBalanceItems.forEach((row, idx) => {
    const account = normalizeAccountCode1C(
      pickStr(row, ['Счет', 'КодСчета', 'СчетУчета', 'Account', 'account', 'code'])
    );
    if (!account || account === '000' || /^итого/i.test(account)) return;

    // Skip synthetic group rows if subaccount rows exist in the same table — checked below after collecting
    const hasExplicitStart = hasAnyKey(row, [...startDebitKeys, ...startCreditKeys]);
    const hasExplicitEnd = hasAnyKey(row, [...endDebitKeys, ...endCreditKeys]);

    const startDebit = pickNum(row, startDebitKeys);
    const startCredit = pickNum(row, startCreditKeys);
    const turnoverDebit = pickNum(row, turnDebitKeys);
    const turnoverCredit = pickNum(row, turnCreditKeys);
    const endDebit = pickNum(row, endDebitKeys);
    const endCredit = pickNum(row, endCreditKeys);

    let rawDebit = pickNum(row, genericDebitKeys);
    let rawCredit = pickNum(row, genericCreditKeys);

    // Handle single-column "СуммаОстаток" + "ВидОстатка" if exported that way
    if (rawDebit === 0 && rawCredit === 0 && !hasExplicitStart && !hasExplicitEnd) {
      const singleSum = pickNum(row, ['СуммаОстаток', 'Сумма', 'Остаток']);
      if (singleSum !== 0) {
        const info = getAccountInfo(account);
        if (info.type === 'passive') {
          rawCredit = singleSum;
        } else if (singleSum > 0) {
          rawDebit = singleSum;
        } else {
          rawCredit = Math.abs(singleSum);
        }
      }
    }

    if (hasExplicitStart && !hasExplicitEnd && rawDebit === 0 && rawCredit === 0) {
      rawDebit = startDebit;
      rawCredit = startCredit;
    } else if (hasExplicitEnd && !hasExplicitStart && rawDebit === 0 && rawCredit === 0) {
      rawDebit = endDebit;
      rawCredit = endCredit;
    }

    const allZero =
      Math.abs(startDebit) < 0.005 &&
      Math.abs(startCredit) < 0.005 &&
      Math.abs(turnoverDebit) < 0.005 &&
      Math.abs(turnoverCredit) < 0.005 &&
      Math.abs(endDebit) < 0.005 &&
      Math.abs(endCredit) < 0.005 &&
      Math.abs(rawDebit) < 0.005 &&
      Math.abs(rawCredit) < 0.005;

    if (allZero) return;

    rawBalances.push({
      id: `bal-1c-${idx + 1}`,
      account,
      accountName: pickStr(row, ['НаименованиеСчета', 'ПредставлениеСчета', 'accountName']) || undefined,
      subconto: pickStr(row, ['Субконто', 'Субконто1', 'Контрагент', 'Номенклатура', 'subconto']) || undefined,
      startDebit,
      startCredit,
      turnoverDebit,
      turnoverCredit,
      endDebit,
      endCredit,
      rawDebit,
      rawCredit,
      hasExplicitStart,
      hasExplicitEnd,
      quantity: pickNum(row, ['Количество', 'КоличествоОстаток', 'quantity']) || undefined,
    });
  });

  // Deduplicate group summary rows if child subaccounts are also present in rawBalances
  const accountCodesPresent = new Set(rawBalances.map((b) => b.account));
  const filteredBalances = rawBalances.filter((b) => {
    const hasChildSubaccount = Array.from(accountCodesPresent).some(
      (other) => other !== b.account && other.startsWith(`${b.account}.`)
    );
    return !hasChildSubaccount;
  });

  // 8. Period dates
  const allDates = [
    ...postings.map((p) => p.date),
    ...documents.map((d) => d.date),
  ]
    .filter(Boolean)
    .sort();

  const explicitPeriodStart = normalizeDateISO(
    pickStr(root, ['НачалоПериода', 'ДатаНачала', 'ПериодС', 'periodStart'])
  );
  const explicitPeriodEnd = normalizeDateISO(
    pickStr(root, ['КонецПериода', 'ДатаОкончания', 'ПериодПо', 'periodEnd'])
  );
  const balanceDate = normalizeDateISO(
    pickStr(root, ['ДатаОстатков', 'ОстаткиНаДату', 'НаДату', 'ДатаАктуальности', 'balanceDate'])
  );

  let periodStart = explicitPeriodStart;
  let periodEnd = explicitPeriodEnd;

  if (!periodStart && allDates.length > 0) {
    // Snap to 1st day of earliest posting month
    const earliest = allDates[0];
    periodStart = `${earliest.slice(0, 7)}-01`;
  }
  if (!periodEnd && allDates.length > 0) {
    const latest = allDates[allDates.length - 1];
    const [yStr, mStr] = latest.split('-');
    const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
    periodEnd = `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  if (!periodStart) periodStart = `${todayIso.slice(0, 7)}-01`;
  if (!periodEnd) periodEnd = todayIso;

  const { mode: detectedBalanceMode, reason: balanceModeReason } = detectSmartBalanceMode(
    filteredBalances,
    postings,
    balanceSectionKey,
    balanceDate,
    periodStart,
    hasPeriodNamedPostingsKey
  );

  const exportedAt =
    normalizeDateISO(pickStr(root, ['ДатаВыгрузки', 'Выгружено', 'exportedAt'])) ||
    pickStr(root, ['ДатаВыгрузки', 'exportedAt']) ||
    new Date().toISOString();

  const configurationName =
    pickStr(root, ['Конфигурация', 'ИмяКонфигурации', 'ВерсияКонфигурации', 'configurationName']) ||
    'БухгалтерияПредприятия 3.0';

  return {
    loadedAt: new Date().toISOString(),
    exportedAt,
    sourceFileName,
    configurationName,
    periodStart,
    periodEnd,
    balanceDate: balanceDate || undefined,
    organization,
    accountingPolicy,
    rawBalances: filteredBalances,
    detectedBalanceMode,
    balanceModeReason,
    postings,
    documents,
    counterparties,
    contracts,
    nomenclature,
    warehouses,
    expenseItems,
    cashFlowItems,
    employees,
    individuals,
    nomenclatureGroups,
    subdivisions,
    bankAccounts,
    rawDirectories,
    rawRegisters: accountingPolicy.rawRegisters,
  };
}

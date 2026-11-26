import {
  BalanceRow1C,
  Database1CSnapshot,
  DEFAULT_REPORTING_YEAR,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_CORR,
  DEFAULT_SBERBANK_NAME,
} from '@/types/accounting';
import {
  normalize1CDatabaseExport,
  normalizeAccountCode1C,
  normalizeDateISO,
  parseRussianNumber,
} from './json1CSyncNormalizer';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
    if (isRecord(val)) {
      const nested = pickString(val, ['Наименование', 'Представление', 'НомерСчета', 'Код', 'name']);
      if (nested) return nested;
    }
  }
  return '';
}

export interface Base0SummaryStats {
  organizationName: string;
  inn: string;
  kpp: string;
  bik: string;
  accountNumber: string;
  totalCatalogItems: number;
  openingBalanceLinesCount: number;
  usesLegacyPayrollAccounts?: boolean;
  payrollAccounts69?: string[];
}

export function isBase0JsonPayload(raw: unknown, fileName = ''): boolean {
  if (/base0/i.test(fileName)) return true;
  if (!isRecord(raw)) return false;
  if (raw['ФорматБазы0'] || raw['НачальныеОстатки'] || raw['openingBalances']) {
    return true;
  }
  if ((raw['organization'] || raw['Организация']) && raw['catalogs'] && !raw['Проводки']) {
    return true;
  }
  return false;
}

/**
 * Parses `base0_1c.json` exported from real 1C:Бухгалтерия 8.3 (ред. 3.0) by
 * `ВыгрузитьБазу0НаСервере` (or a canonical camelCase / Russian 1C Base 0 JSON)
 * into a ready-to-connect `Database1CSnapshot` with explicit start-of-year opening balances.
 */
export function parseBase0Json(
  rawInput: string | Record<string, unknown>,
  sourceFileName = 'base0_1c.json',
  reportingYear = DEFAULT_REPORTING_YEAR
): Database1CSnapshot {
  let payload: Record<string, unknown>;
  if (typeof rawInput === 'string') {
    const clean = rawInput.replace(/^\uFEFF/, '').trim();
    if (!clean) {
      throw new Error('Файл Базы 0 пуст.');
    }
    const parsed = JSON.parse(clean);
    if (!isRecord(parsed)) {
      throw new Error('Ожидался JSON-объект Базы 0 (base0_1c.json).');
    }
    payload = parsed;
  } else if (isRecord(rawInput)) {
    payload = rawInput;
  } else {
    throw new Error('Некорректный формат файла Базы 0.');
  }

  // Normalize camelCase Base 0 format (if exported with catalogs/openingBalances) into unified keys
  // alongside Russian 1C keys (`Организация`, `ВсеСправочники`, `НачальныеОстатки`)
  const normalizedRoot: Record<string, unknown> = { ...payload };

  const orgSrc = isRecord(payload['Организация'])
    ? (payload['Организация'] as Record<string, unknown>)
    : isRecord(payload['organization'])
      ? (payload['organization'] as Record<string, unknown>)
      : null;

  if (orgSrc) {
    const bankNested = isRecord(orgSrc['ОсновнойБанковскийСчет'])
      ? (orgSrc['ОсновнойБанковскийСчет'] as Record<string, unknown>)
      : null;
    const bik =
      pickString(orgSrc, ['БИК', 'bik']) ||
      (bankNested ? pickString(bankNested, ['БИК', 'bik']) : '') ||
      DEFAULT_SBERBANK_BIK;
    const bankName =
      pickString(orgSrc, ['Банк', 'БанкНаименование', 'НаименованиеБанка', 'bankName']) ||
      (bankNested ? pickString(bankNested, ['Банк', 'БанкНаименование', 'НаименованиеБанка', 'bankName']) : '') ||
      DEFAULT_SBERBANK_NAME;
    const accountNumber =
      pickString(orgSrc, ['НомерСчета', 'РасчетныйСчет', 'accountNumber', 'bankAccount']) ||
      (bankNested ? pickString(bankNested, ['НомерСчета', 'РасчетныйСчет', 'accountNumber']) : '');
    const corrAccount =
      pickString(orgSrc, ['КоррСчет', 'corrAccount']) ||
      (bankNested ? pickString(bankNested, ['КоррСчет', 'corrAccount']) : '') ||
      DEFAULT_SBERBANK_CORR;

    const chiefAccountant = pickString(orgSrc, [
      'ГлавныйБухгалтер',
      'chiefAccountant',
      'Бухгалтер',
      'ФИОГлавногоБухгалтера',
    ]);

    normalizedRoot['Организация'] = {
      ...orgSrc,
      Наименование: pickString(orgSrc, ['Наименование', 'name', 'ПолноеНаименование', 'fullName']),
      ПолноеНаименование: pickString(orgSrc, ['ПолноеНаименование', 'fullName', 'Наименование', 'name']),
      ИНН: pickString(orgSrc, ['ИНН', 'inn']),
      КПП: pickString(orgSrc, ['КПП', 'kpp']),
      БИК: bik,
      Банк: bankName,
      РасчетныйСчет: accountNumber,
      КоррСчет: corrAccount,
      ...(chiefAccountant ? { ГлавныйБухгалтер: chiefAccountant } : {}),
    };

    if (accountNumber && !normalizedRoot['БанковскиеСчетаОрганизаций']) {
      normalizedRoot['БанковскиеСчетаОрганизаций'] = [
        {
          Наименование: 'Основной банковский счет',
          НомерСчета: accountNumber,
          БИК: bik,
          Банк: bankName,
          КоррСчет: corrAccount,
        },
      ];
    }
  }

  // Merge `catalogs` / `Справочники` / `ВсеСправочники`
  const mergedDirs: Record<string, unknown> = {};
  for (const dirKey of ['ВсеСправочники', 'Справочники', 'catalogs', 'directories']) {
    if (isRecord(payload[dirKey])) {
      Object.assign(mergedDirs, payload[dirKey] as Record<string, unknown>);
    }
  }
  const aliasPairs: Array<[string, string]> = [
    ['counterparties', 'Контрагенты'],
    ['contracts', 'ДоговорыКонтрагентов'],
    ['warehouses', 'Склады'],
    ['subdivisions', 'Подразделения'],
    ['nomenclature', 'Номенклатура'],
    ['nomenclatureGroups', 'НоменклатурныеГруппы'],
    ['employees', 'Сотрудники'],
    ['individuals', 'ФизическиеЛица'],
    ['fixedAssets', 'ОсновныеСредства'],
    ['deferredExpenses', 'РасходыБудущихПериодов'],
    ['ОсновныеСредства', 'ОсновныеСредства'],
    ['РасходыБудущихПериодов', 'РасходыБудущихПериодов'],
  ];
  for (const [src, dst] of aliasPairs) {
    const candidate = mergedDirs[src] ?? payload[src];
    if (Array.isArray(candidate) && (!mergedDirs[dst] || src === dst)) {
      mergedDirs[dst] = candidate.map((item) => {
        if (typeof item === 'string') {
          return { Наименование: item };
        }
        if (isRecord(item)) {
          const mapped: Record<string, unknown> = { ...item };
          const nm = pickString(item, ['Наименование', 'ФИО', 'name', 'fullName']);
          if (nm && !mapped['Наименование']) mapped['Наименование'] = nm;
          if ((dst === 'Сотрудники' || dst === 'ФизическиеЛица') && nm && !mapped['ФИО']) {
            mapped['ФИО'] = nm;
          }
          const pos = pickString(item, ['Должность', 'position']);
          if (pos && !mapped['Должность']) mapped['Должность'] = pos;
          if (item['salary'] !== undefined && mapped['Оклад'] === undefined) {
            mapped['Оклад'] = item['salary'];
          }
          const cpName = pickString(item, ['Контрагент', 'Владелец', 'counterpartyName']);
          if (cpName && !mapped['Контрагент']) mapped['Контрагент'] = cpName;
          if (
            item['usefulLifeMonths'] !== undefined &&
            mapped['СрокПолезногоИспользования'] === undefined
          ) {
            mapped['СрокПолезногоИспользования'] = item['usefulLifeMonths'];
          }
          if (dst === 'РасходыБудущихПериодов') {
            const rpbStart = normalizeDateISO(
              pickString(item, [
                'ДатаНачалаСписания',
                'ДатаНачала',
                'НачалоСписания',
                'startDate',
              ])
            );
            const rpbEnd = normalizeDateISO(
              pickString(item, [
                'ДатаОкончанияСписания',
                'ДатаОкончания',
                'ОкончаниеСписания',
                'endDate',
              ])
            );
            const rpbSum = parseRussianNumber(
              item['Сумма'] ?? item['ПервоначальнаяСумма'] ?? item['totalAmount'] ?? item['amount'] ?? 0
            );
            const rpbMethod = pickString(item, [
              'СпособСписания',
              'ПорядокСписания',
              'СпособПризнанияРасходов',
              'writeOffMethod',
            ]);
            if (rpbStart) mapped['ДатаНачалаСписания'] = rpbStart;
            if (rpbEnd) mapped['ДатаОкончанияСписания'] = rpbEnd;
            if (rpbSum > 0 && !mapped['Сумма']) mapped['Сумма'] = rpbSum;
            if (rpbMethod && !mapped['СпособСписания']) mapped['СпособСписания'] = rpbMethod;
          }
          return mapped;
        }
        return item;
      });
    }
  }
  if (Object.keys(mergedDirs).length > 0) {
    normalizedRoot['ВсеСправочники'] = mergedDirs;
  }

  // Normalize `НачальныеОстатки` / `openingBalances` / `Остатки`
  const rawOpeningCandidate =
    payload['НачальныеОстатки'] ??
    payload['openingBalances'] ??
    payload['ОстаткиНаНачалоГода'] ??
    payload['Остатки'];

  const explicitOpeningRows: BalanceRow1C[] = [];
  if (Array.isArray(rawOpeningCandidate)) {
    rawOpeningCandidate.forEach((item, idx) => {
      if (!isRecord(item)) return;
      const account = normalizeAccountCode1C(
        pickString(item, ['Счет', 'КодСчета', 'account', 'code'])
      );
      if (!account || account === '000') return;
      const dt = parseRussianNumber(
        item['СальдоНачДт'] ??
          item['СуммаОстатокДт'] ??
          item['ОстатокДт'] ??
          item['Дебет'] ??
          item['startDebit'] ??
          item['debit'] ??
          0
      );
      const kt = parseRussianNumber(
        item['СальдоНачКт'] ??
          item['СуммаОстатокКт'] ??
          item['ОстатокКт'] ??
          item['Кредит'] ??
          item['startCredit'] ??
          item['credit'] ??
          0
      );
      const qty = parseRussianNumber(
        item['КоличествоОстаток'] ?? item['Количество'] ?? item['quantity'] ?? 0
      );
      if (Math.abs(dt) < 0.005 && Math.abs(kt) < 0.005 && Math.abs(qty) < 0.005) return;

      const subconto = pickString(item, [
        'Субконто1',
        'Субконто',
        'Контрагент',
        'Номенклатура',
        'ОсновноеСредство',
        'subconto',
      ]);

      explicitOpeningRows.push({
        id: `base0-bal-${idx + 1}`,
        account,
        accountName: pickString(item, ['НаименованиеСчета', 'accountName']) || undefined,
        subconto: subconto || undefined,
        startDebit: dt,
        startCredit: kt,
        turnoverDebit: 0,
        turnoverCredit: 0,
        endDebit: 0,
        endCredit: 0,
        rawDebit: dt,
        rawCredit: kt,
        hasExplicitStart: true,
        hasExplicitEnd: false,
        quantity: qty > 0 ? qty : undefined,
      });
    });
  }

  if (explicitOpeningRows.length > 0) {
    normalizedRoot['НачальныеОстатки'] = explicitOpeningRows.map((r) => ({
      Счет: r.account,
      НаименованиеСчета: r.accountName || '',
      Субконто1: r.subconto || '',
      СальдоНачДт: r.startDebit,
      СальдоНачКт: r.startCredit,
      КоличествоОстаток: r.quantity ?? 0,
    }));
  }

  const snapshot = normalize1CDatabaseExport(normalizedRoot, sourceFileName);

  // Enforce Base 0 start-of-year period anchor & explicit opening balances
  const rawBalanceDate = normalizeDateISO(
    pickString(payload, ['ДатаОстатков', 'balanceDate', 'НачалоГода', 'periodStart'])
  );
  const effectiveYear = rawBalanceDate
    ? Number(rawBalanceDate.slice(0, 4))
    : Number(payload['ОтчетныйГод'] ?? payload['reportingYear'] ?? reportingYear) ||
      DEFAULT_REPORTING_YEAR;

  snapshot.periodStart = `${effectiveYear}-01-01`;
  if (!snapshot.periodEnd || !snapshot.periodEnd.startsWith(`${effectiveYear}-`)) {
    snapshot.periodEnd = `${effectiveYear}-12-31`;
  }
  snapshot.balanceDate = rawBalanceDate || `${effectiveYear}-01-01`;

  if (explicitOpeningRows.length > 0) {
    snapshot.rawBalances = explicitOpeningRows;
    snapshot.detectedBalanceMode = 'start_balances_forward_end';
    snapshot.balanceModeReason = `База 0 из 1С: входящие остатки на ${snapshot.balanceDate} (${explicitOpeningRows.length} стр.) → СальдоКон = СальдоНач + ОборотыДт − ОборотыКт`;
  } else if (snapshot.postings.length === 0) {
    snapshot.detectedBalanceMode = 'start_balances_forward_end';
    snapshot.balanceModeReason = `База 0 из 1С подключена (${snapshot.organization.name || 'Организация'}): начальные остатки равны 0,00 ₽`;
  }

  // Detect pre-ENS legacy payroll/insurance subaccounts (69.01, 69.02.7, 69.03.1 without 69.09)
  const rawPayroll69 =
    payload['payrollAccounts69'] ??
    payload['Субсчета69'] ??
    payload['СчетаВзносов69'];
  const parsedPayroll69: string[] = Array.isArray(rawPayroll69)
    ? Array.from(
        new Set(
          rawPayroll69
            .map((el) =>
              typeof el === 'string'
                ? normalizeAccountCode1C(el)
                : isRecord(el)
                  ? normalizeAccountCode1C(pickString(el, ['Код', 'Счет', 'code', 'account']))
                  : ''
            )
            .filter((code) => code.startsWith('69.'))
        )
      )
    : [];

  const opening69Codes = explicitOpeningRows
    .map((r) => r.account)
    .filter((code) => code.startsWith('69.'));
  const combined69 = Array.from(new Set([...parsedPayroll69, ...opening69Codes]));

  const explicitLegacyFlag =
    payload['usesLegacyPayrollAccounts'] ?? payload['ИспользуютсяСтарыеСчетаВзносов'];
  const inferredLegacyFlag =
    typeof explicitLegacyFlag === 'boolean'
      ? explicitLegacyFlag
      : combined69.length > 0
        ? !combined69.includes('69.09') &&
          combined69.some((c) => c === '69.01' || c.startsWith('69.02') || c.startsWith('69.03'))
        : undefined;

  if (typeof inferredLegacyFlag === 'boolean') {
    snapshot.usesLegacyPayrollAccounts = inferredLegacyFlag;
  }
  if (combined69.length > 0) {
    snapshot.payrollAccounts69 = combined69;
  }

  return snapshot;
}

export function summarizeConnectedBase0(db1C: Database1CSnapshot | null): Base0SummaryStats | null {
  if (!db1C) return null;
  const extraFixedAssets = db1C.rawDirectories['ОсновныеСредства']?.length ?? 0;
  const extraRpb = db1C.rawDirectories['РасходыБудущихПериодов']?.length ?? 0;
  const totalCatalogItems =
    db1C.counterparties.length +
    db1C.contracts.length +
    db1C.nomenclature.length +
    db1C.warehouses.length +
    db1C.employees.length +
    db1C.nomenclatureGroups.length +
    db1C.subdivisions.length +
    extraFixedAssets +
    extraRpb;

  return {
    organizationName: db1C.organization.name || db1C.organization.fullName || 'Организация 1С',
    inn: db1C.organization.inn || '—',
    kpp: db1C.organization.kpp || '',
    bik: db1C.organization.bik || '',
    accountNumber: db1C.organization.bankAccount || '',
    totalCatalogItems,
    openingBalanceLinesCount: db1C.rawBalances.length,
    usesLegacyPayrollAccounts: db1C.usesLegacyPayrollAccounts,
    payrollAccounts69: db1C.payrollAccounts69,
  };
}

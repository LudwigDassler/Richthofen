import type {
  BusinessOperation,
  OpeningBalanceEntry,
  OrganizationCard,
  Synced1CAccountingPolicy,
  Synced1CContract,
  Synced1CCounterparty,
  Synced1CDocument,
  Synced1CDocumentLine,
  Synced1CEmployeeRecord,
  Synced1CNomenclatureRecord,
  Synced1CPosting,
  Synced1CResponsiblePersons,
  Synced1CSnapshot,
} from '@/types/accounting';
import { calculateOsv } from '@/lib/engine/osvCalculator';

function round2(val: number): number {
  if (!Number.isFinite(val) || Math.abs(val) < 0.0001) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function toNum(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : 0;
  if (typeof raw === 'string') {
    const cleaned = raw
      .trim()
      .replace(/[₽]/g, '')
      .replace(/руб\.?/gi, '')
      .replace(/[\s\u00A0\u202F]/g, '')
      .replace(',', '.');
    if (!cleaned || cleaned === '-' || cleaned === '—') return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? round2(n) : 0;
  }
  return 0;
}

function asObj(val: unknown): Record<string, unknown> | null {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (k in obj) {
      const v = obj[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      const nested = asObj(v);
      if (nested) {
        const sub = pickStr(nested, [
          'Наименование',
          'Представление',
          'Код',
          'Номер',
          'name',
          'label',
          'value',
        ]);
        if (sub !== undefined) return sub;
      }
    }
  }
  return undefined;
}

function normalizeDateString(raw: string | undefined): string {
  if (!raw) return '2026-04-01';
  const trimmed = raw.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const dotMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(trimmed);
  if (dotMatch) {
    const d = dotMatch[1].padStart(2, '0');
    const m = dotMatch[2].padStart(2, '0');
    const y = dotMatch[3].length === 2 ? `20${dotMatch[3]}` : dotMatch[3];
    return `${y}-${m}-${d}`;
  }
  return trimmed;
}

function normalizeAccountCode(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw)
    .trim()
    .replace(/^сч(?:ет)?\.?\s*/i, '')
    .replace(/,/g, '.')
    .toUpperCase();
}

function normKey(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeContentHash(str: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `rev-${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

// =============================================================================
// 1. REGISTERS (ОтветственныеЛицаОрганизаций, УчетнаяПолитикаОрганизаций, КадроваяИстория)
// =============================================================================
function extractRegisters(root: Record<string, unknown>): {
  responsiblePersons?: Synced1CResponsiblePersons;
  accountingPolicy?: Synced1CAccountingPolicy;
  hrHistory: Synced1CEmployeeRecord[];
} {
  const regRoot =
    asObj(root['registers1C']) ??
    asObj(root['РегистрыСведений']) ??
    asObj(root['Регистры']) ??
    {};

  // Responsible persons
  const respRaw =
    regRoot['responsiblePersons'] ??
    regRoot['ОтветственныеЛицаОрганизаций'] ??
    regRoot['ОтветственныеЛица'] ??
    root['ОтветственныеЛицаОрганизаций'];

  let responsiblePersons: Synced1CResponsiblePersons | undefined;
  const respRows = Array.isArray(respRaw) ? respRaw : asObj(respRaw) ? [respRaw] : [];
  if (respRows.length > 0) {
    const rp: Synced1CResponsiblePersons = {};
    for (const r of respRows) {
      const obj = asObj(r);
      if (!obj) continue;
      // Shape A: { ОтветственноеЛицо: "Руководитель", ФизическоеЛицо: "Иванов И.И.", Должность: "..." }
      const role = (
        pickStr(obj, [
          'СтруктурнаяЕдиница',
          'ОтветственноеЛицо',
          'ВидОтветственногоЛица',
          'Роль',
          'Должность',
        ]) || ''
      ).toLowerCase();
      const person = pickStr(obj, [
        'ФизическоеЛицо',
        'ФИО',
        'Сотрудник',
        'Ответственный',
        'Представление',
      ]);

      if (role && person !== undefined) {
        if (/руководител|директор/i.test(role)) {
          rp.directorName = person;
          const pos = pickStr(obj, ['Должность']);
          if (pos) rp.directorPosition = pos;
        } else if (/главн.*бух|бухгалтер/i.test(role)) {
          rp.chiefAccountantName = person;
        } else if (/кассир/i.test(role)) {
          rp.cashierName = person;
        }
      }

      // Shape B: flat object { directorName, chiefAccountantName, Руководитель, ГлавныйБухгалтер }
      const flatDir = pickStr(obj, ['directorName', 'Руководитель', 'ГенеральныйДиректор', 'Директор']);
      const flatDirPos = pickStr(obj, ['directorPosition', 'ДолжностьРуководителя']);
      const flatChief = pickStr(obj, ['chiefAccountantName', 'ГлавныйБухгалтер']);
      const flatCashier = pickStr(obj, ['cashierName', 'Кассир']);
      if (flatDir !== undefined) rp.directorName = flatDir;
      if (flatDirPos !== undefined) rp.directorPosition = flatDirPos;
      if (flatChief !== undefined) rp.chiefAccountantName = flatChief;
      if (flatCashier !== undefined) rp.cashierName = flatCashier;
    }
    if (Object.keys(rp).length > 0) responsiblePersons = rp;
  }

  // Accounting policy
  const polRaw =
    regRoot['accountingPolicy'] ??
    regRoot['УчетнаяПолитикаОрганизаций'] ??
    regRoot['УчетнаяПолитика'] ??
    root['УчетнаяПолитикаОрганизаций'];

  let accountingPolicy: Synced1CAccountingPolicy | undefined;
  const polObj = Array.isArray(polRaw)
    ? asObj(polRaw[polRaw.length - 1])
    : asObj(polRaw);
  if (polObj) {
    const taxSystem = pickStr(polObj, ['taxSystem', 'СистемаНалогообложения', 'Налогообложение']);
    const valuationMethod = pickStr(polObj, [
      'valuationMethod',
      'СпособОценкиМПЗ',
      'ОценкаЗапасов',
      'СпособОценкиТоваров',
    ]);
    const mainCostAccount = pickStr(polObj, ['mainCostAccount', 'ОсновнойСчетЗатрат', 'СчетЗатрат']);
    const rawDirect = polObj['directCosting'] ?? polObj['ПрименяетсяДиректКостинг'] ?? polObj['ДиректКостинг'];
    const directCosting = typeof rawDirect === 'boolean' ? rawDirect : undefined;
    const rawSummary = pickStr(polObj, ['rawSummary', 'Описание', 'Комментарий']);

    if (taxSystem || valuationMethod || mainCostAccount || directCosting !== undefined || rawSummary) {
      accountingPolicy = {
        ...(taxSystem ? { taxSystem } : {}),
        ...(valuationMethod ? { valuationMethod } : {}),
        ...(mainCostAccount ? { mainCostAccount } : {}),
        ...(directCosting !== undefined ? { directCosting } : {}),
        ...(rawSummary ? { rawSummary } : {}),
      };
    }
  }

  // HR history
  const hrRaw =
    regRoot['hrHistory'] ??
    regRoot['КадроваяИсторияСотрудников'] ??
    regRoot['КадроваяИстория'] ??
    root['КадроваяИсторияСотрудников'];
  const hrHistory: Synced1CEmployeeRecord[] = [];
  for (let i = 0; i < asArray(hrRaw).length; i++) {
    const obj = asObj(asArray(hrRaw)[i]);
    if (!obj) continue;
    const fullName = pickStr(obj, ['fullName', 'Сотрудник', 'ФизическоеЛицо', 'ФИО', 'Наименование']) || '';
    if (!fullName) continue;
    const salaryVal = toNum(obj['salary'] ?? obj['Оклад'] ?? obj['РазмерОклада'] ?? obj['Тариф']);
    hrHistory.push({
      id: pickStr(obj, ['id', 'ИД', 'Ссылка']) || `hr-${i + 1}`,
      fullName,
      position: pickStr(obj, ['position', 'Должность']),
      department: pickStr(obj, ['department', 'Подразделение']),
      ...(salaryVal > 0 ? { salary: salaryVal } : {}),
      hireDate: pickStr(obj, ['hireDate', 'ДатаПриема', 'Период', 'Дата']),
      inn: pickStr(obj, ['inn', 'ИНН']),
      snils: pickStr(obj, ['snils', 'СНИЛС']),
      personnelNumber: pickStr(obj, ['personnelNumber', 'ТабельныйНомер', 'Код']),
    });
  }

  return { responsiblePersons, accountingPolicy, hrHistory };
}

// =============================================================================
// 2. DIRECTORIES (Организация, БанковскиеСчета, Контрагенты + Договоры, Номенклатура, Сотрудники)
// =============================================================================
function extractBankAccountsIndex(dirsRoot: Record<string, unknown>): Record<string, unknown>[] {
  const list = asArray(dirsRoot['БанковскиеСчета'] ?? dirsRoot['СправочникБанковскиеСчета'] ?? dirsRoot['bankAccounts']);
  return list.map(asObj).filter((x): x is Record<string, unknown> => Boolean(x));
}

function findMatchingBankAccount(
  bankAccounts: Record<string, unknown>[],
  ownerCandidates: Array<string | undefined>,
  preferredRef?: string
): Record<string, unknown> | undefined {
  const keys = ownerCandidates.map(normKey).filter(Boolean);
  if (preferredRef) {
    const prefKey = normKey(preferredRef);
    const exact = bankAccounts.find(
      (b) =>
        normKey(pickStr(b, ['Ссылка', 'id', 'Код', 'НомерСчета'])) === prefKey
    );
    if (exact) return exact;
  }
  if (keys.length === 0) return undefined;
  return bankAccounts.find((b) => {
    const owner = normKey(
      pickStr(b, ['Владелец', 'ВладелецСчета', 'Контрагент', 'Организация', 'ВладелецНаименование'])
    );
    const ownerInn = normKey(pickStr(b, ['ВладелецИНН', 'ИНН']));
    return keys.some((k) => (owner && (owner === k || owner.includes(k) || k.includes(owner))) || (ownerInn && ownerInn === k));
  });
}

function normalizeOrganization(
  rawOrg: unknown,
  dirsRoot: Record<string, unknown>,
  bankAccounts: Record<string, unknown>[],
  responsiblePersons?: Synced1CResponsiblePersons,
  accountingPolicy?: Synced1CAccountingPolicy
): Partial<OrganizationCard> | undefined {
  let obj = asObj(rawOrg);
  if (!obj) {
    const orgList = asArray(dirsRoot['Организации'] ?? dirsRoot['СправочникОрганизации']);
    if (orgList.length > 0) obj = asObj(orgList[0]);
  }
  if (!obj) return undefined;

  const patch: Partial<OrganizationCard> = {};

  const fullName = pickStr(obj, [
    'name',
    'НаименованиеПолное',
    'ПолноеНаименование',
    'ОфициальноеНаименование',
    'Наименование',
  ]);
  const shortName = pickStr(obj, [
    'shortName',
    'НаименованиеСокращенное',
    'КраткоеНаименование',
    'Наименование',
    'name',
  ]);
  const inn = pickStr(obj, ['inn', 'ИНН']);
  const kpp = pickStr(obj, ['kpp', 'КПП']);
  const ogrn = pickStr(obj, ['ogrn', 'ОГРН']);
  const address = pickStr(obj, ['address', 'ЮридическийАдрес', 'Адрес']);

  let bankAccount = pickStr(obj, [
    'bankAccount',
    'РасчетныйСчет',
    'НомерСчета',
    'ОсновнойБанковскийСчет',
  ]);
  let bik = pickStr(obj, ['bik', 'БИК']);
  let bankName = pickStr(obj, ['bankName', 'Банк', 'НаименованиеБанка']);
  let corrAccount = pickStr(obj, ['corrAccount', 'КоррСчет', 'КорреспондентскийСчет']);

  // Cross-join ВсеСправочники.БанковскиеСчета for organization
  const prefBankRef = pickStr(obj, ['ОсновнойБанковскийСчет', 'ОсновнойБанковскийСчетСсылка']);
  const matchedOrgBank = findMatchingBankAccount(
    bankAccounts,
    [shortName, fullName, inn, pickStr(obj, ['Ссылка', 'id'])],
    prefBankRef
  );
  if (matchedOrgBank) {
    if (!bankAccount) bankAccount = pickStr(matchedOrgBank, ['НомерСчета', 'РасчетныйСчет', 'bankAccount']);
    if (!bik) bik = pickStr(matchedOrgBank, ['БИК', 'bik']);
    if (!bankName) bankName = pickStr(matchedOrgBank, ['НаименованиеБанка', 'Банк', 'bankName', 'Наименование']);
    if (!corrAccount) corrAccount = pickStr(matchedOrgBank, ['КоррСчет', 'КорреспондентскийСчет', 'corrAccount']);
  }

  let directorName = pickStr(obj, ['directorName', 'Руководитель', 'ГенеральныйДиректор', 'Директор']);
  let chiefAccountantName = pickStr(obj, ['chiefAccountantName', 'ГлавныйБухгалтер', 'Бухгалтер']);

  if (!directorName && responsiblePersons?.directorName) {
    directorName = responsiblePersons.directorName;
  }
  if (chiefAccountantName === undefined && responsiblePersons?.chiefAccountantName !== undefined) {
    chiefAccountantName = responsiblePersons.chiefAccountantName;
  }

  if (fullName !== undefined) patch.name = fullName;
  if (shortName !== undefined) patch.shortName = shortName;
  if (inn !== undefined) patch.inn = inn;
  if (kpp !== undefined) patch.kpp = kpp;
  if (ogrn !== undefined) patch.ogrn = ogrn;
  if (address !== undefined) patch.address = address;
  if (bankAccount !== undefined) patch.bankAccount = bankAccount;
  if (bik !== undefined) patch.bik = bik;
  if (bankName !== undefined) patch.bankName = bankName;
  if (corrAccount !== undefined) patch.corrAccount = corrAccount;
  if (directorName !== undefined) patch.directorName = directorName;
  if (chiefAccountantName !== undefined) patch.chiefAccountantName = chiefAccountantName;

  if (accountingPolicy?.taxSystem) {
    const ts = accountingPolicy.taxSystem.toUpperCase();
    if (/УСН.*15|ДОХОДЫ.*РАСХОДЫ/i.test(ts)) patch.taxSystem = 'USN_15';
    else if (/УСН.*6|УСН/i.test(ts)) patch.taxSystem = 'USN_6';
    else if (/ОСН|ОСНО|ОБЩ/i.test(ts)) patch.taxSystem = 'OSNO';
  }
  if (accountingPolicy?.directCosting !== undefined) {
    patch.costingMethod = accountingPolicy.directCosting ? 'direct-costing' : 'full-absorption';
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function normalizeContracts(
  rawCp: Record<string, unknown>,
  allContractsTable: Record<string, unknown>[]
): Synced1CContract[] {
  const contractsRaw = rawCp['contracts'] ?? rawCp['Договоры'] ?? rawCp['СписокДоговоров'];
  const result: Synced1CContract[] = [];

  if (Array.isArray(contractsRaw)) {
    for (const item of contractsRaw) {
      if (typeof item === 'string' && item.trim()) {
        result.push({ number: item.trim(), name: item.trim() });
        continue;
      }
      const cObj = asObj(item);
      if (!cObj) continue;
      const number =
        pickStr(cObj, ['number', 'Номер', 'НомерДоговора', 'Наименование', 'name']) || '';
      const date = pickStr(cObj, ['date', 'Дата', 'ДатаДоговора']);
      const kind = pickStr(cObj, ['kind', 'ВидДоговора', 'ТипДоговора']);
      const name = pickStr(cObj, ['name', 'Наименование', 'Представление']) || number;
      if (number || name) {
        result.push({
          number: number || name || '',
          ...(date ? { date } : {}),
          ...(kind ? { kind } : {}),
          ...(name ? { name } : {}),
        });
      }
    }
  }

  // Cross-join from ВсеСправочники.ДоговорыКонтрагентов
  if (allContractsTable.length > 0) {
    const cpKeys = [
      pickStr(rawCp, ['name', 'Наименование', 'НаименованиеПолное']),
      pickStr(rawCp, ['inn', 'ИНН']),
      pickStr(rawCp, ['Ссылка', 'id']),
    ]
      .map(normKey)
      .filter(Boolean);

    for (const cObj of allContractsTable) {
      const owner = normKey(pickStr(cObj, ['Владелец', 'Контрагент', 'ВладелецНаименование']));
      const ownerInn = normKey(pickStr(cObj, ['ВладелецИНН', 'ИНН']));
      const matched = cpKeys.some(
        (k) => (owner && (owner === k || owner.includes(k) || k.includes(owner))) || (ownerInn && ownerInn === k)
      );
      if (!matched) continue;

      const number = pickStr(cObj, ['Номер', 'НомерДоговора', 'Наименование', 'number']) || '';
      const name = pickStr(cObj, ['Наименование', 'name', 'Номер']) || number;
      const date = pickStr(cObj, ['Дата', 'ДатаДоговора', 'date']);
      const kind = pickStr(cObj, ['ВидДоговора', 'ТипДоговора', 'kind']);
      if (number || name) {
        if (!result.some((r) => normKey(r.number) === normKey(number || name))) {
          result.push({
            number: number || name,
            ...(date ? { date } : {}),
            ...(kind ? { kind } : {}),
            ...(name ? { name } : {}),
          });
        }
      }
    }
  }

  const singleContractNum = pickStr(rawCp, [
    'contractNumber',
    'Договор',
    'НомерДоговора',
    'ОсновнойДоговор',
  ]);
  const singleContractDate = pickStr(rawCp, ['contractDate', 'ДатаДоговора']);
  const singleContractKind = pickStr(rawCp, ['contractKind', 'ВидДоговора']);

  if (singleContractNum && result.length === 0) {
    result.push({
      number: singleContractNum,
      ...(singleContractDate ? { date: singleContractDate } : {}),
      ...(singleContractKind ? { kind: singleContractKind } : {}),
      name: singleContractNum,
    });
  }

  return result;
}

function normalizeCounterparties(
  rawList: unknown,
  allContractsTable: Record<string, unknown>[],
  bankAccounts: Record<string, unknown>[]
): Synced1CCounterparty[] {
  if (!Array.isArray(rawList)) return [];
  const list: Synced1CCounterparty[] = [];

  for (const item of rawList) {
    const obj = asObj(item);
    if (!obj) continue;
    const name =
      pickStr(obj, ['name', 'Наименование', 'КраткоеНаименование', 'НаименованиеСокращенное']) || '';
    const fullName = pickStr(obj, [
      'fullName',
      'НаименованиеПолное',
      'ПолноеНаименование',
      'ОфициальноеНаименование',
    ]);
    const inn = pickStr(obj, ['inn', 'ИНН']);
    const kpp = pickStr(obj, ['kpp', 'КПП']);
    let bankAccount = pickStr(obj, [
      'bankAccount',
      'РасчетныйСчет',
      'НомерСчета',
      'ОсновнойБанковскийСчет',
    ]);
    let bik = pickStr(obj, ['bik', 'БИК']);
    let bankName = pickStr(obj, ['bankName', 'Банк', 'НаименованиеБанка']);

    // Cross-join ВсеСправочники.БанковскиеСчета if missing directly on counterparty
    const matchedBank = findMatchingBankAccount(
      bankAccounts,
      [name, fullName, inn, pickStr(obj, ['Ссылка', 'id'])],
      pickStr(obj, ['ОсновнойБанковскийСчет'])
    );
    if (matchedBank) {
      if (!bankAccount) bankAccount = pickStr(matchedBank, ['НомерСчета', 'РасчетныйСчет', 'bankAccount']);
      if (!bik) bik = pickStr(matchedBank, ['БИК', 'bik']);
      if (!bankName) bankName = pickStr(matchedBank, ['НаименованиеБанка', 'Банк', 'bankName']);
    }

    if (!name && !inn) continue;

    list.push({
      name: name || fullName || `Контрагент (${inn})`,
      ...(fullName !== undefined ? { fullName } : {}),
      ...(inn !== undefined ? { inn } : {}),
      ...(kpp !== undefined ? { kpp } : {}),
      ...(bankAccount !== undefined ? { bankAccount } : {}),
      ...(bik !== undefined ? { bik } : {}),
      ...(bankName !== undefined ? { bankName } : {}),
      contracts: normalizeContracts(obj, allContractsTable),
    });
  }

  return list;
}

function normalizeNomenclatureList(dirsRoot: Record<string, unknown>): Synced1CNomenclatureRecord[] {
  const raw = dirsRoot['Номенклатура'] ?? dirsRoot['nomenclature'] ?? dirsRoot['СправочникНоменклатура'];
  const result: Synced1CNomenclatureRecord[] = [];
  for (let i = 0; i < asArray(raw).length; i++) {
    const obj = asObj(asArray(raw)[i]);
    if (!obj) continue;
    const name = pickStr(obj, ['name', 'Наименование', 'НаименованиеПолное']) || '';
    if (!name) continue;
    result.push({
      id: pickStr(obj, ['id', 'ИД', 'Ссылка']) || `nom-1c-${i + 1}`,
      name,
      kind: pickStr(obj, ['kind', 'ВидНоменклатуры', 'ТипНоменклатуры', 'Группа']),
      unit: pickStr(obj, ['unit', 'ЕдиницаИзмерения', 'ЕдИзм']),
      vatRate: pickStr(obj, ['vatRate', 'СтавкаНДС', 'НДС']),
      code: pickStr(obj, ['code', 'Код', 'Артикул']),
    });
  }
  return result;
}

function normalizeEmployeesList(
  dirsRoot: Record<string, unknown>,
  hrHistory: Synced1CEmployeeRecord[]
): Synced1CEmployeeRecord[] {
  const rawEmp = dirsRoot['Сотрудники'] ?? dirsRoot['employees'] ?? dirsRoot['СправочникСотрудники'];
  const rawPeople = asArray(dirsRoot['ФизическиеЛица'] ?? dirsRoot['ФизЛица']).map(asObj).filter(Boolean) as Record<string, unknown>[];

  const map = new Map<string, Synced1CEmployeeRecord>();
  const rawArr = asArray(rawEmp);

  for (let i = 0; i < rawArr.length; i++) {
    const obj = asObj(rawArr[i]);
    if (!obj) continue;
    const fullName = pickStr(obj, ['fullName', 'Наименование', 'ФИО', 'ПолноеИмя', 'ФизическоеЛицо']) || '';
    if (!fullName) continue;

    const personMeta = rawPeople.find(
      (p) => normKey(pickStr(p, ['Наименование', 'ФИО', 'fullName'])) === normKey(fullName)
    );
    const hrMeta = hrHistory.find((h) => normKey(h.fullName) === normKey(fullName));
    const salaryVal = toNum(obj['salary'] ?? obj['Оклад'] ?? obj['РазмерОклада']) || hrMeta?.salary;

    const rec: Synced1CEmployeeRecord = {
      id: pickStr(obj, ['id', 'ИД', 'Ссылка']) || `emp-1c-${i + 1}`,
      fullName,
      position: pickStr(obj, ['position', 'Должность']) || hrMeta?.position,
      department: pickStr(obj, ['department', 'Подразделение']) || hrMeta?.department,
      ...(salaryVal && salaryVal > 0 ? { salary: salaryVal } : {}),
      hireDate: pickStr(obj, ['hireDate', 'ДатаПриема', 'ДатаПриемаНаРаботу']) || hrMeta?.hireDate,
      inn: pickStr(obj, ['inn', 'ИНН']) || (personMeta ? pickStr(personMeta, ['ИНН', 'inn']) : undefined),
      snils: pickStr(obj, ['snils', 'СНИЛС']) || (personMeta ? pickStr(personMeta, ['СНИЛС', 'snils']) : undefined),
      personnelNumber: pickStr(obj, ['personnelNumber', 'ТабельныйНомер', 'Код']),
    };
    map.set(normKey(fullName), rec);
  }

  // Add any employees seen only in КадроваяИстория
  for (const hr of hrHistory) {
    const k = normKey(hr.fullName);
    if (!map.has(k)) {
      map.set(k, hr);
    }
  }

  return Array.from(map.values());
}

// =============================================================================
// 3. OPENING BALANCES (Остатки на 31.03.2026) WITH SYNTHETIC PARENT DEDUPLICATION
// =============================================================================
function normalizeOpeningBalances(rawBalances: unknown): OpeningBalanceEntry[] {
  let rawList: unknown[] = [];

  if (Array.isArray(rawBalances)) {
    rawList = rawBalances;
  } else {
    const obj = asObj(rawBalances);
    if (obj) {
      // Handle { ПоСубконто: [...], ПоСчетам: [...] }
      const subArr = asArray(obj['ПоСубконто'] ?? obj['ДетальныеОстатки'] ?? obj['Строки']);
      const accArr = asArray(obj['ПоСчетам'] ?? obj['СводныеОстатки']);
      if (subArr.length > 0 || accArr.length > 0) {
        rawList = [...subArr, ...accArr];
      } else {
        // Map { "60.01": { debit, credit }, ... }
        const entries: OpeningBalanceEntry[] = [];
        Object.entries(obj).forEach(([accKey, val], idx) => {
          const accountCode = normalizeAccountCode(accKey);
          const vObj = asObj(val);
          if (!accountCode || !vObj) return;
          const debit = toNum(vObj['debit'] ?? vObj['Дебет'] ?? vObj['Дт']);
          const credit = toNum(vObj['credit'] ?? vObj['Кредит'] ?? vObj['Кт']);
          if (debit > 0 || credit > 0) {
            entries.push({
              id: `sync-ob-${accountCode}-${idx + 1}`,
              accountCode,
              subconto1: pickStr(vObj, ['subconto1', 'Субконто1']),
              subconto2: pickStr(vObj, ['subconto2', 'Субконто2']),
              debit,
              credit,
            });
          }
        });
        return entries;
      }
    }
  }

  const parsed: OpeningBalanceEntry[] = [];
  rawList.forEach((item, idx) => {
    const obj = asObj(item);
    if (!obj) return;
    const accountCode = normalizeAccountCode(
      obj['accountCode'] ?? obj['Счет'] ?? obj['КодСчета'] ?? obj['Субсчет']
    );
    if (!accountCode || accountCode === '000') return;

    const subconto1 = pickStr(obj, [
      'subconto1',
      'Субконто1',
      'Контрагент',
      'Номенклатура',
      'Работник',
      'Сотрудник',
      'ВидНалога',
    ]);
    const subconto2 = pickStr(obj, ['subconto2', 'Субконто2', 'Договор', 'Склад']);
    const subconto3 = pickStr(obj, ['subconto3', 'Субконто3']);
    const debit = toNum(
      obj['debit'] ?? obj['Дебет'] ?? obj['СальдоДебет'] ?? obj['СальдоНачДт'] ?? obj['НачДт'] ?? obj['СальдоКонДт']
    );
    const credit = toNum(
      obj['credit'] ?? obj['Кредит'] ?? obj['СальдоКредит'] ?? obj['СальдоНачКт'] ?? obj['НачКт'] ?? obj['СальдоКонКт']
    );
    const comment = pickStr(obj, ['comment', 'Комментарий', 'Содержание']);

    if (debit > 0 || credit > 0) {
      parsed.push({
        id: pickStr(obj, ['id', 'ИД']) || `sync-ob-${accountCode}-${idx + 1}`,
        accountCode,
        ...(subconto1 ? { subconto1 } : {}),
        ...(subconto2 ? { subconto2 } : {}),
        ...(subconto3 ? { subconto3 } : {}),
        debit,
        credit,
        ...(comment ? { comment } : {}),
      });
    }
  });

  // Deduplicate synthetic parent rows (e.g. "60" when "60.01"/"60.02" exist, or aggregate "60.01" without subconto when subconto "60.01" exists)
  const allCodes = new Set(parsed.map((e) => e.accountCode));
  const accountsWithDetailedSubcontos = new Set(
    parsed.filter((e) => Boolean(e.subconto1 || e.subconto2)).map((e) => e.accountCode)
  );

  return parsed.filter((entry) => {
    const hasChildCode = Array.from(allCodes).some(
      (other) => other !== entry.accountCode && other.startsWith(`${entry.accountCode}.`)
    );
    if (hasChildCode) return false;
    if (!entry.subconto1 && !entry.subconto2 && accountsWithDetailedSubcontos.has(entry.accountCode)) {
      return false;
    }
    return true;
  });
}

// =============================================================================
// 4. FULL DOCUMENTS (`ВсеДокументы` — flat array OR object grouped by docType!)
// =============================================================================
function classifySection1C(docType: string): string {
  const lower = docType.toLowerCase();
  if (/списание.*расчетн|поступлен.*расчетн|приходн.*кассов|расходн.*кассов|пко|рко|банк|касс|авансов.*отчет/i.test(lower)) {
    return 'Банк и касса';
  }
  if (/поступлен.*товар|поступлен.*услуг|поступлен.*акт|счет-фактура\s+получен|покупк|доверенност|возврат\s+товаров\s+поставщику/i.test(lower)) {
    return 'Покупки';
  }
  if (/реализац|отгрузк|акт\s+об\s+оказании|счет-фактура\s+выдан|продаж|счет\s+покупател/i.test(lower)) {
    return 'Продажи';
  }
  if (/прием\s+на\s+работ|кадров|начислен.*зарплат|ведомост|отпуск|больничн|увольнен/i.test(lower)) {
    return 'Зарплата и кадры';
  }
  if (/операция|закрытие\s+месяца|регламентн|корректировк.*долг|требован|расход\s+материал/i.test(lower)) {
    return 'Операции';
  }
  return 'Прочие документы';
}

function humanizeDocType(rawType: string): string {
  const map: Record<string, string> = {
    СписаниеСРасчетногоСчета: 'Списание с расчетного счета',
    ПоступлениеНаРасчетныйСчет: 'Поступление на расчетный счет',
    ПоступлениеТоваровУслуг: 'Поступление (акт, накладная, УПД)',
    РеализацияТоваровУслуг: 'Реализация (акт, накладная, УПД)',
    ПриходныйКассовыйОрдер: 'Поступление наличных (ПКО)',
    РасходныйКассовыйОрдер: 'Выдача наличных (РКО)',
    ПриемНаРаботу: 'Прием на работу',
    НачислениеЗарплаты: 'Начисление зарплаты',
    ВедомостьВКассу: 'Ведомость в кассу',
    ОперацияБух: 'Операция, введенная вручную',
    СчетФактураПолученный: 'Счет-фактура полученный',
    СчетФактураВыданный: 'Счет-фактура выданный',
    КорректировкаДолга: 'Корректировка долга',
    ЗакрытиеМесяца: 'Закрытие месяца (Регламентная операция)',
  };
  return map[rawType] || rawType;
}

function normalizeDocumentLines(docObj: Record<string, unknown>): Synced1CDocumentLine[] {
  const linesRaw = [
    ...asArray(docObj['lines']),
    ...asArray(docObj['Строки']),
    ...asArray(docObj['ТабличнаяЧасть']),
    ...asArray(docObj['Товары']),
    ...asArray(docObj['Услуги']),
    ...asArray(docObj['Материалы']),
    ...asArray(docObj['РасшифровкаПлатежа']),
    ...asArray(docObj['Начисления']),
    ...asArray(docObj['Сотрудники']),
  ];

  const lines: Synced1CDocumentLine[] = [];
  for (const item of linesRaw) {
    const row = asObj(item);
    if (!row) continue;

    const nomenclature = pickStr(row, [
      'nomenclature',
      'Номенклатура',
      'Содержание',
      'Наименование',
      'Сотрудник',
      'Начисление',
      'СтатьяРасходов',
    ]);
    const quantity = toNum(row['quantity'] ?? row['Количество']);
    const price = toNum(row['price'] ?? row['Цена']);
    const amount = toNum(row['amount'] ?? row['Сумма'] ?? row['Всего'] ?? row['Оклад'] ?? row['Начислено']);
    const vatRate = pickStr(row, ['vatRate', 'СтавкаНДС', 'НДС']);
    const vatAmount = toNum(row['vatAmount'] ?? row['СуммаНДС']);
    const accountCode = normalizeAccountCode(
      row['accountCode'] ?? row['СчетУчета'] ?? row['СчетЗатрат'] ?? row['Счет'] ?? row['СчетДт']
    );
    const vatAccountCode = normalizeAccountCode(row['vatAccountCode'] ?? row['СчетУчетаНДС'] ?? row['СчетНДС']);
    const subconto = pickStr(row, [
      'subconto',
      'НоменклатурнаяГруппа',
      'СтатьяЗатрат',
      'Подразделение',
      'Договор',
      'СтатьяДДС',
    ]);

    lines.push({
      ...(nomenclature ? { nomenclature } : {}),
      ...(quantity > 0 ? { quantity } : {}),
      ...(price > 0 ? { price } : {}),
      ...(amount > 0 ? { amount } : {}),
      ...(vatRate ? { vatRate } : {}),
      ...(vatAmount > 0 ? { vatAmount } : {}),
      ...(accountCode ? { accountCode } : {}),
      ...(vatAccountCode ? { vatAccountCode } : {}),
      ...(subconto ? { subconto } : {}),
    });
  }
  return lines;
}

function normalizeAllDocuments(rawDocs: unknown): Synced1CDocument[] {
  const flatItems: Array<{ raw: Record<string, unknown>; fallbackType?: string }> = [];

  if (Array.isArray(rawDocs)) {
    for (const item of rawDocs) {
      const obj = asObj(item);
      if (obj) flatItems.push({ raw: obj });
    }
  } else {
    const grouped = asObj(rawDocs);
    if (grouped) {
      for (const [docKey, listVal] of Object.entries(grouped)) {
        for (const item of asArray(listVal)) {
          const obj = asObj(item);
          if (obj) flatItems.push({ raw: obj, fallbackType: humanizeDocType(docKey) });
        }
      }
    }
  }

  const docs: Synced1CDocument[] = [];
  flatItems.forEach(({ raw, fallbackType }, idx) => {
    const docType =
      pickStr(raw, ['docType', 'ВидДокумента', 'ТипДокумента', 'ДокументВид']) ||
      fallbackType ||
      'Документ 1С';
    const section1C = pickStr(raw, ['section1C', 'Раздел']) || classifySection1C(docType);
    const number = pickStr(raw, ['number', 'Номер', 'НомерДокумента']) || String(idx + 1);
    const date = normalizeDateString(pickStr(raw, ['date', 'Дата']));

    const rawPosted = raw['posted'] ?? raw['Проведен'];
    const posted = typeof rawPosted === 'boolean' ? rawPosted : true;
    const rawDeleted = raw['deletionMark'] ?? raw['ПометкаУдаления'];
    const deletionMark = typeof rawDeleted === 'boolean' ? rawDeleted : false;

    const operationKind = pickStr(raw, ['operationKind', 'ВидОперации']);
    const counterparty = pickStr(raw, ['counterparty', 'Контрагент', 'Получатель', 'Плательщик', 'Сотрудник']);
    const contract = pickStr(raw, ['contract', 'Договор', 'ДоговорКонтрагента']);

    const lines = normalizeDocumentLines(raw);
    let amount = toNum(raw['amount'] ?? raw['СуммаДокумента'] ?? raw['Сумма'] ?? raw['Оклад']);
    if (amount === 0 && lines.length > 0) {
      amount = round2(lines.reduce((s, l) => s + (l.amount || 0), 0));
    }
    let vatAmount = toNum(raw['vatAmount'] ?? raw['СуммаНДС']);
    if (vatAmount === 0 && lines.length > 0) {
      vatAmount = round2(lines.reduce((s, l) => s + (l.vatAmount || 0), 0));
    }

    const settlementAccount = normalizeAccountCode(
      raw['settlementAccount'] ?? raw['СчетУчетаРасчетовСКонтрагентом'] ?? raw['СчетРасчетов']
    );
    const advanceAccount = normalizeAccountCode(
      raw['advanceAccount'] ?? raw['СчетУчетаРасчетовПоАвансам'] ?? raw['СчетАвансов']
    );

    const sfNumber = pickStr(raw, ['sfNumber', 'НомерСФ', 'НомерСчетаФактуры', 'СчетФактураНомер']);
    const sfDate = pickStr(raw, ['sfDate', 'ДатаСФ', 'ДатаСчетаФактуры']);
    const sfObj = asObj(raw['СчетФактура']);
    const rawHasSf = raw['hasSfOrUpd'] ?? raw['СчетФактураПредъявлен'] ?? raw['УПД'];
    const hasSfOrUpd =
      typeof rawHasSf === 'boolean'
        ? rawHasSf
        : Boolean(sfNumber || (sfObj && pickStr(sfObj, ['Номер', 'Дата'])));

    const comment = pickStr(raw, ['comment', 'Комментарий', 'НазначениеПлатежа', 'Содержание']);

    docs.push({
      id: pickStr(raw, ['id', 'ИД', 'Ссылка']) || `sync-doc-${idx + 1}`,
      docType,
      section1C,
      number,
      date,
      posted,
      ...(deletionMark ? { deletionMark } : {}),
      ...(operationKind ? { operationKind } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(contract ? { contract } : {}),
      amount,
      ...(vatAmount > 0 ? { vatAmount } : {}),
      ...(settlementAccount ? { settlementAccount } : {}),
      ...(advanceAccount ? { advanceAccount } : {}),
      ...(hasSfOrUpd ? { hasSfOrUpd } : {}),
      ...(sfNumber ? { sfNumber } : sfObj ? { sfNumber: pickStr(sfObj, ['Номер']) } : {}),
      ...(sfDate ? { sfDate } : sfObj ? { sfDate: pickStr(sfObj, ['Дата']) } : {}),
      ...(comment ? { comment } : {}),
      lines,
    });
  });

  return docs;
}

// =============================================================================
// 5. POSTINGS & END BALANCES
// =============================================================================
function normalizeSubcontoArray(
  obj: Record<string, unknown>,
  arrayKeys: string[],
  singleKeys: string[]
): string[] {
  for (const k of arrayKeys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v
        .map((item) => (item === null || item === undefined ? '' : String(item).trim()))
        .filter(Boolean);
    }
    if (typeof v === 'string' && v.trim()) {
      return v
        .split(/\s*(?:\/|\||;)\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const collected: string[] = [];
  for (const sk of singleKeys) {
    const s = pickStr(obj, [sk]);
    if (s) collected.push(s);
  }
  return collected;
}

function normalizeAprilPostings(rawPostings: unknown): Synced1CPosting[] {
  if (!Array.isArray(rawPostings)) return [];
  const list: Synced1CPosting[] = [];

  rawPostings.forEach((item, idx) => {
    const obj = asObj(item);
    if (!obj) return;

    const debitAccount = normalizeAccountCode(
      obj['debitAccount'] ?? obj['СчетДт'] ?? obj['Дебет'] ?? obj['СчетДебета']
    );
    const creditAccount = normalizeAccountCode(
      obj['creditAccount'] ?? obj['СчетКт'] ?? obj['Кредит'] ?? obj['СчетКредита']
    );
    const amount = toNum(obj['amount'] ?? obj['Сумма']);

    if (!debitAccount || !creditAccount || amount <= 0) return;

    const date = normalizeDateString(pickStr(obj, ['date', 'Дата', 'Период']));
    const documentType = pickStr(obj, [
      'documentType',
      'ВидДокумента',
      'ДокументВид',
      'РегистраторВид',
      'Документ',
    ]);
    const documentNumber = pickStr(obj, [
      'documentNumber',
      'НомерДокумента',
      'РегистраторНомер',
      'Номер',
    ]);
    const comment = pickStr(obj, ['comment', 'Содержание', 'Комментарий', 'Назначение']);

    const debitSubconto = normalizeSubcontoArray(
      obj,
      ['debitSubconto', 'СубконтоДт', 'СубконтоДебета'],
      ['СубконтоДт1', 'СубконтоДт2', 'СубконтоДт3']
    );
    const creditSubconto = normalizeSubcontoArray(
      obj,
      ['creditSubconto', 'СубконтоКт', 'СубконтоКредита'],
      ['СубконтоКт1', 'СубконтоКт2', 'СубконтоКт3']
    );

    list.push({
      id: pickStr(obj, ['id', 'ИД']) || `sync-post-${idx + 1}`,
      date,
      ...(documentType ? { documentType } : {}),
      ...(documentNumber ? { documentNumber } : {}),
      debitAccount,
      debitSubconto,
      creditAccount,
      creditSubconto,
      amount,
      ...(comment ? { comment } : {}),
    });
  });

  return list;
}

function normalizeEndBalances(
  rawEnd: unknown,
  openingBalances: OpeningBalanceEntry[],
  aprilPostings: Synced1CPosting[]
): Record<string, { debit: number; credit: number }> | undefined {
  const result: Record<string, { debit: number; credit: number }> = {};

  if (Array.isArray(rawEnd)) {
    for (const item of rawEnd) {
      const obj = asObj(item);
      if (!obj) continue;
      const code = normalizeAccountCode(obj['accountCode'] ?? obj['Счет'] ?? obj['КодСчета']);
      if (!code) continue;
      const debit = toNum(
        obj['endDebit'] ?? obj['СальдоКонДт'] ?? obj['КонДт'] ?? obj['СальдоДебет'] ?? obj['debit']
      );
      const credit = toNum(
        obj['endCredit'] ?? obj['СальдоКонКт'] ?? obj['КонКт'] ?? obj['СальдоКредит'] ?? obj['credit']
      );
      result[code] = { debit, credit };
    }
    if (Object.keys(result).length > 0) return result;
  } else {
    const mapObj = asObj(rawEnd);
    if (mapObj) {
      for (const [accKey, val] of Object.entries(mapObj)) {
        const code = normalizeAccountCode(accKey);
        const vObj = asObj(val);
        if (!code || !vObj) continue;
        const debit = toNum(
          vObj['debit'] ?? vObj['endDebit'] ?? vObj['Дебет'] ?? vObj['Дт'] ?? vObj['СальдоКонДт']
        );
        const credit = toNum(
          vObj['credit'] ?? vObj['endCredit'] ?? vObj['Кредит'] ?? vObj['Кт'] ?? vObj['СальдоКонКт']
        );
        result[code] = { debit, credit };
      }
      if (Object.keys(result).length > 0) return result;
    }
  }

  if (openingBalances.length > 0 || aprilPostings.length > 0) {
    const syntheticOp: BusinessOperation = {
      id: 'sync-synthetic-all',
      number: 1,
      date: '2026-04-30',
      rawDescription: 'Движения из базы 1С за апрель',
      explicitAmount: 1,
      resolvedAmount: 1,
      status: 'done',
      menuPath1C: ['1С'],
      documentType1C: 'Выгрузка 1С',
      operationKind1C: 'Проводки',
      hasUpdOrSf: false,
      documentFields: [],
      postings: aprilPostings.map((p) => ({
        id: p.id,
        debitAccount: p.debitAccount,
        debitSubconto: p.debitSubconto,
        creditAccount: p.creditAccount,
        creditSubconto: p.creditSubconto,
        amount: p.amount,
        comment: p.comment || '',
      })),
      pitfalls: [],
    };
    const osv = calculateOsv(openingBalances, [syntheticOp], 'completed_only');
    for (const row of osv.rows) {
      if (!row.isGroup) {
        result[row.accountCode] = {
          debit: round2(row.endDebit),
          credit: round2(row.endCredit),
        };
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  return undefined;
}

// =============================================================================
// 6. MAIN NORMALIZER
// =============================================================================
export function normalize1CSyncPayload(
  raw: unknown,
  sourceOverride?: Synced1CSnapshot['source'],
  explicitRevision?: string
): Synced1CSnapshot {
  const root = asObj(raw) || {};

  // Fast path: if already a normalized Phase 4 snapshot from cache, return preserving all fields!
  if (
    root['isNormalizedSnapshot'] === true &&
    typeof root['revision'] === 'string' &&
    typeof root['syncedAt'] === 'string' &&
    Array.isArray(root['allDocuments']) &&
    asObj(root['directories1C']) &&
    asObj(root['registers1C'])
  ) {
    const existing = root as unknown as Synced1CSnapshot;
    return {
      ...existing,
      ...(sourceOverride ? { source: sourceOverride } : {}),
      ...(explicitRevision ? { revision: explicitRevision } : {}),
    };
  }

  const dirsRoot = asObj(root['directories1C'] ?? root['ВсеСправочники'] ?? root['Справочники']) ?? {};
  const registers1C = extractRegisters(root);
  const bankAccounts = extractBankAccountsIndex(dirsRoot);
  const allContractsTable = asArray(
    dirsRoot['ДоговорыКонтрагентов'] ?? dirsRoot['Договоры'] ?? dirsRoot['contracts']
  )
    .map(asObj)
    .filter((x): x is Record<string, unknown> => Boolean(x));

  const orgRaw = root['organization'] ?? root['Организация'] ?? root['НашаОрганизация'];
  const organization = normalizeOrganization(
    orgRaw,
    dirsRoot,
    bankAccounts,
    registers1C.responsiblePersons,
    registers1C.accountingPolicy
  );

  const cpsRaw =
    dirsRoot['counterparties'] ??
    dirsRoot['Контрагенты'] ??
    root['counterparties'] ??
    root['Контрагенты'] ??
    root['СправочникКонтрагенты'];

  const counterparties = normalizeCounterparties(cpsRaw, allContractsTable, bankAccounts);
  const nomenclature = normalizeNomenclatureList(dirsRoot);
  const employees = normalizeEmployeesList(dirsRoot, registers1C.hrHistory);

  const obRaw =
    root['openingBalances'] ??
    root['Остатки'] ??
    root['НачальныеОстатки'] ??
    root['ВходящиеОстатки'] ??
    root['ОСВ_Начало'];
  const openingBalances = normalizeOpeningBalances(obRaw);

  const docsRaw = root['allDocuments'] ?? root['ВсеДокументы'] ?? root['Документы'];
  const allDocuments = normalizeAllDocuments(docsRaw);

  const postingsRaw =
    root['aprilPostings'] ??
    root['ПроводкиС_Апреля'] ??
    root['Проводки'] ??
    root['Движения'] ??
    root['ЖурналПроводок'];
  const aprilPostings = normalizeAprilPostings(postingsRaw);

  const endBalRaw =
    root['endBalances'] ??
    root['КонечныеОстатки'] ??
    root['ОстаткиНаКонец'] ??
    root['ОСВ'] ??
    root['ОСВ_Апрель'];
  const endBalances = normalizeEndBalances(endBalRaw, openingBalances, aprilPostings);

  const rawClosingFlag =
    root['hasMonthEndClosing'] ??
    root['ЗакрытиеМесяцаВыполнено'] ??
    root['МесяцЗакрыт'];

  const hasMonthEndClosing =
    typeof rawClosingFlag === 'boolean'
      ? rawClosingFlag
      : aprilPostings.some(
          (p) =>
            p.debitAccount === '90.09' ||
            p.creditAccount === '90.09' ||
            p.debitAccount === '91.09' ||
            p.creditAccount === '91.09' ||
            p.debitAccount === '90.08.1'
        );

  const contractsCount = counterparties.reduce((s, c) => s + c.contracts.length, 0);

  const canonicalPayloadForHash = JSON.stringify({
    organization,
    counterparties,
    nomenclature,
    employees,
    openingBalances,
    allDocuments,
    endBalances,
    aprilPostings,
    registers1C,
    hasMonthEndClosing,
  });

  const revision = explicitRevision || computeContentHash(canonicalPayloadForHash);
  const syncedAt =
    typeof root['ДатаВыгрузки'] === 'string' && root['ДатаВыгрузки'].trim()
      ? root['ДатаВыгрузки'].trim()
      : new Date().toISOString();

  const validSources = new Set<Synced1CSnapshot['source']>([
    'http-post',
    'downloads-file',
    'file-upload',
    'demo-simulation',
  ]);
  const rawSource = root['source'] as Synced1CSnapshot['source'] | undefined;
  const source: Synced1CSnapshot['source'] =
    sourceOverride || (rawSource && validSources.has(rawSource) ? rawSource : 'http-post');

  return {
    revision,
    syncedAt,
    source,
    isNormalizedSnapshot: true,
    ...(organization ? { organization } : {}),
    counterparties,
    openingBalances,
    ...(endBalances ? { endBalances } : {}),
    aprilPostings,
    hasMonthEndClosing,
    allDocuments,
    directories1C: {
      counterparties,
      nomenclature,
      employees,
      bankAccountsCount: bankAccounts.length,
      contractsCount,
    },
    registers1C: {
      ...(registers1C.responsiblePersons ? { responsiblePersons: registers1C.responsiblePersons } : {}),
      ...(registers1C.accountingPolicy ? { accountingPolicy: registers1C.accountingPolicy } : {}),
      hrHistory: registers1C.hrHistory,
    },
  };
}

// =============================================================================
// 7. REALISTIC SAMPLE 1C EXPORT PAYLOAD WITH FULL DOCUMENTS, DIRECTORIES & REGISTERS
// =============================================================================
export function buildSample1CSyncErrorPayload(): Record<string, unknown> {
  return {
    ФорматОбмена: '1C:Enterprise 8.3 FullExport JSON v2.0',
    ДатаВыгрузки: new Date().toISOString(),
    ЗакрытиеМесяцаВыполнено: false,
    Организация: {
      НаименованиеПолное: 'Общество с ограниченной ответственностью «БалтСтройИнвест»',
      НаименованиеСокращенное: 'ООО «БалтСтройИнвест»',
      ИНН: '7841529035',
      КПП: '784101001',
      ОГРН: '1217800084512',
    },
    РегистрыСведений: {
      ОтветственныеЛицаОрганизаций: [
        { ОтветственноеЛицо: 'Руководитель', ФизическоеЛицо: 'Невский Андрей Владимирович', Должность: 'Генеральный директор' },
        { ОтветственноеЛицо: 'Главный бухгалтер', ФизическоеЛицо: '' }, // ОШИБКА: пустой Главбух!
      ],
      УчетнаяПолитикаОрганизаций: {
        СистемаНалогообложения: 'ОСНО (Общая система налогообложения)',
        СпособОценкиМПЗ: 'По средней стоимости',
        ОсновнойСчетЗатрат: '20.01',
        ПрименяетсяДиректКостинг: true,
      },
      КадроваяИсторияСотрудников: [
        { Сотрудник: 'Невский Андрей Владимирович', Должность: 'Генеральный директор', Подразделение: 'Администрация', Оклад: 95000, ДатаПриема: '2025-01-15' },
        { Сотрудник: 'Соколов Алексей Викторович', Должность: 'Прораб', Подразделение: 'Строительный участок', Оклад: 85000, ДатаПриема: '2026-01-10' },
      ],
    },
    ВсеСправочники: {
      БанковскиеСчета: [
        {
          Владелец: 'ООО «БалтСтройИнвест»',
          НомерСчета: '40702810655000048219',
          БИК: '044030653',
          НаименованиеБанка: 'Северо-Западный банк ПАО Сбербанк г. Санкт-Петербург',
          КоррСчет: '30101810500000000653',
        },
        {
          Владелец: 'МИ ФНС №10 по СПб',
          НомерСчета: '', // ОШИБКА: не заполнен казначейский счет
          БИК: '044030001',
          НаименованиеБанка: 'Северо-Западное ГУ Банка России // УФК по г. Санкт-Петербургу',
        },
        {
          Владелец: 'ООО «СП-171»',
          НомерСчета: '40702810155000091710',
          БИК: '044030653',
          НаименованиеБанка: 'Северо-Западный банк ПАО Сбербанк г. Санкт-Петербург',
        },
        {
          Владелец: 'ООО «Управление»',
          НомерСчета: '40702810490000064520',
          БИК: '044030790',
          НаименованиеБанка: 'АО «Банк Санкт-Петербург»',
        },
      ],
      Контрагенты: [
        { Наименование: 'МИ ФНС №10 по СПб', ИНН: '7841000019', КПП: '' }, // ОШИБКА: пустой КПП 783901001
        { Наименование: 'ООО «Конкурент»', ИНН: '7813452101', КПП: '', РасчетныйСчет: '', БИК: '', Банк: '' }, // ОШИБКА: пустые КПП/Р-сч/БИК/Банк
        { Наименование: 'ООО «Сбыт»', ИНН: '7805618321', КПП: '780501001', РасчетныйСчет: '', БИК: '', Банк: '' },
        { Наименование: 'ООО «СП-171»', ИНН: '7810192328', КПП: '781401001' },
        { Наименование: 'ООО «Управление»', ИНН: '7816490257', КПП: '781601001' },
      ],
      ДоговорыКонтрагентов: [
        { Владелец: 'МИ ФНС №10 по СПб', Номер: 'Уплата налогов и взносов в бюджет', ВидДоговора: 'Прочее' },
        { Владелец: 'ООО «Конкурент»', Номер: 'Счет-договор №18', Дата: '02.04.2026', ВидДоговора: 'С поставщиком' },
        { Владелец: 'ООО «Конкурент»', Номер: 'Основной договор', Дата: '03.04.2026', ВидДоговора: 'С поставщиком' },
        { Владелец: 'ООО «Сбыт»', Номер: 'Договор №177', Дата: '10.02.2026', ВидДоговора: 'С поставщиком' },
        { Владелец: 'ООО «СП-171»', Номер: 'Договор поставки №171-ОК', Дата: '20.04.2026', ВидДоговора: 'С покупателем' },
        { Владелец: 'ООО «Управление»', Номер: 'Договор субподряда №25-СМР', Дата: '12.04.2026', ВидДоговора: 'С поставщиком' },
      ],
      Номенклатура: [
        { Наименование: 'Оконный блок ПВХ двухкамерный', ВидНоменклатуры: 'Товары', ЕдиницаИзмерения: 'шт.', СтавкаНДС: '20%' },
        { Наименование: 'Субподрядные СМР по ремонту кровли', ВидНоменклатуры: 'Услуги', ЕдиницаИзмерения: 'усл.', СтавкаНДС: '20%' },
      ],
      Сотрудники: [
        { Наименование: 'Невский Андрей Владимирович', Должность: 'Генеральный директор', ТабельныйНомер: '00001' },
        { Наименование: 'Соколов Алексей Викторович', Должность: 'Прораб', ТабельныйНомер: '00002' },
      ],
    },
    Остатки: [
      { Счет: '01.01', Субконто1: 'Строительные леса рамные и подъемное оборудование', Дебет: 1200000, Кредит: 0 },
      { Счет: '02.01', Субконто1: 'Строительные леса рамные и подъемное оборудование', Дебет: 0, Кредит: 240000 },
      { Счет: '10.08', Субконто1: 'Строительные и крепежные материалы', Субконто2: 'Основной склад', Дебет: 185000, Кредит: 0 },
      { Счет: '50.01', Субконто1: 'Основная касса организации', Дебет: 15000, Кредит: 0 },
      { Счет: '51', Субконто1: 'Основной р/с в Северо-Западном банке ПАО Сбербанк', Дебет: 4200000, Кредит: 0 },
      { Счет: '60.01', Субконто1: 'ООО «Сбыт»', Субконто2: 'Договор №177 от 10.02.2026', Дебет: 0, Кредит: 120000 },
      { Счет: '68.01', Субконто1: 'НДФЛ при исполнении обязанностей налогового агента', Дебет: 0, Кредит: 22000 },
      { Счет: '68.02', Субконто1: 'Налог на добавленную стоимость', Дебет: 0, Кредит: 110000 },
      { Счет: '69.09', Субконто1: 'Страховые взносы по единому тарифу', Дебет: 0, Кредит: 48000 },
      { Счет: '70', Субконто1: 'Работники организации (зарплата за март)', Дебет: 0, Кредит: 145000 },
      { Счет: '80.09', Субконто1: 'Учредитель: Невский Андрей Владимирович (100%)', Дебет: 0, Кредит: 1000000 },
      { Счет: '84.01', Субконто1: 'Нераспределенная прибыль прошлых лет', Дебет: 0, Кредит: 3915000 },
    ],
    ВсеДокументы: {
      СписаниеСРасчетногоСчета: [
        { Номер: '000001', Дата: '2026-04-01', Проведен: true, ВидОперации: 'Уплата налога', Контрагент: 'МИ ФНС №10 по СПб', СуммаДокумента: 110000, НазначениеПлатежа: 'Уплата НДС за 1 кв.' },
        { Номер: '000002', Дата: '2026-04-01', Проведен: true, ВидОперации: 'Уплата налога', Контрагент: 'МИ ФНС №10 по СПб', СуммаДокумента: 22000, НазначениеПлатежа: 'Уплата НДФЛ за 1 кв.' },
        { Номер: '000003', Дата: '2026-04-01', Проведен: true, ВидОперации: 'Уплата налога', Контрагент: 'МИ ФНС №10 по СПб', СуммаДокумента: 48000, НазначениеПлатежа: 'Уплата страховых взносов за март' },
        { Номер: '000004', Дата: '2026-04-02', Проведен: true, ВидОперации: 'Оплата поставщику', Контрагент: 'ООО «Конкурент»', Договор: 'Счет-договор №18', СуммаДокумента: 1236900, СчетРасчетов: '60.01', СчетАвансов: '60.02' },
        { Номер: '000005', Дата: '2026-04-04', Проведен: true, ВидОперации: 'Оплата поставщику', Контрагент: 'ООО «Сбыт»', Договор: 'Договор №177', СуммаДокумента: 120000, СчетРасчетов: '60.01' },
        { Номер: '000006', Дата: '2026-04-04', Проведен: true, ВидОперации: 'Прочие расчеты с контрагентами', Контрагент: 'ООО «Сбыт»', Договор: 'Договор №177', СуммаДокумента: 8000, СчетРасчетов: '76.02' },
        { Номер: '000007', Дата: '2026-04-25', Проведен: true, ВидОперации: 'Оплата поставщику', Контрагент: 'ООО «Управление»', Договор: 'Договор субподряда №25-СМР', СуммаДокумента: 2352000, СчетРасчетов: '60.01' },
      ],
      ПоступлениеТоваровУслуг: [
        {
          Номер: '000001',
          Дата: '2026-04-03',
          Проведен: true,
          ВидОперации: 'Товары (накладная, УПД)',
          Контрагент: 'ООО «Конкурент»',
          Договор: 'Основной договор', // ОШИБКА: договор не совпадает со Счет-договором №18!
          СуммаДокумента: 1236900,
          СуммаНДС: 206150,
          СчетФактураПредъявлен: true,
          НомерСФ: '45',
          ДатаСФ: '2026-04-03',
          Товары: [
            { Номенклатура: 'Оконный блок ПВХ двухкамерный', Количество: 133, Цена: 9300, Сумма: 1236900, СтавкаНДС: '20%', СуммаНДС: 206150, СчетУчета: '41.01', СчетУчетаНДС: '19.03' },
          ],
        },
        {
          Номер: '000002',
          Дата: '2026-04-25',
          Проведен: true,
          ВидОперации: 'Услуги (акт, УПД)',
          Контрагент: 'ООО «Управление»',
          Договор: 'Договор субподряда №25-СМР',
          СуммаДокумента: 2352000,
          СуммаНДС: 392000,
          СчетФактураПредъявлен: false, // ОШИБКА: СФ не зарегистрирован!
          Услуги: [
            { Номенклатура: 'Субподрядные СМР по ремонту кровли', Количество: 1, Цена: 2352000, Сумма: 2352000, СтавкаНДС: '20%', СуммаНДС: 392000, СчетУчета: '20.01', СчетУчетаНДС: '19.04', НоменклатурнаяГруппа: 'Ремонт кровли с установкой кирпичной трубы' },
          ],
        },
      ],
      РеализацияТоваровУслуг: [
        {
          Номер: '000001',
          Дата: '2026-04-22',
          Проведен: true,
          ВидОперации: 'Товары (накладная, УПД)',
          Контрагент: 'ООО «СП-171»',
          Договор: 'Договор поставки №171-ОК',
          СуммаДокумента: 1369900,
          СуммаНДС: 228316.67,
          СчетФактураПредъявлен: true,
          Товары: [
            { Номенклатура: 'Оконный блок ПВХ двухкамерный', Количество: 133, Цена: 10300, Сумма: 1369900, СтавкаНДС: '20%', СуммаНДС: 228316.67, СчетУчета: '41.01', НоменклатурнаяГруппа: 'Оптовая торговля оконными блоками' },
          ],
        },
      ],
      ПриходныйКассовыйОрдер: [
        { Номер: '000001', Дата: '2026-04-15', Проведен: true, ВидОперации: 'Получение наличных в банке', СуммаДокумента: 145000 },
      ],
      РасходныйКассовыйОрдер: [
        { Номер: '000001', Дата: '2026-04-15', Проведен: true, ВидОперации: 'Выплата заработной платы по ведомостям', СуммаДокумента: 145000 },
      ],
      ПриемНаРаботу: [
        { Номер: '000001', Дата: '2026-04-05', Проведен: false, Сотрудник: 'Главный бухгалтер (Студент)', Оклад: 72200, Комментарий: 'Черновик кадрового приказа — забыли нажать «Провести»!' },
      ],
      ОперацияБух: [
        { Номер: '000001', Дата: '2026-04-04', Проведен: true, Контрагент: 'ООО «Сбыт»', Договор: 'Договор №177', СуммаДокумента: 8000, Комментарий: 'Неустойка 3000 + штраф 5000 по дог. 177' },
      ],
    },
    ПроводкиС_Апреля: [
      { ИД: '1c-p-1a', Дата: '2026-04-01', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000001', СчетДт: '68.02', СубконтоДт: ['Налог (взносы): начислено / уплачено'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 110000, Содержание: 'Уплата НДС в МИ ФНС №10 по СПб' },
      { ИД: '1c-p-1b', Дата: '2026-04-01', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000002', СчетДт: '68.01', СубконтоДт: ['Налог (взносы): начислено / уплачено'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 22000, Содержание: 'Уплата НДФЛ в МИ ФНС №10 по СПб' },
      { ИД: '1c-p-1c', Дата: '2026-04-01', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000003', СчетДт: '69.09', СубконтоДт: ['Налог (взносы): начислено / уплачено'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 48000, Содержание: 'Уплата страховых взносов в МИ ФНС №10 по СПб' },
      { ИД: '1c-p-2', Дата: '2026-04-02', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000004', СчетДт: '60.02', СубконтоДт: ['ООО «Конкурент»', 'Счет-договор №18 от 02.04.2026'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 1236900, Содержание: '100% аванс ООО «Конкурент» за 133 оконных блока' },
      { ИД: '1c-p-3a', Дата: '2026-04-03', ВидДокумента: 'Поступление (акт, накладная, УПД)', НомерДокумента: '000001', СчетДт: '41.01', СубконтоДт: ['Оконный блок ПВХ двухкамерный', 'Основной склад'], СчетКт: '60.01', СубконтоКт: ['ООО «Конкурент»', 'Основной договор'], Сумма: 1030750, Содержание: 'Поступление оконных блоков 133 шт. (без зачета аванса из-за другого договора!)' },
      { ИД: '1c-p-3b', Дата: '2026-04-03', ВидДокумента: 'Поступление (акт, накладная, УПД)', НомерДокумента: '000001', СчетДт: '19.03', СубконтоДт: ['ООО «Конкурент»', 'Счет-фактура полученный №45'], СчетКт: '60.01', СубконтоКт: ['ООО «Конкурент»', 'Основной договор'], Сумма: 206150, Содержание: 'Выделен НДС по оконным блокам' },
      { ИД: '1c-p-3c', Дата: '2026-04-03', ВидДокумента: 'Счет-фактура полученный', НомерДокумента: '000001', СчетДт: '68.02', СубконтоДт: ['Налог (взносы): начислено / уплачено'], СчетКт: '19.03', СубконтоКт: ['ООО «Конкурент»', 'Счет-фактура полученный №45'], Сумма: 206150, Содержание: 'Принят к вычету НДС по оконным блокам' },
      { ИД: '1c-p-4a', Дата: '2026-04-04', ВидДокумента: 'Операция, введенная вручную', НомерДокумента: '000001', СчетДт: '91.02', СубконтоДт: ['Штрафы, пени и неустойки к получению (уплате)'], СчетКт: '76.02', СубконтоКт: ['ООО «Сбыт»', 'Договор №177 от 10.02.2026'], Сумма: 8000, Содержание: 'Начислены неустойка 3000 и штраф 5000 одной строкой на 91.02' },
      { ИД: '1c-p-4b', Дата: '2026-04-04', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000005', СчетДт: '60.01', СубконтоДт: ['ООО «Сбыт»', 'Договор №177 от 10.02.2026'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 120000, Содержание: 'Погашение основного долга по дог. 177 ООО «Сбыт»' },
      { ИД: '1c-p-4c', Дата: '2026-04-04', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000006', СчетДт: '76.02', СубконтоДт: ['ООО «Сбыт»', 'Договор №177 от 10.02.2026'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 8000, Содержание: 'Оплата санкций по исполнительному листу ООО «Сбыт»' },
      { ИД: '1c-p-6a', Дата: '2026-04-15', ВидДокумента: 'Поступление наличных (ПКО)', НомерДокумента: '000001', СчетДт: '50.01', СубконтоДт: ['Получение наличных из банка'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 145000, Содержание: 'Получены наличные в кассу на выплату зарплаты' },
      { ИД: '1c-p-6b', Дата: '2026-04-15', ВидДокумента: 'Выдача наличных (РКО)', НомерДокумента: '000001', СчетДт: '70', СубконтоДт: ['Работники организации'], СчетКт: '50.01', СубконтоКт: ['Оплата труда'], Сумма: 145000, Содержание: 'Выплачена зарплата за март из кассы' },
      { ИД: '1c-p-7a', Дата: '2026-04-22', ВидДокумента: 'Реализация (акт, накладная, УПД)', НомерДокумента: '000001', СчетДт: '90.02.1', СубконтоДт: ['Оптовая торговля оконными блоками'], СчетКт: '41.01', СубконтоКт: ['Оконный блок ПВХ двухкамерный', 'Основной склад'], Сумма: 1030750, Содержание: 'Списана себестоимость 133 оконных блоков' },
      { ИД: '1c-p-7b', Дата: '2026-04-22', ВидДокумента: 'Реализация (акт, накладная, УПД)', НомерДокумента: '000001', СчетДт: '62.01', СубконтоДт: ['ООО «СП-171»', 'Договор поставки №171-ОК от 20.04.2026'], СчетКт: '90.01.1', СубконтоКт: ['Оптовая торговля оконными блоками', '20%'], Сумма: 1369900, Содержание: 'Реализация оконных блоков 133 шт. ООО «СП-171»' },
      { ИД: '1c-p-7c', Дата: '2026-04-22', ВидДокумента: 'Реализация (акт, накладная, УПД)', НомерДокумента: '000001', СчетДт: '90.03', СубконтоДт: ['Оптовая торговля оконными блоками'], СчетКт: '68.02', СубконтоКт: ['Налог (взносы): начислено / уплачено'], Сумма: 228316.67, Содержание: 'Начислен НДС с реализации оконных блоков' },
      { ИД: '1c-p-9a', Дата: '2026-04-25', ВидДокумента: 'Поступление (акт, накладная, УПД)', НомерДокумента: '000002', СчетДт: '20.01', СубконтоДт: ['Ремонт кровли с установкой кирпичной трубы', 'Материальные расходы (субподрядные работы)'], СчетКт: '60.01', СубконтоКт: ['ООО «Управление»', 'Договор субподряда №25-СМР от 12.04.2026'], Сумма: 1960000, Содержание: 'Субподрядные работы ООО «Управление» на объекте ремонта кровли' },
      { ИД: '1c-p-9b', Дата: '2026-04-25', ВидДокумента: 'Поступление (акт, накладная, УПД)', НомерДокумента: '000002', СчетДт: '19.04', СубконтоДт: ['ООО «Управление»', 'Без счета-фактуры'], СчетКт: '60.01', СубконтоКт: ['ООО «Управление»', 'Договор субподряда №25-СМР от 12.04.2026'], Сумма: 392000, Содержание: 'Учтен входящий НДС по субподряду (СФ не зарегистрирован!)' },
      { ИД: '1c-p-9c', Дата: '2026-04-25', ВидДокумента: 'Списание с расчетного счета', НомерДокумента: '000007', СчетДт: '60.01', СубконтоДт: ['ООО «Управление»', 'Договор субподряда №25-СМР от 12.04.2026'], СчетКт: '51', СубконтоКт: ['Основной р/с'], Сумма: 2352000, Содержание: 'Оплата ООО «Управление» за субподрядные СМР' },
      { ИД: '1c-p-sal', Дата: '2026-04-30', ВидДокумента: 'Начисление зарплаты', НомерДокумента: '000001', СчетДт: '26', СубконтоДт: ['Оплата труда'], СчетКт: '70', СубконтоКт: ['Работники администрации'], Сумма: 158909.09, Содержание: 'Начислена зарплата администрации за апрель (Закрытие месяца не проведено!)' },
    ],
  };
}

import { isOffBalanceAccountCode } from '@/data/chartOfAccounts';
import {
  Database1CSnapshot,
  DEFAULT_REPORTING_YEAR,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  ExportMode1C,
  OsvReport,
  PersistedWorkbenchStateV2,
  QueuedOperation,
} from '@/types/accounting';

function escapeBsl(str: string): string {
  return (str ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ').trim();
}

function escapeXml(str: string): string {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .trim();
}

function toBslDateExpr(isoDate: string, endOfDay = false): string {
  const m = (isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    return 'ТекущаяДата()';
  }
  const [, y, mo, d] = m;
  return endOfDay
    ? `Дата(${Number(y)}, ${Number(mo)}, ${Number(d)}, 23, 59, 59)`
    : `Дата(${Number(y)}, ${Number(mo)}, ${Number(d)}, 12, 0, 0)`;
}

function dayBeforeIso(isoDate: string): string {
  const m = (isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '2025-01-01';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function deterministicUuid(seed: string): string {
  // Pure deterministic hash -> UUID v4-shaped string for idempotent EnterpriseData XML exchange
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  let h3 = 0x9e3779b9 ^ seed.length;
  let h4 = 0x85ebca6b ^ seed.length;

  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  const raw = `${hex8(h1)}${hex8(h2)}${hex8(h3)}${hex8(h4)}`;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function to1CVatEnumName(rate: number, rule: string): string {
  if (rule === 'none' || rate <= 0) return 'БезНДС';
  if (rate === 20) return 'НДС20';
  if (rate === 22) return 'НДС22';
  if (rate === 10) return 'НДС10';
  return 'НДС20';
}

export interface ExportStatsSummary {
  mode: ExportMode1C;
  counterpartiesCount: number;
  contractsCount: number;
  bankAccountsCount?: number;
  nomenclatureCount: number;
  warehousesCount: number;
  openingBalanceLinesCount: number;
  documentsToPostCount: number;
  entriesCount: number;
}

export function buildExportBundle(params: {
  mode: ExportMode1C;
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  osv: OsvReport;
  reportingYear?: number;
  fullState?: PersistedWorkbenchStateV2;
}): {
  stats: ExportStatsSummary;
  bslCode: string;
  enterpriseDataXml: string;
  jsonSnapshot: string;
} {
  const { mode, db1C, operations, osv, reportingYear, fullState } = params;
  const effYear = reportingYear ?? fullState?.reportingYear;
  const activeNewOps = operations.filter((op) => op.includeInProcessing && !op.isDuplicateIn1C);

  // Collect directories according to mode
  const cpMap = new Map<
    string,
    {
      name: string;
      fullName: string;
      inn: string;
      kpp: string;
      kind: string;
      bankAccount?: string;
      bik?: string;
      bankName?: string;
    }
  >();
  const ctrMap = new Map<
    string,
    { name: string; number: string; date: string; cpName: string; cpInn: string; kind: string }
  >();
  const nomMap = new Map<
    string,
    { name: string; unit: string; isService: boolean; vatRate: number }
  >();
  const whSet = new Set<string>();
  const expSet = new Set<string>();

  if (mode === 'clean_db' && db1C) {
    for (const c of db1C.counterparties) {
      const key = c.inn || c.name.toLowerCase();
      cpMap.set(key, {
        name: c.name,
        fullName: c.fullName || c.name,
        inn: c.inn,
        kpp: c.kpp,
        kind: c.kind || 'ЮридическоеЛицо',
      });
    }
    for (const ctr of db1C.contracts) {
      const key = `${ctr.counterpartyName.toLowerCase()}|${ctr.name.toLowerCase()}`;
      ctrMap.set(key, {
        name: ctr.name,
        number: ctr.number,
        date: ctr.date || db1C.periodStart,
        cpName: ctr.counterpartyName,
        cpInn: ctr.counterpartyInn || '',
        kind: ctr.contractKind || 'СПоставщиком',
      });
    }
    for (const n of db1C.nomenclature) {
      nomMap.set(n.name.toLowerCase(), {
        name: n.name,
        unit: n.unit || 'шт',
        isService: /услуг/i.test(n.itemKind),
        vatRate: db1C.accountingPolicy.vatRate,
      });
    }
    for (const w of db1C.warehouses) whSet.add(w.name);
    for (const e of db1C.expenseItems) expSet.add(e.name);
  }

  for (const op of activeNewOps) {
    const trimmedCp = op.counterpartyName.trim();
    if (
      trimmedCp.length >= 2 &&
      (mode === 'clean_db' ||
        op.bindings.counterparty.status === 'new_for_1c' ||
        Boolean(op.counterpartyBankAccount || op.counterpartyBik))
    ) {
      const key = op.counterpartyInn || trimmedCp.toLowerCase();
      const existing = cpMap.get(key);
      if (!existing) {
        cpMap.set(key, {
          name: trimmedCp,
          fullName: trimmedCp,
          inn: op.counterpartyInn,
          kpp: op.counterpartyKpp,
          kind: op.counterpartyKind,
          bankAccount: op.counterpartyBankAccount,
          bik: op.counterpartyBik,
          bankName: op.counterpartyBankName,
        });
      } else {
        if (!existing.bankAccount && op.counterpartyBankAccount) {
          existing.bankAccount = op.counterpartyBankAccount;
        }
        if (!existing.bik && op.counterpartyBik) {
          existing.bik = op.counterpartyBik;
          existing.bankName = op.counterpartyBankName;
        }
      }
    }

    if (
      trimmedCp.length >= 2 &&
      op.contractName &&
      (mode === 'clean_db' || op.bindings.contract.status === 'new_for_1c')
    ) {
      const key = `${op.counterpartyName.toLowerCase()}|${op.contractName.toLowerCase()}`;
      if (!ctrMap.has(key)) {
        const ctrKind =
          op.category === 'bank_in' ||
          op.category === 'sale_goods' ||
          op.category === 'sale_services'
            ? 'СПокупателем'
            : 'СПоставщиком';
        ctrMap.set(key, {
          name: op.contractName,
          number: op.contractNumber || '1',
          date: op.contractDate || op.date,
          cpName: op.counterpartyName,
          cpInn: op.counterpartyInn,
          kind: ctrKind,
        });
      }
    }

    if (
      op.nomenclatureName &&
      (mode === 'clean_db' || op.bindings.nomenclature.status === 'new_for_1c')
    ) {
      const key = op.nomenclatureName.toLowerCase();
      if (!nomMap.has(key)) {
        nomMap.set(key, {
          name: op.nomenclatureName,
          unit: 'шт',
          isService: op.category === 'purchase_services' || op.category === 'sale_services',
          vatRate: op.vatRate,
        });
      }
    }

    if (
      op.warehouseName &&
      (mode === 'clean_db' || op.bindings.warehouse.status === 'new_for_1c')
    ) {
      whSet.add(op.warehouseName);
    }

    if (
      op.expenseItemName &&
      (mode === 'clean_db' || op.bindings.expenseItem.status === 'new_for_1c')
    ) {
      expSet.add(op.expenseItemName);
    }
    if (op.warehouseToName && (mode === 'clean_db' || op.bindings.warehouse.status === 'new_for_1c')) {
      whSet.add(op.warehouseToName);
    }
  }

  // Opening balances lines for Mode B ('clean_db') — exclude unilateral off-balance accounts from double-entry 000
  const openingLines =
    mode === 'clean_db'
      ? osv.leafRows.filter(
          (r) =>
            !isOffBalanceAccountCode(r.code) &&
            (Math.abs(r.startDebit) >= 0.01 || Math.abs(r.startCredit) >= 0.01)
        )
      : [];

  // Only carry over DB postings in clean_db mode that belong to the active reporting period (>= effYear-01-01)
  const filteredDbPostingsForCleanMode =
    mode === 'clean_db' && db1C
      ? effYear
        ? db1C.postings.filter((p) => !p.date || p.date >= `${effYear}-01-01`)
        : db1C.postings
      : [];
  const dbPostingsCountInCleanMode = filteredDbPostingsForCleanMode.length;

  const bankAccountsCount =
    Array.from(cpMap.values()).filter((c) => Boolean(c.bankAccount || c.bik)).length +
    (activeNewOps.some((o) => o.entries.some((e) => e.debit === '51' || e.credit === '51')) ? 1 : 0);

  const stats: ExportStatsSummary = {
    mode,
    counterpartiesCount: cpMap.size,
    contractsCount: ctrMap.size,
    bankAccountsCount,
    nomenclatureCount: nomMap.size,
    warehousesCount: whSet.size,
    openingBalanceLinesCount: openingLines.length,
    documentsToPostCount:
      activeNewOps.length + (dbPostingsCountInCleanMode > 0 ? 1 : 0),
    entriesCount:
      activeNewOps.reduce((s, o) => s + o.entries.length, 0) + dbPostingsCountInCleanMode,
  };

  const bslCode = generateBslModule({
    mode,
    db1C,
    reportingYear: effYear,
    filteredDbPostings: filteredDbPostingsForCleanMode,
    activeNewOps,
    openingLines,
    cpList: Array.from(cpMap.values()),
    ctrList: Array.from(ctrMap.values()),
    nomList: Array.from(nomMap.values()),
    whList: Array.from(whSet),
    expList: Array.from(expSet),
  });

  const enterpriseDataXml = generateEnterpriseDataXml({
    mode,
    db1C,
    activeNewOps,
    cpList: Array.from(cpMap.values()),
    ctrList: Array.from(ctrMap.values()),
    nomList: Array.from(nomMap.values()),
  });

  const jsonSnapshot = JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      exportMode: mode,
      reportingYear: effYear ?? DEFAULT_REPORTING_YEAR,
      stats,
      db1C: fullState?.db1C ?? db1C,
      operations: fullState?.operations ?? operations,
      osvTotals: osv.totals,
    },
    null,
    2
  );

  return {
    stats,
    bslCode,
    enterpriseDataXml,
    jsonSnapshot,
  };
}

function generateBslModule(params: {
  mode: ExportMode1C;
  db1C: Database1CSnapshot | null;
  reportingYear?: number;
  filteredDbPostings: Database1CSnapshot['postings'];
  activeNewOps: QueuedOperation[];
  openingLines: OsvReport['leafRows'];
  cpList: Array<{
    name: string;
    fullName: string;
    inn: string;
    kpp: string;
    kind: string;
    bankAccount?: string;
    bik?: string;
    bankName?: string;
  }>;
  ctrList: Array<{ name: string; number: string; date: string; cpName: string; cpInn: string; kind: string }>;
  nomList: Array<{ name: string; unit: string; isService: boolean; vatRate: number }>;
  whList: string[];
  expList: string[];
}): string {
  const {
    mode,
    db1C,
    reportingYear,
    filteredDbPostings,
    activeNewOps,
    openingLines,
    cpList,
    ctrList,
    nomList,
    whList,
    expList,
  } = params;

  const org = db1C?.organization;
  const orgName = escapeBsl(org?.name || '');
  const orgFull = escapeBsl(org?.fullName || org?.name || '');
  const orgInn = escapeBsl(org?.inn || '');
  const orgKpp = escapeBsl(org?.kpp || '');
  const orgOgrn = escapeBsl(org?.ogrn || '');
  const orgDefaultBik = escapeBsl(
    org?.bik || activeNewOps.find((o) => o.organizationBik)?.organizationBik || DEFAULT_SBERBANK_BIK
  );
  const orgDefaultBankName = escapeBsl(
    org?.bankName ||
      activeNewOps.find((o) => o.organizationBankName)?.organizationBankName ||
      DEFAULT_SBERBANK_NAME
  );
  const orgDefaultAccount = escapeBsl(org?.bankAccount || '');
  const basePeriodStart = reportingYear
    ? `${reportingYear}-01-01`
    : db1C?.periodStart || activeNewOps[0]?.date || '2026-01-01';
  const openingDateIso = dayBeforeIso(basePeriodStart);

  const lines: string[] = [];
  lines.push('// ============================================================================');
  lines.push('// Автономный модуль загрузки данных в 1С:Предприятие 8.3 (Бухгалтерия 3.0)');
  lines.push(
    `// Режим выгрузки: ${
      mode === 'incremental'
        ? 'Режим А — Дозагрузка новых элементов и документов в текущую БД 1С'
        : 'Режим Б — Развёртывание с нуля в чистую БД 1С (Организация + Справочники + Ввод остатков + Документы)'
    }`
  );
  lines.push(`// Сформировано: ${new Date().toISOString()}`);
  lines.push('// Инструкция: Откройте обработку выполнения кода на сервере или создайте внешнюю');
  lines.push('// обработку в Конфигураторе, вставьте этот код в модуль и вызовите ВыполнитьЗагрузку().');
  lines.push('// ============================================================================');
  lines.push('');
  lines.push('&НаСервере');
  lines.push('Процедура ВыполнитьЗагрузку() Экспорт');
  lines.push('\tСчетчикСправочников = 0;');
  lines.push('\tСчетчикДокументов = 0;');
  lines.push('\tСчетчикОшибок = 0;');
  lines.push('');
  lines.push('\tСообщить("=== Старт загрузки в 1С:Бухгалтерия 8.3 (ред. 3.0) ===");');
  lines.push('');

  // Organization resolution
  lines.push('\t// 1. Определение рабочей Организации');
  lines.push(
    `\tОрганизацияСсылка = НайтиИлиСоздатьОрганизацию("${orgName}", "${orgFull}", "${orgInn}", "${orgKpp}", "${orgOgrn}", ${
      mode === 'clean_db' ? 'Истина' : 'Ложь'
    });`
  );
  lines.push('\tЕсли Не ЗначениеЗаполнено(ОрганизацияСсылка) Тогда');
  lines.push('\t\tСообщить("КРИТИЧЕСКАЯ ОШИБКА: Не найдена организация в базе 1С!");');
  lines.push('\t\tВозврат;');
  lines.push('\tКонецЕсли;');
  lines.push(
    `\tПопытка НайтиИлиСоздатьБанковскийСчет(ОрганизацияСсылка, "${orgDefaultBik}", "${orgDefaultBankName}", "${orgDefaultAccount}"); Исключение КонецПопытки;`
  );
  lines.push('');

  // Warehouses
  if (whList.length > 0) {
    lines.push('\t// 2. Справочник Склады');
    for (const wh of whList) {
      lines.push('\tПопытка');
      lines.push(`\t\tНайтиИлиСоздатьСклад("${escapeBsl(wh)}");`);
      lines.push('\t\tСчетчикСправочников = СчетчикСправочников + 1;');
      lines.push('\tИсключение');
      lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
      lines.push('\t\tСообщить("Ошибка создания склада: " + ОписаниеОшибки());');
      lines.push('\tКонецПопытки;');
    }
    lines.push('');
  }

  // Expense items
  if (expList.length > 0) {
    lines.push('\t// 3. Справочник Статьи затрат');
    for (const exp of expList) {
      lines.push('\tПопытка');
      lines.push(`\t\tНайтиИлиСоздатьСтатьюЗатрат("${escapeBsl(exp)}");`);
      lines.push('\t\tСчетчикСправочников = СчетчикСправочников + 1;');
      lines.push('\tИсключение');
      lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
      lines.push('\t\tСообщить("Ошибка создания статьи затрат: " + ОписаниеОшибки());');
      lines.push('\tКонецПопытки;');
    }
    lines.push('');
  }

  // Counterparties & Counterparty Bank Accounts
  if (cpList.length > 0) {
    lines.push('\t// 4. Справочник Контрагенты и их Банковские счета (поиск по ИНН / Наименованию без дублей)');
    for (const cp of cpList) {
      lines.push('\tПопытка');
      lines.push(
        `\t\tКонтрОбъектСсылка = НайтиИлиСоздатьКонтрагента("${escapeBsl(cp.name)}", "${escapeBsl(
          cp.fullName
        )}", "${escapeBsl(cp.inn)}", "${escapeBsl(cp.kpp)}", "${escapeBsl(cp.kind)}");`
      );
      if (cp.bik || cp.bankAccount) {
        const effCpBik = escapeBsl(cp.bik || DEFAULT_SBERBANK_BIK);
        const effCpBank = escapeBsl(cp.bankName || DEFAULT_SBERBANK_NAME);
        lines.push(
          `\t\tНайтиИлиСоздатьБанковскийСчет(КонтрОбъектСсылка, "${effCpBik}", "${effCpBank}", "${escapeBsl(
            cp.bankAccount || ''
          )}");`
        );
      }
      lines.push('\t\tСчетчикСправочников = СчетчикСправочников + 1;');
      lines.push('\tИсключение');
      lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
      lines.push(
        `\t\tСообщить("Ошибка контрагента [${escapeBsl(cp.name)}]: " + ОписаниеОшибки());`
      );
      lines.push('\tКонецПопытки;');
    }
    lines.push('');
  }

  // Contracts
  if (ctrList.length > 0) {
    lines.push('\t// 5. Справочник Договоры контрагентов');
    for (const ctr of ctrList) {
      lines.push('\tПопытка');
      lines.push(
        `\t\tКонтрСсылка = НайтиИлиСоздатьКонтрагента("${escapeBsl(ctr.cpName)}", "${escapeBsl(
          ctr.cpName
        )}", "${escapeBsl(ctr.cpInn)}", "", "ЮридическоеЛицо");`
      );
      lines.push(
        `\t\tНайтиИлиСоздатьДоговор(ОрганизацияСсылка, КонтрСсылка, "${escapeBsl(
          ctr.name
        )}", "${escapeBsl(ctr.number)}", ${toBslDateExpr(ctr.date)}, "${escapeBsl(ctr.kind)}");`
      );
      lines.push('\t\tСчетчикСправочников = СчетчикСправочников + 1;');
      lines.push('\tИсключение');
      lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
      lines.push(
        `\t\tСообщить("Ошибка договора [${escapeBsl(ctr.name)}]: " + ОписаниеОшибки());`
      );
      lines.push('\tКонецПопытки;');
    }
    lines.push('');
  }

  // Nomenclature
  if (nomList.length > 0) {
    lines.push('\t// 6. Справочник Номенклатура');
    for (const nom of nomList) {
      lines.push('\tПопытка');
      lines.push(
        `\t\tНайтиИлиСоздатьНоменклатуру("${escapeBsl(nom.name)}", ${
          nom.isService ? 'Истина' : 'Ложь'
        }, "${to1CVatEnumName(nom.vatRate, nom.vatRate > 0 ? 'included' : 'none')}");`
      );
      lines.push('\t\tСчетчикСправочников = СчетчикСправочников + 1;');
      lines.push('\tИсключение');
      lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
      lines.push(
        `\t\tСообщить("Ошибка номенклатуры [${escapeBsl(nom.name)}]: " + ОписаниеОшибки());`
      );
      lines.push('\tКонецПопытки;');
    }
    lines.push('');
  }

  // Mode B: Opening balances via auxiliary account 000 + historical DB postings
  if (mode === 'clean_db' && openingLines.length > 0) {
    lines.push('\t// 7. Ввод начальных остатков (в корреспонденции со вспомогательным счётом 000)');
    lines.push('\tПопытка');
    lines.push('\t\tДокОст = Документы.ОперацияБух.СоздатьДокумент();');
    lines.push(`\t\tДокОст.Дата = ${toBslDateExpr(openingDateIso, true)};`);
    lines.push('\t\tДокОст.Организация = ОрганизацияСсылка;');
    lines.push('\t\tДокОст.Содержание = "Ввод начальных остатков по данным выгрузки 1С";');
    lines.push(
      `\t\tДокОст.СуммаОперации = ${openingLines
        .reduce((s, r) => s + Math.abs(r.startDebit) + Math.abs(r.startCredit), 0)
        .toFixed(2)};`
    );
    lines.push('\t\tСчет000 = ПланыСчетов.Хозрасчетный.НайтиПоКоду("000");');
    for (const row of openingLines) {
      if (Math.abs(row.startDebit) >= 0.01) {
        lines.push('\t\tДвиж = ДокОст.Движения.Хозрасчетный.Добавить();');
        lines.push(`\t\tДвиж.Период = ${toBslDateExpr(openingDateIso, true)};`);
        lines.push('\t\tДвиж.Организация = ОрганизацияСсылка;');
        lines.push(`\t\tДвиж.СчетДт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(row.code)}");`);
        lines.push('\t\tДвиж.СчетКт = Счет000;');
        lines.push(`\t\tДвиж.Сумма = ${row.startDebit.toFixed(2)};`);
        lines.push(`\t\tДвиж.Содержание = "Ввод начального остатка по счёту ${escapeBsl(row.code)}";`);
      }
      if (Math.abs(row.startCredit) >= 0.01) {
        lines.push('\t\tДвиж = ДокОст.Движения.Хозрасчетный.Добавить();');
        lines.push(`\t\tДвиж.Период = ${toBslDateExpr(openingDateIso, true)};`);
        lines.push('\t\tДвиж.Организация = ОрганизацияСсылка;');
        lines.push('\t\tДвиж.СчетДт = Счет000;');
        lines.push(`\t\tДвиж.СчетКт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(row.code)}");`);
        lines.push(`\t\tДвиж.Сумма = ${row.startCredit.toFixed(2)};`);
        lines.push(`\t\tДвиж.Содержание = "Ввод начального остатка по счёту ${escapeBsl(row.code)}";`);
      }
    }
    lines.push('\t\tДокОст.Записать(РежимЗаписиДокумента.Запись);');
    lines.push('\t\tДокОст.Движения.Записать();');
    lines.push('\t\tСчетчикДокументов = СчетчикДокументов + 1;');
    lines.push('\t\tСообщить("Записан ввод начальных остатков на дату " + Формат(ДокОст.Дата, "ДФ=dd.MM.yyyy"));');
    lines.push('\tИсключение');
    lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
    lines.push('\t\tСообщить("Ошибка ввода начальных остатков: " + ОписаниеОшибки());');
    lines.push('\tКонецПопытки;');
    lines.push('');
  }

  if (mode === 'clean_db' && filteredDbPostings.length > 0) {
    const histDateIso = filteredDbPostings[0]?.date || basePeriodStart;
    lines.push('\t// 8. Перенос проводок отчётного периода из исходной базы 1С');
    lines.push('\tПопытка');
    lines.push('\t\tДокИст = Документы.ОперацияБух.СоздатьДокумент();');
    lines.push(`\t\tДокИст.Дата = ${toBslDateExpr(histDateIso)};`);
    lines.push('\t\tДокИст.Организация = ОрганизацияСсылка;');
    lines.push('\t\tДокИст.Содержание = "Перенос проводок периода из исходной базы 1С";');
    lines.push(
      `\t\tДокИст.СуммаОперации = ${filteredDbPostings
        .reduce((s, p) => s + p.amount, 0)
        .toFixed(2)};`
    );
    for (const p of filteredDbPostings) {
      lines.push('\t\tДвиж = ДокИст.Движения.Хозрасчетный.Добавить();');
      lines.push(`\t\tДвиж.Период = ${toBslDateExpr(p.date || histDateIso)};`);
      lines.push('\t\tДвиж.Организация = ОрганизацияСсылка;');
      lines.push(`\t\tДвиж.СчетДт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(p.debit)}");`);
      lines.push(`\t\tДвиж.СчетКт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(p.credit)}");`);
      lines.push(`\t\tДвиж.Сумма = ${p.amount.toFixed(2)};`);
      lines.push(`\t\tДвиж.Содержание = "${escapeBsl(p.description)}";`);
    }
    lines.push('\t\tДокИст.Записать(РежимЗаписиДокумента.Запись);');
    lines.push('\t\tДокИст.Движения.Записать();');
    lines.push('\t\tСчетчикДокументов = СчетчикДокументов + 1;');
    lines.push('\tИсключение');
    lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
    lines.push('\t\tСообщить("Ошибка переноса исторических проводок: " + ОписаниеОшибки());');
    lines.push('\tКонецПопытки;');
    lines.push('');
  }

  // Queued Documents & Postings
  lines.push('\t// Проведение новых и корректирующих документов периода');
  activeNewOps.forEach((op, index) => {
    const idx = index + 1;
    const dateExpr = toBslDateExpr(op.date, op.category === 'closing');
    const cpEsc = escapeBsl(op.counterpartyName);
    const innEsc = escapeBsl(op.counterpartyInn);
    const kppEsc = escapeBsl(op.counterpartyKpp);
    const ctrEsc = escapeBsl(op.contractName || 'Основной договор');
    const descEsc = escapeBsl(op.description);
    const vatEnum = to1CVatEnumName(op.vatRate, op.vatRule);
    const netAmount = Math.max(0, Math.round((op.amount - op.vatAmount) * 100) / 100);

    lines.push(`\t// --- Документ #${idx}: ${op.docType1C} (${descEsc.slice(0, 70)}) ---`);
    lines.push('\tПопытка');

    if (op.docType1C === 'СписаниеСРасчетногоСчета') {
      lines.push('\t\tДок = Документы.СписаниеСРасчетногоСчета.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      if (op.category === 'tax_payment') {
        lines.push('\t\tДок.ВидОперации = Перечисления.ВидыОперацийСписаниеДенежныхСредств.УплатаНалога;');
      } else if (op.category === 'bank_fee') {
        lines.push('\t\tДок.ВидОперации = Перечисления.ВидыОперацийСписаниеДенежныхСредств.КомиссияБанка;');
      } else if (op.category === 'payroll_payout') {
        lines.push('\t\tДок.ВидОперации = Перечисления.ВидыОперацийСписаниеДенежныхСредств.ПеречислениеЗаработнойПлатыПоВедомостям;');
      } else {
        lines.push('\t\tДок.ВидОперации = Перечисления.ВидыОперацийСписаниеДенежныхСредств.ОплатаПоставщику;');
      }
      if (cpEsc) {
        lines.push(
          `\t\tДок.Контрагент = НайтиИлиСоздатьКонтрагента("${cpEsc}", "${cpEsc}", "${innEsc}", "${kppEsc}", "${op.counterpartyKind}");`
        );
        lines.push(
          `\t\tДок.ДоговорКонтрагента = НайтиИлиСоздатьДоговор(ОрганизацияСсылка, Док.Контрагент, "${ctrEsc}", "${escapeBsl(
            op.contractNumber || '1'
          )}", ${dateExpr}, "СПоставщиком");`
        );
      }
      lines.push(`\t\tДок.СуммаДокумента = ${op.amount.toFixed(2)};`);
      lines.push('\t\tДок.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("51");');
      const targetDebit = op.entries[0]?.debit || '60.01';
      lines.push(
        `\t\tПопытка Док.СчетРасчетов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(
          targetDebit
        )}"); Исключение КонецПопытки;`
      );
      if (op.cashFlowItemName) {
        lines.push(
          `\t\tДок.СтатьяДвиженияДенежныхСредств = НайтиИлиСоздатьСтатьюДДС("${escapeBsl(
            op.cashFlowItemName
          )}");`
        );
      }
      if (op.docNumber) {
        lines.push(`\t\tДок.НомерВходящегоДокумента = "${escapeBsl(op.docNumber)}";`);
      }
      lines.push(`\t\tДок.НазначениеПлатежа = "${descEsc}";`);
      lines.push(`\t\tДок.Комментарий = "Загружено из рабочего места бухгалтера: ${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ПоступлениеНаРасчетныйСчет') {
      lines.push('\t\tДок = Документы.ПоступлениеНаРасчетныйСчет.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(
        '\t\tДок.ВидОперации = Перечисления.ВидыОперацийПоступлениеДенежныхСредств.ОплатаОтПокупателя;'
      );
      if (cpEsc) {
        lines.push(
          `\t\tДок.Контрагент = НайтиИлиСоздатьКонтрагента("${cpEsc}", "${cpEsc}", "${innEsc}", "${kppEsc}", "${op.counterpartyKind}");`
        );
        lines.push(
          `\t\tДок.ДоговорКонтрагента = НайтиИлиСоздатьДоговор(ОрганизацияСсылка, Док.Контрагент, "${ctrEsc}", "${escapeBsl(
            op.contractNumber || '1'
          )}", ${dateExpr}, "СПокупателем");`
        );
      }
      lines.push(`\t\tДок.СуммаДокумента = ${op.amount.toFixed(2)};`);
      lines.push(`\t\tДок.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
      lines.push(`\t\tДок.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
      lines.push('\t\tДок.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("51");');
      lines.push('\t\tДок.СчетРасчетов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("62.01");');
      lines.push('\t\tДок.СчетАвансов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("62.02");');
      if (op.cashFlowItemName) {
        lines.push(
          `\t\tДок.СтатьяДвиженияДенежныхСредств = НайтиИлиСоздатьСтатьюДДС("${escapeBsl(
            op.cashFlowItemName
          )}");`
        );
      }
      lines.push(`\t\tДок.НазначениеПлатежа = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ПоступлениеТоваровУслуг') {
      const isService = op.category === 'purchase_services';
      const isEquipment = op.category === 'purchase_equipment';
      lines.push('\t\tДок = Документы.ПоступлениеТоваровУслуг.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(
        `\t\tДок.ВидОперации = Перечисления.ВидыОперацийПоступлениеТоваровУслуг.${
          isService ? 'Услуги' : isEquipment ? 'Оборудование' : 'Товары'
        };`
      );
      lines.push(
        `\t\tДок.Контрагент = НайтиИлиСоздатьКонтрагента("${cpEsc}", "${cpEsc}", "${innEsc}", "${kppEsc}", "${op.counterpartyKind}");`
      );
      lines.push(
        `\t\tДок.ДоговорКонтрагента = НайтиИлиСоздатьДоговор(ОрганизацияСсылка, Док.Контрагент, "${ctrEsc}", "${escapeBsl(
          op.contractNumber || '1'
        )}", ${dateExpr}, "СПоставщиком");`
      );
      if (op.warehouseName && !isService) {
        lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName)}");`);
      }
      lines.push('\t\tДок.СуммаВключаетНДС = Истина;');
      lines.push('\t\tДок.СчетУчетаРасчетовСКонтрагентом = ПланыСчетов.Хозрасчетный.НайтиПоКоду("60.01");');
      lines.push('\t\tДок.СчетУчетаРасчетовПоАвансам = ПланыСчетов.Хозрасчетный.НайтиПоКоду("60.02");');
      const nomItem = escapeBsl(op.nomenclatureName || op.description.slice(0, 80));
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const price = Math.round((op.amount / qty) * 100) / 100;
      const mainDebitAcc =
        op.entries[0]?.debit || (isService ? '26' : isEquipment ? '08.04.1' : '41.01');
      if (isService) {
        lines.push('\t\tСтр = Док.Услуги.Добавить();');
        lines.push(
          `\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Истина, "${vatEnum}");`
        );
        lines.push(`\t\tСтр.Содержание = "${descEsc}";`);
        lines.push(`\t\tСтр.Количество = ${qty};`);
        lines.push(`\t\tСтр.Цена = ${price.toFixed(2)};`);
        lines.push(`\t\tСтр.Сумма = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
        lines.push(`\t\tСтр.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push(
          `\t\tСтр.СчетЗатрат = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(mainDebitAcc)}");`
        );
        if (op.expenseItemName) {
          lines.push(
            `\t\tСтр.Субконто1 = НайтиИлиСоздатьСтатьюЗатрат("${escapeBsl(op.expenseItemName)}");`
          );
        }
        lines.push('\t\tСтр.СчетУчетаНДС = ПланыСчетов.Хозрасчетный.НайтиПоКоду("19.04");');
      } else if (isEquipment) {
        lines.push('\t\tСтр = Док.Оборудование.Добавить();');
        lines.push(
          `\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "${vatEnum}");`
        );
        lines.push(`\t\tСтр.Количество = ${qty};`);
        lines.push(`\t\tСтр.Цена = ${price.toFixed(2)};`);
        lines.push(`\t\tСтр.Сумма = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
        lines.push(`\t\tСтр.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push('\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("08.04.1");');
        lines.push('\t\tСтр.СчетУчетаНДС = ПланыСчетов.Хозрасчетный.НайтиПоКоду("19.01");');
      } else {
        lines.push('\t\tСтр = Док.Товары.Добавить();');
        lines.push(
          `\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "${vatEnum}");`
        );
        lines.push(`\t\tСтр.Количество = ${qty};`);
        lines.push(`\t\tСтр.Цена = ${price.toFixed(2)};`);
        lines.push(`\t\tСтр.Сумма = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
        lines.push(`\t\tСтр.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push(
          `\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(mainDebitAcc)}");`
        );
        lines.push('\t\tСтр.СчетУчетаНДС = ПланыСчетов.Хозрасчетный.НайтиПоКоду("19.03");');
      }
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');

      if (op.hasInvoiceSF && op.vatAmount > 0) {
        lines.push('\t\tСФ = Документы.СчетФактураПолученный.СоздатьДокумент();');
        lines.push(`\t\tСФ.Дата = ${dateExpr};`);
        lines.push('\t\tСФ.Организация = ОрганизацияСсылка;');
        lines.push('\t\tСФ.Контрагент = Док.Контрагент;');
        lines.push('\t\tСФ.ДокументОснование = Док.Ссылка;');
        lines.push(`\t\tСФ.НомерВходящегоДокумента = "${escapeBsl(op.docNumber || '1')}";`);
        lines.push(`\t\tСФ.ДатаВходящегоДокумента = ${dateExpr};`);
        lines.push('\t\tСФ.ОтразитьВычетНДСВЖурналеДокументов = Истина;');
        lines.push('\t\tСФ.Записать(РежимЗаписиДокумента.Проведение);');
      }
    } else if (op.docType1C === 'РеализацияТоваровУслуг') {
      const isService = op.category === 'sale_services';
      lines.push('\t\tДок = Документы.РеализацияТоваровУслуг.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(
        `\t\tДок.ВидОперации = Перечисления.ВидыОперацийРеализацияТоваров.${
          isService ? 'Услуги' : 'Товары'
        };`
      );
      lines.push(
        `\t\tДок.Контрагент = НайтиИлиСоздатьКонтрагента("${cpEsc}", "${cpEsc}", "${innEsc}", "${kppEsc}", "${op.counterpartyKind}");`
      );
      lines.push(
        `\t\tДок.ДоговорКонтрагента = НайтиИлиСоздатьДоговор(ОрганизацияСсылка, Док.Контрагент, "${ctrEsc}", "${escapeBsl(
          op.contractNumber || '1'
        )}", ${dateExpr}, "СПокупателем");`
      );
      if (op.warehouseName && !isService) {
        lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName)}");`);
      }
      lines.push('\t\tДок.СуммаВключаетНДС = Истина;');
      lines.push('\t\tДок.СчетУчетаРасчетовСКонтрагентом = ПланыСчетов.Хозрасчетный.НайтиПоКоду("62.01");');
      lines.push('\t\tДок.СчетУчетаРасчетовПоАвансам = ПланыСчетов.Хозрасчетный.НайтиПоКоду("62.02");');
      const nomItem = escapeBsl(op.nomenclatureName || op.description.slice(0, 80));
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const price = Math.round((op.amount / qty) * 100) / 100;
      if (isService) {
        lines.push('\t\tСтр = Док.Услуги.Добавить();');
        lines.push(
          `\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Истина, "${vatEnum}");`
        );
        lines.push(`\t\tСтр.Содержание = "${descEsc}";`);
        lines.push(`\t\tСтр.Количество = ${qty};`);
        lines.push(`\t\tСтр.Цена = ${price.toFixed(2)};`);
        lines.push(`\t\tСтр.Сумма = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
        lines.push(`\t\tСтр.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push('\t\tСтр.СчетДоходов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("90.01.1");');
        lines.push('\t\tСтр.СчетУчетаНДСПоРеализации = ПланыСчетов.Хозрасчетный.НайтиПоКоду("90.03");');
      } else {
        lines.push('\t\tСтр = Док.Товары.Добавить();');
        lines.push(
          `\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "${vatEnum}");`
        );
        lines.push(`\t\tСтр.Количество = ${qty};`);
        lines.push(`\t\tСтр.Цена = ${price.toFixed(2)};`);
        lines.push(`\t\tСтр.Сумма = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.СтавкаНДС = Перечисления.СтавкиНДС.${vatEnum};`);
        lines.push(`\t\tСтр.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push('\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("41.01");');
        lines.push('\t\tСтр.СчетДоходов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("90.01.1");');
        lines.push('\t\tСтр.СчетРасходов = ПланыСчетов.Хозрасчетный.НайтиПоКоду("90.02.1");');
        lines.push('\t\tСтр.СчетУчетаНДСПоРеализации = ПланыСчетов.Хозрасчетный.НайтиПоКоду("90.03");');
      }
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');

      if (op.vatAmount > 0) {
        lines.push('\t\tСФВыд = Документы.СчетФактураВыданный.СоздатьДокумент();');
        lines.push(`\t\tСФВыд.Дата = ${dateExpr};`);
        lines.push('\t\tСФВыд.Организация = ОрганизацияСсылка;');
        lines.push('\t\tСФВыд.Контрагент = Док.Контрагент;');
        lines.push('\t\tСФВыд.ДокументОснование = Док.Ссылка;');
        lines.push(`\t\tСФВыд.СуммаДокумента = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСФВыд.СуммаНДС = ${op.vatAmount.toFixed(2)};`);
        lines.push('\t\tСФВыд.Записать(РежимЗаписиДокумента.Проведение);');
      }
    } else if (op.docType1C === 'РасходМатериалов') {
      const nomItem = escapeBsl(op.nomenclatureName || 'Материалы');
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const costAcc = escapeBsl(op.costAccount || op.entries[0]?.debit || '20.01');
      const matAcc = escapeBsl(op.materialAccount || op.entries[0]?.credit || '10.01');
      lines.push('\t\tДок = Документы.РасходМатериалов.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push('\t\tПопытка Док.ВидОперации = Перечисления.ВидыОперацийРасходМатериалов.ИспользованиеМатериалов; Исключение КонецПопытки;');
      lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName || 'Основной склад')}");`);
      lines.push(`\t\tДок.СчетЗатрат = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${costAcc}");`);
      if (op.nomenclatureGroupName) {
        lines.push(
          `\t\tПопытка Док.Субконто1 = НайтиИлиСоздатьНоменклатурнуюГруппу("${escapeBsl(op.nomenclatureGroupName)}"); Исключение КонецПопытки;`
        );
      }
      if (op.expenseItemName) {
        lines.push(
          `\t\tПопытка Док.Субконто2 = НайтиИлиСоздатьСтатьюЗатрат("${escapeBsl(op.expenseItemName)}"); Исключение КонецПопытки;`
        );
      }
      lines.push('\t\tСтр = Док.Материалы.Добавить();');
      lines.push(`\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "БезНДС");`);
      lines.push(`\t\tСтр.Количество = ${qty};`);
      lines.push(`\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${matAcc}");`);
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ПередачаМатериаловВЭксплуатацию') {
      const nomItem = escapeBsl(op.nomenclatureName || 'Спецодежда');
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const empName = escapeBsl(op.employeeName || 'Сотрудник производства');
      const matAcc = escapeBsl(op.materialAccount || '10.10');
      const isInventory = matAcc === '10.09' || op.offBalanceAccount === 'МЦ.04';
      lines.push('\t\tДок = Документы.ПередачаМатериаловВЭксплуатацию.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName || 'Основной склад')}");`);
      lines.push(
        `\t\tСтр = Док.${isInventory ? 'ИнвентарьИХозяйственныеПринадлежности' : 'Спецодежда'}.Добавить();`
      );
      lines.push(`\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "БезНДС");`);
      lines.push(`\t\tСтр.Количество = ${qty};`);
      lines.push(`\t\tСтр.ФизическоеЛицо = НайтиИлиСоздатьФизлицо("${empName}");`);
      lines.push(`\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${matAcc}");`);
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ПеремещениеТоваров') {
      const nomItem = escapeBsl(op.nomenclatureName || 'Материалы');
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const matAcc = escapeBsl(op.materialAccount || op.entries[0]?.debit || '10.01');
      lines.push('\t\tДок = Документы.ПеремещениеТоваров.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(`\t\tДок.СкладОтправитель = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName || 'Основной склад')}");`);
      lines.push(`\t\tДок.СкладПолучатель = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseToName || 'Производственный склад')}");`);
      lines.push('\t\tСтр = Док.Товары.Добавить();');
      lines.push(`\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "БезНДС");`);
      lines.push(`\t\tСтр.Количество = ${qty};`);
      lines.push(`\t\tСтр.СчетУчетаОтправителя = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${matAcc}");`);
      lines.push(`\t\tСтр.СчетУчетаПолучателя = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${matAcc}");`);
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ВыпускПродукции') {
      const nomItem = escapeBsl(op.nomenclatureName || 'Готовая продукция');
      const qty = op.quantity && op.quantity > 0 ? op.quantity : 1;
      const costAcc = escapeBsl(op.costAccount || '20.01');
      lines.push('\t\tДок = Документы.ОтчетПроизводстваЗаСмену.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName || 'Основной склад')}");`);
      lines.push(`\t\tДок.СчетЗатрат = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${costAcc}");`);
      lines.push('\t\tСтр = Док.Продукция.Добавить();');
      lines.push(`\t\tСтр.Номенклатура = НайтиИлиСоздатьНоменклатуру("${nomItem}", Ложь, "БезНДС");`);
      lines.push(`\t\tСтр.Количество = ${qty};`);
      if (op.amount >= 0.01) {
        lines.push(`\t\tСтр.СуммаПлановая = ${op.amount.toFixed(2)};`);
        lines.push(`\t\tСтр.ЦенаПлановая = ${(Math.round((op.amount / qty) * 100) / 100).toFixed(2)};`);
      }
      lines.push('\t\tСтр.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("43");');
      if (op.nomenclatureGroupName) {
        lines.push(
          `\t\tПопытка Стр.НоменклатурнаяГруппа = НайтиИлиСоздатьНоменклатурнуюГруппу("${escapeBsl(op.nomenclatureGroupName)}"); Исключение КонецПопытки;`
        );
      }
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else if (op.docType1C === 'ПринятиеКУчетуОС') {
      const osItem = escapeBsl(op.nomenclatureName || 'Объект основных средств');
      lines.push('\t\tДок = Документы.ПринятиеКУчетуОС.СоздатьДокумент();');
      lines.push(`\t\tДок.Дата = ${dateExpr};`);
      lines.push('\t\tДок.Организация = ОрганизацияСсылка;');
      lines.push('\t\tПопытка Док.ВидОперации = Перечисления.ВидыОперацийПринятиеКУчетуОС.Оборудование; Исключение КонецПопытки;');
      lines.push(`\t\tДок.Склад = НайтиИлиСоздатьСклад("${escapeBsl(op.warehouseName || 'Основной склад')}");`);
      lines.push(`\t\tДок.Оборудование = НайтиИлиСоздатьНоменклатуру("${osItem}", Ложь, "БезНДС");`);
      lines.push('\t\tДок.СчетУчета = ПланыСчетов.Хозрасчетный.НайтиПоКоду("08.04.1");');
      lines.push('\t\tДок.СчетУчетаБУ = ПланыСчетов.Хозрасчетный.НайтиПоКоду("01.01");');
      lines.push('\t\tДок.СчетНачисленияАмортизацииБУ = ПланыСчетов.Хозрасчетный.НайтиПоКоду("02.01");');
      lines.push(`\t\tСтрОС = Док.ОсновныеСредства.Добавить();`);
      lines.push(`\t\tСтрОС.ОсновноеСредство = НайтиИлиСоздатьОсновноеСредство("${osItem}");`);
      lines.push(`\t\tДок.Комментарий = "${descEsc}";`);
      lines.push('\t\tДок.Записать(РежимЗаписиДокумента.Проведение);');
    } else {
      // Universal ОперацияБух for НачислениеЗарплаты, КорректировкаДолга, ЗакрытиеМесяца, СФ на аванс, Касса, ручные операции
      // Guarantees exact RSBU double-entry (and unilateral off-balance МЦ) movements in РегистрБухгалтерии.Хозрасчетный
      void netAmount;
      lines.push('\t\tДокОп = Документы.ОперацияБух.СоздатьДокумент();');
      lines.push(`\t\tДокОп.Дата = ${dateExpr};`);
      lines.push('\t\tДокОп.Организация = ОрганизацияСсылка;');
      lines.push(`\t\tДокОп.Содержание = "${descEsc}";`);
      lines.push(
        `\t\tДокОп.СуммаОперации = ${op.entries
          .filter((e) => !e.isOffBalance)
          .reduce((s, e) => s + e.amount, 0)
          .toFixed(2)};`
      );
      for (const entry of op.entries) {
        lines.push('\t\tДвиж = ДокОп.Движения.Хозрасчетный.Добавить();');
        lines.push(`\t\tДвиж.Период = ${dateExpr};`);
        lines.push('\t\tДвиж.Организация = ОрганизацияСсылка;');
        if (entry.debit) {
          lines.push(
            `\t\tДвиж.СчетДт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(entry.debit)}");`
          );
        }
        if (entry.credit && !entry.isOffBalance) {
          lines.push(
            `\t\tДвиж.СчетКт = ПланыСчетов.Хозрасчетный.НайтиПоКоду("${escapeBsl(entry.credit)}");`
          );
        }
        lines.push(`\t\tДвиж.Сумма = ${entry.amount.toFixed(2)};`);
        lines.push(`\t\tДвиж.Содержание = "${escapeBsl(entry.description || op.description)}";`);
      }
      lines.push('\t\tДокОп.Записать(РежимЗаписиДокумента.Запись);');
      lines.push('\t\tДокОп.Движения.Записать();');
    }

    lines.push('\t\tСчетчикДокументов = СчетчикДокументов + 1;');
    lines.push('\tИсключение');
    lines.push('\t\tСчетчикОшибок = СчетчикОшибок + 1;');
    lines.push(
      `\t\tСообщить("Ошибка проведения документа #${idx} [${op.docType1C}]: " + ОписаниеОшибки());`
    );
    lines.push('\tКонецПопытки;');
    lines.push('');
  });

  lines.push(
    '\tСообщить("=== Загрузка завершена. Справочников обработано: " + СчетчикСправочников + ", Документов проведено: " + СчетчикДокументов + ", Ошибок: " + СчетчикОшибок + " ===");'
  );
  lines.push('КонецПроцедуры');
  lines.push('');

  // Helper BSL Functions
  lines.push('// --- Вспомогательные идемпотентные функции поиска и создания элементов 1С БП 3.0 ---');
  lines.push('&НаСервере');
  lines.push(
    'Функция НайтиИлиСоздатьОрганизацию(Наименование, ПолноеНаименование, ИНН, КПП, ОГРН, РазрешитьСоздание)'
  );
  lines.push('\tЕсли ЗначениеЗаполнено(ИНН) Тогда');
  lines.push('\t\tНайденная = Справочники.Организации.НайтиПоРеквизиту("ИНН", ИНН);');
  lines.push('\t\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tКонецЕсли;');
  lines.push('\tЕсли ЗначениеЗаполнено(Наименование) Тогда');
  lines.push('\t\tНайденная = Справочники.Организации.НайтиПоНаименованию(Наименование);');
  lines.push('\t\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tКонецЕсли;');
  lines.push('\tЕсли Не РазрешитьСоздание Тогда');
  lines.push('\t\tВыборка = Справочники.Организации.Выбрать();');
  lines.push('\t\tПока Выборка.Следующий() Цикл');
  lines.push('\t\t\tЕсли Не Выборка.ПометкаУдаления Тогда Возврат Выборка.Ссылка; КонецЕсли;');
  lines.push('\t\tКонецЦикла;');
  lines.push('\tКонецЕсли;');
  lines.push('\tОбъектОрг = Справочники.Организации.СоздатьЭлемент();');
  lines.push('\tОбъектОрг.Наименование = ?(ЗначениеЗаполнено(Наименование), Наименование, "Организация");');
  lines.push('\tОбъектОрг.НаименованиеСокращенное = ОбъектОрг.Наименование;');
  lines.push('\tОбъектОрг.НаименованиеПолное = ?(ЗначениеЗаполнено(ПолноеНаименование), ПолноеНаименование, ОбъектОрг.Наименование);');
  lines.push('\tОбъектОрг.ИНН = ИНН;');
  lines.push('\tОбъектОрг.КПП = КПП;');
  lines.push('\tОбъектОрг.ОГРН = ОГРН;');
  lines.push('\tОбъектОрг.ЮридическоеФизическоеЛицо = Перечисления.ЮридическоеФизическоеЛицо.ЮридическоеЛицо;');
  lines.push('\tОбъектОрг.Записать();');
  lines.push('\tВозврат ОбъектОрг.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push(
    'Функция НайтиИлиСоздатьКонтрагента(Наименование, ПолноеНаименование, ИНН, КПП, ВидЮрФиз)'
  );
  lines.push('\tЕсли ЗначениеЗаполнено(ИНН) Тогда');
  lines.push('\t\tНайденный = Справочники.Контрагенты.НайтиПоРеквизиту("ИНН", ИНН);');
  lines.push('\t\tЕсли ЗначениеЗаполнено(Найденный) Тогда Возврат Найденный; КонецЕсли;');
  lines.push('\tКонецЕсли;');
  lines.push('\tЕсли ЗначениеЗаполнено(Наименование) Тогда');
  lines.push('\t\tНайденный = Справочники.Контрагенты.НайтиПоНаименованию(Наименование);');
  lines.push('\t\tЕсли ЗначениеЗаполнено(Найденный) Тогда Возврат Найденный; КонецЕсли;');
  lines.push('\tКонецЕсли;');
  lines.push('\tНов = Справочники.Контрагенты.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.НаименованиеПолное = ?(ЗначениеЗаполнено(ПолноеНаименование), ПолноеНаименование, Наименование);');
  lines.push('\tНов.ИНН = ИНН;');
  lines.push('\tНов.КПП = КПП;');
  lines.push('\tЕсли ВидЮрФиз = "ФизическоеЛицо" Или ВидЮрФиз = "ИндивидуальныйПредприниматель" Тогда');
  lines.push('\t\tНов.ЮридическоеФизическоеЛицо = Перечисления.ЮридическоеФизическоеЛицо.ФизическоеЛицо;');
  lines.push('\tИначе');
  lines.push('\t\tНов.ЮридическоеФизическоеЛицо = Перечисления.ЮридическоеФизическоеЛицо.ЮридическоеЛицо;');
  lines.push('\tКонецЕсли;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push(
    'Функция НайтиИлиСоздатьДоговор(Организация, Контрагент, НаименованиеДоговора, НомерДоговора, ДатаДоговора, ВидДоговораСтр)'
  );
  lines.push('\tНайденный = Справочники.ДоговорыКонтрагентов.НайтиПоНаименованию(НаименованиеДоговора, Истина, , Контрагент);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденный) Тогда Возврат Найденный; КонецЕсли;');
  lines.push('\tНов = Справочники.ДоговорыКонтрагентов.СоздатьЭлемент();');
  lines.push('\tНов.Владелец = Контрагент;');
  lines.push('\tНов.Организация = Организация;');
  lines.push('\tНов.Наименование = НаименованиеДоговора;');
  lines.push('\tНов.Номер = НомерДоговора;');
  lines.push('\tНов.Дата = ДатаДоговора;');
  lines.push('\tЕсли ВидДоговораСтр = "СПокупателем" Тогда');
  lines.push('\t\tНов.ВидДоговора = Перечисления.ВидыДоговоровКонтрагентов.СПокупателем;');
  lines.push('\tИначе');
  lines.push('\t\tНов.ВидДоговора = Перечисления.ВидыДоговоровКонтрагентов.СПоставщиком;');
  lines.push('\tКонецЕсли;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьНоменклатуру(Наименование, ЭтоУслуга, СтавкаНДССтр)');
  lines.push('\tНайденная = Справочники.Номенклатура.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tНов = Справочники.Номенклатура.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.НаименованиеПолное = Наименование;');
  lines.push('\tНов.Услуга = ЭтоУслуга;');
  lines.push('\tПопытка Нов.СтавкаНДС = Перечисления.СтавкиНДС[СтавкаНДССтр]; Исключение КонецПопытки;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьСклад(Наименование)');
  lines.push('\tНайденный = Справочники.Склады.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденный) Тогда Возврат Найденный; КонецЕсли;');
  lines.push('\tНов = Справочники.Склады.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.ТипСклада = Перечисления.ТипыСкладов.Оптовый;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьСтатьюЗатрат(Наименование)');
  lines.push('\tНайденная = Справочники.СтатьиЗатрат.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tНов = Справочники.СтатьиЗатрат.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьСтатьюДДС(Наименование)');
  lines.push('\tНайденная = Справочники.СтатьиДвиженияДенежныхСредств.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tНов = Справочники.СтатьиДвиженияДенежныхСредств.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьБанковскийСчет(ВладелецСсылка, БИКБанка, НаименованиеБанка, НомерСчета)');
  lines.push('\tЕсли Не ЗначениеЗаполнено(БИКБанка) Тогда Возврат Неопределено; КонецЕсли;');
  lines.push('\tБанкСсылка = Справочники.Банки.НайтиПоКоду(БИКБанка);');
  lines.push('\tЕсли Не ЗначениеЗаполнено(БанкСсылка) Тогда');
  lines.push('\t\tНовБанк = Справочники.Банки.СоздатьЭлемент();');
  lines.push('\t\tНовБанк.Код = БИКБанка;');
  lines.push('\t\tНовБанк.Наименование = ?(ЗначениеЗаполнено(НаименованиеБанка), НаименованиеБанка, "Банк БИК " + БИКБанка);');
  lines.push('\t\tНовБанк.Записать();');
  lines.push('\t\tБанкСсылка = НовБанк.Ссылка;');
  lines.push('\tКонецЕсли;');
  lines.push('\tЕсли ЗначениеЗаполнено(НомерСчета) Тогда');
  lines.push('\t\tНайденныйСчет = Справочники.БанковскиеСчета.НайтиПоРеквизиту("НомерСчета", НомерСчета, , ВладелецСсылка);');
  lines.push('\t\tЕсли ЗначениеЗаполнено(НайденныйСчет) Тогда Возврат НайденныйСчет; КонецЕсли;');
  lines.push('\tКонецЕсли;');
  lines.push('\tНовСчет = Справочники.БанковскиеСчета.СоздатьЭлемент();');
  lines.push('\tНовСчет.Владелец = ВладелецСсылка;');
  lines.push('\tНовСчет.Банк = БанкСсылка;');
  lines.push('\tЕсли ЗначениеЗаполнено(НомерСчета) Тогда НовСчет.НомерСчета = НомерСчета; КонецЕсли;');
  lines.push('\tНовСчет.Наименование = ?(ЗначениеЗаполнено(НомерСчета), НомерСчета + " (" + БИКБанка + ")", "Основной счёт (" + БИКБанка + ")");');
  lines.push('\tНовСчет.Записать();');
  lines.push('\tВозврат НовСчет.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьФизлицо(ФИО)');
  lines.push('\tНайденное = Справочники.ФизическиеЛица.НайтиПоНаименованию(ФИО);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденное) Тогда Возврат Найденное; КонецЕсли;');
  lines.push('\tНов = Справочники.ФизическиеЛица.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = ФИО;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьНоменклатурнуюГруппу(Наименование)');
  lines.push('\tНайденная = Справочники.НоменклатурныеГруппы.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденная) Тогда Возврат Найденная; КонецЕсли;');
  lines.push('\tНов = Справочники.НоменклатурныеГруппы.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');
  lines.push('');

  lines.push('&НаСервере');
  lines.push('Функция НайтиИлиСоздатьОсновноеСредство(Наименование)');
  lines.push('\tНайденное = Справочники.ОсновныеСредства.НайтиПоНаименованию(Наименование);');
  lines.push('\tЕсли ЗначениеЗаполнено(Найденное) Тогда Возврат Найденное; КонецЕсли;');
  lines.push('\tНов = Справочники.ОсновныеСредства.СоздатьЭлемент();');
  lines.push('\tНов.Наименование = Наименование;');
  lines.push('\tНов.НаименованиеПолное = Наименование;');
  lines.push('\tНов.Записать();');
  lines.push('\tВозврат Нов.Ссылка;');
  lines.push('КонецФункции');

  return lines.join('\n');
}

function generateEnterpriseDataXml(params: {
  mode: ExportMode1C;
  db1C: Database1CSnapshot | null;
  activeNewOps: QueuedOperation[];
  cpList: Array<{ name: string; fullName: string; inn: string; kpp: string; kind: string }>;
  ctrList: Array<{ name: string; number: string; date: string; cpName: string; cpInn: string; kind: string }>;
  nomList: Array<{ name: string; unit: string; isService: boolean; vatRate: number }>;
}): string {
  const { mode, db1C, activeNewOps, cpList, ctrList, nomList } = params;
  const org = db1C?.organization;
  const orgUuid = org?.guid1C || deterministicUuid(`org:${org?.inn || org?.name || 'default'}`);

  const xml: string[] = [];
  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push(
    '<Message xmlns="http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8" xmlns:msg="http://www.1c.ru/SSL/Exchange/Message" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
  );
  xml.push('  <msg:Header>');
  xml.push('    <msg:Format>http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.8</msg:Format>');
  xml.push(`    <msg:CreationDate>${new Date().toISOString()}</msg:CreationDate>`);
  xml.push(`    <msg:ExchangePlan>${mode === 'clean_db' ? 'FullDeployment1C' : 'IncrementalSync1C'}</msg:ExchangePlan>`);
  xml.push('  </msg:Header>');
  xml.push('  <Body>');

  if (org && org.name) {
    xml.push('    <Справочник.Организации>');
    xml.push('      <КлючевыеСвойства>');
    xml.push(`        <Ссылка>${escapeXml(orgUuid)}</Ссылка>`);
    xml.push(`        <Наименование>${escapeXml(org.name)}</Наименование>`);
    xml.push(`        <НаименованиеПолное>${escapeXml(org.fullName || org.name)}</НаименованиеПолное>`);
    xml.push(`        <ИНН>${escapeXml(org.inn)}</ИНН>`);
    xml.push(`        <КПП>${escapeXml(org.kpp)}</КПП>`);
    xml.push('        <ЮридическоеФизическоеЛицо>ЮридическоеЛицо</ЮридическоеФизическоеЛицо>');
    xml.push('      </КлючевыеСвойства>');
    xml.push('    </Справочник.Организации>');
  }

  for (const cp of cpList) {
    const cpUuid = deterministicUuid(`cp:${cp.inn || cp.name}`);
    xml.push('    <Справочник.Контрагенты>');
    xml.push('      <КлючевыеСвойства>');
    xml.push(`        <Ссылка>${cpUuid}</Ссылка>`);
    xml.push(`        <Наименование>${escapeXml(cp.name)}</Наименование>`);
    xml.push(`        <НаименованиеПолное>${escapeXml(cp.fullName || cp.name)}</НаименованиеПолное>`);
    xml.push(`        <ИНН>${escapeXml(cp.inn)}</ИНН>`);
    xml.push(`        <КПП>${escapeXml(cp.kpp)}</КПП>`);
    xml.push(`        <ЮридическоеФизическоеЛицо>${escapeXml(cp.kind)}</ЮридическоеФизическоеЛицо>`);
    xml.push('      </КлючевыеСвойства>');
    xml.push('    </Справочник.Контрагенты>');
  }

  for (const ctr of ctrList) {
    const ctrUuid = deterministicUuid(`ctr:${ctr.cpInn || ctr.cpName}:${ctr.name}`);
    const cpUuid = deterministicUuid(`cp:${ctr.cpInn || ctr.cpName}`);
    xml.push('    <Справочник.ДоговорыКонтрагентов>');
    xml.push('      <КлючевыеСвойства>');
    xml.push(`        <Ссылка>${ctrUuid}</Ссылка>`);
    xml.push(`        <Наименование>${escapeXml(ctr.name)}</Наименование>`);
    xml.push(`        <Номер>${escapeXml(ctr.number)}</Номер>`);
    xml.push(`        <Дата>${escapeXml(ctr.date || '2025-01-01')}</Дата>`);
    xml.push(`        <ВидДоговора>${escapeXml(ctr.kind)}</ВидДоговора>`);
    xml.push('        <Контрагент>');
    xml.push(`          <Ссылка>${cpUuid}</Ссылка>`);
    xml.push(`          <Наименование>${escapeXml(ctr.cpName)}</Наименование>`);
    xml.push(`          <ИНН>${escapeXml(ctr.cpInn)}</ИНН>`);
    xml.push('        </Контрагент>');
    xml.push('      </КлючевыеСвойства>');
    xml.push('    </Справочник.ДоговорыКонтрагентов>');
  }

  for (const nom of nomList) {
    const nomUuid = deterministicUuid(`nom:${nom.name}`);
    xml.push('    <Справочник.Номенклатура>');
    xml.push('      <КлючевыеСвойства>');
    xml.push(`        <Ссылка>${nomUuid}</Ссылка>`);
    xml.push(`        <Наименование>${escapeXml(nom.name)}</Наименование>`);
    xml.push(`        <ТипНоменклатуры>${nom.isService ? 'Услуга' : 'Товар'}</ТипНоменклатуры>`);
    xml.push('      </КлючевыеСвойства>');
    xml.push('    </Справочник.Номенклатура>');
  }

  activeNewOps.forEach((op, idx) => {
    const docUuid = deterministicUuid(`doc:${op.id}:${idx}`);
    const edTag =
      op.docType1C === 'СписаниеСРасчетногоСчета'
        ? 'Документ.СписаниеБезналичныхДенежныхСредств'
        : op.docType1C === 'ПоступлениеНаРасчетныйСчет'
          ? 'Документ.ПоступлениеБезналичныхДенежныхСредств'
          : op.docType1C === 'ПоступлениеТоваровУслуг'
            ? 'Документ.ПоступлениеТоваровУслуг'
            : op.docType1C === 'РеализацияТоваровУслуг'
              ? 'Документ.РеализацияТоваровУслуг'
              : op.docType1C === 'РасходМатериалов'
                ? 'Документ.РасходМатериалов'
                : op.docType1C === 'ПередачаМатериаловВЭксплуатацию'
                  ? 'Документ.ПередачаМатериаловВЭксплуатацию'
                  : op.docType1C === 'ПеремещениеТоваров'
                    ? 'Документ.ПеремещениеТоваров'
                    : op.docType1C === 'ВыпускПродукции'
                      ? 'Документ.ОтчетПроизводстваЗаСмену'
                      : op.docType1C === 'ПринятиеКУчетуОС'
                        ? 'Документ.ПринятиеКУчетуОС'
                        : 'Документ.ОперацияБух';

    xml.push(`    <${edTag}>`);
    xml.push('      <КлючевыеСвойства>');
    xml.push(`        <Ссылка>${docUuid}</Ссылка>`);
    xml.push(`        <Дата>${escapeXml(op.date || '2025-04-01')}T12:00:00</Дата>`);
    xml.push(`        <Номер>${escapeXml(op.docNumber || String(idx + 1).padStart(5, '0'))}</Номер>`);
    xml.push('        <Организация>');
    xml.push(`          <Ссылка>${escapeXml(orgUuid)}</Ссылка>`);
    xml.push(`          <Наименование>${escapeXml(org?.name || '')}</Наименование>`);
    xml.push(`          <ИНН>${escapeXml(org?.inn || '')}</ИНН>`);
    xml.push('        </Организация>');
    xml.push('      </КлючевыеСвойства>');
    xml.push(`      <Сумма>${op.amount.toFixed(2)}</Сумма>`);
    if (op.vatAmount > 0) {
      xml.push(`      <СуммаНДС>${op.vatAmount.toFixed(2)}</СуммаНДС>`);
    }
    if (op.counterpartyName) {
      const cpUuid = deterministicUuid(`cp:${op.counterpartyInn || op.counterpartyName}`);
      xml.push('      <Контрагент>');
      xml.push(`        <Ссылка>${cpUuid}</Ссылка>`);
      xml.push(`        <Наименование>${escapeXml(op.counterpartyName)}</Наименование>`);
      xml.push(`        <ИНН>${escapeXml(op.counterpartyInn)}</ИНН>`);
      xml.push(`        <КПП>${escapeXml(op.counterpartyKpp)}</КПП>`);
      xml.push('      </Контрагент>');
    }
    xml.push(`      <Комментарий>${escapeXml(op.description)}</Комментарий>`);
    xml.push('      <ПроводкиБухгалтерскогоУчета>');
    for (const e of op.entries) {
      xml.push('        <Строка>');
      xml.push(`          <СчетДт>${escapeXml(e.debit)}</СчетДт>`);
      xml.push(`          <СчетКт>${escapeXml(e.credit)}</СчетКт>`);
      xml.push(`          <Сумма>${e.amount.toFixed(2)}</Сумма>`);
      xml.push(`          <Содержание>${escapeXml(e.description)}</Содержание>`);
      xml.push('        </Строка>');
    }
    xml.push('      </ПроводкиБухгалтерскогоУчета>');
    xml.push(`    </${edTag}>`);
  });

  xml.push('  </Body>');
  xml.push('</Message>');
  return xml.join('\n');
}

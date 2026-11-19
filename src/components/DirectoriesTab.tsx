'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  CheckSquare,
  ClipboardCopy,
  FolderKanban,
  Package,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import {
  CounterpartyCard1C,
  EmployeeCard1C,
  EntityRequisiteCheck,
  NomenclatureCard1C,
} from '@/types/accounting';

type DirectorySection = 'counterparties' | 'nomenclature' | 'employees' | 'organization';

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

function CopyableFieldRow({
  label,
  value,
  mono = false,
  copiedId,
  fieldKey,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copiedId: string | null;
  fieldKey: string;
  onCopy: (key: string, val: string) => void;
}) {
  const isCopied = copiedId === fieldKey;
  const displayVal = value?.trim() ? value : '—';

  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </div>
        <div
          className={`text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate ${
            mono ? 'font-mono tabular-nums' : ''
          }`}
          title={displayVal}
        >
          {displayVal}
        </div>
      </div>

      {value?.trim() && (
        <button
          type="button"
          onClick={() => onCopy(fieldKey, value)}
          title={`Скопировать «${label}»`}
          className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
            isCopied
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
              : 'bg-white hover:bg-zinc-100 dark:bg-[#111113] dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
          }`}
        >
          {isCopied ? (
            <>
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              <span>Ок</span>
            </>
          ) : (
            <>
              <ClipboardCopy className="w-3 h-3" />
              <span className="hidden sm:inline">Копировать</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

function RequisiteGapAlert({
  check,
  copiedId,
  onCopy,
}: {
  check: EntityRequisiteCheck;
  copiedId: string | null;
  onCopy: (key: string, val: string) => void;
}) {
  if (check.status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80">
        <CheckCircle2 className="w-3 h-3" />
        Реквизиты заполнены ({check.filledCount}/{check.totalRequired})
      </span>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
          <AlertCircle className="w-3.5 h-3.5" />
          Требует дозаполнения в 1С ({check.filledCount} из {check.totalRequired})
        </span>
        {check.status === 'missing_in_1c' && (
          <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
            Карточка отсутствует в выгрузке 1С — создайте по эталону ниже
          </span>
        )}
      </div>

      {check.missingFields.length > 0 && (
        <div className="rounded-md border border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20 divide-y divide-rose-200/70 dark:divide-rose-900/50">
          {check.missingFields.map((gap) => {
            const copyKey = `req-gap-${check.entityId}-${gap.fieldKey}`;
            const isCopied = copiedId === copyKey;
            return (
              <div
                key={gap.fieldKey}
                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-rose-900 dark:text-rose-200">
                      {gap.fieldLabel}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300">
                      {gap.reason === 'empty'
                        ? 'Пусто в 1С'
                        : `В 1С: ${gap.actualValueIn1C || 'не совпадает'}`}
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-xs text-zinc-900 dark:text-zinc-100">
                    Эталон: <strong>{gap.expectedValue}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onCopy(copyKey, gap.expectedValue)}
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors ${
                    isCopied
                      ? 'bg-emerald-600 text-white border-emerald-700'
                      : 'bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Скопировано</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="w-3 h-3" />
                      <span>Копировать</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DirectoriesTab() {
  const {
    directories,
    effectiveOrganization,
    toggleDirectoryItemCreated,
    addCounterparty,
    addNomenclature,
    addEmployee,
    setActiveTab,
    requisiteReport,
    synced1C,
    refreshFrom1CSync,
    simulate1CSyncWithSampleErrors,
  } = useAccountant();

  const [section, setSection] = useState<DirectorySection>('counterparties');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Counterparty state
  const [cpName, setCpName] = useState('');
  const [cpInn, setCpInn] = useState('');
  const [cpKpp, setCpKpp] = useState('');
  const [cpBankAcc, setCpBankAcc] = useState('');
  const [cpBankName, setCpBankName] = useState('Северо-Западный банк ПАО Сбербанк');
  const [cpBik, setCpBik] = useState('044030653');
  const [cpContractKind, setCpContractKind] =
    useState<CounterpartyCard1C['contractKind']>('С поставщиком');
  const [cpContractNum, setCpContractNum] = useState('');
  const [cpContractDate, setCpContractDate] = useState('01.04.2026');

  // Add Nomenclature state
  const [nomName, setNomName] = useState('');
  const [nomKind, setNomKind] = useState<NomenclatureCard1C['kind']>('Товары');
  const [nomUnit, setNomUnit] = useState('шт');
  const [nomAccount, setNomAccount] = useState('41.01');
  const [nomVatAccount, setNomVatAccount] = useState('19.03');
  const [nomGroup, setNomGroup] = useState('Основная номенклатурная группа');
  const [nomExpense, setNomExpense] = useState('Материальные расходы');
  const [nomVatRate, setNomVatRate] = useState(20);

  // Add Employee state
  const [empFullName, setEmpFullName] = useState('');
  const [empPosition, setEmpPosition] = useState('Бухгалтер');
  const [empDept, setEmpDept] = useState('Администрация');
  const [empSalary, setEmpSalary] = useState('72200');
  const [empHireDate, setEmpHireDate] = useState('05.04.2026');
  const [empCostAcc, setEmpCostAcc] = useState('26');

  const handleCopy = (key: string, val: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(val);
    }
    setCopiedId(key);
    setTimeout(() => {
      setCopiedId((prev) => (prev === key ? null : prev));
    }, 1600);
  };

  const substituteStudent = (text: string): string => {
    const st = effectiveOrganization.studentName.trim();
    if (!st) return text;
    return text.replace(/\(?\s*ФИО\s+студента\s*\)?/gi, st);
  };

  const groupedNomenclature = useMemo(() => {
    const goods = directories.nomenclature.filter((n) => n.kind === 'Товары');
    const materials = directories.nomenclature.filter((n) => n.kind === 'Материалы');
    const services = directories.nomenclature.filter(
      (n) => n.kind === 'Услуги / Субподрядные работы' || n.kind === 'Продукция / СМР'
    );
    return { goods, materials, services };
  }, [directories.nomenclature]);

  const cpCheckMap = useMemo(() => {
    const map = new Map<string, EntityRequisiteCheck>();
    for (const c of requisiteReport.counterpartyChecks) {
      map.set(c.entityId, c);
      if (c.innExpected) map.set(`inn:${c.innExpected}`, c);
      map.set(`name:${c.name.toLowerCase()}`, c);
    }
    return map;
  }, [requisiteReport.counterpartyChecks]);

  const createdCpCount = directories.counterparties.filter((c) => c.createdIn1C).length;
  const createdNomCount = directories.nomenclature.filter((n) => n.createdIn1C).length;
  const createdEmpCount = directories.employees.filter((e) => e.createdIn1C).length;

  const handleAddCounterpartySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cpName.trim()) return;
    addCounterparty({
      name: cpName.trim(),
      fullName: cpName.trim(),
      inn: cpInn.trim() || '7810000000',
      kpp: cpKpp.trim() || '781001001',
      bankAccount: cpBankAcc.trim() || '40702810455000000101',
      bankName: cpBankName.trim() || 'Северо-Западный банк ПАО Сбербанк',
      bik: cpBik.trim() || '044030653',
      contractKind: cpContractKind,
      contractNumber: cpContractNum.trim() || 'Б/Н',
      contractDate: cpContractDate.trim() || '01.04.2026',
      createdIn1C: false,
    });
    setCpName('');
    setCpInn('');
    setCpKpp('');
    setCpBankAcc('');
    setCpContractNum('');
    setShowAddForm(false);
  };

  const handleAddNomenclatureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomName.trim()) return;
    addNomenclature({
      name: nomName.trim(),
      kind: nomKind,
      unit: nomUnit.trim() || 'шт',
      accountCode: nomAccount.trim() || '41.01',
      vatAccountCode: nomVatAccount.trim() || '19.03',
      nomenclatureGroup: nomGroup.trim() || undefined,
      expenseItem: nomExpense.trim() || undefined,
      defaultVatRate: nomVatRate,
      createdIn1C: false,
    });
    setNomName('');
    setShowAddForm(false);
  };

  const handleAddEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!empFullName.trim()) return;
    addEmployee({
      fullName: empFullName.trim(),
      position: empPosition.trim() || 'Специалист',
      department: empDept.trim() || 'Основное подразделение',
      salary: Number(empSalary) || 60000,
      hireDate: empHireDate.trim() || '01.04.2026',
      costAccount: empCostAcc.trim() || '26',
      createdIn1C: false,
    });
    setEmpFullName('');
    setShowAddForm(false);
  };

  const renderNomenclatureCard = (item: NomenclatureCard1C) => {
    const isCreated = Boolean(item.createdIn1C);
    return (
      <div
        key={item.id}
        className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums font-semibold bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800">
                Счет {item.accountCode}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums text-zinc-600 dark:text-zinc-400 bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
                НДС {item.defaultVatRate}% ({item.vatAccountCode})
              </span>
            </div>
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-1.5">
              {item.name}
            </h4>
          </div>

          <button
            type="button"
            onClick={() => toggleDirectoryItemCreated(item.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              isCreated
                ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
                : 'bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
            }`}
          >
            {isCreated ? (
              <CheckSquare className="w-3.5 h-3.5" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            <span>Заведено в 1С</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <CopyableFieldRow
            label="Наименование в 1С"
            value={item.name}
            copiedId={copiedId}
            fieldKey={`${item.id}-name`}
            onCopy={handleCopy}
          />
          <CopyableFieldRow
            label="Вид номенклатуры"
            value={item.kind}
            copiedId={copiedId}
            fieldKey={`${item.id}-kind`}
            onCopy={handleCopy}
          />
          <CopyableFieldRow
            label="Единица измерения"
            value={item.unit}
            copiedId={copiedId}
            fieldKey={`${item.id}-unit`}
            onCopy={handleCopy}
          />
          <CopyableFieldRow
            label="Счет учета / Счет НДС"
            value={`${item.accountCode} / ${item.vatAccountCode}`}
            mono
            copiedId={copiedId}
            fieldKey={`${item.id}-acc`}
            onCopy={handleCopy}
          />
          {item.nomenclatureGroup && (
            <CopyableFieldRow
              label="Номенклатурная группа (субконто 20 / 90)"
              value={item.nomenclatureGroup}
              copiedId={copiedId}
              fieldKey={`${item.id}-ng`}
              onCopy={handleCopy}
            />
          )}
          {item.expenseItem && (
            <CopyableFieldRow
              label="Статья затрат"
              value={item.expenseItem}
              copiedId={copiedId}
              fieldKey={`${item.id}-exp`}
              onCopy={handleCopy}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      {/* Top «Реквизит-контроль» Strip */}
      <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Реквизит-контроль и Справочники 1С
              </span>
              {requisiteReport.incompleteCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono tabular-nums font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Требует дозаполнения в 1С: {requisiteReport.incompleteCount} карт.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono tabular-nums font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Эталонные карточки полные ({1 + requisiteReport.counterpartyChecks.length} проверено)
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Проверка обязательных полей нашей организации (8 полей) и всех контрагентов задачи (Наименование, ИНН, КПП, р/сч, БИК, Банк, Договор + вид договора).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void refreshFrom1CSync()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Сверить с 1С</span>
            </button>

            {!synced1C && (
              <button
                type="button"
                onClick={() => void simulate1CSyncWithSampleErrors()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#FAFAFA] hover:bg-zinc-100 dark:bg-[#09090B] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 transition-colors"
              >
                <span>Тест: незаполненные реквизиты 1С</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('navigator')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-colors"
            >
              <span>К пошаговому вводу операций →</span>
            </button>
          </div>
        </div>

        {/* Summary Chips for Organization + All 5 Counterparties */}
        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
          {[requisiteReport.organizationCheck, ...requisiteReport.counterpartyChecks].map(
            (chk) => {
              const bad = chk.status !== 'complete';
              return (
                <button
                  key={chk.entityId}
                  type="button"
                  onClick={() =>
                    setSection(
                      chk.entityType === 'organization' ? 'organization' : 'counterparties'
                    )
                  }
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors ${
                    bad
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800 font-semibold'
                      : 'bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded ${
                      bad ? 'bg-rose-600' : 'bg-emerald-500'
                    }`}
                  />
                  <span>{chk.name}</span>
                  <span className="font-mono tabular-nums text-[11px] opacity-80">
                    {chk.filledCount}/{chk.totalRequired}
                  </span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Sub-navigation Tabs + Add Custom Item Button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => {
              setSection('counterparties');
              setShowAddForm(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              section === 'counterparties'
                ? 'bg-white dark:bg-[#111113] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Контрагенты и договоры</span>
            <span className="font-mono tabular-nums text-[11px] opacity-75">
              {createdCpCount}/{directories.counterparties.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSection('organization');
              setShowAddForm(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              section === 'organization'
                ? 'bg-white dark:bg-[#111113] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Наша организация</span>
            {requisiteReport.organizationCheck.status !== 'complete' && (
              <span className="px-1 rounded bg-rose-600 text-white text-[10px] font-mono">
                !
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSection('nomenclature');
              setShowAddForm(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              section === 'nomenclature'
                ? 'bg-white dark:bg-[#111113] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Номенклатура и НГ</span>
            <span className="font-mono tabular-nums text-[11px] opacity-75">
              {createdNomCount}/{directories.nomenclature.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSection('employees');
              setShowAddForm(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              section === 'employees'
                ? 'bg-white dark:bg-[#111113] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Сотрудники и Кадры</span>
            <span className="font-mono tabular-nums text-[11px] opacity-75">
              {createdEmpCount}/{directories.employees.length}
            </span>
          </button>
        </div>

        {section !== 'organization' && (
          <button
            type="button"
            onClick={() => setShowAddForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 transition-colors"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{showAddForm ? 'Отмена' : 'Добавить карточку'}</span>
          </button>
        )}
      </div>

      {/* Inline Add Custom Item Forms */}
      {showAddForm && section === 'counterparties' && (
        <form
          onSubmit={handleAddCounterpartySubmit}
          className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Новый контрагент (Справочники → Контрагенты)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              required
              value={cpName}
              onChange={(e) => setCpName(e.target.value)}
              placeholder='Наименование (ООО "Вектор")'
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpInn}
              onChange={(e) => setCpInn(e.target.value)}
              placeholder="ИНН (10 или 12 цифр)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpKpp}
              onChange={(e) => setCpKpp(e.target.value)}
              placeholder="КПП (9 цифр)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpBankAcc}
              onChange={(e) => setCpBankAcc(e.target.value)}
              placeholder="Расчетный счет (20 цифр)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpBik}
              onChange={(e) => setCpBik(e.target.value)}
              placeholder="БИК банка"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpBankName}
              onChange={(e) => setCpBankName(e.target.value)}
              placeholder="Наименование банка"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <select
              value={cpContractKind}
              onChange={(e) =>
                setCpContractKind(e.target.value as CounterpartyCard1C['contractKind'])
              }
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            >
              <option value="С поставщиком">Вид договора: С поставщиком</option>
              <option value="С покупателем">Вид договора: С покупателем</option>
              <option value="Прочее">Вид договора: Прочее</option>
            </select>
            <input
              value={cpContractNum}
              onChange={(e) => setCpContractNum(e.target.value)}
              placeholder="Номер договора (№ 177)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={cpContractDate}
              onChange={(e) => setCpContractDate(e.target.value)}
              placeholder="Дата договора (01.04.2026)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
            >
              Сохранить карточку
            </button>
          </div>
        </form>
      )}

      {showAddForm && section === 'nomenclature' && (
        <form
          onSubmit={handleAddNomenclatureSubmit}
          className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Новая позиция номенклатуры
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              required
              value={nomName}
              onChange={(e) => setNomName(e.target.value)}
              placeholder="Наименование"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <select
              value={nomKind}
              onChange={(e) => {
                const nextKind = e.target.value as NomenclatureCard1C['kind'];
                setNomKind(nextKind);
                if (nextKind === 'Товары') {
                  setNomAccount('41.01');
                  setNomVatAccount('19.03');
                } else if (nextKind === 'Материалы') {
                  setNomAccount('10.01');
                  setNomVatAccount('19.03');
                } else {
                  setNomAccount('20.01');
                  setNomVatAccount('19.04');
                }
              }}
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            >
              <option value="Товары">Товары (41.01)</option>
              <option value="Материалы">Материалы (10.01)</option>
              <option value="Услуги / Субподрядные работы">
                Услуги / Субподрядные работы (20.01, 26)
              </option>
              <option value="Продукция / СМР">Продукция / СМР</option>
            </select>
            <input
              value={nomUnit}
              onChange={(e) => setNomUnit(e.target.value)}
              placeholder="Ед. изм."
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={nomAccount}
              onChange={(e) => setNomAccount(e.target.value)}
              placeholder="Счет учета"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={nomGroup}
              onChange={(e) => setNomGroup(e.target.value)}
              placeholder="Номенклатурная группа"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              type="number"
              value={nomVatRate}
              onChange={(e) => setNomVatRate(Number(e.target.value) || 0)}
              placeholder="Ставка НДС (%)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
            >
              Добавить позицию
            </button>
          </div>
        </form>
      )}

      {showAddForm && section === 'employees' && (
        <form
          onSubmit={handleAddEmployeeSubmit}
          className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Новый сотрудник
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              required
              value={empFullName}
              onChange={(e) => setEmpFullName(e.target.value)}
              placeholder="ФИО сотрудника"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={empPosition}
              onChange={(e) => setEmpPosition(e.target.value)}
              placeholder="Должность"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={empDept}
              onChange={(e) => setEmpDept(e.target.value)}
              placeholder="Подразделение"
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              type="number"
              value={empSalary}
              onChange={(e) => setEmpSalary(e.target.value)}
              placeholder="Оклад, ₽"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <input
              value={empHireDate}
              onChange={(e) => setEmpHireDate(e.target.value)}
              placeholder="Дата приема (05.04.2026)"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            />
            <select
              value={empCostAcc}
              onChange={(e) => setEmpCostAcc(e.target.value)}
              className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800"
            >
              <option value="26">Счет затрат: 26 (АУП)</option>
              <option value="20.01">Счет затрат: 20.01 (Производство)</option>
              <option value="44.01">Счет затрат: 44.01 (Торговля)</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
            >
              Добавить сотрудника
            </button>
          </div>
        </form>
      )}

      {/* SECTION 1: COUNTERPARTIES WITH REQUISITE CONTROL */}
      {section === 'counterparties' && (
        <div className="grid grid-cols-1 gap-3">
          {directories.counterparties.map((cp) => {
            const isCreated = Boolean(cp.createdIn1C);
            const reqCheck =
              cpCheckMap.get(cp.id) ||
              (cp.inn ? cpCheckMap.get(`inn:${cp.inn}`) : undefined) ||
              cpCheckMap.get(`name:${cp.name.toLowerCase()}`);
            const hasGap = reqCheck && reqCheck.status !== 'complete';

            return (
              <div
                key={cp.id}
                className={`rounded-md bg-white dark:bg-[#111113] border p-4 space-y-3 ${
                  hasGap
                    ? 'border-rose-300 dark:border-rose-800'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                        {cp.contractKind}
                      </span>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {cp.name}
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {cp.fullName}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleDirectoryItemCreated(cp.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      isCreated
                        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {isCreated ? (
                      <CheckSquare className="w-3.5 h-3.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    <span>Заведено в 1С</span>
                  </button>
                </div>

                {/* Requisite Completeness Checklist */}
                {reqCheck && (
                  <RequisiteGapAlert
                    check={reqCheck}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <CopyableFieldRow
                    label="Наименование"
                    value={cp.name}
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-name`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="ИНН"
                    value={cp.inn}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-inn`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="КПП"
                    value={cp.kpp}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-kpp`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Расчетный счет"
                    value={cp.bankAccount}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-rs`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="БИК банка"
                    value={cp.bik}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-bik`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Банк"
                    value={cp.bankName}
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-bank`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Вид договора в 1С"
                    value={cp.contractKind}
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-ckind`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Номер договора"
                    value={cp.contractNumber}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-cnum`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Дата договора"
                    value={cp.contractDate}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${cp.id}-cdate`}
                    onCopy={handleCopy}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION 2: NOMENCLATURE */}
      {section === 'nomenclature' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                <FolderKanban className="w-4 h-4" />
                <span>Номенклатурные группы (Счет 20.01 и 90.01)</span>
              </div>
              <div className="space-y-1.5">
                {directories.nomenclatureGroups.map((ng, idx) => (
                  <CopyableFieldRow
                    key={`ng-${idx}`}
                    label="Номенклатурная группа"
                    value={ng}
                    copiedId={copiedId}
                    fieldKey={`ng-chip-${idx}`}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                <Wrench className="w-4 h-4" />
                <span>Статьи затрат (Счета 20 и 26)</span>
              </div>
              <div className="space-y-1.5">
                {directories.expenseItems.map((exp, idx) => (
                  <CopyableFieldRow
                    key={`exp-${idx}`}
                    label="Статья затрат"
                    value={exp}
                    copiedId={copiedId}
                    fieldKey={`exp-chip-${idx}`}
                    onCopy={handleCopy}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Товары (счет 41.01) — <span className="font-mono tabular-nums">{groupedNomenclature.goods.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {groupedNomenclature.goods.map(renderNomenclatureCard)}
            </div>
          </div>

          {groupedNomenclature.materials.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Материалы (счет 10.01) — <span className="font-mono tabular-nums">{groupedNomenclature.materials.length}</span>
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {groupedNomenclature.materials.map(renderNomenclatureCard)}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Услуги и субподрядные работы (счета 20.01, 26) — <span className="font-mono tabular-nums">{groupedNomenclature.services.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {groupedNomenclature.services.map(renderNomenclatureCard)}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: EMPLOYEES */}
      {section === 'employees' && (
        <div className="grid grid-cols-1 gap-3">
          {directories.employees.map((emp: EmployeeCard1C) => {
            const isCreated = Boolean(emp.createdIn1C);
            const displayFio = substituteStudent(emp.fullName);

            return (
              <div
                key={emp.id}
                className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums font-semibold bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800">
                        Счет затрат {emp.costAccount}
                      </span>
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {displayFio}
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {emp.position} • {emp.department}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleDirectoryItemCreated(emp.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      isCreated
                        ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-white hover:bg-zinc-50 dark:bg-[#111113] dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {isCreated ? (
                      <CheckSquare className="w-3.5 h-3.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    <span>Заведено в 1С</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  <CopyableFieldRow
                    label="ФИО сотрудника"
                    value={displayFio}
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-fio`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Должность"
                    value={emp.position}
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-pos`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Подразделение"
                    value={emp.department}
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-dept`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Оклад (руб./мес.)"
                    value={String(emp.salary)}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-sal`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Дата приема на работу"
                    value={emp.hireDate}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-hire`}
                    onCopy={handleCopy}
                  />
                  <CopyableFieldRow
                    label="Счет отражения зарплаты"
                    value={emp.costAccount}
                    mono
                    copiedId={copiedId}
                    fieldKey={`${emp.id}-acc`}
                    onCopy={handleCopy}
                  />
                </div>

                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Оклад: <strong className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{formatRub(emp.salary)}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SECTION 4: OUR ORGANIZATION WITH REQUISITE CONTROL */}
      {section === 'organization' && (
        <div
          className={`rounded-md bg-white dark:bg-[#111113] border p-4 space-y-4 ${
            requisiteReport.organizationCheck.status !== 'complete'
              ? 'border-rose-300 dark:border-rose-800'
              : 'border-zinc-200 dark:border-zinc-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {effectiveOrganization.name}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Главное → Настройки → Организации (8 обязательных реквизитов)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('balances')}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
            >
              Редактировать карточку организации →
            </button>
          </div>

          <RequisiteGapAlert
            check={requisiteReport.organizationCheck}
            copiedId={copiedId}
            onCopy={handleCopy}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <CopyableFieldRow
              label="Краткое наименование"
              value={effectiveOrganization.shortName}
              copiedId={copiedId}
              fieldKey="org-short"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="Полное наименование"
              value={effectiveOrganization.name}
              copiedId={copiedId}
              fieldKey="org-full"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="ИНН"
              value={effectiveOrganization.inn}
              mono
              copiedId={copiedId}
              fieldKey="org-inn"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="КПП"
              value={effectiveOrganization.kpp}
              mono
              copiedId={copiedId}
              fieldKey="org-kpp"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="Расчетный счет"
              value={effectiveOrganization.bankAccount}
              mono
              copiedId={copiedId}
              fieldKey="org-rs"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="БИК банка"
              value={effectiveOrganization.bik}
              mono
              copiedId={copiedId}
              fieldKey="org-bik"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="Банк"
              value={effectiveOrganization.bankName}
              copiedId={copiedId}
              fieldKey="org-bank"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="Руководитель"
              value={effectiveOrganization.directorName}
              copiedId={copiedId}
              fieldKey="org-dir"
              onCopy={handleCopy}
            />
            <CopyableFieldRow
              label="Главный бухгалтер"
              value={effectiveOrganization.chiefAccountantName}
              copiedId={copiedId}
              fieldKey="org-acc"
              onCopy={handleCopy}
            />
          </div>
        </div>
      )}
    </div>
  );
}

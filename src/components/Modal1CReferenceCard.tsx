'use client';

import React, { useEffect, useState } from 'react';
import { Check, Copy, SquareStack, X } from 'lucide-react';
import {
  Database1CSnapshot,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  QueuedOperation,
  Virtual1CStateSnapshot,
} from '@/types/accounting';
import { ReferenceEntityKind1C } from '@/lib/engine';
import { formatDateRu, formatMoney } from '@/lib/formatters';
import { generateEducationalInnKpp, inferOrganizationRegionCode } from '@/lib/egrul/egrulLookup';
import { Modal1CFormSavePatch } from '@/context/AccountantContext';

interface Modal1CReferenceCardProps {
  entityKind: ReferenceEntityKind1C;
  op: QueuedOperation;
  draftPatch: Modal1CFormSavePatch;
  db1C: Database1CSnapshot | null;
  virtualState: Virtual1CStateSnapshot;
  isEditable: boolean;
  onSavePatch: (patch: Partial<Modal1CFormSavePatch>) => void;
  onClose: () => void;
}

export function Modal1CReferenceCard({
  entityKind,
  op,
  draftPatch,
  db1C,
  virtualState,
  isEditable,
  onSavePatch,
  onClose,
}: Modal1CReferenceCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Local editable fields seeded from draftPatch -> op -> virtualState
  const [cpName, setCpName] = useState(
    draftPatch.counterpartyName ?? op.counterpartyName ?? ''
  );
  const [cpKind, setCpKind] = useState<
    'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо'
  >(draftPatch.counterpartyKind ?? op.counterpartyKind ?? 'ЮридическоеЛицо');
  const [cpInn, setCpInn] = useState(draftPatch.counterpartyInn ?? op.counterpartyInn ?? '');
  const [cpKpp, setCpKpp] = useState(draftPatch.counterpartyKpp ?? op.counterpartyKpp ?? '');
  const [cpBik, setCpBik] = useState(
    draftPatch.counterpartyBik ?? op.counterpartyBik ?? DEFAULT_SBERBANK_BIK
  );
  const [cpBankName, setCpBankName] = useState(
    draftPatch.counterpartyBankName ?? op.counterpartyBankName ?? DEFAULT_SBERBANK_NAME
  );
  const [cpBankAcc, setCpBankAcc] = useState(
    draftPatch.counterpartyBankAccount ?? op.counterpartyBankAccount ?? ''
  );

  const [contractName, setContractName] = useState(
    draftPatch.contractName ?? op.contractName ?? 'Основной договор'
  );
  const [contractNumber, setContractNumber] = useState(
    draftPatch.contractNumber ?? op.contractNumber ?? op.docNumber ?? '1'
  );
  const [contractDate, setContractDate] = useState(
    draftPatch.contractDate ?? op.contractDate ?? op.date
  );

  const [nomName, setNomName] = useState(
    draftPatch.nomenclatureName ?? op.nomenclatureName ?? op.description.slice(0, 80)
  );
  const [nomAccount, setNomAccount] = useState(
    draftPatch.materialAccount ??
      op.materialAccount ??
      (op.category === 'purchase_goods'
        ? '41.01'
        : op.category === 'purchase_equipment'
          ? '08.04.1'
          : op.category === 'production_output'
            ? '43'
            : '10.01')
  );
  const [nomVat, setNomVat] = useState(String(draftPatch.vatRate ?? op.vatRate ?? 20));

  const [warehouseName, setWarehouseName] = useState(
    draftPatch.warehouseName ?? op.warehouseName ?? 'Основной склад'
  );

  const matchedEmp = virtualState.employees.find(
    (e) =>
      (draftPatch.employeeName ?? op.employeeName) &&
      e.fullName.toLowerCase().includes((draftPatch.employeeName ?? op.employeeName).toLowerCase())
  );
  const [empName, setEmpName] = useState(
    draftPatch.employeeName ?? op.employeeName ?? matchedEmp?.fullName ?? ''
  );
  const [empPos, setEmpPos] = useState(
    draftPatch.employeePosition ?? op.employeePosition ?? matchedEmp?.position ?? 'Специалист'
  );
  const [empSalary, setEmpSalary] = useState(
    String(
      draftPatch.monthlySalary ??
        op.monthlySalary ??
        matchedEmp?.monthlySalary ??
        (op.amount > 0 ? op.amount : 0)
    )
  );
  const [empCostAcc, setEmpCostAcc] = useState(
    draftPatch.costAccount ?? op.costAccount ?? matchedEmp?.costAccount ?? '26'
  );
  const [empChildren, setEmpChildren] = useState(
    String(draftPatch.employeeChildCount ?? op.employeeChildCount ?? matchedEmp?.childCount ?? 0)
  );

  const matchedOs = virtualState.fixedAssets.find(
    (fa) =>
      (draftPatch.nomenclatureName ?? op.nomenclatureName) &&
      fa.name.toLowerCase().includes((draftPatch.nomenclatureName ?? op.nomenclatureName).toLowerCase())
  );
  const [osName, setOsName] = useState(
    draftPatch.nomenclatureName ?? op.nomenclatureName ?? matchedOs?.name ?? 'Основное средство'
  );
  const [osSpi, setOsSpi] = useState(
    String(draftPatch.usefulLifeMonths ?? op.usefulLifeMonths ?? matchedOs?.usefulLifeMonths ?? 60)
  );
  const [osCostAcc, setOsCostAcc] = useState(
    draftPatch.costAccount ?? op.costAccount ?? '20.01'
  );

  const [rpbMethod, setRpbMethod] = useState<'calendar_days' | 'monthly'>(
    draftPatch.rpbWriteOffMethod ?? op.rpbWriteOffMethod ?? 'calendar_days'
  );
  const [rpbMonths, setRpbMonths] = useState(
    String(draftPatch.rpbTermMonths ?? op.rpbTermMonths ?? 12)
  );
  const [rpbStart, setRpbStart] = useState(
    draftPatch.rpbStartDate ?? op.rpbStartDate ?? op.date
  );
  const [rpbEnd, setRpbEnd] = useState(() => {
    if (draftPatch.rpbEndDate || op.rpbEndDate) {
      return draftPatch.rpbEndDate || op.rpbEndDate || '';
    }
    const base = new Date(`${op.date}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) return '';
    base.setUTCMonth(base.getUTCMonth() + (op.rpbTermMonths || 12));
    base.setUTCDate(base.getUTCDate() - 1);
    return base.toISOString().slice(0, 10);
  });
  const [rpbCostAcc, setRpbCostAcc] = useState(
    draftPatch.costAccount ?? op.costAccount ?? '26'
  );

  const [expItemName, setExpItemName] = useState(
    draftPatch.expenseItemName ?? op.expenseItemName ?? 'Материальные расходы'
  );
  const [ddsItemName, setDdsItemName] = useState(
    draftPatch.cashFlowItemName ?? op.cashFlowItemName ?? 'Оплата товаров, работ, услуг, сырья и иных оборотных активов'
  );

  // Close ONLY nested reference card on Escape (stopImmediatePropagation prevents parent document modal from closing!)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const copyText = async (key: string, val: string) => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1300);
    } catch {
      // Ignore
    }
  };

  const metaByKind: Record<
    ReferenceEntityKind1C,
    { title: string; breadcrumb: string }
  > = {
    counterparty: {
      title: `${cpName || 'Новый контрагент'} (Контрагент)`,
      breadcrumb: 'Справочники  ▸  Покупки и продажи  ▸  Контрагенты',
    },
    contract: {
      title: `${contractName || 'Основной договор'} (Договор)`,
      breadcrumb: 'Справочники  ▸  Покупки и продажи  ▸  Договоры',
    },
    nomenclature: {
      title: `${nomName || 'Номенклатура'} (Номенклатура)`,
      breadcrumb: 'Справочники  ▸  Товары и услуги  ▸  Номенклатура',
    },
    warehouse: {
      title: `${warehouseName || 'Основной склад'} (Склад)`,
      breadcrumb: 'Справочники  ▸  Товары и услуги  ▸  Склады',
    },
    employee: {
      title: `${empName || 'Сотрудник'} (Сотрудник)`,
      breadcrumb: 'Зарплата и кадры  ▸  Кадровый учет  ▸  Сотрудники',
    },
    fixed_asset: {
      title: `${osName || 'Основное средство'} (Основное средство)`,
      breadcrumb: 'Справочники  ▸  ОС и НМА  ▸  Основные средства',
    },
    rpb_97: {
      title: `${nomName || 'Расход будущих периодов'} (Расходы будущих периодов — 97.21)`,
      breadcrumb: 'Справочники  ▸  Доходы и расходы  ▸  Расходы будущих периодов',
    },
    expense_item: {
      title: `${expItemName} (Статья затрат)`,
      breadcrumb: 'Справочники  ▸  Доходы и расходы  ▸  Статьи затрат',
    },
    cash_flow_item: {
      title: `${ddsItemName} (Статья движения денежных средств)`,
      breadcrumb: 'Справочники  ▸  Банк и касса  ▸  Статьи движения денежных средств',
    },
  };

  const handleSaveAndClose = () => {
    if (entityKind === 'counterparty') {
      onSavePatch({
        counterpartyName: cpName.trim(),
        counterpartyKind: cpKind,
        counterpartyInn: cpInn.trim(),
        counterpartyKpp: cpKpp.trim(),
        counterpartyBik: cpBik.trim(),
        counterpartyBankName: cpBankName.trim(),
        counterpartyBankAccount: cpBankAcc.trim(),
        contractName: contractName.trim() || 'Основной договор',
      });
    } else if (entityKind === 'contract') {
      onSavePatch({
        contractName: contractName.trim(),
        contractNumber: contractNumber.trim(),
        contractDate,
      });
    } else if (entityKind === 'nomenclature') {
      onSavePatch({
        nomenclatureName: nomName.trim(),
        materialAccount: nomAccount,
        vatRate: Number(nomVat) || 0,
      });
    } else if (entityKind === 'warehouse') {
      onSavePatch({ warehouseName: warehouseName.trim() });
    } else if (entityKind === 'employee') {
      onSavePatch({
        employeeName: empName.trim(),
        employeePosition: empPos.trim(),
        monthlySalary: Number(empSalary) || 0,
        costAccount: empCostAcc,
        employeeChildCount: Math.max(0, Math.round(Number(empChildren) || 0)),
      });
    } else if (entityKind === 'fixed_asset') {
      onSavePatch({
        nomenclatureName: osName.trim(),
        usefulLifeMonths: Math.max(1, Math.round(Number(osSpi) || 60)),
        costAccount: osCostAcc,
      });
    } else if (entityKind === 'rpb_97') {
      onSavePatch({
        nomenclatureName: nomName.trim(),
        rpbWriteOffMethod: rpbMethod,
        rpbTermMonths: Math.max(1, Math.round(Number(rpbMonths) || 12)),
        rpbStartDate: rpbStart,
        rpbEndDate: rpbEnd,
        costAccount: rpbCostAcc,
      });
    } else if (entityKind === 'expense_item') {
      onSavePatch({ expenseItemName: expItemName.trim() });
    } else if (entityKind === 'cash_flow_item') {
      onSavePatch({ cashFlowItemName: ddsItemName.trim() });
    }
    onClose();
  };

  const handleGenerateEduInn = () => {
    const region = inferOrganizationRegionCode({
      organizationInn: db1C?.organization.inn,
      organizationBik: db1C?.organization.bik || DEFAULT_SBERBANK_BIK,
    });
    const gen = generateEducationalInnKpp(cpName || 'Учебный контрагент', cpKind, region);
    setCpInn(gen.inn);
    if (gen.kpp) setCpKpp(gen.kpp);
  };

  const meta = metaByKind[entityKind];

  const renderFieldRow = (
    label: string,
    keyId: string,
    value: string,
    onChange: (v: string) => void,
    options?: { mono?: boolean; widthClass?: string; type?: 'text' | 'date' | 'number' }
  ) => (
    <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
      <label className="text-[12px] text-[#4A4A4A] truncate">{label}:</label>
      <div className="flex items-center gap-1.5">
        <input
          type={options?.type || 'text'}
          readOnly={!isEditable}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={() => {
            if (!isEditable && value) void copyText(keyId, value);
          }}
          className={`h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] focus:outline-none focus:border-[#E6B800] bg-white text-[12px] text-[#1F1F1F] ${
            options?.mono ? 'tabular-nums font-mono' : ''
          } ${options?.widthClass || 'w-full'} ${!isEditable ? 'cursor-pointer hover:bg-[#FFFDF2]' : ''}`}
        />
        <button
          type="button"
          title="Скопировать значение для вставки в 1С"
          onClick={() => void copyText(keyId, value)}
          className="h-[27px] px-2 rounded-[2px] border border-[#CCCCCC] bg-white hover:bg-[#F5F5F5] text-[11px] text-[#444] shrink-0"
        >
          {copiedKey === keyId ? (
            <Check className="w-3.5 h-3.5 text-emerald-700" strokeWidth={2} />
          ) : (
            <Copy className="w-3.5 h-3.5" strokeWidth={1.6} />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[80] bg-black/35 flex items-center justify-center p-3 sm:p-6"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] rounded-[4px] border border-[#B8B8B8] bg-[#F7F7F5] text-[#1F1F1F] shadow-[0_18px_48px_rgba(0,0,0,0.28)] overflow-hidden"
      >
        {/* 1C Taxi Reference Window Title */}
        <div className="px-3.5 py-2 bg-[#EFECE6] border-b border-[#D4D0C8] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-[2px] bg-[#E8B923] text-[#1F1F1F] shrink-0">
              <SquareStack className="w-2.5 h-2.5" strokeWidth={2.1} />
            </span>
            <span className="font-semibold text-[13px] text-[#1F1F1F] truncate">
              {meta.title}
            </span>
          </div>
          <button
            type="button"
            aria-label="Закрыть карточку справочника"
            onClick={onClose}
            className="p-1 rounded-[2px] text-[#555] hover:bg-black/10"
          >
            <X className="w-4 h-4" strokeWidth={1.8} />
          </button>
        </div>

        {/* 1C Section Navigation Path */}
        <div className="px-3.5 py-1.5 bg-[#FBF7E8] border-b border-[#E5DEC9] text-[11.5px] text-[#5C5338] flex items-center justify-between gap-2">
          <span className="truncate font-medium">{meta.breadcrumb}</span>
          <span className="text-[11px] text-[#7A7052] whitespace-nowrap">
            {isEditable ? 'Режим правки' : 'Клик по полю копирует значение'}
          </span>
        </div>

        {/* 1C Command Toolbar */}
        <div className="px-3.5 py-2 bg-[#F7F7F5] border-b border-[#E0E0DC] flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleSaveAndClose}
            className="h-[28px] px-3 rounded-[3px] border border-[#D6B018] bg-[#FFDC33] hover:bg-[#F2C924] text-[12px] font-semibold text-[#1F1F1F] whitespace-nowrap transition-colors"
          >
            Записать и закрыть
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-[28px] px-3 rounded-[3px] border border-[#CCCCCC] bg-white hover:bg-[#F2F2F2] text-[12px] text-[#1F1F1F] whitespace-nowrap transition-colors"
          >
            Закрыть
          </button>
          {entityKind === 'counterparty' && isEditable && (
            <button
              type="button"
              onClick={handleGenerateEduInn}
              className="h-[28px] px-2.5 rounded-[3px] border border-[#CCCCCC] bg-white hover:bg-[#FFF9DF] text-[11.5px] text-[#0F5499] whitespace-nowrap transition-colors"
            >
              Сгенерировать валидный ИНН/КПП (ФНС checksum)
            </button>
          )}
        </div>

        {/* Body fields */}
        <div className="p-4 bg-white space-y-2.5 max-h-[68vh] overflow-y-auto">
          {entityKind === 'counterparty' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Вид контрагента:</label>
                <select
                  disabled={!isEditable}
                  value={cpKind}
                  onChange={(e) =>
                    setCpKind(
                      e.target.value as
                        | 'ЮридическоеЛицо'
                        | 'ИндивидуальныйПредприниматель'
                        | 'ФизическоеЛицо'
                    )
                  }
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="ЮридическоеЛицо">Юридическое лицо</option>
                  <option value="ИндивидуальныйПредприниматель">Индивидуальный предприниматель</option>
                  <option value="ФизическоеЛицо">Физическое лицо</option>
                </select>
              </div>
              {renderFieldRow('Наименование', 'cp-name', cpName, setCpName)}
              {renderFieldRow('ИНН', 'cp-inn', cpInn, setCpInn, {
                mono: true,
                widthClass: 'w-48',
              })}
              {cpKind === 'ЮридическоеЛицо' &&
                renderFieldRow('КПП', 'cp-kpp', cpKpp, setCpKpp, {
                  mono: true,
                  widthClass: 'w-48',
                })}
              <div className="pt-2 border-t border-[#EBEBEB] text-[11.5px] font-semibold text-[#333]">
                Банковский счёт и основной договор
              </div>
              {renderFieldRow('БИК банка', 'cp-bik', cpBik, setCpBik, {
                mono: true,
                widthClass: 'w-48',
              })}
              {renderFieldRow('Банк', 'cp-bank', cpBankName, setCpBankName)}
              {renderFieldRow('Номер счёта (р/с)', 'cp-rs', cpBankAcc, setCpBankAcc, {
                mono: true,
              })}
              {renderFieldRow('Основной договор', 'cp-ctr', contractName, setContractName)}
            </>
          )}

          {entityKind === 'contract' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Вид договора:</label>
                <input
                  type="text"
                  readOnly
                  value={
                    op.category.startsWith('sale') ||
                    op.category === 'bank_in' ||
                    op.category === 'customer_invoice'
                      ? 'С покупателем'
                      : 'С поставщиком'
                  }
                  className="h-[27px] px-2 rounded-[2px] border border-[#D8D8D8] bg-[#F7F7F5] text-[12px] text-[#1F1F1F]"
                />
              </div>
              {renderFieldRow('Контрагент', 'ctr-cp', cpName, setCpName)}
              {renderFieldRow('Номер договора', 'ctr-num', contractNumber, setContractNumber, {
                mono: true,
                widthClass: 'w-48',
              })}
              {renderFieldRow('Дата договора', 'ctr-date', contractDate, setContractDate, {
                type: 'date',
                mono: true,
                widthClass: 'w-48',
              })}
              {renderFieldRow('Наименование в 1С', 'ctr-name', contractName, setContractName)}
              <div className="text-[11px] text-[#666] pt-1">
                Расчеты ведутся в: <strong>RUB</strong> · Способ зачета авансов: <strong>Автоматически</strong>
              </div>
            </>
          )}

          {entityKind === 'nomenclature' && (
            <>
              {renderFieldRow('Наименование', 'nom-name', nomName, setNomName)}
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Счёт учёта по умолч.:</label>
                <select
                  disabled={!isEditable}
                  value={nomAccount}
                  onChange={(e) => setNomAccount(e.target.value)}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F] tabular-nums"
                >
                  <option value="10.01">10.01 — Сырье и материалы (Вид: Материалы)</option>
                  <option value="10.03">10.03 — Топливо (ГСМ)</option>
                  <option value="10.08">10.08 — Строительные материалы</option>
                  <option value="10.09">10.09 — Инвентарь и хоз. принадлежности</option>
                  <option value="10.10">10.10 — Специальная оснастка и спецодежда на складе</option>
                  <option value="41.01">41.01 — Товары на складах (Вид: Товары)</option>
                  <option value="43">43 — Готовая продукция (Вид: Продукция)</option>
                  <option value="08.04.1">08.04.1 — Компоненты основных средств (Оборудование)</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Ставка % НДС:</label>
                <select
                  disabled={!isEditable}
                  value={nomVat}
                  onChange={(e) => setNomVat(e.target.value)}
                  className="h-[27px] w-48 px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="20">20%</option>
                  <option value="10">10%</option>
                  <option value="0">Без НДС</option>
                </select>
              </div>
              <div className="text-[11px] text-[#666] pt-1">
                Единица измерения: <strong>шт (код ОКЕИ 796)</strong>. В 1С:БП 3.0 счёт учёта в документе автоматически подставляется из Вида номенклатуры!
              </div>
            </>
          )}

          {entityKind === 'warehouse' && (
            <>
              {renderFieldRow('Наименование склада', 'wh-name', warehouseName, setWarehouseName)}
              <div className="text-[11.5px] text-[#555]">
                Тип склада: <strong>Оптовый склад</strong> (количественно-суммовой учёт МПЗ по партиям / средней).
              </div>
            </>
          )}

          {entityKind === 'employee' && (
            <>
              {renderFieldRow('ФИО сотрудника', 'emp-fio', empName, setEmpName)}
              {renderFieldRow('Должность', 'emp-pos', empPos, setEmpPos)}
              {renderFieldRow('Оклад (руб./мес.)', 'emp-sal', empSalary, setEmpSalary, {
                type: 'number',
                mono: true,
                widthClass: 'w-48',
              })}
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Отражение в бухучёте:</label>
                <select
                  disabled={!isEditable}
                  value={empCostAcc}
                  onChange={(e) => setEmpCostAcc(e.target.value)}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="26">Дт 26 — Общехозяйственные расходы (АУП)</option>
                  <option value="20.01">Дт 20.01 — Основное производство (рабочие)</option>
                  <option value="44.01">Дт 44.01 — Издержки обращения (торговля)</option>
                </select>
              </div>
              {renderFieldRow(
                'Стандартные вычеты (детей)',
                'emp-child',
                empChildren,
                setEmpChildren,
                { type: 'number', mono: true, widthClass: 'w-32' }
              )}
              {matchedEmp && (
                <div className="pt-1.5 border-t border-[#EBEBEB] text-[11px] text-[#555] tabular-nums">
                  Принят: <strong>{formatDateRu(matchedEmp.hireDate)}</strong>
                  {matchedEmp.terminationDate
                    ? ` · Уволен: ${formatDateRu(matchedEmp.terminationDate)}`
                    : ' · Работает в штате'}
                </div>
              )}
            </>
          )}

          {entityKind === 'fixed_asset' && (
            <>
              {renderFieldRow('Наименование объекта ОС', 'os-name', osName, setOsName)}
              {renderFieldRow('СПИ (месяцев)', 'os-spi', osSpi, setOsSpi, {
                type: 'number',
                mono: true,
                widthClass: 'w-40',
              })}
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Счёт начисления аморт.:</label>
                <select
                  disabled={!isEditable}
                  value={osCostAcc}
                  onChange={(e) => setOsCostAcc(e.target.value)}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="20.01">Дт 20.01 Кт 02.01 — Основное производство</option>
                  <option value="25">Дт 25 Кт 02.01 — Общепроизводственные расходы</option>
                  <option value="26">Дт 26 Кт 02.01 — Общехозяйственные расходы</option>
                  <option value="44.01">Дт 44.01 Кт 02.01 — Коммерческие расходы</option>
                </select>
              </div>
              {matchedOs && (
                <div className="pt-2 border-t border-[#EBEBEB] text-[11.5px] text-[#333] space-y-1 tabular-nums">
                  <div>
                    Первоначальная стоимость (01.01):{' '}
                    <strong>{formatMoney(matchedOs.initialCost, true)} ₽</strong>
                  </div>
                  <div>
                    Накопленная амортизация (02.01):{' '}
                    <strong>{formatMoney(matchedOs.accumulatedDepreciation ?? 0, true)} ₽</strong>
                  </div>
                  <div>
                    Ежемесячная норма: <strong>{formatMoney(matchedOs.monthlyDepreciation, true)} ₽/мес</strong> · Статус: {matchedOs.status}
                  </div>
                </div>
              )}
            </>
          )}

          {entityKind === 'rpb_97' && (
            <>
              {renderFieldRow('Наименование РБП', 'rpb-name', nomName, setNomName)}
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Способ списания в 1С:</label>
                <select
                  disabled={!isEditable}
                  value={rpbMethod}
                  onChange={(e) => setRpbMethod(e.target.value as 'calendar_days' | 'monthly')}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="calendar_days">По календарным дням</option>
                  <option value="monthly">По месяцам (равными долями)</option>
                </select>
              </div>
              {renderFieldRow('Срок (месяцев)', 'rpb-months', rpbMonths, setRpbMonths, {
                type: 'number',
                mono: true,
                widthClass: 'w-36',
              })}
              {renderFieldRow('Начало списания (с)', 'rpb-start', rpbStart, setRpbStart, {
                type: 'date',
                mono: true,
                widthClass: 'w-48',
              })}
              {renderFieldRow('Окончание списания (по)', 'rpb-end', rpbEnd, setRpbEnd, {
                type: 'date',
                mono: true,
                widthClass: 'w-48',
              })}
              <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] items-center gap-1.5">
                <label className="text-[12px] text-[#4A4A4A]">Счёт затрат списания:</label>
                <select
                  disabled={!isEditable}
                  value={rpbCostAcc}
                  onChange={(e) => setRpbCostAcc(e.target.value)}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] text-[#1F1F1F]"
                >
                  <option value="26">26 — Общехозяйственные расходы</option>
                  <option value="20.01">20.01 — Основное производство</option>
                  <option value="44.01">44.01 — Издержки обращения</option>
                </select>
              </div>
            </>
          )}

          {entityKind === 'expense_item' &&
            renderFieldRow('Статья затрат', 'exp-item', expItemName, setExpItemName)}

          {entityKind === 'cash_flow_item' &&
            renderFieldRow('Статья ДДС', 'dds-item', ddsItemName, setDdsItemName)}
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { CHART_OF_ACCOUNTS } from '@/data/chartOfAccounts';
import {
  Database1CSnapshot,
  QueuedOperation,
  Virtual1CStateSnapshot,
} from '@/types/accounting';
import {
  ReferenceEntityKind1C,
  SmartFieldHint1C,
  Taxi1CLayoutKind,
} from '@/lib/engine';
import { formatDateRu, formatMoney } from '@/lib/formatters';
import { Modal1CFormSavePatch } from '@/context/AccountantContext';
import { FieldHintPopover1C } from '@/components/FieldHintPopover1C';
import {
  PopoverPricesVat1C,
  PopoverSettlementAccounts1C,
  ReferenceField1C,
  ReferencePickerOption1C,
  UpdFooterBar1C,
} from './Taxi1CControls';

interface Taxi1CLayoutsProps {
  layoutKind: Taxi1CLayoutKind;
  op: QueuedOperation;
  draft: Modal1CFormSavePatch;
  setDraft: React.Dispatch<React.SetStateAction<Modal1CFormSavePatch>>;
  db1C: Database1CSnapshot | null;
  virtualState: Virtual1CStateSnapshot;
  isEditable: boolean;
  hints: Record<string, SmartFieldHint1C>;
  hintsEnabled: boolean;
  walkthroughStep: number | null;
  activeAutoHintKey: string | null;
  onDismissAutoHint: () => void;
  onOpenReferenceCard: (kind: ReferenceEntityKind1C) => void;
  onCopiedNotice: (val: string) => void;
}

export function Taxi1CLayouts({
  layoutKind,
  op,
  draft,
  setDraft,
  db1C,
  virtualState,
  isEditable,
  hints,
  hintsEnabled,
  walkthroughStep,
  activeAutoHintKey,
  onDismissAutoHint,
  onOpenReferenceCard,
  onCopiedNotice,
}: Taxi1CLayoutsProps) {
  const [activeSubTab, setActiveSubTab] = useState<string>('main');
  const [expandedRegGroup, setExpandedRegGroup] = useState<Record<string, boolean>>({
    g1: true,
    g2: true,
    g3: true,
    g4: true,
  });

  const orgName =
    db1C?.organization.name ||
    virtualState.ownOrganization?.name ||
    op.ownOrganization?.name ||
    'Наша организация (ОСНО)';

  // Derived reactive values from draft -> op
  const dateVal = draft.date ?? op.date;
  const docNumVal = draft.docNumber ?? op.docNumber ?? '';
  const incomingNumVal = draft.incomingDocNumber ?? op.incomingDocNumber ?? docNumVal;
  const incomingDateVal = draft.incomingDocDate ?? op.incomingDocDate ?? dateVal;
  const cpNameVal = draft.counterpartyName ?? op.counterpartyName ?? '';
  const contractVal = draft.contractName ?? op.contractName ?? 'Основной договор';
  const warehouseVal = draft.warehouseName ?? op.warehouseName ?? 'Основной склад';
  const nomNameVal =
    draft.nomenclatureName ??
    op.nomenclatureName ??
    op.description.slice(0, 75);
  const nomGroupVal =
    draft.nomenclatureGroupName ??
    op.nomenclatureGroupName ??
    'Основная номенклатурная группа';
  const empNameVal = draft.employeeName ?? op.employeeName ?? '';
  const empPosVal = draft.employeePosition ?? op.employeePosition ?? 'Специалист';
  const salaryVal =
    draft.monthlySalary !== undefined
      ? draft.monthlySalary
      : op.monthlySalary ?? (op.amount > 0 ? op.amount : 0);

  const qtyVal = draft.quantity !== undefined ? draft.quantity : op.quantity ?? 1;
  const vatRateVal = draft.vatRate !== undefined ? draft.vatRate : op.vatRate;
  const vatRuleVal = draft.vatRule ?? op.vatRule;
  const hasSfVal = draft.hasInvoiceSF !== undefined ? draft.hasInvoiceSF : op.hasInvoiceSF;

  const rawAmountVal =
    draft.amount !== undefined
      ? draft.amount
      : op.category === 'hr_hire' && op.monthlySalary
        ? op.monthlySalary
        : op.amount;

  const unitPriceVal = useMemo(() => {
    if (draft.unitPrice !== undefined) return draft.unitPrice;
    if (op.unitPrice && op.unitPrice > 0) return op.unitPrice;
    if (qtyVal > 0 && rawAmountVal > 0) {
      return Math.round((rawAmountVal / qtyVal) * 100) / 100;
    }
    return rawAmountVal;
  }, [draft.unitPrice, op.unitPrice, qtyVal, rawAmountVal]);

  const computedTotal = useMemo(() => {
    if (draft.amount !== undefined) return draft.amount;
    if (
      (draft.quantity !== undefined ||
        draft.unitPrice !== undefined ||
        draft.vatRule !== undefined ||
        draft.vatRate !== undefined) &&
      qtyVal > 0 &&
      unitPriceVal > 0
    ) {
      const base = Math.round(qtyVal * unitPriceVal * 100) / 100;
      return vatRuleVal === 'on_top' && vatRateVal > 0
        ? Math.round(base * (1 + vatRateVal / 100) * 100) / 100
        : base;
    }
    return rawAmountVal;
  }, [
    draft.amount,
    draft.quantity,
    draft.unitPrice,
    draft.vatRule,
    draft.vatRate,
    qtyVal,
    unitPriceVal,
    vatRuleVal,
    vatRateVal,
    rawAmountVal,
  ]);

  const computedVat = useMemo(() => {
    if (vatRateVal <= 0 || vatRuleVal === 'none') return 0;
    if (
      draft.amount === undefined &&
      draft.quantity === undefined &&
      draft.unitPrice === undefined &&
      draft.vatRate === undefined &&
      draft.vatRule === undefined &&
      op.vatAmount > 0
    ) {
      return op.vatAmount;
    }
    return Math.round(((computedTotal * vatRateVal) / (100 + vatRateVal)) * 100) / 100;
  }, [
    vatRateVal,
    vatRuleVal,
    computedTotal,
    op.vatAmount,
    draft.amount,
    draft.quantity,
    draft.unitPrice,
    draft.vatRate,
    draft.vatRule,
  ]);

  const computedNetWithoutVat = Math.max(0, Math.round((computedTotal - computedVat) * 100) / 100);

  const costAccVal =
    draft.costAccount ??
    op.costAccount ??
    (op.category === 'materials_writeoff' || op.category === 'os_commissioning' ? '20.01' : '26');
  const matAccVal =
    draft.materialAccount ??
    op.materialAccount ??
    (op.category === 'purchase_goods' || op.category === 'sale_goods'
      ? op.entries.find((e) => e.credit === '43' || e.debit === '43')
        ? '43'
        : '41.01'
      : op.category === 'purchase_equipment'
        ? '08.04.1'
        : op.category === 'deferred_expense_97'
          ? '97.21'
          : '10.01');

  const expItemVal =
    draft.expenseItemName ?? op.expenseItemName ?? 'Материальные расходы';
  const ddsItemVal =
    draft.cashFlowItemName ??
    op.cashFlowItemName ??
    (op.category === 'bank_in'
      ? 'Поступления от продажи продукции и товаров, выполнения работ, оказания услуг'
      : 'Оплата товаров, работ, услуг, сырья и иных оборотных активов');
  const spiVal = draft.usefulLifeMonths ?? op.usefulLifeMonths ?? 60;
  const bankConfirmedVal =
    draft.bankConfirmed !== undefined ? draft.bankConfirmed : op.includeInProcessing;

  // Live reference options
  const cpOptions = useMemo<ReferencePickerOption1C[]>(() => {
    const seen = new Set<string>();
    const list: ReferencePickerOption1C[] = [];
    for (const c of virtualState.counterparties) {
      if (!c.name || seen.has(c.name.toLowerCase())) continue;
      seen.add(c.name.toLowerCase());
      list.push({
        value: c.name,
        subLabel: c.inn ? `ИНН ${c.inn}` : undefined,
        inn: c.inn,
        kpp: c.kpp,
      });
    }
    for (const c of db1C?.counterparties ?? []) {
      if (!c.name || seen.has(c.name.toLowerCase())) continue;
      seen.add(c.name.toLowerCase());
      list.push({
        value: c.name,
        subLabel: c.inn ? `ИНН ${c.inn}` : undefined,
        inn: c.inn,
        kpp: c.kpp,
        contract: c.defaultContract,
      });
    }
    return list;
  }, [virtualState.counterparties, db1C]);

  const contractOptions = useMemo<ReferencePickerOption1C[]>(() => {
    const cpLow = cpNameVal.trim().toLowerCase();
    const list = virtualState.contracts
      .filter((c) => !cpLow || c.counterpartyName.toLowerCase().includes(cpLow))
      .map((c) => ({
        value: c.name,
        subLabel: c.number ? `№${c.number}` : c.contractKind,
      }));
    if (list.length === 0) {
      list.push({ value: 'Основной договор', subLabel: 'По умолчанию' });
    }
    return list;
  }, [virtualState.contracts, cpNameVal]);

  const nomOptions = useMemo<ReferencePickerOption1C[]>(() => {
    return virtualState.nomenclature.map((n) => ({
      value: n.name,
      subLabel: `Сч. ${n.defaultAccount}`,
    }));
  }, [virtualState.nomenclature]);

  const empOptions = useMemo<ReferencePickerOption1C[]>(() => {
    return virtualState.employees.map((e) => ({
      value: e.fullName,
      subLabel: e.position || `${formatMoney(e.monthlySalary, true)} ₽`,
    }));
  }, [virtualState.employees]);

  const osOptions = useMemo<ReferencePickerOption1C[]>(() => {
    return virtualState.fixedAssets.map((fa) => ({
      value: fa.name,
      subLabel: `${formatMoney(fa.initialCost, true)} ₽ · СПИ ${fa.usefulLifeMonths} мес.`,
    }));
  }, [virtualState.fixedAssets]);

  const warehouseOptions: ReferencePickerOption1C[] = [
    { value: 'Основной склад', subLabel: 'Оптовый' },
    { value: 'Склад материалов', subLabel: 'Производство' },
    { value: 'Склад готовой продукции', subLabel: 'Счёт 43' },
  ];

  const stepRingClass = (step: number) =>
    walkthroughStep === step
      ? 'rounded-[3px] p-2 -m-2 border border-[#D6B018] bg-[#FFFDF2] ring-2 ring-[#FFDC33]/60 transition-all'
      : '';

  const copyIfSample = async (txt: string) => {
    if (isEditable || !txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      onCopiedNotice(txt);
    } catch {
      // Ignore
    }
  };

  // Common Header Row: Номер | от | Организация
  const renderStandardDocHeader = (extraRightNode?: React.ReactNode) => (
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(1)}`}>
      <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[12px] text-[#4A4A4A]">Номер:</span>
          <FieldHintPopover1C
            hint={hints.header_date}
            enabled={hintsEnabled}
            forceOpen={activeAutoHintKey === 'header_date'}
            onDismissForce={onDismissAutoHint}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            readOnly={!isEditable}
            value={docNumVal || '0000-000001'}
            onChange={(e) => setDraft((p) => ({ ...p, docNumber: e.target.value }))}
            onClick={() => void copyIfSample(docNumVal)}
            aria-label="Номер документа 1С"
            className="h-[27px] w-28 px-2 rounded-[2px] border border-[#C4C4C4] focus:outline-none focus:border-[#E6B800] bg-white text-[12px] tabular-nums text-[#1F1F1F]"
          />
          <span className="text-[12px] text-[#4A4A4A]">от:</span>
          <input
            type="date"
            readOnly={!isEditable}
            value={dateVal}
            onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
            aria-label="Дата документа 1С"
            className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] focus:outline-none focus:border-[#E6B800] bg-white text-[12px] tabular-nums text-[#1F1F1F]"
          />
        </div>
      </div>

      {extraRightNode ?? (
        <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
          <span className="text-[12px] text-[#4A4A4A]">Организация:</span>
          <input
            type="text"
            readOnly
            value={orgName}
            className="h-[27px] px-2 rounded-[2px] border border-[#D5D5D5] bg-[#F7F7F5] text-[12px] text-[#333] truncate"
          />
        </div>
      )}
    </div>
  );

  // ============================================================================
  // LAYOUT 1 & 2: Поступление (акт, накладная, УПД) AND Реализация (акт, накладная, УПД)
  // ============================================================================
  if (layoutKind === 'ptu' || layoutKind === 'rtu') {
    const isSale = layoutKind === 'rtu';
    const isServices =
      op.category === 'purchase_services' ||
      op.category === 'sale_services' ||
      op.category === 'deferred_expense_97';
    const isEquipment = op.category === 'purchase_equipment';
    const isRpb = op.category === 'deferred_expense_97';

    const vatAccountDisplay = isSale
      ? '90.03'
      : isEquipment
        ? '19.01'
        : isServices
          ? '19.04'
          : '19.03';

    const rowAccountDisplay = isSale
      ? isServices
        ? '90.01.1 / 90.03'
        : `${matAccVal} → 90.02.1 / 90.01.1`
      : isRpb
        ? '97.21 (РБП)'
        : isServices
          ? `${costAccVal} / ${vatRateVal > 0 ? vatAccountDisplay : 'Без НДС'}`
          : `${matAccVal} / ${vatRateVal > 0 ? vatAccountDisplay : 'Без НДС'}`;

    const tabs = isSale
      ? [
          { id: 'main', label: isServices ? 'Услуги (1)' : 'Товары / Продукция (1)' },
          { id: 'extra', label: 'Дополнительно' },
        ]
      : [
          {
            id: 'main',
            label: isEquipment
              ? 'Оборудование (1)'
              : isServices
                ? 'Услуги (1)'
                : 'Товары / Материалы (1)',
          },
          { id: 'cost', label: isRpb ? 'Параметры РБП (97.21)' : 'Счет затрат' },
          { id: 'extra', label: 'Дополнительно' },
        ];

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {/* Row 1: Вх. номер (for PTU) + Номер / от */}
        {!isSale ? (
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(1)}`}>
            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[12px] text-[#4A4A4A]">Накладная, УПД №:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly={!isEditable}
                  value={incomingNumVal}
                  onChange={(e) => setDraft((p) => ({ ...p, incomingDocNumber: e.target.value }))}
                  placeholder="б/н"
                  className="h-[27px] w-28 px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] tabular-nums"
                />
                <span className="text-[#4A4A4A]">от:</span>
                <input
                  type="date"
                  readOnly={!isEditable}
                  value={incomingDateVal}
                  onChange={(e) => setDraft((p) => ({ ...p, incomingDocDate: e.target.value }))}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[12px] text-[#4A4A4A]">Номер в 1С:</span>
                <FieldHintPopover1C
                  hint={hints.header_date}
                  enabled={hintsEnabled}
                  forceOpen={activeAutoHintKey === 'header_date'}
                  onDismissForce={onDismissAutoHint}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly={!isEditable}
                  value={docNumVal || '0000-000001'}
                  onChange={(e) => setDraft((p) => ({ ...p, docNumber: e.target.value }))}
                  className="h-[27px] w-28 px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] tabular-nums"
                />
                <span className="text-[#4A4A4A]">от:</span>
                <input
                  type="date"
                  readOnly={!isEditable}
                  value={dateVal}
                  onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
                  className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px] tabular-nums"
                />
              </div>
            </div>
          </div>
        ) : (
          renderStandardDocHeader()
        )}

        {/* Row 2: Контрагент, Договор, Склад, Счета расчётов */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
          <ReferenceField1C
            label="Контрагент"
            value={cpNameVal}
            placeholder={isSale ? 'Выберите покупателя' : 'Выберите поставщика'}
            isEditable={isEditable}
            entityKind="counterparty"
            options={cpOptions}
            onChange={(val, picked) =>
              setDraft((p) => ({
                ...p,
                counterpartyName: val,
                ...(picked?.inn ? { counterpartyInn: picked.inn } : {}),
                ...(picked?.kpp ? { counterpartyKpp: picked.kpp } : {}),
                ...(picked?.contract ? { contractName: picked.contract } : {}),
              }))
            }
            onOpenReferenceCard={onOpenReferenceCard}
            hint={hints.counterparty}
            hintsEnabled={hintsEnabled}
            forceOpenHint={activeAutoHintKey === 'counterparty'}
            onDismissForceHint={onDismissAutoHint}
            onCopiedNotice={onCopiedNotice}
          />

          <ReferenceField1C
            label="Договор"
            value={contractVal}
            placeholder="Основной договор"
            isEditable={isEditable}
            entityKind="contract"
            options={contractOptions}
            onChange={(val) => setDraft((p) => ({ ...p, contractName: val }))}
            onOpenReferenceCard={onOpenReferenceCard}
            hintsEnabled={hintsEnabled}
            onCopiedNotice={onCopiedNotice}
          />

          {!isServices && (
            <ReferenceField1C
              label="Склад"
              value={warehouseVal}
              placeholder="Основной склад"
              isEditable={isEditable}
              entityKind="warehouse"
              options={warehouseOptions}
              onChange={(val) => setDraft((p) => ({ ...p, warehouseName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
              onCopiedNotice={onCopiedNotice}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[12px] text-[#4A4A4A]">Расчеты:</span>
            <PopoverSettlementAccounts1C isBuyerSide={isSale} />
          </div>
        </div>

        {/* Subtabs + Blue Hyperlink "НДС в сумме / сверху / Без НДС" */}
        <div className={stepRingClass(3)}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CCCCCC] pb-1">
            <div className="flex items-center gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveSubTab(t.id)}
                  className={`h-[27px] px-3 rounded-t-[3px] border text-[12px] whitespace-nowrap ${
                    activeSubTab === t.id
                      ? 'border-[#C4C4C4] border-b-white bg-white font-semibold text-[#1F1F1F]'
                      : 'border-transparent bg-[#EFECE6] hover:bg-[#E5E1D8] text-[#555]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-[#555]">Цены в документе:</span>
              <PopoverPricesVat1C
                vatRule={vatRuleVal}
                vatRate={vatRateVal}
                isEditable={isEditable}
                onChangeVat={(nextRule, nextRate) =>
                  setDraft((p) => ({ ...p, vatRule: nextRule, vatRate: nextRate }))
                }
              />
              <FieldHintPopover1C
                hint={hints.amount_vat}
                enabled={hintsEnabled}
                forceOpen={activeAutoHintKey === 'amount_vat'}
                onDismissForce={onDismissAutoHint}
              />
            </div>
          </div>

          {activeSubTab === 'main' && (
            <div className="mt-2 overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                    <th className="py-1.5 px-2 w-8 border-r border-[#DFDFDF]">№</th>
                    <th className="py-1.5 px-2 min-w-[210px] border-r border-[#DFDFDF]">
                      {isServices ? 'Номенклатура / Содержание услуги' : 'Номенклатура'}
                    </th>
                    <th className="py-1.5 px-2 w-20 text-right border-r border-[#DFDFDF]">Кол-во</th>
                    <th className="py-1.5 px-2 w-28 text-right border-r border-[#DFDFDF]">Цена</th>
                    <th className="py-1.5 px-2 w-28 text-right border-r border-[#DFDFDF]">Сумма</th>
                    <th className="py-1.5 px-2 w-20 border-r border-[#DFDFDF]">% НДС</th>
                    <th className="py-1.5 px-2 w-24 text-right border-r border-[#DFDFDF]">НДС</th>
                    <th className="py-1.5 px-2 w-28 text-right border-r border-[#DFDFDF]">Всего</th>
                    <th className="py-1.5 px-2 w-36">Счета учета</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-[#FFFDF3]">
                    <td className="py-1.5 px-2 tabular-nums text-[#666] border-r border-[#EFEFEF]">
                      1
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <ReferenceField1C
                        compact
                        placeholder="Номенклатура"
                        value={nomNameVal}
                        isEditable={isEditable}
                        entityKind={isRpb ? 'rpb_97' : 'nomenclature'}
                        options={nomOptions}
                        onChange={(val) => setDraft((p) => ({ ...p, nomenclatureName: val }))}
                        onOpenReferenceCard={onOpenReferenceCard}
                        hintsEnabled={hintsEnabled}
                        onCopiedNotice={onCopiedNotice}
                      />
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="number"
                        step="any"
                        aria-label="Количество"
                        readOnly={!isEditable}
                        value={qtyVal}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            quantity: Math.max(0, Number(e.target.value) || 0),
                            amount: undefined,
                          }))
                        }
                        className="w-full h-[26px] px-1.5 border border-[#D2D2D2] rounded-[2px] text-right tabular-nums bg-white"
                      />
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="number"
                        step="0.01"
                        aria-label="Цена"
                        readOnly={!isEditable}
                        value={unitPriceVal}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            unitPrice: Math.max(0, Number(e.target.value) || 0),
                            amount: undefined,
                          }))
                        }
                        className="w-full h-[26px] px-1.5 border border-[#D2D2D2] rounded-[2px] text-right tabular-nums bg-white"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#333] border-r border-[#EFEFEF]">
                      {formatMoney(computedNetWithoutVat, true)}
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <select
                        aria-label="Ставка НДС"
                        disabled={!isEditable}
                        value={vatRateVal <= 0 || vatRuleVal === 'none' ? '0' : String(vatRateVal)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setDraft((p) => ({
                            ...p,
                            vatRate: v,
                            vatRule: v === 0 ? 'none' : p.vatRule === 'none' ? 'included' : vatRuleVal,
                          }));
                        }}
                        className="w-full h-[26px] px-1 border border-[#D2D2D2] rounded-[2px] bg-white text-[11.5px]"
                      >
                        <option value="20">20%</option>
                        <option value="10">10%</option>
                        <option value="0">Без НДС</option>
                      </select>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-[#333] border-r border-[#EFEFEF]">
                      {formatMoney(computedVat, true)}
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="number"
                        step="0.01"
                        aria-label="Всего с НДС"
                        readOnly={!isEditable}
                        value={computedTotal}
                        onClick={() => void copyIfSample(String(computedTotal))}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            amount: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-full h-[26px] px-1.5 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-semibold bg-white"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <button
                        type="button"
                        onClick={() => onOpenReferenceCard(isRpb ? 'rpb_97' : 'nomenclature')}
                        className="text-[11.5px] font-mono text-[#0055A6] hover:underline whitespace-nowrap"
                      >
                        {rowAccountDisplay}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeSubTab === 'cost' && (
            <div className="mt-2 p-3 border border-[#C8C8C8] rounded-[2px] bg-white grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11.5px] text-[#555]">Счет затрат (Дт):</label>
                <select
                  disabled={!isEditable}
                  value={isRpb ? '97.21' : costAccVal}
                  onChange={(e) => setDraft((p) => ({ ...p, costAccount: e.target.value }))}
                  className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
                >
                  {isRpb && <option value="97.21">97.21 — Прочие расходы будущих периодов</option>}
                  <option value="26">26 — Общехозяйственные расходы</option>
                  <option value="20.01">20.01 — Основное производство</option>
                  <option value="25">25 — Общепроизводственные расходы</option>
                  <option value="44.01">44.01 — Издержки обращения</option>
                </select>
              </div>
              <ReferenceField1C
                label="Статья затрат"
                value={expItemVal}
                isEditable={isEditable}
                entityKind={isRpb ? 'rpb_97' : 'expense_item'}
                onChange={(val) => setDraft((p) => ({ ...p, expenseItemName: val }))}
                onOpenReferenceCard={onOpenReferenceCard}
                hintsEnabled={hintsEnabled}
              />
            </div>
          )}

          {activeSubTab === 'extra' && (
            <div className="mt-2 p-3 border border-[#C8C8C8] rounded-[2px] bg-white space-y-2">
              <label className="block text-[11.5px] text-[#555]">
                Комментарий / исходный текст операции:
              </label>
              <input
                type="text"
                readOnly={!isEditable}
                value={draft.description ?? op.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
              />
              {isSale && (
                <div className="grid grid-cols-1 sm:grid-cols-[165px_1fr] items-center gap-2 pt-1">
                  <span className="text-[11.5px] text-[#555]">Номенклатурная группа:</span>
                  <input
                    type="text"
                    readOnly={!isEditable}
                    value={nomGroupVal}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, nomenclatureGroupName: e.target.value }))
                    }
                    className="h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: Всего + УПД + Счёт-фактура */}
        <UpdFooterBar1C
          isSale={isSale}
          totalAmount={computedTotal}
          vatAmount={computedVat}
          vatRate={vatRateVal}
          hasInvoiceSF={hasSfVal}
          sfNumber={incomingNumVal || docNumVal || '1'}
          sfDate={incomingDateVal || dateVal}
          isEditable={isEditable}
          onToggleInvoiceSF={(v) => setDraft((p) => ({ ...p, hasInvoiceSF: v }))}
          onChangeSfNumber={(v) => setDraft((p) => ({ ...p, incomingDocNumber: v }))}
          onChangeSfDate={(v) => setDraft((p) => ({ ...p, incomingDocDate: v }))}
          hint={hints.footer_sf}
          hintsEnabled={hintsEnabled}
          forceOpenHint={activeAutoHintKey === 'footer_sf'}
          onDismissForceHint={onDismissAutoHint}
          highlighted={walkthroughStep === 4}
        />
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 3: Банк (Поступление на расчётный счёт / Списание с расчётного счёта)
  // ============================================================================
  if (layoutKind === 'bank') {
    const isIncoming =
      op.docType1C === 'ПоступлениеНаРасчетныйСчет' ||
      op.category === 'bank_in' ||
      op.category === 'acquiring_receipt';
    const isTaxPayment = op.category === 'tax_payment';
    const isBankFee = op.category === 'bank_fee';

    const opKind1C = isTaxPayment
      ? 'Уплата налога / взноса в бюджет'
      : isBankFee
        ? 'Комиссия банка (прочее списание 91.02)'
        : op.category === 'acquiring_receipt'
          ? 'Поступление от продаж по платежным картам (57.03)'
          : op.category === 'loan_received'
            ? 'Расчеты по кредитам и займам (получение)'
            : op.category === 'loan_repaid'
              ? 'Расчеты по кредитам и займам (возврат долга / процентов)'
              : isIncoming
                ? 'Оплата от покупателя'
                : 'Оплата поставщику';

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {/* Вид операции + Подтверждено выпиской банка */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[#E2E0D8]">
          <div className="flex items-center gap-2">
            <span className="text-[#4A4A4A]">Вид операции:</span>
            <span className="px-2.5 py-1 rounded-[2px] border border-[#C4C4C4] bg-white font-semibold text-[#1F1F1F]">
              {opKind1C}
            </span>
          </div>

          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-[3px] border ${
              walkthroughStep === 4
                ? 'border-[#D6B018] bg-[#FFFDF2] ring-2 ring-[#FFDC33]/60'
                : 'border-[#CFE3D2] bg-[#F2FAF3]'
            }`}
          >
            <label className="inline-flex items-center gap-1.5 font-semibold text-[#1E6B28] cursor-pointer">
              <input
                type="checkbox"
                checked={bankConfirmedVal}
                disabled={!isEditable}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, bankConfirmed: e.target.checked }))
                }
                className="rounded-[2px] border-[#2C8237]"
              />
              <span>Подтверждено выпиской банка</span>
            </label>
            <FieldHintPopover1C
              hint={hints.bank_confirmed}
              enabled={hintsEnabled}
              forceOpen={activeAutoHintKey === 'bank_confirmed'}
              onDismissForce={onDismissAutoHint}
            />
          </div>
        </div>

        {renderStandardDocHeader(
          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Вх. номер п/п:</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly={!isEditable}
                value={incomingNumVal}
                onChange={(e) => setDraft((p) => ({ ...p, incomingDocNumber: e.target.value }))}
                placeholder="№ п/п"
                className="h-[27px] w-28 px-2 rounded-[2px] border border-[#C4C4C4] bg-white tabular-nums"
              />
              <span className="text-[#4A4A4A]">от:</span>
              <input
                type="date"
                readOnly={!isEditable}
                value={incomingDateVal}
                onChange={(e) => setDraft((p) => ({ ...p, incomingDocDate: e.target.value }))}
                className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white tabular-nums"
              />
            </div>
          </div>
        )}

        {/* Плательщик/Получатель + Договор */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
          <ReferenceField1C
            label={isIncoming ? 'Плательщик' : 'Получатель'}
            value={cpNameVal || (isTaxPayment ? 'УФК (ФНС России — ЕНС)' : isBankFee ? 'ПАО Сбербанк' : '')}
            placeholder="Контрагент"
            isEditable={isEditable}
            entityKind="counterparty"
            options={cpOptions}
            onChange={(val, picked) =>
              setDraft((p) => ({
                ...p,
                counterpartyName: val,
                ...(picked?.inn ? { counterpartyInn: picked.inn } : {}),
                ...(picked?.kpp ? { counterpartyKpp: picked.kpp } : {}),
              }))
            }
            onOpenReferenceCard={onOpenReferenceCard}
            hint={hints.counterparty}
            hintsEnabled={hintsEnabled}
            forceOpenHint={activeAutoHintKey === 'counterparty'}
            onDismissForceHint={onDismissAutoHint}
            onCopiedNotice={onCopiedNotice}
          />

          {!isTaxPayment && !isBankFee && (
            <ReferenceField1C
              label="Договор"
              value={contractVal}
              isEditable={isEditable}
              entityKind="contract"
              options={contractOptions}
              onChange={(val) => setDraft((p) => ({ ...p, contractName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
              onCopiedNotice={onCopiedNotice}
            />
          )}
        </div>

        {/* Сумма + НДС + Статья ДДС + Счета расчетов */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(3)}`}>
          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[#4A4A4A]">Сумма платежа:</span>
              <FieldHintPopover1C
                hint={hints.amount_vat}
                enabled={hintsEnabled}
                forceOpen={activeAutoHintKey === 'amount_vat'}
                onDismissForce={onDismissAutoHint}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                readOnly={!isEditable}
                value={computedTotal}
                onClick={() => void copyIfSample(String(computedTotal))}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, amount: Math.max(0, Number(e.target.value) || 0) }))
                }
                className="h-[27px] w-44 px-2 rounded-[2px] border border-[#C4C4C4] focus:border-[#E6B800] bg-white text-right tabular-nums font-bold text-[13px]"
              />
              <span className="text-[#555]">руб.</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Ставка НДС:</span>
            <div className="flex items-center gap-2 tabular-nums">
              <select
                disabled={!isEditable || isTaxPayment || isBankFee}
                value={vatRateVal > 0 ? String(vatRateVal) : '0'}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  setDraft((p) => ({
                    ...p,
                    vatRate: r,
                    vatRule: r > 0 ? 'included' : 'none',
                  }));
                }}
                className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white"
              >
                <option value="20">20% (в т.ч.)</option>
                <option value="10">10% (в т.ч.)</option>
                <option value="0">Без НДС</option>
              </select>
              <span className="text-[#555]">
                Сумма НДС: <strong>{formatMoney(computedVat, true)} ₽</strong>
              </span>
            </div>
          </div>

          <ReferenceField1C
            label="Статья ДДС"
            value={ddsItemVal}
            isEditable={isEditable}
            entityKind="cash_flow_item"
            onChange={(val) => setDraft((p) => ({ ...p, cashFlowItemName: val }))}
            onOpenReferenceCard={onOpenReferenceCard}
            hintsEnabled={hintsEnabled}
          />

          {!isTaxPayment && !isBankFee && (
            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Погашение долга:</span>
              <PopoverSettlementAccounts1C isBuyerSide={isIncoming} />
            </div>
          )}
        </div>

        {/* Назначение платежа */}
        <div className="space-y-1 pt-1">
          <label className="block text-[11.5px] text-[#4A4A4A]">Назначение платежа:</label>
          <textarea
            rows={2}
            readOnly={!isEditable}
            value={draft.description ?? op.description}
            onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
            className="w-full p-2 rounded-[2px] border border-[#C4C4C4] bg-white text-[12px]"
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 4: Касса (ПКО / РКО) + Авансовый отчёт (71.01)
  // ============================================================================
  if (layoutKind === 'cash_ao') {
    const isAo = op.docType1C === 'АвансовыйОтчет' || op.category === 'expense_report';
    const isPko =
      op.docType1C === 'ПоступлениеНаличных' ||
      op.category === 'cash_in' ||
      op.category === 'cash_bank_internal';

    if (isAo) {
      const aoTabs = [
        { id: 'main', label: 'Товары / Расходы (1)' },
        { id: 'adv', label: 'Авансы (71.01)' },
        { id: 'other', label: 'Прочее (командировочные / услуги)' },
      ];
      return (
        <div className="space-y-3 text-[12px] text-[#1F1F1F]">
          {renderStandardDocHeader()}
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
            <ReferenceField1C
              label="Подотчетное лицо"
              value={empNameVal || cpNameVal}
              placeholder="Выберите сотрудника (счёт 71.01)"
              isEditable={isEditable}
              entityKind="employee"
              options={empOptions}
              onChange={(val) => setDraft((p) => ({ ...p, employeeName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hint={hints.employee}
              hintsEnabled={hintsEnabled}
              forceOpenHint={activeAutoHintKey === 'employee'}
              onDismissForceHint={onDismissAutoHint}
              onCopiedNotice={onCopiedNotice}
            />
            <ReferenceField1C
              label="Склад прихода"
              value={warehouseVal}
              isEditable={isEditable}
              entityKind="warehouse"
              options={warehouseOptions}
              onChange={(val) => setDraft((p) => ({ ...p, warehouseName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
            />
          </div>

          <div className={stepRingClass(3)}>
            <div className="flex items-center justify-between border-b border-[#CCCCCC] pb-1">
              <div className="flex items-center gap-1">
                {aoTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveSubTab(t.id)}
                    className={`h-[27px] px-3 rounded-t-[3px] border text-[12px] ${
                      activeSubTab === t.id
                        ? 'border-[#C4C4C4] border-b-white bg-white font-semibold'
                        : 'border-transparent bg-[#EFECE6] text-[#555]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <FieldHintPopover1C
                hint={hints.amount_vat}
                enabled={hintsEnabled}
                forceOpen={activeAutoHintKey === 'amount_vat'}
                onDismissForce={onDismissAutoHint}
              />
            </div>

            <div className="mt-2 overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                    <th className="py-1.5 px-2 w-8 border-r border-[#DFDFDF]">№</th>
                    <th className="py-1.5 px-2 border-r border-[#DFDFDF]">Документ расхода (чек) / Номенклатура</th>
                    <th className="py-1.5 px-2 w-24 text-right border-r border-[#DFDFDF]">Кол-во</th>
                    <th className="py-1.5 px-2 w-32 text-right border-r border-[#DFDFDF]">Сумма (руб.)</th>
                    <th className="py-1.5 px-2 w-40">Счет учета / затрат (Дт)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1.5 px-2 tabular-nums border-r border-[#EFEFEF]">1</td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="text"
                        readOnly={!isEditable}
                        value={nomNameVal}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, nomenclatureName: e.target.value }))
                        }
                        className="w-full h-[26px] px-2 border border-[#D2D2D2] rounded-[2px]"
                      />
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="number"
                        readOnly={!isEditable}
                        value={qtyVal}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, quantity: Number(e.target.value) || 1 }))
                        }
                        className="w-full h-[26px] px-1.5 border border-[#D2D2D2] rounded-[2px] text-right tabular-nums"
                      />
                    </td>
                    <td className="p-1 border-r border-[#EFEFEF]">
                      <input
                        type="number"
                        step="0.01"
                        readOnly={!isEditable}
                        value={computedTotal}
                        onChange={(e) =>
                          setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))
                        }
                        className="w-full h-[26px] px-1.5 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-semibold"
                      />
                    </td>
                    <td className="p-1">
                      <select
                        disabled={!isEditable}
                        value={op.entries[0]?.debit || costAccVal}
                        onChange={(e) => setDraft((p) => ({ ...p, costAccount: e.target.value }))}
                        className="w-full h-[26px] px-1.5 border border-[#D2D2D2] rounded-[2px] font-mono text-[#0055A6]"
                      >
                        <option value="10.09">10.09 — Хоз. инвентарь</option>
                        <option value="10.01">10.01 — Материалы</option>
                        <option value="10.03">10.03 — Топливо (ГСМ)</option>
                        <option value="26">26 — Командировочные / АУП</option>
                        <option value="20.01">20.01 — Основное производство</option>
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    // ПКО / РКО
    const cashOpKind = isPko
      ? op.category === 'cash_bank_internal'
        ? 'Получение наличных в банке (Дт 50.01 Кт 51)'
        : op.category === 'accountable_return'
          ? 'Возврат от подотчетного лица (Дт 50.01 Кт 71.01)'
          : 'Оплата от покупателя / прочий приход'
      : op.category === 'accountable_issue'
        ? 'Выдача подотчетному лицу (Дт 71.01 Кт 50.01)'
        : 'Взнос наличными в банк / выплата через кассу';

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        <div className="flex items-center gap-2 pb-2 border-b border-[#E2E0D8]">
          <span className="text-[#4A4A4A]">Вид операции кассового ордера:</span>
          <span className="px-2.5 py-1 rounded-[2px] border border-[#C4C4C4] bg-white font-semibold">
            {cashOpKind}
          </span>
        </div>

        {renderStandardDocHeader()}

        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
          {(op.category === 'accountable_issue' || op.category === 'accountable_return' || empNameVal) && (
            <ReferenceField1C
              label={isPko ? 'Принято от (71.01)' : 'Выдать (71.01)'}
              value={empNameVal}
              placeholder="Сотрудник (подотчётное лицо)"
              isEditable={isEditable}
              entityKind="employee"
              options={empOptions}
              onChange={(val) => setDraft((p) => ({ ...p, employeeName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hint={hints.employee}
              hintsEnabled={hintsEnabled}
              onCopiedNotice={onCopiedNotice}
            />
          )}

          <div className={`grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5 ${stepRingClass(3)}`}>
            <div className="flex items-center gap-1">
              <span className="text-[#4A4A4A]">Сумма ордера:</span>
              <FieldHintPopover1C
                hint={hints.amount_vat}
                enabled={hintsEnabled}
                forceOpen={activeAutoHintKey === 'amount_vat'}
                onDismissForce={onDismissAutoHint}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                readOnly={!isEditable}
                value={computedTotal}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))
                }
                className="h-[27px] w-44 px-2 rounded-[2px] border border-[#C4C4C4] bg-white text-right tabular-nums font-bold text-[13px]"
              />
              <span className="text-[#555]">руб. (Без НДС)</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="block text-[11.5px] text-[#4A4A4A]">Основание (текст в ПКО / РКО):</label>
          <input
            type="text"
            readOnly={!isEditable}
            value={draft.description ?? op.description}
            onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
            className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
          />
          {op.category === 'cash_bank_internal' && (
            <div className="p-2 rounded-[2px] border border-[#E5D387] bg-[#FFF9E0] text-[11.5px] text-[#5C4900]">
              Правило 1С:БП 3.0: внутреннее перемещение между счётом 51 и кассой 50.01 проводится <strong>ТОЛЬКО кассовым ордером</strong> (ПКО / РКО) — банковская выписка проводку не формирует во избежание задвоения оборота!
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 5: Расход материалов (Требование-накладная) / Передача в эксплуатацию
  // ============================================================================
  if (layoutKind === 'materials_writeoff') {
    const isWorkwear = op.docType1C === 'ПередачаМатериаловВЭксплуатацию' || op.category === 'workwear_issue';

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {renderStandardDocHeader(
          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Вид операции:</span>
            <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-medium">
              {isWorkwear ? 'Передача спецодежды в эксплуатацию (МЦ.02)' : 'Использование материалов (в производство)'}
            </span>
          </div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
          <ReferenceField1C
            label="Склад отпуска"
            value={warehouseVal}
            isEditable={isEditable}
            entityKind="warehouse"
            options={warehouseOptions}
            onChange={(val) => setDraft((p) => ({ ...p, warehouseName: val }))}
            onOpenReferenceCard={onOpenReferenceCard}
            hintsEnabled={hintsEnabled}
          />

          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Счет затрат (Дт):</span>
            <select
              disabled={!isEditable}
              value={costAccVal}
              onChange={(e) => setDraft((p) => ({ ...p, costAccount: e.target.value }))}
              className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white font-mono text-[#0055A6] font-semibold"
            >
              <option value="20.01">20.01 — Основное производство</option>
              <option value="25">25 — Общепроизводственные расходы</option>
              <option value="26">26 — Общехозяйственные расходы</option>
              <option value="44.01">44.01 — Издержки обращения</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Номенкл. группа:</span>
            <input
              type="text"
              readOnly={!isEditable}
              value={nomGroupVal}
              onChange={(e) =>
                setDraft((p) => ({ ...p, nomenclatureGroupName: e.target.value }))
              }
              className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white"
            />
          </div>

          <ReferenceField1C
            label="Статья затрат"
            value={expItemVal}
            isEditable={isEditable}
            entityKind="expense_item"
            onChange={(val) => setDraft((p) => ({ ...p, expenseItemName: val }))}
            onOpenReferenceCard={onOpenReferenceCard}
            hintsEnabled={hintsEnabled}
          />
        </div>

        {/* Authentic pedagogical callout explaining why there is NO Price column in 1C РасходМатериалов */}
        <div className="p-2.5 rounded-[2px] border border-[#E2CF82] bg-[#FFF9E3] text-[11.5px] text-[#4E3F00] flex items-center justify-between gap-2">
          <span>
            В реальной форме <strong>«Расход материалов» 1С:БП 3.0 нет колонки «Цена» и нет НДС</strong>: вы указываете только номенклатуру и количество, а 1С сама списывает себестоимость со счёта 10 ({formatMoney(computedTotal, true)} ₽) по партиям / средней!
          </span>
          <FieldHintPopover1C
            hint={hints.amount_vat}
            enabled={hintsEnabled}
            forceOpen={activeAutoHintKey === 'amount_vat'}
            onDismissForce={onDismissAutoHint}
          />
        </div>

        <div className={`overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white ${stepRingClass(3)}`}>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                <th className="py-1.5 px-2.5 w-9 border-r border-[#DFDFDF]">№</th>
                <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Номенклатура (материал)</th>
                <th className="py-1.5 px-2.5 w-28 text-right border-r border-[#DFDFDF]">Количество</th>
                <th className="py-1.5 px-2.5 w-20 border-r border-[#DFDFDF]">Ед.</th>
                <th className="py-1.5 px-2.5 w-36 border-r border-[#DFDFDF]">Счет учета (Кт)</th>
                <th className="py-1.5 px-2.5 w-44 text-right">Расчётная себестоимость 1С</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1.5 px-2.5 tabular-nums border-r border-[#EFEFEF]">1</td>
                <td className="p-1 border-r border-[#EFEFEF]">
                  <ReferenceField1C
                    compact
                    value={nomNameVal}
                    isEditable={isEditable}
                    entityKind="nomenclature"
                    options={nomOptions}
                    onChange={(val) => setDraft((p) => ({ ...p, nomenclatureName: val }))}
                    onOpenReferenceCard={onOpenReferenceCard}
                    hintsEnabled={hintsEnabled}
                  />
                </td>
                <td className="p-1 border-r border-[#EFEFEF]">
                  <input
                    type="number"
                    step="any"
                    readOnly={!isEditable}
                    value={qtyVal}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, quantity: Math.max(0, Number(e.target.value) || 0) }))
                    }
                    className="w-full h-[26px] px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-semibold"
                  />
                </td>
                <td className="py-1.5 px-2.5 text-[#555] border-r border-[#EFEFEF]">шт / ед.</td>
                <td className="py-1.5 px-2.5 font-mono text-[#0055A6] font-semibold border-r border-[#EFEFEF]">
                  {isWorkwear ? '10.10' : op.entries[0]?.credit || '10.01'}
                </td>
                <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold text-[#333] bg-[#F9F9F7]">
                  {formatMoney(computedTotal, true)} ₽
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 6: Принятие к учёту ОС / НМА / Передача ОС
  // ============================================================================
  if (layoutKind === 'os_nma') {
    const isNma = op.docType1C === 'ПринятиеКУчетуНМА' || op.category === 'intangible_commissioning';
    const isDisposal = op.docType1C === 'ПередачаОС' || op.docType1C === 'СписаниеОС' || op.category === 'os_disposal';

    const osTabs = [
      { id: 'main', label: 'Внеоборотный актив' },
      { id: 'os', label: isNma ? 'Нематериальные активы' : 'Основные средства' },
      { id: 'bu', label: 'Бухгалтерский учет' },
      { id: 'nu', label: 'Налоговый учет' },
    ];

    const monthlyDepr = spiVal > 0 ? Math.round((computedTotal / spiVal) * 100) / 100 : 0;

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {renderStandardDocHeader(
          <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Вид операции:</span>
            <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-medium">
              {isDisposal
                ? 'Выбытие ОС через счёт 01.09'
                : isNma
                  ? 'Принятие к учету НМА (08.05 → 04.01)'
                  : 'Оборудование (ввод в эксплуатацию 08.04.1 → 01.01)'}
            </span>
          </div>
        )}

        {isDisposal && (
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
            <ReferenceField1C
              label="Покупатель ОС"
              value={cpNameVal}
              placeholder="Контрагент (при продаже ОС)"
              isEditable={isEditable}
              entityKind="counterparty"
              options={cpOptions}
              onChange={(val) => setDraft((p) => ({ ...p, counterpartyName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
            />
            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Выручка с НДС:</span>
              <input
                type="number"
                step="0.01"
                readOnly={!isEditable}
                value={computedTotal}
                onChange={(e) => setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
                className="h-[27px] w-44 px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-bold"
              />
            </div>
          </div>
        )}

        <div className={stepRingClass(3)}>
          <div className="flex items-center justify-between border-b border-[#CCCCCC] pb-1">
            <div className="flex flex-wrap items-center gap-1">
              {osTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveSubTab(t.id)}
                  className={`h-[27px] px-3 rounded-t-[3px] border text-[12px] ${
                    activeSubTab === t.id
                      ? 'border-[#C4C4C4] border-b-white bg-white font-semibold'
                      : 'border-transparent bg-[#EFECE6] text-[#555]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <FieldHintPopover1C
              hint={hints.amount_vat}
              enabled={hintsEnabled}
              forceOpen={activeAutoHintKey === 'amount_vat'}
              onDismissForce={onDismissAutoHint}
            />
          </div>

          <div className="mt-2 p-3 border border-[#C8C8C8] rounded-[2px] bg-white grid grid-cols-1 md:grid-cols-2 gap-3">
            <ReferenceField1C
              label={isNma ? 'Объект НМА' : 'Основное средство'}
              value={nomNameVal}
              isEditable={isEditable}
              entityKind="fixed_asset"
              options={osOptions}
              onChange={(val) => setDraft((p) => ({ ...p, nomenclatureName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
              onCopiedNotice={onCopiedNotice}
            />

            <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Первонач. стоимость:</span>
              <input
                type="number"
                step="0.01"
                readOnly={!isEditable}
                value={computedTotal}
                onChange={(e) => setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
                className="h-[27px] w-44 px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-bold"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Счет учета → Аморт.:</span>
              <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-mono text-[#0055A6] font-semibold">
                {isNma ? '08.05 → 04.01 (аморт. 05)' : '08.04.1 → 01.01 (аморт. 02.01)'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">СПИ (в месяцах):</span>
              <div className="flex items-center gap-2 tabular-nums">
                <input
                  type="number"
                  min={1}
                  readOnly={!isEditable}
                  value={spiVal}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      usefulLifeMonths: Math.max(1, Math.round(Number(e.target.value) || 60)),
                    }))
                  }
                  className="h-[27px] w-24 px-2 border border-[#C4C4C4] rounded-[2px] text-right font-semibold"
                />
                <span className="text-[11.5px] text-[#555]">
                  мес. ({formatMoney(monthlyDepr, true)} ₽/мес.)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Способ отражения:</span>
              <select
                disabled={!isEditable}
                value={costAccVal}
                onChange={(e) => setDraft((p) => ({ ...p, costAccount: e.target.value }))}
                className="h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white font-mono text-[#0055A6]"
              >
                <option value="20.01">Дт 20.01 — Основное производство</option>
                <option value="25">Дт 25 — Общепроизводственные расходы</option>
                <option value="26">Дт 26 — Общехозяйственные расходы</option>
                <option value="44.01">Дт 44.01 — Коммерческие расходы</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" checked readOnly className="rounded-[2px]" />
              <span className="font-medium text-[#1E6B28]">
                Начислять амортизацию (линейный способ БУ и НУ со следующего месяца)
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 7: Зарплата и кадры (Приём на работу / Начисление зарплаты / Ведомость)
  // ============================================================================
  if (layoutKind === 'hr_payroll') {
    const isHire = op.docType1C === 'ПриемНаРаботу' || op.category === 'hr_hire';
    const isPayout =
      op.docType1C === 'ВедомостьВБанк' ||
      op.docType1C === 'ВедомостьВКассу' ||
      op.category === 'payroll_payout';

    if (isHire) {
      return (
        <div className="space-y-3 text-[12px] text-[#1F1F1F]">
          {renderStandardDocHeader()}

          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2.5 ${stepRingClass(2)}`}>
            <ReferenceField1C
              label="Сотрудник"
              value={empNameVal}
              placeholder="ФИО сотрудника"
              isEditable={isEditable}
              entityKind="employee"
              options={empOptions}
              onChange={(val) => setDraft((p) => ({ ...p, employeeName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hint={hints.employee}
              hintsEnabled={hintsEnabled}
              forceOpenHint={activeAutoHintKey === 'employee'}
              onDismissForceHint={onDismissAutoHint}
              onCopiedNotice={onCopiedNotice}
            />

            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Должность:</span>
              <input
                type="text"
                readOnly={!isEditable}
                value={empPosVal}
                onChange={(e) => setDraft((p) => ({ ...p, employeePosition: e.target.value }))}
                className="h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
              />
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5 ${stepRingClass(3)}`}>
              <div className="flex items-center gap-1">
                <span className="text-[#4A4A4A]">Оклад (тариф):</span>
                <FieldHintPopover1C
                  hint={hints.amount_vat}
                  enabled={hintsEnabled}
                  forceOpen={activeAutoHintKey === 'amount_vat'}
                  onDismissForce={onDismissAutoHint}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="100"
                  readOnly={!isEditable}
                  value={salaryVal}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, monthlySalary: Number(e.target.value) || 0 }))
                  }
                  className="h-[27px] w-40 px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-bold"
                />
                <span className="text-[#555]">руб./мес.</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Счет затрат ЗП:</span>
              <select
                disabled={!isEditable}
                value={costAccVal}
                onChange={(e) => setDraft((p) => ({ ...p, costAccount: e.target.value }))}
                className="h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white font-mono text-[#0055A6]"
              >
                <option value="26">26 — АУП (администрация)</option>
                <option value="20.01">20.01 — Основное производство</option>
                <option value="44.01">44.01 — Коммерческий персонал</option>
              </select>
            </div>
          </div>

          <div className="p-2.5 rounded-[2px] border border-[#DCDAD2] bg-[#FAF9F5] text-[11.5px] text-[#555]">
            Кадровый документ <strong>не делает бухгалтерских проводок</strong> в день приказа — он записывает оклад, дату приёма/перевода/увольнения и счёт затрат в регистр сведений для последующего расчёта документа «Начисление зарплаты».
          </div>
        </div>
      );
    }

    if (isPayout) {
      return (
        <div className="space-y-3 text-[12px] text-[#1F1F1F]">
          {renderStandardDocHeader()}
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(3)}`}>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Выплата через:</span>
              <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-medium">
                {op.docType1C === 'ВедомостьВКассу' ? 'Кассу (Кт 50.01)' : 'Зарплатный проект в банке (Кт 51)'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[#4A4A4A]">К выплате на руки:</span>
                <FieldHintPopover1C
                  hint={hints.amount_vat}
                  enabled={hintsEnabled}
                  forceOpen={activeAutoHintKey === 'amount_vat'}
                  onDismissForce={onDismissAutoHint}
                />
              </div>
              <input
                type="number"
                step="0.01"
                readOnly={!isEditable}
                value={computedTotal}
                onChange={(e) => setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
                className="h-[27px] w-44 px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-bold"
              />
            </div>
          </div>
        </div>
      );
    }

    // Начисление зарплаты и взносов (tabs: Начисления, НДФЛ, Взносы)
    const staffRows =
      op.payrollStaffSummary && op.payrollStaffSummary.length > 0
        ? op.payrollStaffSummary
        : [
            {
              name: empNameVal || 'Штатные сотрудники организации',
              position: empPosVal,
              costAccount: (costAccVal as '20.01' | '26' | '44.01') || '26',
              salary: computedTotal,
              fullMonthlySalary: salaryVal || computedTotal,
              workedDays: 20,
              totalWorkingDays: 20,
              source: 'Расчёт за месяц',
            },
          ];

    const totalGross = op.entries
      .filter((e) => e.credit === '70')
      .reduce((s, e) => s + e.amount, 0) || computedTotal;
    const totalNdfl = op.entries
      .filter((e) => e.debit === '70' && e.credit === '68.01')
      .reduce((s, e) => s + e.amount, 0);
    const totalIns6909 = op.entries
      .filter((e) => e.credit === '69.09')
      .reduce((s, e) => s + e.amount, 0);
    const totalInj6911 = op.entries
      .filter((e) => e.credit === '69.11')
      .reduce((s, e) => s + e.amount, 0);

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {renderStandardDocHeader(
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-center gap-1.5">
            <span className="text-[#4A4A4A]">Месяц начисления:</span>
            <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-semibold tabular-nums">
              {formatDateRu(dateVal).slice(3)}
            </span>
          </div>
        )}

        <div className={stepRingClass(3)}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CCCCCC] pb-1">
            <div className="flex items-center gap-1">
              {[
                { id: 'main', label: `Начисления (${staffRows.length})` },
                { id: 'ndfl', label: `НДФЛ 13% (${formatMoney(totalNdfl, true)} ₽)` },
                {
                  id: 'ins',
                  label: `Взносы 30% + 0,2% (${formatMoney(totalIns6909 + totalInj6911, true)} ₽)`,
                },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveSubTab(t.id)}
                  className={`h-[27px] px-3 rounded-t-[3px] border text-[12px] ${
                    activeSubTab === t.id
                      ? 'border-[#C4C4C4] border-b-white bg-white font-semibold'
                      : 'border-transparent bg-[#EFECE6] text-[#555]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <FieldHintPopover1C
              hint={hints.amount_vat}
              enabled={hintsEnabled}
              forceOpen={activeAutoHintKey === 'amount_vat'}
              onDismissForce={onDismissAutoHint}
            />
          </div>

          {activeSubTab === 'main' && (
            <div className="mt-2 overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                    <th className="py-1.5 px-2.5 w-8 border-r border-[#DFDFDF]">№</th>
                    <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Сотрудник</th>
                    <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Должность</th>
                    <th className="py-1.5 px-2.5 w-28 text-center border-r border-[#DFDFDF]">Отработано дн.</th>
                    <th className="py-1.5 px-2.5 w-28 border-r border-[#DFDFDF]">Счет Дт</th>
                    <th className="py-1.5 px-2.5 w-36 text-right">Начислено (Кт 70)</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-[#EBEBEB] last:border-b-0">
                      <td className="py-1.5 px-2.5 tabular-nums border-r border-[#EFEFEF]">{idx + 1}</td>
                      <td className="py-1.5 px-2.5 font-medium border-r border-[#EFEFEF]">
                        <button
                          type="button"
                          onClick={() => onOpenReferenceCard('employee')}
                          className="text-[#0055A6] hover:underline text-left"
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="py-1.5 px-2.5 text-[#555] border-r border-[#EFEFEF]">
                        {row.position || 'Штат'}
                      </td>
                      <td className="py-1.5 px-2.5 text-center tabular-nums border-r border-[#EFEFEF]">
                        {row.workedDays && row.totalWorkingDays
                          ? `${row.workedDays} / ${row.totalWorkingDays}`
                          : 'Полный мес.'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono text-[#0055A6] font-semibold border-r border-[#EFEFEF]">
                        {row.costAccount || costAccVal}
                      </td>
                      <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold">
                        {formatMoney(row.salary, true)} ₽
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeSubTab === 'ndfl' && (
            <div className="mt-2 p-3 border border-[#C8C8C8] rounded-[2px] bg-white space-y-1.5 tabular-nums">
              <div>
                Налоговая база ФОТ: <strong>{formatMoney(totalGross, true)} ₽</strong>
              </div>
              <div>
                Удержан НДФЛ 13% (Дт 70 Кт 68.01): <strong>{formatMoney(totalNdfl, true)} ₽</strong>
              </div>
              <div className="text-[11px] text-[#555]">
                Стандартные детские (1 400 ₽) и имущественные вычеты учтены автоматически по данным карточек сотрудников.
              </div>
            </div>
          )}

          {activeSubTab === 'ins' && (
            <div className="mt-2 p-3 border border-[#C8C8C8] rounded-[2px] bg-white space-y-1.5 tabular-nums">
              <div>
                Единый тариф страховых взносов 30% (Кт 69.09):{' '}
                <strong>{formatMoney(totalIns6909, true)} ₽</strong>
              </div>
              <div>
                Взносы на травматизм СФР {op.injuryInsuranceRate ?? 0.2}% (Кт 69.11):{' '}
                <strong>{formatMoney(totalInj6911, true)} ₽</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 8: Счёт покупателю / Выпуск продукции (43) / Книга покупок и продаж
  // ============================================================================
  if (layoutKind === 'invoice_prod_vat') {
    const isProd = op.docType1C === 'ВыпускПродукции' || op.category === 'production_output';
    const isVatDoc =
      op.docType1C === 'СчетФактураВыданный' ||
      op.docType1C === 'СчетФактураПолученный' ||
      op.category === 'advance_vat' ||
      op.category === 'vat_deduction';

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        {renderStandardDocHeader()}

        {!isProd && (
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
            <ReferenceField1C
              label="Контрагент"
              value={cpNameVal}
              isEditable={isEditable}
              entityKind="counterparty"
              options={cpOptions}
              onChange={(val) => setDraft((p) => ({ ...p, counterpartyName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hint={hints.counterparty}
              hintsEnabled={hintsEnabled}
            />
            <ReferenceField1C
              label="Договор"
              value={contractVal}
              isEditable={isEditable}
              entityKind="contract"
              options={contractOptions}
              onChange={(val) => setDraft((p) => ({ ...p, contractName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
            />
          </div>
        )}

        {isProd && (
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 ${stepRingClass(2)}`}>
            <ReferenceField1C
              label="Склад выпуска"
              value={warehouseVal}
              isEditable={isEditable}
              entityKind="warehouse"
              options={warehouseOptions}
              onChange={(val) => setDraft((p) => ({ ...p, warehouseName: val }))}
              onOpenReferenceCard={onOpenReferenceCard}
              hintsEnabled={hintsEnabled}
            />
            <div className="grid grid-cols-1 sm:grid-cols-[128px_1fr] items-center gap-1.5">
              <span className="text-[#4A4A4A]">Счет затрат (Кт):</span>
              <span className="h-[27px] px-2 flex items-center rounded-[2px] border border-[#D4D4D4] bg-[#F7F7F5] font-mono text-[#0055A6] font-semibold">
                Дт 43 Кт 20.01 ({nomGroupVal})
              </span>
            </div>
          </div>
        )}

        <div className={`p-3 border border-[#C8C8C8] rounded-[2px] bg-white grid grid-cols-1 md:grid-cols-3 gap-3 ${stepRingClass(3)}`}>
          <div className="md:col-span-2">
            <label className="block text-[11.5px] text-[#555] mb-1">
              {isProd ? 'Выпущенная готовая продукция (счёт 43):' : isVatDoc ? 'Основание записи книги покупок / продаж:' : 'Номенклатура / Предмет счёта:'}
            </label>
            <input
              type="text"
              readOnly={!isEditable}
              value={nomNameVal}
              onChange={(e) => setDraft((p) => ({ ...p, nomenclatureName: e.target.value }))}
              className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11.5px] text-[#555]">Сумма документа:</label>
              <FieldHintPopover1C
                hint={hints.amount_vat}
                enabled={hintsEnabled}
                forceOpen={activeAutoHintKey === 'amount_vat'}
                onDismissForce={onDismissAutoHint}
              />
            </div>
            <input
              type="number"
              step="0.01"
              readOnly={!isEditable}
              value={computedTotal}
              onChange={(e) => setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
              className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-bold"
            />
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT 9: Закрытие месяца (регламентная обработка) OR ОперацияБух (ручная)
  // ============================================================================
  const isMonthClosing =
    op.docType1C === 'ЗакрытиеМесяца' ||
    op.category === 'closing' ||
    op.category === 'depreciation_accrual' ||
    op.category === 'intangible_amortization';

  if (isMonthClosing) {
    const groups = [
      {
        id: 'g1',
        title: '1. Начисление амортизации ОС (02.01), НМА (05) и списание РБП (97.21)',
        entries: op.entries.filter(
          (e) => e.credit === '02.01' || e.credit === '05' || e.credit === '97.21'
        ),
      },
      {
        id: 'g2',
        title: '2. Закрытие счетов затрат 20.01, 25, 26 (директ-костинг → 90.08.1) и 44.01 (→ 90.07.1)',
        entries: op.entries.filter(
          (e) =>
            ['20.01', '25', '26', '44.01'].includes(e.credit) &&
            !['02.01', '05', '97.21'].includes(e.debit)
        ),
      },
      {
        id: 'g3',
        title: '3. Финансовый результат: закрытие счетов 90.09 и 91.09 на счёт 99.01.1',
        entries: op.entries.filter(
          (e) =>
            (e.debit === '90.09' && e.credit === '99.01.1') ||
            (e.debit === '99.01.1' && e.credit === '90.09') ||
            (e.debit === '91.09' && e.credit === '99.01.1') ||
            (e.debit === '99.01.1' && e.credit === '91.09')
        ),
      },
      {
        id: 'g4',
        title: dateVal.endsWith('-12-31')
          ? '4. Расчёт налога на прибыль (99.02.1 ↔ 68.04.1) и Реформация баланса на 31.12 (→ 84)'
          : '4. Расчёт налога на прибыль организаций нарастающим итогом (99.02.1 ↔ 68.04.1)',
        entries: op.entries.filter(
          (e) =>
            e.debit === '99.02.1' ||
            e.credit === '99.02.1' ||
            e.debit.startsWith('84') ||
            e.credit.startsWith('84') ||
            (e.credit === '90.09' && e.debit !== '99.01.1') ||
            (e.debit === '90.09' && e.credit !== '99.01.1') ||
            (e.credit === '91.09' && e.debit !== '99.01.1') ||
            (e.debit === '91.09' && e.credit !== '99.01.1')
        ),
      },
    ];

    return (
      <div className="space-y-3 text-[12px] text-[#1F1F1F]">
        <div className={`flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-[#DCDAD2] ${stepRingClass(1)}`}>
          <div className="flex items-center gap-3">
            <span className="text-[#4A4A4A]">Период закрытия:</span>
            <input
              type="date"
              readOnly={!isEditable}
              value={dateVal}
              onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
              className="h-[27px] px-2 rounded-[2px] border border-[#C4C4C4] bg-white font-semibold tabular-nums"
            />
            <span className="inline-flex items-center gap-1 text-[#1E6B28] font-semibold">
              <CheckCircle2 className="w-4 h-4" strokeWidth={1.8} />
              Состояние: Выполнено ({op.entries.length} регл. проводок)
            </span>
          </div>
          <FieldHintPopover1C
            hint={hints.amount_vat}
            enabled={hintsEnabled}
            forceOpen={activeAutoHintKey === 'amount_vat'}
            onDismissForce={onDismissAutoHint}
          />
        </div>

        <div className={`space-y-2 ${stepRingClass(3)}`}>
          {groups.map((grp) => {
            const sumGrp = grp.entries.reduce((s, e) => s + e.amount, 0);
            const open = Boolean(expandedRegGroup[grp.id]);
            return (
              <div
                key={grp.id}
                className="rounded-[2px] border border-[#CCCCCC] bg-white overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedRegGroup((prev) => ({ ...prev, [grp.id]: !prev[grp.id] }))
                  }
                  className="w-full px-3 py-2 bg-[#F6F5F0] hover:bg-[#EFECE2] flex items-center justify-between gap-2 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#555] shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#555] shrink-0" />
                    )}
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        grp.entries.length > 0 ? 'text-[#207227]' : 'text-[#999]'
                      }`}
                      strokeWidth={1.9}
                    />
                    <span className="font-semibold text-[#1F1F1F] truncate">{grp.title}</span>
                  </div>
                  <span className="text-[11.5px] tabular-nums font-semibold text-[#333] shrink-0">
                    {grp.entries.length > 0
                      ? `Выполнено · ${grp.entries.length} пров. (${formatMoney(sumGrp, true)} ₽)`
                      : 'Не требуется в этом месяце'}
                  </span>
                </button>

                {open && grp.entries.length > 0 && (
                  <div className="border-t border-[#E2E2E2] overflow-x-auto">
                    <table className="w-full border-collapse text-[11.5px]">
                      <tbody>
                        {grp.entries.map((e) => (
                          <tr key={e.id} className="border-b border-[#F0F0F0] last:border-b-0">
                            <td className="py-1 px-3 w-28 font-mono font-semibold text-[#0055A6] whitespace-nowrap">
                              Дт {e.debit}
                            </td>
                            <td className="py-1 px-2 w-28 font-mono font-semibold text-[#0055A6] whitespace-nowrap">
                              Кт {e.credit}
                            </td>
                            <td className="py-1 px-3 text-[#444]">{e.description}</td>
                            <td className="py-1 px-3 w-36 text-right tabular-nums font-semibold whitespace-nowrap">
                              {formatMoney(e.amount, true)} ₽
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Операция, введенная вручную (ОперацияБух)
  const leafAccounts = CHART_OF_ACCOUNTS.filter((a) => !a.isGroup);
  const manualRows =
    draft.customPostings ??
    op.customPostings ??
    (op.entries.length > 0
      ? op.entries.map((e) => ({
          debit: e.debit,
          credit: e.credit,
          debitSubconto: e.debitSubconto,
          creditSubconto: e.creditSubconto,
          amount: e.amount,
          description: e.description,
        }))
      : [
          {
            debit: '26',
            credit: '60.01',
            debitSubconto: '',
            creditSubconto: cpNameVal,
            amount: computedTotal,
            description: op.description,
          },
        ]);

  return (
    <div className="space-y-3 text-[12px] text-[#1F1F1F]">
      <datalist id="manual-leaf-accounts-1c">
        {leafAccounts.map((acc) => (
          <option key={acc.code} value={acc.code}>
            {acc.name}
          </option>
        ))}
      </datalist>

      {renderStandardDocHeader()}

      <div className={`grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3 ${stepRingClass(2)}`}>
        <div>
          <label className="block text-[11.5px] text-[#4A4A4A] mb-1">Содержание операции:</label>
          <input
            type="text"
            readOnly={!isEditable}
            value={draft.description ?? op.description}
            onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
            className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11.5px] text-[#4A4A4A]">Сумма операции:</label>
            <FieldHintPopover1C
              hint={hints.amount_vat}
              enabled={hintsEnabled}
              forceOpen={activeAutoHintKey === 'amount_vat'}
              onDismissForce={onDismissAutoHint}
            />
          </div>
          <input
            type="number"
            step="0.01"
            readOnly={!isEditable}
            value={computedTotal}
            onChange={(e) => setDraft((p) => ({ ...p, amount: Number(e.target.value) || 0 }))}
            className="w-full h-[27px] px-2 border border-[#C4C4C4] rounded-[2px] bg-white text-right tabular-nums font-bold"
          />
        </div>
      </div>

      <div className={`space-y-2 ${stepRingClass(3)}`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#333]">Бухгалтерский и налоговый учет (проводки):</span>
          {isEditable && (
            <button
              type="button"
              onClick={() =>
                setDraft((p) => ({
                  ...p,
                  customPostings: [
                    ...manualRows,
                    {
                      debit: '26',
                      credit: '60.01',
                      amount: 0,
                      description: draft.description ?? op.description,
                    },
                  ],
                }))
              }
              className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-[2px] border border-[#CCCCCC] bg-white hover:bg-[#FFF8DC] text-[11.5px] font-medium"
            >
              <Plus className="w-3.5 h-3.5 text-[#207227]" strokeWidth={2} />
              Добавить
            </button>
          )}
        </div>

        <div className="overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                <th className="py-1.5 px-2 w-8 border-r border-[#DFDFDF]">№</th>
                <th className="py-1.5 px-2 w-24 border-r border-[#DFDFDF]">Счет Дт</th>
                <th className="py-1.5 px-2 border-r border-[#DFDFDF]">Субконто Дт</th>
                <th className="py-1.5 px-2 w-24 border-r border-[#DFDFDF]">Счет Кт</th>
                <th className="py-1.5 px-2 border-r border-[#DFDFDF]">Субконто Кт</th>
                <th className="py-1.5 px-2 w-32 text-right border-r border-[#DFDFDF]">Сумма</th>
                <th className="py-1.5 px-2">Содержание</th>
                {isEditable && <th className="py-1.5 px-1 w-8" />}
              </tr>
            </thead>
            <tbody>
              {manualRows.map((row, idx) => (
                <tr key={idx} className="border-b border-[#EBEBEB] last:border-b-0">
                  <td className="py-1 px-2 tabular-nums text-[#666] border-r border-[#EFEFEF]">
                    {idx + 1}
                  </td>
                  <td className="p-1 border-r border-[#EFEFEF]">
                    <input
                      type="text"
                      readOnly={!isEditable}
                      list="manual-leaf-accounts-1c"
                      value={row.debit}
                      onChange={(e) => {
                        const next = [...manualRows];
                        next[idx] = { ...row, debit: e.target.value };
                        setDraft((p) => ({ ...p, customPostings: next }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] font-mono font-semibold text-[#0055A6]"
                    />
                  </td>
                  <td className="p-1 border-r border-[#EFEFEF]">
                    <input
                      type="text"
                      readOnly={!isEditable}
                      value={row.debitSubconto || ''}
                      onChange={(e) => {
                        const next = [...manualRows];
                        next[idx] = { ...row, debitSubconto: e.target.value };
                        setDraft((p) => ({ ...p, customPostings: next }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                    />
                  </td>
                  <td className="p-1 border-r border-[#EFEFEF]">
                    <input
                      type="text"
                      readOnly={!isEditable}
                      list="manual-leaf-accounts-1c"
                      value={row.credit}
                      onChange={(e) => {
                        const next = [...manualRows];
                        next[idx] = { ...row, credit: e.target.value };
                        setDraft((p) => ({ ...p, customPostings: next }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] font-mono font-semibold text-[#0055A6]"
                    />
                  </td>
                  <td className="p-1 border-r border-[#EFEFEF]">
                    <input
                      type="text"
                      readOnly={!isEditable}
                      value={row.creditSubconto || ''}
                      onChange={(e) => {
                        const next = [...manualRows];
                        next[idx] = { ...row, creditSubconto: e.target.value };
                        setDraft((p) => ({ ...p, customPostings: next }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                    />
                  </td>
                  <td className="p-1 border-r border-[#EFEFEF]">
                    <input
                      type="number"
                      step="0.01"
                      readOnly={!isEditable}
                      value={row.amount ?? 0}
                      onChange={(e) => {
                        const amt = Number(e.target.value) || 0;
                        const next = [...manualRows];
                        next[idx] = { ...row, amount: amt };
                        setDraft((p) => ({
                          ...p,
                          customPostings: next,
                          amount: next.reduce((s, r) => s + (Number(r.amount) || 0), 0),
                        }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-semibold"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="text"
                      readOnly={!isEditable}
                      value={row.description || ''}
                      onChange={(e) => {
                        const next = [...manualRows];
                        next[idx] = { ...row, description: e.target.value };
                        setDraft((p) => ({ ...p, customPostings: next }));
                      }}
                      className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                    />
                  </td>
                  {isEditable && (
                    <td className="p-1 text-center">
                      <button
                        type="button"
                        aria-label="Удалить проводку"
                        onClick={() => {
                          const next = manualRows.filter((_, i) => i !== idx);
                          setDraft((p) => ({ ...p, customPostings: next }));
                        }}
                        className="p-1 text-[#888] hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.7} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

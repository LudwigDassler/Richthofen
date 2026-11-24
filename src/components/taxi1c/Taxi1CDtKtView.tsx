'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CHART_OF_ACCOUNTS } from '@/data/chartOfAccounts';
import { QueuedOperation } from '@/types/accounting';
import { build1CRegistersImpact, SmartFieldHint1C } from '@/lib/engine';
import { formatMoney } from '@/lib/formatters';
import { FieldHintPopover1C } from '@/components/FieldHintPopover1C';

interface CustomPostingDraftRow {
  debit: string;
  credit: string;
  debitSubconto?: string;
  creditSubconto?: string;
  amount?: number;
  description?: string;
}

interface Taxi1CDtKtViewProps {
  op: QueuedOperation;
  isEditable: boolean;
  customRows: CustomPostingDraftRow[];
  onChangeCustomRows: (rows: CustomPostingDraftRow[]) => void;
  hint?: SmartFieldHint1C;
  hintsEnabled: boolean;
  forceOpenHint?: boolean;
  onDismissForceHint?: () => void;
}

export function Taxi1CDtKtView({
  op,
  isEditable,
  customRows,
  onChangeCustomRows,
  hint,
  hintsEnabled,
  forceOpenHint,
  onDismissForceHint,
}: Taxi1CDtKtViewProps) {
  const [subTab, setSubTab] = useState<'postings' | 'registers'>('postings');
  const [manualOverride, setManualOverride] = useState<boolean>(op.docType1C === 'ОперацияБух');

  const registerRows = build1CRegistersImpact(op);
  const leafAccounts = CHART_OF_ACCOUNTS.filter((a) => !a.isGroup);

  const enableManualAdjust = isEditable && manualOverride;

  const handleToggleManualOverride = (checked: boolean) => {
    setManualOverride(checked);
    if (checked && customRows.length === 0 && op.entries.length > 0) {
      onChangeCustomRows(
        op.entries.map((e) => ({
          debit: e.debit,
          credit: e.credit,
          debitSubconto: e.debitSubconto,
          creditSubconto: e.creditSubconto,
          amount: e.amount,
          description: e.description,
        }))
      );
    }
  };

  const totalDt = op.entries
    .filter((e) => !e.isOffBalance)
    .reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-3 text-[12px] text-[#1F1F1F]">
      <datalist id="taxi1c-leaf-accounts">
        {leafAccounts.map((acc) => (
          <option key={acc.code} value={acc.code}>
            {acc.name}
          </option>
        ))}
      </datalist>

      {/* Top bar of Дт/Кт window */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#DCDAD2]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSubTab('postings')}
            className={`h-[28px] px-3 rounded-t-[3px] border text-[12px] font-medium whitespace-nowrap ${
              subTab === 'postings'
                ? 'border-[#C4C4C4] border-b-white bg-white text-[#1F1F1F] font-semibold'
                : 'border-transparent bg-[#EFECE6] hover:bg-[#E5E1D8] text-[#555]'
            }`}
          >
            Бухгалтерский и налоговый учет ({op.entries.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('registers')}
            className={`h-[28px] px-3 rounded-t-[3px] border text-[12px] font-medium whitespace-nowrap ${
              subTab === 'registers'
                ? 'border-[#C4C4C4] border-b-white bg-white text-[#1F1F1F] font-semibold'
                : 'border-transparent bg-[#EFECE6] hover:bg-[#E5E1D8] text-[#555]'
            }`}
          >
            Регистры 1С: влияние на учет ({registerRows.length})
          </button>
          {hint && (
            <div className="ml-1.5">
              <FieldHintPopover1C
                hint={hint}
                enabled={hintsEnabled}
                forceOpen={forceOpenHint}
                onDismissForce={onDismissForceHint}
              />
            </div>
          )}
        </div>

        {subTab === 'postings' && isEditable && (
          <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#444] cursor-pointer">
            <input
              type="checkbox"
              checked={manualOverride}
              onChange={(e) => handleToggleManualOverride(e.target.checked)}
              className="rounded-[2px] border-[#999]"
            />
            <span>Ручная корректировка (разрешает редактирование движений документа)</span>
          </label>
        )}
      </div>

      {subTab === 'postings' ? (
        <div className="space-y-2.5">
          {enableManualAdjust ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-[#6E5600] font-medium">
                  Режим ручной правки движений: после изменения нажмите жёлтую кнопку «Провести» или «Провести и закрыть».
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChangeCustomRows([
                      ...customRows,
                      {
                        debit: '26',
                        credit: '60.01',
                        debitSubconto: '',
                        creditSubconto: op.counterpartyName || '',
                        amount: op.amount || 0,
                        description: op.description,
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-[2px] border border-[#CCCCCC] bg-white hover:bg-[#FFF8DC] text-[11.5px] font-medium"
                >
                  <Plus className="w-3.5 h-3.5 text-[#207227]" strokeWidth={2} />
                  Добавить проводку
                </button>
              </div>

              <div className="overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#444]">
                      <th className="py-1.5 px-2 w-8 border-r border-[#DFDFDF]">№</th>
                      <th className="py-1.5 px-2 w-24 border-r border-[#DFDFDF]">Счет Дт</th>
                      <th className="py-1.5 px-2 border-r border-[#DFDFDF]">Субконто Дт</th>
                      <th className="py-1.5 px-2 w-24 border-r border-[#DFDFDF]">Счет Кт</th>
                      <th className="py-1.5 px-2 border-r border-[#DFDFDF]">Субконто Кт</th>
                      <th className="py-1.5 px-2 w-32 text-right border-r border-[#DFDFDF]">Сумма</th>
                      <th className="py-1.5 px-2">Содержание</th>
                      <th className="py-1.5 px-1.5 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {customRows.map((row, i) => (
                      <tr key={i} className="border-b border-[#EBEBEB] last:border-b-0">
                        <td className="py-1 px-2 tabular-nums text-[#666] border-r border-[#EFEFEF]">
                          {i + 1}
                        </td>
                        <td className="p-1 border-r border-[#EFEFEF]">
                          <input
                            type="text"
                            list="taxi1c-leaf-accounts"
                            value={row.debit}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, debit: e.target.value };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] font-mono font-semibold text-[#0055A6]"
                          />
                        </td>
                        <td className="p-1 border-r border-[#EFEFEF]">
                          <input
                            type="text"
                            value={row.debitSubconto || ''}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, debitSubconto: e.target.value };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                          />
                        </td>
                        <td className="p-1 border-r border-[#EFEFEF]">
                          <input
                            type="text"
                            list="taxi1c-leaf-accounts"
                            value={row.credit}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, credit: e.target.value };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] font-mono font-semibold text-[#0055A6]"
                          />
                        </td>
                        <td className="p-1 border-r border-[#EFEFEF]">
                          <input
                            type="text"
                            value={row.creditSubconto || ''}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, creditSubconto: e.target.value };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                          />
                        </td>
                        <td className="p-1 border-r border-[#EFEFEF]">
                          <input
                            type="number"
                            step="0.01"
                            value={row.amount ?? 0}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, amount: Number(e.target.value) || 0 };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px] text-right tabular-nums font-semibold"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={row.description || ''}
                            onChange={(e) => {
                              const next = [...customRows];
                              next[i] = { ...row, description: e.target.value };
                              onChangeCustomRows(next);
                            }}
                            className="w-full h-[25px] px-1.5 border border-[#C4C4C4] rounded-[2px]"
                          />
                        </td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            aria-label="Удалить строку проводки"
                            onClick={() =>
                              onChangeCustomRows(customRows.filter((_, idx) => idx !== i))
                            }
                            className="p-1 text-[#888] hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.7} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : op.entries.length === 0 ? (
            <div className="p-4 rounded-[3px] border border-[#DCDAD2] bg-[#FAF9F5] text-[12px] text-[#555]">
              Этот вид документа в 1С:Бухгалтерия 8.3 (<strong>{op.docType1C}</strong>) фиксирует управленческие / кадровые данные или счёт на оплату и <strong>не формирует бухгалтерских проводок Дт/Кт</strong> в Главной книге. Переключитесь на вкладку «Регистры 1С: влияние на учет», чтобы увидеть, какие регистры он заполняет.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                    <th className="py-1.5 px-2.5 w-9 border-r border-[#DFDFDF]">№</th>
                    <th className="py-1.5 px-2.5 w-24 border-r border-[#DFDFDF]">Счет Дт</th>
                    <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Субконто Дт</th>
                    <th className="py-1.5 px-2.5 w-24 border-r border-[#DFDFDF]">Счет Кт</th>
                    <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Субконто Кт</th>
                    <th className="py-1.5 px-2.5 w-32 text-right border-r border-[#DFDFDF]">Сумма (БУ)</th>
                    <th className="py-1.5 px-2.5">Содержание проводки</th>
                  </tr>
                </thead>
                <tbody>
                  {op.entries.map((entry, idx) => (
                    <tr
                      key={entry.id}
                      className="border-b border-[#EBEBEB] last:border-b-0 hover:bg-[#FFFDF2]"
                    >
                      <td className="py-1.5 px-2.5 tabular-nums text-[#666] border-r border-[#EFEFEF]">
                        {idx + 1}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono font-semibold text-[#0055A6] border-r border-[#EFEFEF] whitespace-nowrap">
                        {entry.debit || '—'}
                      </td>
                      <td className="py-1.5 px-2.5 text-[#2B2B2B] border-r border-[#EFEFEF]">
                        {entry.debitSubconto || '—'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono font-semibold text-[#0055A6] border-r border-[#EFEFEF] whitespace-nowrap">
                        {entry.credit || '—'}
                      </td>
                      <td className="py-1.5 px-2.5 text-[#2B2B2B] border-r border-[#EFEFEF]">
                        {entry.creditSubconto || '—'}
                      </td>
                      <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold text-[#1F1F1F] border-r border-[#EFEFEF] whitespace-nowrap">
                        {formatMoney(entry.amount, true)}
                      </td>
                      <td className="py-1.5 px-2.5 text-[#444]">{entry.description}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F7F6F2] border-t border-[#CCCCCC] font-semibold">
                    <td colSpan={5} className="py-1.5 px-2.5 text-right text-[#444]">
                      Оборот по балансовым проводкам документа (Σ Дт = Σ Кт):
                    </td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-[#1F1F1F] border-l border-r border-[#DFDFDF]">
                      {formatMoney(totalDt, true)}
                    </td>
                    <td className="py-1.5 px-2.5 text-[11px] text-[#207227]">
                      Проведен без расхождений
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto border border-[#C8C8C8] rounded-[2px] bg-white">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F3F2EE] border-b border-[#CCCCCC] text-left text-[11.5px] text-[#333]">
                <th className="py-1.5 px-2.5 w-10 border-r border-[#DFDFDF]">Вид</th>
                <th className="py-1.5 px-2.5 w-64 border-r border-[#DFDFDF]">Регистр 1С:БП 3.0</th>
                <th className="py-1.5 px-2.5 border-r border-[#DFDFDF]">Измерения / Субконто</th>
                <th className="py-1.5 px-2.5 w-36 text-right border-r border-[#DFDFDF]">Ресурс / Сумма</th>
                <th className="py-1.5 px-2.5">Что это даёт в учёте и отчётности</th>
              </tr>
            </thead>
            <tbody>
              {registerRows.map((reg) => (
                <tr key={reg.id} className="border-b border-[#EBEBEB] last:border-b-0 hover:bg-[#FFFDF2]">
                  <td className="py-1.5 px-2.5 text-center font-bold border-r border-[#EFEFEF]">
                    <span
                      className={
                        reg.movementSign === '+'
                          ? 'text-[#1F7A2E]'
                          : reg.movementSign === '−'
                            ? 'text-[#B43232]'
                            : 'text-[#0055A6]'
                      }
                    >
                      {reg.movementSign}
                    </span>
                  </td>
                  <td className="py-1.5 px-2.5 border-r border-[#EFEFEF]">
                    <div className="font-semibold text-[#1F1F1F]">{reg.registerName}</div>
                    <div className="text-[10.5px] text-[#666]">{reg.registerKind}</div>
                  </td>
                  <td className="py-1.5 px-2.5 text-[#333] border-r border-[#EFEFEF]">
                    {reg.analytics}
                  </td>
                  <td className="py-1.5 px-2.5 text-right tabular-nums font-semibold text-[#1F1F1F] border-r border-[#EFEFEF]">
                    {reg.amountOrValue}
                  </td>
                  <td className="py-1.5 px-2.5 text-[#444]">{reg.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

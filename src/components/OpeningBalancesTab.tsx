'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Link2,
  Plus,
  Scale,
  Trash2,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { useAccountant } from '@/context/AccountantContext';
import { CHART_OF_ACCOUNTS, getAccountInfo } from '@/data/chartOfAccounts';
import { BusinessOperation, OpeningBalanceEntry, OrganizationCard } from '@/types/accounting';
import { Import1CDataPanel } from '@/components/Import1CDataPanel';

function formatRub(amount: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ₽'
  );
}

function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function findDependentOperations(
  row: OpeningBalanceEntry,
  operations: BusinessOperation[]
): BusinessOperation[] {
  const rowRoot = row.accountCode.split('.')[0];
  const rowContract = (row.subconto2 || '').toLowerCase();
  const rowSub1 = (row.subconto1 || '').toLowerCase();

  return operations.filter((op) => {
    if (op.isMonthEndClosing) return false;

    if (op.smartLink) {
      const ruleCode = op.smartLink.accountCode;
      const codeMatches =
        row.accountCode === ruleCode ||
        row.accountCode.startsWith(`${ruleCode}.`) ||
        (ruleCode.includes('68') && (rowRoot === '68' || rowRoot === '69')) ||
        rowRoot === ruleCode.split('.')[0];

      if (codeMatches) {
        if (op.smartLink.matchContract) {
          const token = op.smartLink.matchContract.replace(/[^\dа-яa-z-]/gi, '').toLowerCase();
          if (
            token &&
            (rowContract.includes(token) ||
              (row.comment || '').toLowerCase().includes(token))
          ) {
            return true;
          }
          return false;
        }
        return true;
      }
    }

    if (
      row.accountCode === '50.01' &&
      op.postings.some((p) => p.creditAccount === '50.01')
    ) {
      return true;
    }

    if (op.explicitAmount === null) {
      const desc = op.rawDescription.toLowerCase();
      if (rowContract.includes('177') && desc.includes('177')) return true;
      if ((rowRoot === '68' || rowRoot === '69') && /налог|взнос|бюджет/.test(desc)) {
        return true;
      }
      if (rowRoot === '70' && /зарплат|заработн/.test(desc)) {
        return true;
      }
      if (rowSub1 && rowSub1.length > 4 && desc.includes(rowSub1.slice(0, 6))) {
        return true;
      }
    }

    return false;
  });
}

export function OpeningBalancesTab() {
  const {
    organization,
    effectiveOrganization,
    updateOrganization,
    openingBalances,
    addOpeningBalance,
    updateOpeningBalance,
    removeOpeningBalance,
    balanceOpeningDifferenceTo84,
    operations,
    selectOperationAndNavigate,
    setActiveTab,
  } = useAccountant();

  const leafAccounts = useMemo(
    () => CHART_OF_ACCOUNTS.filter((acc) => !acc.isGroup && acc.code !== '000'),
    []
  );

  const [newAccountCode, setNewAccountCode] = useState('60.01');
  const [newSubconto1, setNewSubconto1] = useState('');
  const [newSubconto2, setNewSubconto2] = useState('');
  const [newDebit, setNewDebit] = useState('');
  const [newCredit, setNewCredit] = useState('');

  const { totalDebit, totalCredit, diff, isBalanced } = useMemo(() => {
    const dt = roundMoney(
      openingBalances.reduce((sum, r) => sum + (Number(r.debit) || 0), 0)
    );
    const kt = roundMoney(
      openingBalances.reduce((sum, r) => sum + (Number(r.credit) || 0), 0)
    );
    const d = roundMoney(dt - kt);
    return {
      totalDebit: dt,
      totalCredit: kt,
      diff: d,
      isBalanced: Math.abs(d) < 0.01,
    };
  }, [openingBalances]);

  const handleAddRow = (e: React.FormEvent) => {
    e.preventDefault();
    const dt = roundMoney(Math.max(0, Number(newDebit.replace(',', '.')) || 0));
    const kt = roundMoney(Math.max(0, Number(newCredit.replace(',', '.')) || 0));

    addOpeningBalance({
      accountCode: newAccountCode,
      subconto1: newSubconto1.trim() || undefined,
      subconto2: newSubconto2.trim() || undefined,
      debit: dt,
      credit: kt,
    });

    setNewSubconto1('');
    setNewSubconto2('');
    setNewDebit('');
    setNewCredit('');
  };

  const vatOptions: Array<{ label: string; value: number }> = [
    { label: '20% (стандартная)', value: 20 },
    { label: '22% (с 2026 / вар.)', value: 22 },
    { label: '10% (льготная)', value: 10 },
    { label: '0% (экспорт)', value: 0 },
    { label: 'Без НДС', value: -1 },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      {/* Top Guide Bar + Primary Next Action */}
      <div className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Scale className="w-4 h-4 text-zinc-500 dark:text-zinc-400 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            Загрузите Excel-файл ОСВ из 1С за 1 квартал (и при наличии ОСВ по счетам 60, 68, 70 или клиент-банк) — программа перенесет сальдо на 31 марта как входящие остатки на 1 апреля и подставит недостающие суммы в операции.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('navigator')}
          className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 transition-colors"
        >
          <span>Далее: Пошаговый разбор и реквизиты →</span>
        </button>
      </div>

      {/* 1C:Бухгалтерия 8.3 Closed Q1 Data Import */}
      <Import1CDataPanel />

      {/* Opening Balances Table & Live Balance Check */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Главное → Помощник ввода остатков (на 01.04)
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Входящие остатки по счетам и привязка к операциям задачи
            </h2>
          </div>
        </div>

        {/* Live Balance Check Banner */}
        <div
          className={`p-3.5 rounded-md border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
            openingBalances.length === 0
              ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
              : isBalanced
                ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {openingBalances.length > 0 && isBalanced ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            )}

            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {openingBalances.length === 0
                  ? 'Остатки пусты — загрузите файл ОСВ за 1 квартал выше или добавьте строки вручную'
                  : isBalanced
                    ? 'Баланс сходится до копейки! Вспомогательный счет 000 закрыт в ноль.'
                    : `Актив не равен Пассиву на ${formatRub(Math.abs(diff))} (остаток на счете 000)`}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                <span>
                  Актив (Дт): <strong>{formatRub(totalDebit)}</strong>
                </span>
                <span>
                  Пассив (Кт): <strong>{formatRub(totalCredit)}</strong>
                </span>
              </div>
            </div>
          </div>

          {!isBalanced && openingBalances.length > 0 && (
            <button
              type="button"
              onClick={balanceOpeningDifferenceTo84}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>Сбалансировать разницу на счет 84.01</span>
            </button>
          )}
        </div>

        {/* Editable Opening Balances Table */}
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAFA] dark:bg-[#09090B] text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 px-2.5 font-semibold w-48">Счет 1С</th>
                <th className="py-2 px-2.5 font-semibold">Субконто 1 (Контрагент / Налог / ОС)</th>
                <th className="py-2 px-2.5 font-semibold">Субконто 2 (Договор / Склад)</th>
                <th className="py-2 px-2.5 font-semibold text-right w-32">Сальдо Дт, ₽</th>
                <th className="py-2 px-2.5 font-semibold text-right w-32">Сальдо Кт, ₽</th>
                <th className="py-2 px-2.5 font-semibold">Привязка</th>
                <th className="py-2 px-2 font-semibold text-center w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {openingBalances.map((row) => {
                const accInfo = getAccountInfo(row.accountCode);
                const linkedOps = findDependentOperations(row, operations);

                return (
                  <tr
                    key={row.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="py-1.5 px-2.5 align-middle">
                      <select
                        value={row.accountCode}
                        onChange={(e) =>
                          updateOpeningBalance(row.id, { accountCode: e.target.value })
                        }
                        title={accInfo.name}
                        className="w-full px-2 py-1 rounded-md text-xs font-mono tabular-nums font-semibold bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                      >
                        {!leafAccounts.some((a) => a.code === row.accountCode) && (
                          <option value={row.accountCode}>{row.accountCode}</option>
                        )}
                        {leafAccounts.map((acc) => (
                          <option key={acc.code} value={acc.code}>
                            {acc.code} — {acc.name.slice(0, 28)}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-1.5 px-2.5 align-middle">
                      <input
                        type="text"
                        value={row.subconto1 || ''}
                        onChange={(e) =>
                          updateOpeningBalance(row.id, { subconto1: e.target.value })
                        }
                        placeholder="Контрагент / Налог / Объект..."
                        className="w-full px-2 py-1 rounded-md text-xs bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                      />
                    </td>

                    <td className="py-1.5 px-2.5 align-middle">
                      <input
                        type="text"
                        value={row.subconto2 || ''}
                        onChange={(e) =>
                          updateOpeningBalance(row.id, { subconto2: e.target.value })
                        }
                        placeholder="Договор №..."
                        className="w-full px-2 py-1 rounded-md text-xs font-mono tabular-nums bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                      />
                    </td>

                    <td className="py-1.5 px-2.5 align-middle text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.debit || ''}
                        placeholder="0,00"
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0);
                          updateOpeningBalance(row.id, {
                            debit: roundMoney(val),
                            ...(val > 0 ? { credit: 0 } : {}),
                          });
                        }}
                        className="w-full px-2 py-1 rounded-md text-xs font-mono tabular-nums font-semibold text-right bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                      />
                    </td>

                    <td className="py-1.5 px-2.5 align-middle text-right">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.credit || ''}
                        placeholder="0,00"
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0);
                          updateOpeningBalance(row.id, {
                            credit: roundMoney(val),
                            ...(val > 0 ? { debit: 0 } : {}),
                          });
                        }}
                        className="w-full px-2 py-1 rounded-md text-xs font-mono tabular-nums font-semibold text-right bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                      />
                    </td>

                    <td className="py-1.5 px-2.5 align-middle">
                      {linkedOps.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {linkedOps.map((op) => (
                            <button
                              key={op.id}
                              type="button"
                              onClick={() => selectOperationAndNavigate(op.id)}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700"
                            >
                              <Link2 className="w-3 h-3" />
                              <span>Оп. №{op.number}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-400">ОСВ</span>
                      )}
                    </td>

                    <td className="py-1.5 px-2 align-middle text-center">
                      <button
                        type="button"
                        onClick={() => removeOpeningBalance(row.id)}
                        title="Удалить строку"
                        className="p-1 rounded text-zinc-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="bg-[#FAFAFA] dark:bg-[#09090B] border-t border-zinc-200 dark:border-zinc-800 font-semibold">
                <td colSpan={3} className="py-2 px-3 text-xs text-zinc-700 dark:text-zinc-300">
                  ИТОГО ВХОДЯЩЕЕ САЛЬДО НА 01.04:
                </td>
                <td className="py-2 px-2.5 text-right text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatRub(totalDebit)}
                </td>
                <td className="py-2 px-2.5 text-right text-xs font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatRub(totalCredit)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Add Opening Balance Row Form */}
        <form
          onSubmit={handleAddRow}
          className="p-3 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-2"
        >
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Добавить строку начального остатка вручную
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
            <select
              value={newAccountCode}
              onChange={(e) => setNewAccountCode(e.target.value)}
              className="sm:col-span-2 px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              {leafAccounts.map((acc) => (
                <option key={acc.code} value={acc.code}>
                  {acc.code} — {acc.name}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={newSubconto1}
              onChange={(e) => setNewSubconto1(e.target.value)}
              placeholder='Субконто 1 (ООО "Сбыт")'
              className="px-2.5 py-1.5 rounded-md text-xs bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />

            <input
              type="text"
              value={newSubconto2}
              onChange={(e) => setNewSubconto2(e.target.value)}
              placeholder="Договор №177"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />

            <input
              type="number"
              step="0.01"
              min="0"
              value={newDebit}
              onChange={(e) => {
                setNewDebit(e.target.value);
                if (e.target.value) setNewCredit('');
              }}
              placeholder="Дебет, ₽"
              className="px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.01"
                min="0"
                value={newCredit}
                onChange={(e) => {
                  setNewCredit(e.target.value);
                  if (e.target.value) setNewDebit('');
                }}
                placeholder="Кредит, ₽"
                className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
              <button
                type="submit"
                className="shrink-0 inline-flex items-center justify-center p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900"
                title="Добавить строку"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </form>
      </section>

      {/* Organization Card & Student Personalization */}
      <section className="rounded-md bg-white dark:bg-[#111113] border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Карточка нашей организации, ставка НДС и ФИО студента
          </h2>
        </div>

        <div className="p-3.5 rounded-md bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            <UserCheck className="w-4 h-4" />
            <span>ФИО студента (автоподстановка в название организации и приказ о приеме главбуха)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
            <input
              type="text"
              value={organization.studentName}
              onChange={(e) => updateOrganization({ studentName: e.target.value })}
              placeholder="Введите ваше ФИО (напр. Иванов Иван Иванович)"
              className="w-full px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-[#111113] border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            />

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={organization.substituteStudentInOrgName}
                  onChange={(e) =>
                    updateOrganization({ substituteStudentInOrgName: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-zinc-300"
                />
                <span>Добавить ФИО студента в название организации</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={organization.substituteStudentAsAccountant}
                  onChange={(e) =>
                    updateOrganization({ substituteStudentAsAccountant: e.target.checked })
                  }
                  className="w-3.5 h-3.5 rounded border-zinc-300"
                />
                <span>Подставить ФИО студента как Главного бухгалтера</span>
              </label>
            </div>
          </div>

          {organization.studentName.trim() && (
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-700 dark:text-zinc-300">
              <span>
                Организация в 1С: <strong>{effectiveOrganization.shortName}</strong>
              </span>
              <span>•</span>
              <span>
                Главный бухгалтер: <strong>{effectiveOrganization.chiefAccountantName}</strong>
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Краткое наименование в 1С
            </label>
            <input
              type="text"
              value={organization.shortName}
              onChange={(e) => updateOrganization({ shortName: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Полное наименование
            </label>
            <input
              type="text"
              value={organization.name}
              onChange={(e) => updateOrganization({ name: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              ИНН
            </label>
            <input
              type="text"
              value={organization.inn}
              onChange={(e) => updateOrganization({ inn: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              КПП
            </label>
            <input
              type="text"
              value={organization.kpp}
              onChange={(e) => updateOrganization({ kpp: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              БИК банка
            </label>
            <input
              type="text"
              value={organization.bik}
              onChange={(e) => updateOrganization({ bik: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Расчетный счет (счет 51)
            </label>
            <input
              type="text"
              value={organization.bankAccount}
              onChange={(e) => updateOrganization({ bankAccount: e.target.value })}
              className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Система налогообложения
            </label>
            <select
              value={organization.taxSystem}
              onChange={(e) =>
                updateOrganization({
                  taxSystem: e.target.value as OrganizationCard['taxSystem'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              <option value="OSNO">ОСНО (НДС + Налог на прибыль)</option>
              <option value="USN_15">УСН «Доходы минус расходы» (15%)</option>
              <option value="USN_6">УСН «Доходы» (6%)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Ставка НДС (пересчитывает проводки)
            </label>
            <select
              value={organization.defaultVatRate}
              onChange={(e) =>
                updateOrganization({ defaultVatRate: Number(e.target.value) })
              }
              className="w-full px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums font-semibold bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            >
              {vatOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Метод закрытия счета 26
            </label>
            <select
              value={organization.costingMethod}
              onChange={(e) =>
                updateOrganization({
                  costingMethod: e.target.value as OrganizationCard['costingMethod'],
                })
              }
              className="w-full px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              <option value="direct-costing">Директ-костинг (в Дт 90.08.1)</option>
              <option value="full-absorption">В себестоимость (в Дт 20.01)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-zinc-500 mb-1">
              Руководитель и Главный бухгалтер
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={organization.directorName}
                onChange={(e) => updateOrganization({ directorName: e.target.value })}
                placeholder="Руководитель"
                className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
              <input
                type="text"
                value={organization.chiefAccountantName}
                onChange={(e) => updateOrganization({ chiefAccountantName: e.target.value })}
                placeholder="Главбух"
                className="px-2.5 py-1.5 rounded-md text-xs bg-[#FAFAFA] dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

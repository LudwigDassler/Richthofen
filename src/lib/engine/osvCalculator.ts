import {
  AccountType,
  BusinessOperation,
  OpeningBalanceEntry,
  OsvAccountCardMovement,
  OsvReport,
  OsvRow,
} from '@/types/accounting';
import { ACCOUNT_MAP, getAccountInfo } from '@/data/chartOfAccounts';
import { formatMoneyRu, parseDateToSortKey, roundMoney } from './smartLinker';

const DEFAULT_SUBACCOUNT_FOR_GROUP: Record<string, string> = {
  '01': '01.01',
  '02': '02.01',
  '08': '08.04',
  '10': '10.01',
  '19': '19.03',
  '20': '20.01',
  '41': '41.01',
  '44': '44.01',
  '50': '50.01',
  '60': '60.01',
  '62': '62.01',
  '68': '68.10',
  '69': '69.09',
  '71': '71.01',
  '75': '75.01',
  '76': '76.09',
  '80': '80.09',
  '84': '84.01',
  '90': '90.09',
  '91': '91.09',
  '99': '99.01.1',
};

function resolveLeafAccountCode(rawCode: string): string {
  const trimmed = (rawCode || '').trim();
  if (!trimmed) return '000';
  if (ACCOUNT_MAP[trimmed]?.isGroup && DEFAULT_SUBACCOUNT_FOR_GROUP[trimmed]) {
    return DEFAULT_SUBACCOUNT_FOR_GROUP[trimmed];
  }
  return trimmed;
}

function buildRedBalanceHint(
  accountCode: string,
  accountType: AccountType,
  amount: number
): string {
  const absStr = formatMoneyRu(Math.abs(amount));
  if (accountCode === '50.01' || accountCode.startsWith('50')) {
    return `Отрицательный остаток наличных в кассе (−${absStr})! Счет 50.01 активный — проверьте проведение ПКО «Получение наличных в банке» (Дт 50.01 Кт 51) и время документов.`;
  }
  if (accountCode === '51') {
    return `Отрицательное сальдо на расчетном счете 51 (−${absStr})! Проверьте начальный остаток по счету 51 и поступления от покупателей.`;
  }
  if (accountCode.startsWith('10') || accountCode.startsWith('41')) {
    return `Отрицательный складской остаток ТМЦ (−${absStr})! Списано больше, чем оприходовано — проверьте документ поступления и хронологию проведения.`;
  }
  if (accountCode === '60.02' || accountCode === '62.01') {
    return `Краснота на активном субсчете расчетов ${accountCode} (−${absStr})! Проверьте корректность выбора субсчета (60.01/60.02 или 62.01/62.02) и зачет авансов.`;
  }
  if (accountCode === '60.01' || accountCode === '62.02') {
    return `Краснота на пассивном субсчете расчетов ${accountCode} (−${absStr})! Вероятно, предоплата отражена на счете расчетов вместо авансового субсчета.`;
  }
  if (accountCode === '000') {
    return `Вспомогательный счет 000 не закрыт (остаток ${absStr})! Сумма дебетовых и кредитовых начальных остатков не совпадает.`;
  }
  if (accountType === 'active') {
    return `Отрицательное дебетовое сальдо на активном счете ${accountCode} (−${absStr}) — «краснота» в 1С 8.3.`;
  }
  return `Отрицательное кредитовое сальдо на пассивном счете ${accountCode} (−${absStr}) — «краснота» в 1С 8.3.`;
}

function compareAccountCodes(a: string, b: string): number {
  if (a === b) return 0;
  // Auxiliary account 000 always goes at the very end in 1C 8.3 OSV
  if (a === '000') return 1;
  if (b === '000') return -1;

  const segA = a.split('.');
  const segB = b.split('.');
  const maxLen = Math.max(segA.length, segB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = segA[i];
    const partB = segB[i];
    if (partA === undefined) return -1; // Parent group ("60") precedes subaccount ("60.01")
    if (partB === undefined) return 1;

    const numA = Number(partA);
    const numB = Number(partB);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
      if (numA !== numB) return numA - numB;
    } else {
      const cmp = partA.localeCompare(partB, 'ru');
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

interface LeafAccumulator {
  accountCode: string;
  startDebit: number;
  startCredit: number;
  turnoverDebit: number;
  turnoverCredit: number;
  movements: OsvAccountCardMovement[];
}

/**
 * Calculates an authentic 1C:Бухгалтерия 8.3 (ред. 3.0) Trial Balance (Оборотно-сальдовая ведомость)
 * with leaf subaccounts, synthetic parent group rows, kopeck-exact double-entry math,
 * 1C red-balance («краснота») detection, and «Карточка счета» drill-down movements.
 */
export function calculateOsv(
  openingBalances: OpeningBalanceEntry[],
  operations: BusinessOperation[],
  mode: 'completed_only' | 'all_operations'
): OsvReport {
  const leafMap = new Map<string, LeafAccumulator>();

  const ensureLeaf = (rawCode: string): LeafAccumulator => {
    const code = resolveLeafAccountCode(rawCode);
    let acc = leafMap.get(code);
    if (!acc) {
      acc = {
        accountCode: code,
        startDebit: 0,
        startCredit: 0,
        turnoverDebit: 0,
        turnoverCredit: 0,
        movements: [],
      };
      leafMap.set(code, acc);
    }
    return acc;
  };

  // 1. Load Opening Balances
  for (const entry of openingBalances) {
    const debit = roundMoney(entry.debit || 0);
    const credit = roundMoney(entry.credit || 0);
    if (debit === 0 && credit === 0) continue;

    const leaf = ensureLeaf(entry.accountCode);
    leaf.startDebit = roundMoney(leaf.startDebit + debit);
    leaf.startCredit = roundMoney(leaf.startCredit + credit);
  }

  // 2. Filter & chronologically sort operations
  const filteredOps = operations
    .map((op, index) => ({ op, index }))
    .filter(({ op }) => {
      if (op.status === 'needs_data') return false;
      if (mode === 'completed_only') {
        return op.status === 'done';
      }
      // 'all_operations': include all operations with resolvedAmount > 0 or non-zero postings
      return (
        op.resolvedAmount > 0 || op.postings.some((p) => Math.abs(p.amount) >= 0.005)
      );
    })
    .sort((a, b) => {
      const keyA = parseDateToSortKey(a.op.date);
      const keyB = parseDateToSortKey(b.op.date);
      if (keyA !== keyB) return keyA - keyB;
      // Regular operations precede month-end closing operations on the last day of the month
      const closingA = a.op.isMonthEndClosing ? 1 : 0;
      const closingB = b.op.isMonthEndClosing ? 1 : 0;
      if (closingA !== closingB) return closingA - closingB;
      return a.index - b.index;
    });

  // 3. Accumulate turnovers & movements
  for (const { op } of filteredOps) {
    for (const posting of op.postings) {
      const amt = roundMoney(posting.amount || 0);
      if (Math.abs(amt) < 0.005) continue;

      const debitCode = resolveLeafAccountCode(posting.debitAccount);
      const creditCode = resolveLeafAccountCode(posting.creditAccount);

      const debitLeaf = ensureLeaf(debitCode);
      debitLeaf.turnoverDebit = roundMoney(debitLeaf.turnoverDebit + amt);
      debitLeaf.movements.push({
        operationId: op.id,
        operationNumber: op.number,
        date: op.date,
        description: posting.comment || op.rawDescription,
        correspondentAccount: creditCode,
        subconto: (posting.debitSubconto || []).filter(Boolean).join(' / '),
        debit: amt,
        credit: 0,
      });

      const creditLeaf = ensureLeaf(creditCode);
      creditLeaf.turnoverCredit = roundMoney(creditLeaf.turnoverCredit + amt);
      creditLeaf.movements.push({
        operationId: op.id,
        operationNumber: op.number,
        date: op.date,
        description: posting.comment || op.rawDescription,
        correspondentAccount: debitCode,
        subconto: (posting.creditSubconto || []).filter(Boolean).join(' / '),
        debit: 0,
        credit: amt,
      });
    }
  }

  // 4. Finalize leaf OsvRows using 1C 8.3 active / passive / active-passive rules
  const leafRows: OsvRow[] = [];
  for (const acc of Array.from(leafMap.values())) {
    const info = getAccountInfo(acc.accountCode);
    const parentCode =
      info.parentCode ||
      (acc.accountCode.includes('.') ? acc.accountCode.split('.')[0] : undefined);

    // Collapse net opening balance per subaccount if user entered multiple opening rows on same subaccount
    let startDebit = acc.startDebit;
    let startCredit = acc.startCredit;
    if (startDebit > 0 && startCredit > 0) {
      const startNet = roundMoney(startDebit - startCredit);
      if (info.type === 'active') {
        startDebit = startNet;
        startCredit = 0;
      } else if (info.type === 'passive') {
        startDebit = 0;
        startCredit = roundMoney(-startNet);
      } else if (startNet >= 0) {
        startDebit = startNet;
        startCredit = 0;
      } else {
        startDebit = 0;
        startCredit = roundMoney(Math.abs(startNet));
      }
    }

    let endDebit = 0;
    let endCredit = 0;
    let hasRedBalance = false;
    let redBalanceHint: string | undefined = undefined;

    if (info.type === 'active') {
      const net = roundMoney(
        startDebit - startCredit + acc.turnoverDebit - acc.turnoverCredit
      );
      endDebit = net;
      endCredit = 0;
      if (net < -0.004) {
        hasRedBalance = true;
        redBalanceHint = buildRedBalanceHint(acc.accountCode, info.type, net);
      }
    } else if (info.type === 'passive') {
      const net = roundMoney(
        startCredit - startDebit + acc.turnoverCredit - acc.turnoverDebit
      );
      endDebit = 0;
      endCredit = net;
      if (net < -0.004) {
        hasRedBalance = true;
        redBalanceHint = buildRedBalanceHint(acc.accountCode, info.type, net);
      }
    } else {
      // active-passive
      const net = roundMoney(
        startDebit - startCredit + acc.turnoverDebit - acc.turnoverCredit
      );
      if (net >= 0) {
        endDebit = net;
        endCredit = 0;
      } else {
        endDebit = 0;
        endCredit = roundMoney(Math.abs(net));
      }
      if (acc.accountCode === '000' && Math.abs(net) >= 0.01) {
        hasRedBalance = true;
        redBalanceHint = buildRedBalanceHint('000', 'active-passive', net);
      }
    }

    const isAllZero =
      Math.abs(startDebit) < 0.005 &&
      Math.abs(startCredit) < 0.005 &&
      Math.abs(acc.turnoverDebit) < 0.005 &&
      Math.abs(acc.turnoverCredit) < 0.005 &&
      Math.abs(endDebit) < 0.005 &&
      Math.abs(endCredit) < 0.005 &&
      acc.movements.length === 0;

    if (!isAllZero) {
      leafRows.push({
        accountCode: acc.accountCode,
        accountName: info.name,
        accountType: info.type,
        isGroup: false,
        parentCode,
        startDebit,
        startCredit,
        turnoverDebit: acc.turnoverDebit,
        turnoverCredit: acc.turnoverCredit,
        endDebit,
        endCredit,
        hasRedBalance,
        redBalanceHint,
        movements: acc.movements,
      });
    }
  }

  // 5. Build Synthetic Parent Group Rows (01, 02, 10, 19, 20, 41, 50, 60, 62, 68, 69, 76, 80, 84, 90, 91, 99, etc.)
  const childrenByParent = new Map<string, OsvRow[]>();
  for (const row of leafRows) {
    if (row.parentCode) {
      const list = childrenByParent.get(row.parentCode) || [];
      list.push(row);
      childrenByParent.set(row.parentCode, list);
    }
  }

  const groupRows: OsvRow[] = [];
  for (const [parentCode, children] of Array.from(childrenByParent.entries())) {
    const parentInfo = getAccountInfo(parentCode);
    const startDebit = roundMoney(children.reduce((s, c) => s + c.startDebit, 0));
    const startCredit = roundMoney(children.reduce((s, c) => s + c.startCredit, 0));
    const turnoverDebit = roundMoney(children.reduce((s, c) => s + c.turnoverDebit, 0));
    const turnoverCredit = roundMoney(children.reduce((s, c) => s + c.turnoverCredit, 0));

    let endDebit = 0;
    let endCredit = 0;

    // In 1C 8.3, synthetic accounts 90, 91, and 99 have collapsed ending balance across subaccounts
    // (so synthetic 90 and 91 equal 0,00 after month-end closing!), while settlement/asset accounts
    // (60, 62, 68, 69, 76, etc.) preserve expanded subaccount balances («развернутое сальдо»).
    if (parentCode === '90' || parentCode === '91' || parentCode === '99') {
      const collapsedNet = roundMoney(
        children.reduce((s, c) => s + (c.endDebit - c.endCredit), 0)
      );
      if (collapsedNet >= 0) {
        endDebit = collapsedNet;
        endCredit = 0;
      } else {
        endDebit = 0;
        endCredit = roundMoney(Math.abs(collapsedNet));
      }
    } else {
      endDebit = roundMoney(children.reduce((s, c) => s + c.endDebit, 0));
      endCredit = roundMoney(children.reduce((s, c) => s + c.endCredit, 0));
    }

    const childWithRed = children.find((c) => c.hasRedBalance);
    groupRows.push({
      accountCode: parentCode,
      accountName: parentInfo.name,
      accountType: parentInfo.type,
      isGroup: true,
      parentCode: undefined,
      startDebit,
      startCredit,
      turnoverDebit,
      turnoverCredit,
      endDebit,
      endCredit,
      hasRedBalance: Boolean(childWithRed),
      redBalanceHint: childWithRed?.redBalanceHint,
      movements: [],
    });
  }

  // 6. Combine & sort rows hierarchically
  const allRows = [...leafRows, ...groupRows].sort((a, b) =>
    compareAccountCodes(a.accountCode, b.accountCode)
  );

  // 7. Compute report totals strictly from leaf rows (!isGroup) so parent rows are never double-counted
  const totalStartDebit = roundMoney(leafRows.reduce((s, r) => s + r.startDebit, 0));
  const totalStartCredit = roundMoney(leafRows.reduce((s, r) => s + r.startCredit, 0));
  const totalTurnoverDebit = roundMoney(leafRows.reduce((s, r) => s + r.turnoverDebit, 0));
  const totalTurnoverCredit = roundMoney(leafRows.reduce((s, r) => s + r.turnoverCredit, 0));
  const totalEndDebit = roundMoney(leafRows.reduce((s, r) => s + r.endDebit, 0));
  const totalEndCredit = roundMoney(leafRows.reduce((s, r) => s + r.endCredit, 0));

  const isStartBalanced = Math.abs(roundMoney(totalStartDebit - totalStartCredit)) < 0.01;
  const isEndBalanced = Math.abs(roundMoney(totalEndDebit - totalEndCredit)) < 0.01;

  return {
    rows: allRows,
    totalStartDebit,
    totalStartCredit,
    totalTurnoverDebit,
    totalTurnoverCredit,
    totalEndDebit,
    totalEndCredit,
    isStartBalanced,
    isEndBalanced,
  };
}

import { CHART_OF_ACCOUNTS, getAccountInfo } from '@/data/chartOfAccounts';
import {
  AccountType,
  BalanceAnchorOverride,
  BalanceInterpretationMode,
  Database1CSnapshot,
  OsvAccountRow,
  OsvReport,
  QueuedOperation,
} from '@/types/accounting';

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function splitNetToSides(
  net: number,
  type: AccountType
): { debit: number; credit: number; isRed: boolean } {
  const cleanNet = Math.abs(net) < 0.005 ? 0 : round2(net);

  if (type === 'active') {
    return {
      debit: cleanNet,
      credit: 0,
      isRed: cleanNet < -0.005,
    };
  }

  if (type === 'passive') {
    const creditVal = cleanNet === 0 ? 0 : round2(-cleanNet);
    return {
      debit: 0,
      credit: creditVal,
      isRed: creditVal < -0.005,
    };
  }

  // active-passive
  if (cleanNet > 0) {
    return { debit: cleanNet, credit: 0, isRed: false };
  }
  if (cleanNet < 0) {
    return { debit: 0, credit: round2(-cleanNet), isRed: false };
  }
  return { debit: 0, credit: 0, isRed: false };
}

export function resolveEffectiveBalanceMode(
  db1C: Database1CSnapshot | null,
  override: BalanceAnchorOverride
): { mode: BalanceInterpretationMode; description: string } {
  if (!db1C) {
    return {
      mode: 'postings_only',
      description: 'База 1С не подключена — расчёт только по загруженным операциям (начальное сальдо = 0)',
    };
  }

  if (override === 'treat_raw_as_end' && db1C.rawBalances.length > 0) {
    return {
      mode: 'end_balances_reconstructed_start',
      description:
        'Ручной режим (Остатки = Конец периода): СальдоНач = СальдоКон − ОборотыДт + ОборотыКт',
    };
  }

  if (override === 'treat_raw_as_start' && db1C.rawBalances.length > 0) {
    return {
      mode: 'start_balances_forward_end',
      description:
        'Ручной режим (Остатки = Начало периода): СальдоКон = СальдоНач + ОборотыДт − ОборотыКт',
    };
  }

  return {
    mode: db1C.detectedBalanceMode,
    description: db1C.balanceModeReason,
  };
}

interface MovementRecord {
  date: string;
  debit: string;
  credit: string;
  amount: number;
  source: 'db' | 'queued';
}

export function calculateOsvReport(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  dateFrom?: string;
  dateTo?: string;
  balanceAnchorOverride?: BalanceAnchorOverride;
  includeQueuedOperations?: boolean;
}): OsvReport {
  const {
    db1C,
    operations,
    dateFrom = '',
    dateTo = '',
    balanceAnchorOverride = 'auto',
    includeQueuedOperations = true,
  } = params;

  const { mode: effectiveMode, description: balanceModeDescription } =
    resolveEffectiveBalanceMode(db1C, balanceAnchorOverride);

  // Collect all movements from 1C DB
  const dbMovements: MovementRecord[] = (db1C?.postings ?? [])
    .filter((p) => Math.abs(p.amount) >= 0.005)
    .map((p) => ({
      date: p.date || '',
      debit: p.debit,
      credit: p.credit,
      amount: round2(p.amount),
      source: 'db' as const,
    }));

  // Collect movements from user-queued operations (excluding duplicates disabled by user)
  const queuedMovements: MovementRecord[] = includeQueuedOperations
    ? operations
        .filter((op) => op.includeInProcessing && !op.isDuplicateIn1C)
        .flatMap((op) =>
          op.entries
            .filter((e) => Math.abs(e.amount) >= 0.005 && (e.debit || e.credit))
            .map((e) => ({
              date: op.date || '',
              debit: e.debit,
              credit: e.credit,
              amount: round2(e.amount),
              source: 'queued' as const,
            }))
        )
    : [];

  // Step 1: Compute baseStartNet per leaf account (before ANY dbMovements)
  // Note: debit - credit = net
  const baseStartNetMap = new Map<string, number>();
  const explicitNoPostingsTurnoverMap = new Map<string, { dt: number; kt: number }>();

  const addNet = (map: Map<string, number>, acc: string, delta: number) => {
    if (!acc || acc === '000') return;
    map.set(acc, round2((map.get(acc) ?? 0) + delta));
  };

  if (db1C && db1C.rawBalances.length > 0) {
    if (effectiveMode === 'explicit_start_end') {
      for (const b of db1C.rawBalances) {
        addNet(baseStartNetMap, b.account, b.startDebit - b.startCredit);
        if (dbMovements.length === 0 && (b.turnoverDebit !== 0 || b.turnoverCredit !== 0)) {
          const prev = explicitNoPostingsTurnoverMap.get(b.account) ?? { dt: 0, kt: 0 };
          explicitNoPostingsTurnoverMap.set(b.account, {
            dt: round2(prev.dt + b.turnoverDebit),
            kt: round2(prev.kt + b.turnoverCredit),
          });
        }
      }
    } else if (effectiveMode === 'end_balances_reconstructed_start') {
      // rawBalances represent ending balances AFTER all dbMovements
      for (const b of db1C.rawBalances) {
        const endNet = b.hasExplicitEnd
          ? b.endDebit - b.endCredit
          : b.rawDebit - b.rawCredit;
        addNet(baseStartNetMap, b.account, endNet);
      }
      // Subtract all dbMovements to reconstruct exact opening balance at start of DB period:
      // NetStart = NetEnd - DbTurnoverDebit + DbTurnoverCredit
      for (const m of dbMovements) {
        if (m.debit && m.debit !== '000') {
          addNet(baseStartNetMap, m.debit, -m.amount);
        }
        if (m.credit && m.credit !== '000') {
          addNet(baseStartNetMap, m.credit, +m.amount);
        }
      }
    } else {
      // 'start_balances_forward_end' or 'balances_only'
      for (const b of db1C.rawBalances) {
        const startNet = b.hasExplicitStart
          ? b.startDebit - b.startCredit
          : b.rawDebit - b.rawCredit;
        addNet(baseStartNetMap, b.account, startNet);
        if (dbMovements.length === 0 && (b.turnoverDebit !== 0 || b.turnoverCredit !== 0)) {
          const prev = explicitNoPostingsTurnoverMap.get(b.account) ?? { dt: 0, kt: 0 };
          explicitNoPostingsTurnoverMap.set(b.account, {
            dt: round2(prev.dt + b.turnoverDebit),
            kt: round2(prev.kt + b.turnoverCredit),
          });
        }
      }
    }
  }

  // Step 2: Partition movements relative to [dateFrom, dateTo]
  // - date < dateFrom -> rolls into periodStartNet
  // - dateFrom <= date <= dateTo -> period turnovers
  // - date > dateTo -> excluded from selected period view
  const periodStartNetMap = new Map<string, number>(baseStartNetMap);
  const dbTurnMap = new Map<string, { dt: number; kt: number }>();
  const queuedTurnMap = new Map<string, { dt: number; kt: number }>();

  for (const [acc, t] of explicitNoPostingsTurnoverMap.entries()) {
    dbTurnMap.set(acc, { dt: t.dt, kt: t.kt });
  }

  const allMovements = [...dbMovements, ...queuedMovements];
  for (const m of allMovements) {
    const d = m.date;
    const isBeforeStart = Boolean(dateFrom && d && d < dateFrom);
    const isAfterEnd = Boolean(dateTo && d && d > dateTo);

    if (isBeforeStart) {
      if (m.debit && m.debit !== '000') addNet(periodStartNetMap, m.debit, +m.amount);
      if (m.credit && m.credit !== '000') addNet(periodStartNetMap, m.credit, -m.amount);
      continue;
    }

    if (isAfterEnd) {
      continue;
    }

    const targetMap = m.source === 'db' ? dbTurnMap : queuedTurnMap;
    if (m.debit && m.debit !== '000') {
      const cur = targetMap.get(m.debit) ?? { dt: 0, kt: 0 };
      cur.dt = round2(cur.dt + m.amount);
      targetMap.set(m.debit, cur);
    }
    if (m.credit && m.credit !== '000') {
      const cur = targetMap.get(m.credit) ?? { dt: 0, kt: 0 };
      cur.kt = round2(cur.kt + m.amount);
      targetMap.set(m.credit, cur);
    }
  }

  // Collect all active leaf account codes
  const leafAccountSet = new Set<string>([
    ...periodStartNetMap.keys(),
    ...dbTurnMap.keys(),
    ...queuedTurnMap.keys(),
  ]);
  leafAccountSet.delete('000');

  // Ensure if both parent '60' and child '60.01' somehow exist in postings, keep '60' as leaf ONLY if it has direct values;
  // To avoid ambiguity if '60' has direct postings AND '60.01' exists, keep both as leaf accounts if '60' has direct non-zero data,
  // otherwise synthetic group rows are generated purely from child accounts.
  const leafRows: OsvAccountRow[] = [];

  const sortedLeafCodes = Array.from(leafAccountSet).sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true })
  );

  for (const code of sortedLeafCodes) {
    const info = getAccountInfo(code);
    // Treat leaf account with its own type; if charting marks '60' as group because of '60.01',
    // check whether '60' actually had direct postings/balances:
    const startNet = periodStartNetMap.get(code) ?? 0;
    const dbT = dbTurnMap.get(code) ?? { dt: 0, kt: 0 };
    const qT = queuedTurnMap.get(code) ?? { dt: 0, kt: 0 };
    const turnDt = round2(dbT.dt + qT.dt);
    const turnKt = round2(dbT.kt + qT.kt);
    const endNet = round2(startNet + turnDt - turnKt);

    if (
      Math.abs(startNet) < 0.005 &&
      Math.abs(turnDt) < 0.005 &&
      Math.abs(turnKt) < 0.005 &&
      Math.abs(endNet) < 0.005
    ) {
      continue;
    }

    const startSides = splitNetToSides(startNet, info.type);
    const endSides = splitNetToSides(endNet, info.type);

    leafRows.push({
      code,
      name: info.name,
      type: info.type,
      parentCode: info.parentCode ?? (code.includes('.') ? code.split('.')[0] : undefined),
      isGroup: false,
      startDebit: startSides.debit,
      startCredit: startSides.credit,
      turnoverDebit: turnDt,
      turnoverCredit: turnKt,
      endDebit: endSides.debit,
      endCredit: endSides.credit,
      hasRedStart: startSides.isRed,
      hasRedEnd: endSides.isRed,
      dbTurnoverDebit: dbT.dt,
      dbTurnoverCredit: dbT.kt,
      queuedTurnoverDebit: qT.dt,
      queuedTurnoverCredit: qT.kt,
    });
  }

  // Build synthetic group rows for roots that have subaccounts (e.g. 10, 19, 20, 41, 60, 62, 68, 69, 76, 90, 91, 99)
  const childrenByRoot = new Map<string, OsvAccountRow[]>();
  const directRootLeafSet = new Set(
    leafRows.filter((r) => !r.code.includes('.')).map((r) => r.code)
  );

  for (const row of leafRows) {
    if (row.code.includes('.')) {
      const root = row.code.split('.')[0];
      if (!directRootLeafSet.has(root)) {
        const arr = childrenByRoot.get(root) ?? [];
        arr.push(row);
        childrenByRoot.set(root, arr);
      }
    }
  }

  const rows: OsvAccountRow[] = [];
  const emittedRoots = new Set<string>();

  for (const leaf of leafRows) {
    const root = leaf.code.includes('.') ? leaf.code.split('.')[0] : null;
    if (root && childrenByRoot.has(root) && !emittedRoots.has(root)) {
      emittedRoots.add(root);
      const children = childrenByRoot.get(root)!;
      const rootInfo =
        CHART_OF_ACCOUNTS.find((a) => a.code === root) ?? getAccountInfo(root);

      const sumTurnDt = round2(children.reduce((s, c) => s + c.turnoverDebit, 0));
      const sumTurnKt = round2(children.reduce((s, c) => s + c.turnoverCredit, 0));
      const sumDbTurnDt = round2(children.reduce((s, c) => s + c.dbTurnoverDebit, 0));
      const sumDbTurnKt = round2(children.reduce((s, c) => s + c.dbTurnoverCredit, 0));
      const sumQTurnDt = round2(children.reduce((s, c) => s + c.queuedTurnoverDebit, 0));
      const sumQTurnKt = round2(children.reduce((s, c) => s + c.queuedTurnoverCredit, 0));

      // In 1C 8.3 BP 3.0, synthetic accounts 90, 91, 99 display collapsed (свёрнутое) balance at root level
      const isCollapsedFinancialRoot = root === '90' || root === '91' || root === '99';

      let gStartDt = 0;
      let gStartKt = 0;
      let gEndDt = 0;
      let gEndKt = 0;

      if (isCollapsedFinancialRoot) {
        const netStart = round2(
          children.reduce((s, c) => s + (c.startDebit - c.startCredit), 0)
        );
        const netEnd = round2(
          children.reduce((s, c) => s + (c.endDebit - c.endCredit), 0)
        );
        gStartDt = netStart > 0 ? netStart : 0;
        gStartKt = netStart < 0 ? round2(-netStart) : 0;
        gEndDt = netEnd > 0 ? netEnd : 0;
        gEndKt = netEnd < 0 ? round2(-netEnd) : 0;
      } else {
        gStartDt = round2(children.reduce((s, c) => s + c.startDebit, 0));
        gStartKt = round2(children.reduce((s, c) => s + c.startCredit, 0));
        gEndDt = round2(children.reduce((s, c) => s + c.endDebit, 0));
        gEndKt = round2(children.reduce((s, c) => s + c.endCredit, 0));
      }

      rows.push({
        code: root,
        name: rootInfo.name,
        type: rootInfo.type,
        isGroup: true,
        isCollapsedSynthetic: isCollapsedFinancialRoot,
        startDebit: gStartDt,
        startCredit: gStartKt,
        turnoverDebit: sumTurnDt,
        turnoverCredit: sumTurnKt,
        endDebit: gEndDt,
        endCredit: gEndKt,
        hasRedStart: children.some((c) => c.hasRedStart),
        hasRedEnd: children.some((c) => c.hasRedEnd),
        dbTurnoverDebit: sumDbTurnDt,
        dbTurnoverCredit: sumDbTurnKt,
        queuedTurnoverDebit: sumQTurnDt,
        queuedTurnoverCredit: sumQTurnKt,
      });
    }
    rows.push(leaf);
  }

  // Grand totals strictly over leafRows (no double counting)
  const totalStartDebit = round2(leafRows.reduce((s, r) => s + r.startDebit, 0));
  const totalStartCredit = round2(leafRows.reduce((s, r) => s + r.startCredit, 0));
  const totalTurnoverDebit = round2(leafRows.reduce((s, r) => s + r.turnoverDebit, 0));
  const totalTurnoverCredit = round2(leafRows.reduce((s, r) => s + r.turnoverCredit, 0));
  const totalEndDebit = round2(leafRows.reduce((s, r) => s + r.endDebit, 0));
  const totalEndCredit = round2(leafRows.reduce((s, r) => s + r.endCredit, 0));

  const startDiff = round2(totalStartDebit - totalStartCredit);
  const turnoverDiff = round2(totalTurnoverDebit - totalTurnoverCredit);
  const endDiff = round2(totalEndDebit - totalEndCredit);

  return {
    dateFrom,
    dateTo,
    includeQueuedOperations,
    balanceMode: effectiveMode,
    balanceModeDescription,
    rows,
    leafRows,
    totals: {
      startDebit: totalStartDebit,
      startCredit: totalStartCredit,
      turnoverDebit: totalTurnoverDebit,
      turnoverCredit: totalTurnoverCredit,
      endDebit: totalEndDebit,
      endCredit: totalEndCredit,
      startDiff,
      turnoverDiff,
      endDiff,
      isStartBalanced: Math.abs(startDiff) < 0.01,
      isTurnoverBalanced: Math.abs(turnoverDiff) < 0.01,
      isEndBalanced: Math.abs(endDiff) < 0.01,
    },
  };
}

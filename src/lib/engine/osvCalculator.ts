import {
  CHART_OF_ACCOUNTS,
  getAccountInfo,
  isOffBalanceAccountCode,
} from '@/data/chartOfAccounts';
import {
  AccountType,
  BalanceAnchorOverride,
  BalanceInterpretationMode,
  Database1CSnapshot,
  OsvAccountMovement,
  OsvAccountRow,
  OsvAuditorHint,
  OsvReport,
  OsvSourceMode,
  OsvSubcontoRow,
  QueuedOperation,
} from '@/types/accounting';
import { sanitizeAuditorHint1C } from '@/lib/engine/textHygiene1C';

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function formatRuDateShort(iso: string): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || 'период';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatMoneyRu(n: number): string {
  return `${round2(n).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
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
  override: BalanceAnchorOverride,
  sourceMode: OsvSourceMode = 'combined'
): { mode: BalanceInterpretationMode; description: string } {
  if (sourceMode === 'queued_only') {
    return {
      mode: 'postings_only',
      description:
        'Режим «Только новые операции»: обороты и остатки рассчитаны изолированно по загруженным файлам (начальное сальдо = 0)',
    };
  }

  if (!db1C) {
    return {
      mode: 'postings_only',
      description:
        'База 1С не подключена — расчёт только по загруженным операциям (начальное сальдо = 0)',
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
  id: string;
  date: string;
  debit: string;
  credit: string;
  debitSubconto: string;
  creditSubconto: string;
  amount: number;
  source: 'db' | 'queued';
  operationId?: string;
  docLabel: string;
  description: string;
}

export function normalizeSubcontoLabel(raw?: string, acc?: string): string {
  const clean = (raw ?? '').trim();
  if (!clean) return 'Без аналитики (субконто)';
  // On 50.01 (Касса организации), Subconto 1 (Статьи ДДС) is turnover-only in 1C:BP 3.0; balance is kept for the cash desk as a whole.
  if (acc === '50.01') {
    return 'Основная касса организации';
  }
  // On 51 (Расчётные счета), Subconto 1 is Банковские счета (balance-bearing), Subconto 2 (Статьи ДДС) is turnover-only.
  if (acc === '51') {
    return clean.split(/\s+\/\s+/)[0].trim() || 'Основной расчётный счёт';
  }
  // On 70 (Расчёты с персоналом по оплате труда), 1C:BP 3.0 default «Сводно по всем работникам» keeps consolidated payroll register balance.
  if (acc === '70') {
    return 'Работники организации (сводно по ведомостям)';
  }
  // On 68.* and 69.*, Subconto 1 in 1C:BP 3.0 is Виды платежей в бюджет (фонды): «Налог (взносы): начислено / уплачено».
  if (acc && (acc.startsWith('68.') || acc.startsWith('69.'))) {
    return 'Налог (взносы): начислено / уплачено';
  }
  // In 1C:BP 3.0 Chart of Accounts, on 20.01 / 20.02 / 23 Subconto 1 is Номенклатурные группы (balance-bearing)
  // while Subconto 2 (Статьи затрат) is marked «Только обороты» so production output (43 <- 20.01) & month-end close cleanly.
  if (acc === '20.01' || acc === '20.02' || acc === '23') {
    return clean.split(/\s+\/\s+/)[0].trim() || clean;
  }
  // Fixed assets & capex accounts group balance by asset/object name (Subconto 1)
  if (acc === '08.04.1' || acc === '01.01' || acc === '01.09' || acc === '02.01') {
    return clean.split(/\s+\/\s+/)[0].trim() || clean;
  }
  // Counterparty settlement & VAT accounts group primary OSV subconto by Counterparty (Subconto 1)
  if (
    acc &&
    (acc.startsWith('60') ||
      acc.startsWith('62') ||
      acc.startsWith('76') ||
      acc.startsWith('19'))
  ) {
    return clean.split(/\s+\/\s+/)[0].trim() || clean;
  }
  return clean;
}

export function calculateOsvReport(params: {
  db1C: Database1CSnapshot | null;
  operations: QueuedOperation[];
  dateFrom?: string;
  dateTo?: string;
  reportingYear?: number;
  balanceAnchorOverride?: BalanceAnchorOverride;
  includeQueuedOperations?: boolean;
  sourceMode?: OsvSourceMode;
}): OsvReport {
  const {
    db1C,
    operations,
    dateFrom = '',
    dateTo = '',
    reportingYear,
    balanceAnchorOverride = 'auto',
    includeQueuedOperations = true,
    sourceMode: explicitSourceMode,
  } = params;

  const effectiveSourceMode: OsvSourceMode =
    explicitSourceMode ?? (includeQueuedOperations ? 'combined' : 'db_only');

  const useDbData = effectiveSourceMode !== 'queued_only' && Boolean(db1C);
  const useQueuedData = effectiveSourceMode !== 'db_only';

  const reportingYearStart =
    reportingYear && reportingYear >= 1990 && reportingYear <= 2100
      ? `${reportingYear}-01-01`
      : '';

  const { mode: effectiveMode, description: balanceModeDescription } =
    resolveEffectiveBalanceMode(useDbData ? db1C : null, balanceAnchorOverride, effectiveSourceMode);

  // Collect all movements from 1C DB
  const dbMovements: MovementRecord[] = useDbData
    ? (db1C?.postings ?? [])
        .filter((p) => Math.abs(p.amount) >= 0.005)
        .map((p) => ({
          id: p.id,
          date: p.date || '',
          debit: p.debit,
          credit: p.credit,
          debitSubconto: p.debitSubconto?.filter(Boolean).join(' / ') || p.counterpartyName || '',
          creditSubconto: p.creditSubconto?.filter(Boolean).join(' / ') || p.counterpartyName || '',
          amount: round2(p.amount),
          source: 'db' as const,
          docLabel: p.documentLabel || `${p.documentType} №${p.documentNumber || 'б/н'}`,
          description: p.description || p.documentLabel || 'Проводка базы 1С',
        }))
    : [];

  // Collect movements from user-queued operations (excluding duplicates disabled by user)
  const queuedMovements: MovementRecord[] = useQueuedData
    ? operations
        .filter((op) => op.includeInProcessing && !op.isDuplicateIn1C)
        .flatMap((op) =>
          op.entries
            .filter((e) => Math.abs(e.amount) >= 0.005 && (e.debit || e.credit))
            .map((e) => ({
              id: `${op.id}-${e.id}`,
              date: op.date || '',
              debit: e.debit,
              credit: e.credit,
              debitSubconto: e.debitSubconto || op.counterpartyName || op.nomenclatureName || op.employeeName || '',
              creditSubconto: e.creditSubconto || op.counterpartyName || op.nomenclatureName || op.employeeName || '',
              amount: round2(e.amount),
              source: 'queued' as const,
              operationId: op.id,
              docLabel: `${op.docType1C}${op.docNumber ? ` №${op.docNumber}` : ''}`,
              description: e.description || op.description,
            }))
        )
    : [];

  // Step 1: Compute baseStartNet per leaf account (before ANY dbMovements)
  const baseStartNetMap = new Map<string, number>();
  const baseSubcontoStartNetMap = new Map<string, Map<string, number>>();
  const explicitNoPostingsTurnoverMap = new Map<string, { dt: number; kt: number }>();

  const addNet = (map: Map<string, number>, acc: string, delta: number) => {
    if (!acc || acc === '000') return;
    map.set(acc, round2((map.get(acc) ?? 0) + delta));
  };

  const addSubcontoStartNet = (acc: string, subcontoRaw: string | undefined, delta: number) => {
    if (!acc || acc === '000' || Math.abs(delta) < 0.005) return;
    const subLabel = normalizeSubcontoLabel(subcontoRaw, acc);
    const subMap = baseSubcontoStartNetMap.get(acc) ?? new Map<string, number>();
    subMap.set(subLabel, round2((subMap.get(subLabel) ?? 0) + delta));
    baseSubcontoStartNetMap.set(acc, subMap);
  };

  const dbPeriodEndsBeforeReportingYear = Boolean(
    reportingYearStart && db1C?.periodEnd && db1C.periodEnd < reportingYearStart
  );

  if (useDbData && db1C && db1C.rawBalances.length > 0) {
    if (effectiveMode === 'explicit_start_end') {
      for (const b of db1C.rawBalances) {
        if (dbMovements.length === 0 && dbPeriodEndsBeforeReportingYear) {
          const endNet = b.hasExplicitEnd
            ? b.endDebit - b.endCredit
            : b.startDebit - b.startCredit + b.turnoverDebit - b.turnoverCredit;
          addNet(baseStartNetMap, b.account, endNet);
          addSubcontoStartNet(b.account, b.subconto, endNet);
        } else {
          const sNet = b.startDebit - b.startCredit;
          addNet(baseStartNetMap, b.account, sNet);
          addSubcontoStartNet(b.account, b.subconto, sNet);
          if (dbMovements.length === 0 && (b.turnoverDebit !== 0 || b.turnoverCredit !== 0)) {
            const prev = explicitNoPostingsTurnoverMap.get(b.account) ?? { dt: 0, kt: 0 };
            explicitNoPostingsTurnoverMap.set(b.account, {
              dt: round2(prev.dt + b.turnoverDebit),
              kt: round2(prev.kt + b.turnoverCredit),
            });
          }
        }
      }
    } else if (effectiveMode === 'end_balances_reconstructed_start') {
      for (const b of db1C.rawBalances) {
        const endNet = b.hasExplicitEnd
          ? b.endDebit - b.endCredit
          : b.rawDebit - b.rawCredit;
        addNet(baseStartNetMap, b.account, endNet);
        addSubcontoStartNet(b.account, b.subconto, endNet);
      }
      for (const m of dbMovements) {
        if (m.debit && m.debit !== '000') {
          addNet(baseStartNetMap, m.debit, -m.amount);
          addSubcontoStartNet(m.debit, m.debitSubconto, -m.amount);
        }
        if (m.credit && m.credit !== '000') {
          addNet(baseStartNetMap, m.credit, +m.amount);
          addSubcontoStartNet(m.credit, m.creditSubconto, +m.amount);
        }
      }
    } else {
      for (const b of db1C.rawBalances) {
        if (dbMovements.length === 0 && dbPeriodEndsBeforeReportingYear && b.hasExplicitEnd) {
          const eNet = b.endDebit - b.endCredit;
          addNet(baseStartNetMap, b.account, eNet);
          addSubcontoStartNet(b.account, b.subconto, eNet);
        } else {
          const startNet = b.hasExplicitStart
            ? b.startDebit - b.startCredit
            : b.rawDebit - b.rawCredit;
          addNet(baseStartNetMap, b.account, startNet);
          addSubcontoStartNet(b.account, b.subconto, startNet);
          if (
            dbMovements.length === 0 &&
            !dbPeriodEndsBeforeReportingYear &&
            (b.turnoverDebit !== 0 || b.turnoverCredit !== 0)
          ) {
            const prev = explicitNoPostingsTurnoverMap.get(b.account) ?? { dt: 0, kt: 0 };
            explicitNoPostingsTurnoverMap.set(b.account, {
              dt: round2(prev.dt + b.turnoverDebit),
              kt: round2(prev.kt + b.turnoverCredit),
            });
          }
        }
      }
    }
  }

  // Step 2: Partition movements relative to [dateFrom, dateTo] and reportingYearStart
  const periodStartNetMap = new Map<string, number>(baseStartNetMap);
  const subcontoStartMap = new Map<string, Map<string, number>>();
  for (const [acc, sm] of baseSubcontoStartNetMap.entries()) {
    subcontoStartMap.set(acc, new Map(sm));
  }
  const subcontoTurnMap = new Map<string, Map<string, { dt: number; kt: number }>>();

  const addSubcontoPeriodStart = (acc: string, subRaw: string, delta: number) => {
    if (!acc || acc === '000') return;
    const label = normalizeSubcontoLabel(subRaw, acc);
    const sm = subcontoStartMap.get(acc) ?? new Map<string, number>();
    sm.set(label, round2((sm.get(label) ?? 0) + delta));
    subcontoStartMap.set(acc, sm);
  };

  const addSubcontoTurn = (acc: string, subRaw: string, side: 'dt' | 'kt', amt: number) => {
    if (!acc || acc === '000') return;
    const label = normalizeSubcontoLabel(subRaw, acc);
    const sm = subcontoTurnMap.get(acc) ?? new Map<string, { dt: number; kt: number }>();
    const cur = sm.get(label) ?? { dt: 0, kt: 0 };
    if (side === 'dt') cur.dt = round2(cur.dt + amt);
    else cur.kt = round2(cur.kt + amt);
    sm.set(label, cur);
    subcontoTurnMap.set(acc, sm);
  };

  const dbTurnMap = new Map<string, { dt: number; kt: number }>();
  const queuedTurnMap = new Map<string, { dt: number; kt: number }>();

  for (const [acc, t] of explicitNoPostingsTurnoverMap.entries()) {
    dbTurnMap.set(acc, { dt: t.dt, kt: t.kt });
  }

  const rawMovementsInPeriodByAcc = new Map<string, MovementRecord[]>();
  const pushMovementForAcc = (acc: string, m: MovementRecord) => {
    if (!acc || acc === '000') return;
    const arr = rawMovementsInPeriodByAcc.get(acc) ?? [];
    arr.push(m);
    rawMovementsInPeriodByAcc.set(acc, arr);
  };

  const allMovements = [...dbMovements, ...queuedMovements];
  for (const m of allMovements) {
    const d = m.date;
    const isHistoricalDbBeforeReportingYear = Boolean(
      m.source === 'db' && reportingYearStart && d && d < reportingYearStart
    );
    const isBeforeStart =
      isHistoricalDbBeforeReportingYear || Boolean(dateFrom && d && d < dateFrom);
    const isAfterEnd = Boolean(dateTo && d && d > dateTo);

    if (isBeforeStart) {
      if (m.debit && m.debit !== '000') {
        addNet(periodStartNetMap, m.debit, +m.amount);
        addSubcontoPeriodStart(m.debit, m.debitSubconto, +m.amount);
      }
      if (m.credit && m.credit !== '000') {
        addNet(periodStartNetMap, m.credit, -m.amount);
        addSubcontoPeriodStart(m.credit, m.creditSubconto, -m.amount);
      }
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
      addSubcontoTurn(m.debit, m.debitSubconto, 'dt', m.amount);
      pushMovementForAcc(m.debit, m);
    }
    if (m.credit && m.credit !== '000') {
      const cur = targetMap.get(m.credit) ?? { dt: 0, kt: 0 };
      cur.kt = round2(cur.kt + m.amount);
      targetMap.set(m.credit, cur);
      addSubcontoTurn(m.credit, m.creditSubconto, 'kt', m.amount);
      if (m.credit !== m.debit) {
        pushMovementForAcc(m.credit, m);
      }
    }
  }

  // Collect all active leaf account codes
  const leafAccountSet = new Set<string>([
    ...periodStartNetMap.keys(),
    ...dbTurnMap.keys(),
    ...queuedTurnMap.keys(),
  ]);
  leafAccountSet.delete('000');

  const leafRows: OsvAccountRow[] = [];
  const subcontoRowsByAccount: Record<string, OsvSubcontoRow[]> = {};
  const movementsByAccount: Record<string, OsvAccountMovement[]> = {};

  const sortedLeafCodes = Array.from(leafAccountSet).sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true })
  );

  for (const code of sortedLeafCodes) {
    const info = getAccountInfo(code);
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

    // Subconto breakdown for this leaf account
    const subStarts = subcontoStartMap.get(code);
    const subTurns = subcontoTurnMap.get(code);
    const allSubLabels = new Set<string>([
      ...(subStarts ? subStarts.keys() : []),
      ...(subTurns ? subTurns.keys() : []),
    ]);
    if (allSubLabels.size > 0) {
      const subRows: OsvSubcontoRow[] = [];
      for (const label of Array.from(allSubLabels).sort((a, b) => a.localeCompare(b, 'ru'))) {
        const sNet = subStarts?.get(label) ?? 0;
        const t = subTurns?.get(label) ?? { dt: 0, kt: 0 };
        const eNet = round2(sNet + t.dt - t.kt);
        if (
          Math.abs(sNet) < 0.005 &&
          Math.abs(t.dt) < 0.005 &&
          Math.abs(t.kt) < 0.005 &&
          Math.abs(eNet) < 0.005
        ) {
          continue;
        }
        const sSides = splitNetToSides(sNet, info.type);
        const eSides = splitNetToSides(eNet, info.type);
        const isTurnoverOnlyFinResultSub =
          code.startsWith('90.') || code.startsWith('91.') || code.startsWith('99.');
        subRows.push({
          subcontoKey: `${code}::${label}`,
          subcontoLabel: label,
          startDebit: sSides.debit,
          startCredit: sSides.credit,
          turnoverDebit: t.dt,
          turnoverCredit: t.kt,
          endDebit: eSides.debit,
          endCredit: eSides.credit,
          hasRedEnd: isTurnoverOnlyFinResultSub ? false : eSides.isRed,
        });
      }
      if (subRows.length > 0) {
        subcontoRowsByAccount[code] = subRows;
      }
    }

    // Account Card (Карточка счёта) chronological movements
    const accMovs = (rawMovementsInPeriodByAcc.get(code) ?? []).slice().sort((a, b) => {
      if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
      return a.id.localeCompare(b.id);
    });
    let runningNet = startNet;
    const cardRows: OsvAccountMovement[] = [];
    for (const m of accMovs) {
      const isDt = m.debit === code;
      const isKt = m.credit === code;
      const dtAmt = isDt ? m.amount : 0;
      const ktAmt = isKt ? m.amount : 0;
      runningNet = round2(runningNet + dtAmt - ktAmt);
      const runSides = splitNetToSides(runningNet, info.type);
      cardRows.push({
        id: `${code}-${m.id}`,
        date: m.date,
        source: m.source,
        operationId: m.operationId,
        docLabel: m.docLabel,
        description: m.description,
        corrAccount: isDt ? m.credit || '—' : m.debit || '—',
        subconto: isDt ? m.debitSubconto : m.creditSubconto,
        debitAmount: dtAmt,
        creditAmount: ktAmt,
        runningNet,
        runningDebit: runSides.debit,
        runningCredit: runSides.credit,
        isRedRunning: runSides.isRed,
      });
    }
    movementsByAccount[code] = cardRows;
  }

  // Build synthetic group rows for roots that have subaccounts
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

      const isCollapsedFinancialRoot =
        root === '90' || root === '91' || root === '99' || root === '68' || root === '69';

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

      // Aggregate root movements for clicking synthetic group rows in OSV
      const mergedMovs = children
        .flatMap((c) => movementsByAccount[c.code] ?? [])
        .sort(
          (a, b) =>
            (a.date || '').localeCompare(b.date || '') ||
            (a.id || '').localeCompare(b.id || '')
        );
      if (mergedMovs.length > 0) {
        let groupRunningNet = round2(gStartDt - gStartKt);
        movementsByAccount[root] = mergedMovs.map((m) => {
          groupRunningNet = round2(
            groupRunningNet + (m.debitAmount || 0) - (m.creditAmount || 0)
          );
          const { debit: rDt, credit: rKt, isRed: rRed } = splitNetToSides(
            groupRunningNet,
            rootInfo.type
          );
          return {
            ...m,
            runningNet: groupRunningNet,
            runningDebit: rDt,
            runningCredit: rKt,
            isRedRunning: rRed,
          };
        });
      }
    }
    rows.push(leaf);
  }

  // Grand totals over balance-sheet accounts (excluding off-balance accounts):
  // In 1C:BP 3.0, turnover totals sum all leaf subaccounts, whereas opening/ending balance totals
  // sum expanded leaf balances for accounts outside {90, 91, 99} (including active-passive 60, 62, 68, 69, 70, 71, 73, 75, 76)
  // PLUS the collapsed synthetic root balances for financial result accounts 90, 91, and 99.
  const balanceLeafRows = leafRows.filter((r) => !isOffBalanceAccountCode(r.code));
  const isFinancialResultCode = (code: string) => {
    const root = code.split('.')[0];
    return root === '90' || root === '91' || root === '99' || root === '68' || root === '69';
  };
  const nonFinancialBalanceLeaves = balanceLeafRows.filter((r) => !isFinancialResultCode(r.code));

  let collapsedFinStartDebit = 0;
  let collapsedFinStartCredit = 0;
  let collapsedFinEndDebit = 0;
  let collapsedFinEndCredit = 0;

  for (const finRoot of ['68', '69', '90', '91', '99'] as const) {
    const finLeaves = balanceLeafRows.filter(
      (r) => r.code === finRoot || r.code.startsWith(`${finRoot}.`)
    );
    if (finLeaves.length === 0) continue;
    const netFinStart = round2(
      finLeaves.reduce((s, r) => s + (r.startDebit - r.startCredit), 0)
    );
    const netFinEnd = round2(
      finLeaves.reduce((s, r) => s + (r.endDebit - r.endCredit), 0)
    );
    if (netFinStart > 0) collapsedFinStartDebit = round2(collapsedFinStartDebit + netFinStart);
    else if (netFinStart < 0) collapsedFinStartCredit = round2(collapsedFinStartCredit - netFinStart);

    if (netFinEnd > 0) collapsedFinEndDebit = round2(collapsedFinEndDebit + netFinEnd);
    else if (netFinEnd < 0) collapsedFinEndCredit = round2(collapsedFinEndCredit - netFinEnd);
  }

  const totalStartDebit = round2(
    nonFinancialBalanceLeaves.reduce((s, r) => s + r.startDebit, 0) + collapsedFinStartDebit
  );
  const totalStartCredit = round2(
    nonFinancialBalanceLeaves.reduce((s, r) => s + r.startCredit, 0) + collapsedFinStartCredit
  );
  const totalTurnoverDebit = round2(balanceLeafRows.reduce((s, r) => s + r.turnoverDebit, 0));
  const totalTurnoverCredit = round2(balanceLeafRows.reduce((s, r) => s + r.turnoverCredit, 0));
  const totalEndDebit = round2(
    nonFinancialBalanceLeaves.reduce((s, r) => s + r.endDebit, 0) + collapsedFinEndDebit
  );
  const totalEndCredit = round2(
    nonFinancialBalanceLeaves.reduce((s, r) => s + r.endCredit, 0) + collapsedFinEndCredit
  );

  const startDiff = round2(totalStartDebit - totalStartCredit);
  const turnoverDiff = round2(totalTurnoverDebit - totalTurnoverCredit);
  const endDiff = round2(totalEndDebit - totalEndCredit);

  const isStartBalanced = Math.abs(startDiff) < 0.01;
  const isTurnoverBalanced = Math.abs(turnoverDiff) < 0.01;
  const isEndBalanced = Math.abs(endDiff) < 0.01;

  // Build the 5 Smart Auditor Hints
  const auditorHints: OsvAuditorHint[] = [];

  // 1. Double-entry balance check
  if (balanceLeafRows.length > 0) {
    if (isStartBalanced && isTurnoverBalanced && isEndBalanced) {
      auditorHints.push({
        id: 'hint-double-entry-ok',
        checkType: 'double_entry_balance',
        severity: 'ok',
        title: 'Контроль двойной записи пройден (Σ Дт = Σ Кт)',
        explanation: `Входящее сальдо (${formatMoneyRu(totalStartDebit)}), обороты за период (${formatMoneyRu(totalTurnoverDebit)}) и исходящее сальдо (${formatMoneyRu(totalEndDebit)}) полностью сбалансированы.`,
      });
    } else {
      auditorHints.push({
        id: 'hint-double-entry-err',
        checkType: 'double_entry_balance',
        severity: 'error',
        title: 'Нарушено равенство Дебета и Кредита в ОСВ',
        explanation: `Расхождение: на начало ${formatMoneyRu(startDiff)}, по оборотам ${formatMoneyRu(turnoverDiff)}, на конец ${formatMoneyRu(endDiff)}. Проверьте полноту начальных остатков (счёт 000) или односторонние ручные проводки.`,
        howToFix1C:
          'В 1С:БП 3.0 откройте «Главное → Помощник ввода остатков» и убедитесь, что вспомогательный счёт 000 закрылся в ноль.',
      });
    }
  }

  // 2. Red (negative) balances on active/passive accounts
  for (const r of balanceLeafRows) {
    if (!r.hasRedEnd) continue;
    const movs = movementsByAccount[r.code] ?? [];
    const firstRedMov = movs.find((m) => m.isRedRunning);
    const val = r.type === 'active' ? r.endDebit : r.endCredit;
    auditorHints.push({
      id: `hint-red-${r.code}`,
      checkType: 'red_balance',
      severity: 'error',
      accountCode: r.code,
      operationId: firstRedMov?.operationId,
      title: `Красный (отрицательный) остаток на счёте ${r.code} «${r.name}»: ${formatMoneyRu(val)}`,
      explanation: firstRedMov
        ? `Счёт ушёл в минус ${formatRuDateShort(firstRedMov.date)} на документе «${firstRedMov.docLabel}» (${firstRedMov.description}). Вероятно, пропущено поступление/входящий остаток или перепутано время проведения документов за один день.`
        : `Отрицательное конечное сальдо на ${r.type === 'active' ? 'активном' : 'пассивном'} счёте ${r.code}. Не хватает входящего остатка или приходной операции.`,
      howToFix1C:
        r.code.startsWith('50') || r.code.startsWith('51')
          ? 'Проверьте входящий остаток денежных средств и очерёдность выписок/кассовых ордеров по времени.'
          : 'Проверьте документ поступления, склад и субсчёт учёта (например, 10.01 vs 10.08), затем перепроведите документы в хронологическом порядке.',
      quickAction: firstRedMov?.operationId ? 'jump_operation' : undefined,
      quickActionLabel: firstRedMov?.operationId ? 'Перейти к операции' : undefined,
    });
  }

  // 3. Unclosed cost & financial result accounts (20.01, 25, 26, 44.01, 90, 91)
  const maxActiveDateInWindow = [
    ...queuedMovements.map((m) => m.date),
    ...dbMovements.map((m) => m.date),
  ].reduce((mx, d) => (d > mx ? d : mx), '');
  const effectiveEndYm = (maxActiveDateInWindow || dateTo || '').slice(0, 7);
  const hasClosingInEndMonth =
    Boolean(effectiveEndYm) &&
    operations.some(
      (o) =>
        o.includeInProcessing &&
        !o.isDuplicateIn1C &&
        o.category === 'closing' &&
        (o.date || '').slice(0, 7) === effectiveEndYm
    );
  const hasLegitimateWipOn20 = (() => {
    if (!hasClosingInEndMonth) return false;
    const subs20 = (subcontoRowsByAccount['20.01'] ?? []).filter((s) => s.endDebit >= 0.01);
    if (subs20.length === 0) return false;
    const hasNamedProjectSub = subs20.some(
      (s) =>
        s.subcontoLabel !== 'Без аналитики (субконто)' &&
        s.subcontoLabel !== 'Основная номенклатурная группа'
    );
    const hasExplicitWipPolicy = operations.some(
      (o) =>
        o.includeInProcessing &&
        !o.isDuplicateIn1C &&
        (!dateTo || o.date <= dateTo) &&
        (o.category === 'wip_inventory' ||
          o.docType1C === 'ИнвентаризацияНЗП' ||
          /незавер[шщ][её]нн\p{L}*\s+производств|(?:^|[^\p{L}])нзп(?=$|[^\p{L}])/iu.test(
            o.description || ''
          ))
    );
    return hasNamedProjectSub || hasExplicitWipPolicy;
  })();

  const unclosedCostRows = balanceLeafRows.filter((r) => {
    if (Math.abs(r.endDebit) < 0.01 && Math.abs(r.endCredit) < 0.01) return false;
    if (r.code === '20.01') return !hasLegitimateWipOn20;
    return r.code.startsWith('25') || r.code === '26' || r.code.startsWith('44');
  });
  const unclosedFinRoots = rows.filter(
    (r) =>
      r.isGroup &&
      (r.code === '90' || r.code === '91') &&
      (Math.abs(r.endDebit) >= 0.01 || Math.abs(r.endCredit) >= 0.01)
  );
  if (unclosedCostRows.length > 0 || unclosedFinRoots.length > 0) {
    const codes = [
      ...unclosedCostRows.map((r) => `${r.code} (${formatMoneyRu(r.endDebit || r.endCredit)})`),
      ...unclosedFinRoots.map((r) => `${r.code} свёрнуто (${formatMoneyRu(r.endDebit || r.endCredit)})`),
    ].join(', ');
    auditorHints.push({
      id: 'hint-unclosed-period',
      checkType: 'unclosed_accounts',
      severity: 'warning',
      accountCode: unclosedCostRows[0]?.code ?? unclosedFinRoots[0]?.code,
      title: `Не закрыты счета затрат и финансового результата на конец периода`,
      explanation: `Остаток числится на счетах: ${codes}. В законченной учебной работе на конец месяца счета 25, 26, 44 и свёрнутое сальдо счетов 90 и 91 должны равняться 0,00 ₽ (счёт 20.01 имеет остаток только при наличии незавершённого производства).`,
      howToFix1C:
        'В 1С:БП 3.0 откройте «Операции → Закрытие месяца» и нажмите «Выполнить закрытие месяца» (или нажмите кнопку «Сформировать закрытие периода»).',
      quickAction: effectiveSourceMode !== 'db_only' ? 'run_autofix' : undefined,
      quickActionLabel:
        effectiveSourceMode !== 'db_only' ? 'Сформировать закрытие периода' : undefined,
    });
  }

  // 4. Unoffset advances (60.01 + 60.02 or 62.01 + 62.02 simultaneously)
  const checkAdvancePair = (debtCode: string, advCode: string, titleLabel: string) => {
    const debtSubs = subcontoRowsByAccount[debtCode] ?? [];
    const advSubs = subcontoRowsByAccount[advCode] ?? [];
    const advBySub = new Map(advSubs.map((s) => [s.subcontoLabel, s]));
    for (const dSub of debtSubs) {
      if (dSub.subcontoLabel === 'Без аналитики (субконто)') continue;
      const aSub = advBySub.get(dSub.subcontoLabel);
      if (!aSub) continue;
      const debtBal = debtCode === '60.01' ? dSub.endCredit : dSub.endDebit;
      const advBal = advCode === '60.02' ? aSub.endDebit : aSub.endCredit;
      if (debtBal >= 0.01 && advBal >= 0.01) {
        const offsetAmt = Math.min(debtBal, advBal);
        auditorHints.push({
          id: `hint-adv-${debtCode}-${dSub.subcontoLabel}`,
          checkType: 'unoffset_advances',
          severity: 'warning',
          accountCode: debtCode,
          title: `Незачтённый аванс по ${titleLabel} «${dSub.subcontoLabel}» на ${formatMoneyRu(offsetAmt)}`,
          explanation: `Одновременно висит остаток на ${debtCode} (${formatMoneyRu(debtBal)}) и аванс на ${advCode} (${formatMoneyRu(advBal)}). В 1С это чаще всего происходит из-за разных договоров в выписке и накладной или нарушения хронологии документов.`,
          howToFix1C:
            'Проверьте совпадение договора в оплате и накладной и перепроведите накладную (Зачёт авансов: Автоматически), либо оформите «Корректировка долга → Зачёт авансов».',
          quickAction: effectiveSourceMode !== 'db_only' ? 'run_autofix' : undefined,
          quickActionLabel: effectiveSourceMode !== 'db_only' ? 'Зачесть аванс автоматически' : undefined,
        });
      }
    }
  };
  checkAdvancePair('60.01', '60.02', 'поставщику');
  checkAdvancePair('62.01', '62.02', 'покупателю');

  // 5. Stuck input VAT on 19.* or uncommissioned equipment on 08.*
  const stuck19 = balanceLeafRows.filter((r) => r.code.startsWith('19') && r.endDebit >= 0.01);
  if (stuck19.length > 0) {
    const summary19 = stuck19.map((r) => `${r.code}: ${formatMoneyRu(r.endDebit)}`).join(', ');
    auditorHints.push({
      id: 'hint-stuck-19',
      checkType: 'stuck_vat_or_capex',
      severity: 'warning',
      accountCode: stuck19[0].code,
      title: `Не принят к вычету входной НДС на счёте 19 (${summary19})`,
      explanation:
        'Дебетовое сальдо на счёте 19 означает, что оприходованы товары/услуги/ОС с НДС, но не зарегистрирован счёт-фактура поставщика (или УПД со статусом 1) либо не сформированы записи книги покупок.',
      howToFix1C:
        'Проверьте регистрацию счёта-фактуры в подвале документа поступления или выполните «Операции → Регламентные операции НДС → Формирование записей книги покупок».',
    });
  }

  const stuck08 = balanceLeafRows.filter((r) => r.code.startsWith('08') && r.endDebit >= 0.01);
  if (stuck08.length > 0) {
    const summary08 = stuck08.map((r) => `${r.code}: ${formatMoneyRu(r.endDebit)}`).join(', ');
    auditorHints.push({
      id: 'hint-stuck-08',
      checkType: 'stuck_vat_or_capex',
      severity: 'warning',
      accountCode: stuck08[0].code,
      title: `Не введены в эксплуатацию внеоборотные активы на счёте 08 (${summary08})`,
      explanation:
        'Оборудование или капвложения числятся на счёте 08 и ещё не перенесены на счёт 01.01. Пока объект на счёте 08, амортизация по нему не начисляется.',
      howToFix1C:
        'Если по условию задачи объект должен быть введён в работу, оформите документ «ОС и НМА → Принятие к учёту ОС» (Дт 01.01 Кт 08.04.1).',
    });
  }

  return {
    dateFrom,
    dateTo,
    includeQueuedOperations: useQueuedData,
    sourceMode: effectiveSourceMode,
    balanceMode: effectiveMode,
    balanceModeDescription,
    rows,
    leafRows,
    subcontoRowsByAccount,
    movementsByAccount,
    auditorHints: auditorHints.map(sanitizeAuditorHint1C),
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
      isStartBalanced,
      isTurnoverBalanced,
      isEndBalanced,
    },
  };
}

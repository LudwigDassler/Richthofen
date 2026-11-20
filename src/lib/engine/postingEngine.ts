import {
  AccompanyingAction1C,
  AccountingEntry,
  CounterpartyResolutionSource,
  Database1CSnapshot,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  DirectoryAutocompleteOption1C,
  DocType1CBP30,
  EgrulCandidate,
  EntityBindingStatus,
  OperationAmountMode,
  OperationCategory,
  OperationReadinessStatus,
  QueuedOperation,
} from '@/types/accounting';
import {
  buildOperationMentorGuide1C,
  doesOperationRequireCounterparty,
} from '@/lib/engine/mentorGuide1C';
import { calculateOsvReport } from '@/lib/engine/osvCalculator';

function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function normalizeEntityKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[«»"'`„“”]/g, ' ')
    .replace(
      /(?:^|[^\p{L}\p{N}])(общество с ограниченной ответственностью|акционерное общество|публичное акционерное общество|закрытое акционерное общество|индивидуальный предприниматель|ооо|пао|зао|ао|ип)(?=$|[^\p{L}\p{N}])/giu,
      ' '
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferCounterpartyKind(
  name: string,
  inn: string
): 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо' {
  const cleanInn = inn.replace(/\D/g, '');
  const lower = name.toLowerCase();
  if (/^\s*ип(?=$|[^\p{L}])|индивидуальный предприниматель/iu.test(lower)) {
    return 'ИндивидуальныйПредприниматель';
  }
  if (cleanInn.length === 12) {
    return 'ИндивидуальныйПредприниматель';
  }
  if (
    /^\s*(ооо|ао|пао|зао|гуп|муп|фгуп|ано|нко)(?=$|[^\p{L}])/iu.test(lower) ||
    cleanInn.length === 10
  ) {
    return 'ЮридическоеЛицо';
  }
  // Check if name looks like a 2- or 3-part Russian FIO or Surname + Initials
  if (
    /^[А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?))$/u.test(
      name.trim()
    )
  ) {
    return 'ФизическоеЛицо';
  }
  return 'ЮридическоеЛицо';
}

export function isFounderContributionText(text: string): boolean {
  return /поступлен\p{L}*\s+(?:на\s+расч[её]тн\p{L}+\s+сч[её]т\s+|на\s+р\/с\s+)?доли(?=$|[^\p{L}])|оплат\p{L}*\s+доли(?=$|[^\p{L}])|внесени\p{L}*\s+доли(?=$|[^\p{L}])|взнос\p{L}*\s+(?:(?:от\s+)?(?:учредител\p{L}*|участник\p{L}*)\s+.*)?в\s+уставн\p{L}+\s+капитал|вклад\p{L}*\s+(?:(?:от\s+)?(?:учредител\p{L}*|участник\p{L}*)\s+.*)?в\s+уставн\p{L}+\s+капитал|поступил\p{L}*.*вклад\p{L}*\s+учредител|формирован\p{L}*\s+уставн\p{L}+\s+капитал|взнос\p{L}*\s+учредител/iu.test(
    text
  );
}

function normalizeInflectedSurnameWithInitials(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.\s*[А-ЯЁ]\.?)$/u);
  if (!m) return normalizeGenitiveFioToNominative(trimmed);
  const [, sur, initialsRaw] = m;
  const initials = initialsRaw.replace(/\s+/g, '');
  let nomSur = sur;
  if (/(?:ову|еву|ёву|ину|ыну|ому|ему)$/iu.test(sur)) {
    nomSur = /(?:ому|ему)$/iu.test(sur) ? sur.replace(/(?:ому|ему)$/iu, 'ий') : sur.slice(0, -1);
  } else if (/(?:ова|ева|ёва|ина|ына)$/iu.test(sur)) {
    // Genitive masculine ("вклад учредителя Соколова А.В." / "авансовый отчет Петрова А.С.")
    nomSur = sur.slice(0, -1);
  } else if (/(?:овой|евой|ёвой|иной|ыной)$/iu.test(sur)) {
    nomSur = `${sur.slice(0, -2)}а`;
  } else if (/(?:овым|евым|ёвым|иным|ыным)$/iu.test(sur)) {
    nomSur = sur.slice(0, -2);
  } else if (/ому$/iu.test(sur)) {
    nomSur = sur.replace(/ому$/iu, 'ый');
  } else if (/у$/iu.test(sur) && sur.length >= 4 && /[бвгджзклмнпрстфхцчшщ]у$/iu.test(sur)) {
    nomSur = sur.slice(0, -1);
  }
  return `${nomSur} ${initials.endsWith('.') ? initials : `${initials}.`}`;
}

export function extractFounderFioFromDescription(text: string): string {
  const cleaned = text.replace(/[«»"'„“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  const re =
    /(?:доли(?:\s+в\s+уставн\p{L}+\s+капитал\p{L}*)?(?:\s+учредителя|\s+участника|\s+от)?|(?:взнос\p{L}*|вклад\p{L}*)\s+(?:в\s+уставн\p{L}+\s+капитал\p{L}*\s+)?(?:от\s+)?(?:учредителя\s+|участника\s+)|(?:взнос\p{L}*|вклад\p{L}*)\s+в\s+уставн\p{L}+\s+капитал\p{L}*\s+(?:от\s+)?|(?:от\s+)?(?:учредителя|участника)\s+)([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?))?)/u;
  const m = cleaned.match(re);
  if (m && m[1]) {
    const candidate = m[1]
      .replace(/\s+(?:Сумма|НДС|Без|По|Договор|Счет|Счёт|В|На|в|на).*$/u, '')
      .trim();
    if (candidate.length >= 2) {
      return normalizeInflectedSurnameWithInitials(candidate);
    }
  }
  return '';
}

export function extractAccountableFioFromDescription(text: string): string {
  const cleaned = text.replace(/[«»"'„“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:выдан\p{L}*|перечислен\p{L}*|возвращ\p{L}*|внесен\p{L}*|авансов\p{L}*\s+отч[её]т|отчитал(?:ся|ась))\s+(?:из\s+касс\p{L}*\s+|с\s+р\/с\s+|на\s+карт\p{L}*\s+|подотч[её]т\s+|под\s+отч[её]т\s+|остат\p{L}*\s+подотч[её]тн\p{L}*\s+сумм\s+|сотрудник\p{L}*\s+|работник\p{L}*\s+)*([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/u,
    /([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)\s+(?:подотч[её]т|под\s+отч[её]т|на\s+хоз|на\s+командиров)/u,
    /(?:подотч[её]т|под\s+отч[её]т)\s+(?:сотрудник\p{L}*\s+|работник\p{L}*\s+)?([А-ЯЁ][а-яё]{2,}(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)))/u,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m[1]) {
      return normalizeInflectedSurnameWithInitials(m[1]);
    }
  }
  return '';
}

function normalizeGenitiveFioToNominative(rawFio: string): string {
  const parts = rawFio.trim().split(/\s+/);
  if (parts.length === 3) {
    const [sur, given, patr] = parts;
    // Unambiguous masculine genitive: e.g. "Иванова Ивана Ивановича" -> "Иванов Иван Иванович"
    if (/(?:овича|евича|ича)$/iu.test(patr) && /[ая]$/iu.test(given)) {
      const nomSur = /(?:ова|ева|ёва|ина|ына)$/iu.test(sur)
        ? sur.slice(0, -1)
        : /(?:ого|его)$/iu.test(sur)
          ? sur.replace(/(?:ого|его)$/iu, 'ий')
          : /а$/iu.test(sur)
            ? sur.slice(0, -1)
            : sur;
      const nomGiven = /я$/iu.test(given) ? `${given.slice(0, -1)}й` : given.slice(0, -1);
      const nomPatr = patr.slice(0, -1);
      if (nomSur.length >= 2 && nomGiven.length >= 2) {
        return `${nomSur} ${nomGiven} ${nomPatr}`;
      }
    }
    // Unambiguous feminine genitive: e.g. "Морозовой Елены Сергеевны" -> "Морозова Елена Сергеевна"
    if (/(?:овны|евны|ичны|иничны)$/iu.test(patr) && /[ыи]$/iu.test(given)) {
      const nomSur = /(?:овой|евой|ёвой|иной|ыной)$/iu.test(sur)
        ? `${sur.slice(0, -2)}а`
        : /(?:ской|цкой)$/iu.test(sur)
          ? `${sur.slice(0, -2)}ая`
          : sur;
      const nomGiven = /и$/iu.test(given) && /[кгхжшщчц]и$/iu.test(given)
        ? `${given.slice(0, -1)}а`
        : /и$/iu.test(given)
          ? `${given.slice(0, -1)}я`
          : `${given.slice(0, -1)}а`;
      const nomPatr = `${patr.slice(0, -1)}а`;
      if (nomSur.length >= 2 && nomGiven.length >= 2) {
        return `${nomSur} ${nomGiven} ${nomPatr}`;
      }
    }
  }
  return rawFio.trim();
}

export function russianSurnameMatches(candidateSurname: string, dbNominativeSurname: string): boolean {
  const cand = candidateSurname.toLowerCase().replace(/ё/g, 'е').trim();
  const nom = dbNominativeSurname.toLowerCase().replace(/ё/g, 'е').trim();
  if (cand.length < 2 || nom.length < 2) return false;
  if (cand === nom) return true;

  const forms = new Set<string>([nom]);
  if (/(?:ов|ев|ин|ын)$/.test(nom)) {
    forms.add(`${nom}а`);
    forms.add(`${nom}у`);
    forms.add(`${nom}ым`);
    forms.add(`${nom}е`);
  } else if (/(?:ова|ева|ина|ына)$/.test(nom)) {
    const stem = nom.slice(0, -1);
    forms.add(`${stem}ой`);
    forms.add(`${stem}у`);
  } else if (/(?:ский|цкий|ской|цкой|ой)$/.test(nom)) {
    const stem = nom.slice(0, -2);
    forms.add(`${stem}ого`);
    forms.add(`${stem}ому`);
    forms.add(`${stem}им`);
    forms.add(`${stem}ым`);
    forms.add(`${stem}ом`);
  } else if (/(?:ская|цкая|ая|яя)$/.test(nom)) {
    const stem = nom.slice(0, -2);
    forms.add(`${stem}ой`);
    forms.add(`${stem}ей`);
    forms.add(`${stem}ую`);
    forms.add(`${stem}юю`);
  } else if (nom.endsWith('а')) {
    const stem = nom.slice(0, -1);
    forms.add(`${stem}ы`);
    forms.add(`${stem}и`);
    forms.add(`${stem}е`);
    forms.add(`${stem}у`);
    forms.add(`${stem}ой`);
    forms.add(`${stem}ей`);
  } else if (nom.endsWith('я')) {
    const stem = nom.slice(0, -1);
    forms.add(`${stem}и`);
    forms.add(`${stem}е`);
    forms.add(`${stem}ю`);
    forms.add(`${stem}ей`);
  } else if (nom.endsWith('ь')) {
    const stem = nom.slice(0, -1);
    forms.add(`${stem}я`);
    forms.add(`${stem}ю`);
    forms.add(`${stem}ем`);
    forms.add(`${stem}и`);
  } else if (nom.endsWith('й')) {
    const stem = nom.slice(0, -1);
    forms.add(`${stem}я`);
    forms.add(`${stem}ю`);
    forms.add(`${stem}ем`);
    forms.add(`${stem}ого`);
    forms.add(`${stem}ому`);
  } else if (/[бвгджзклмнпрстфхцчшщ]$/.test(nom)) {
    forms.add(`${nom}а`);
    forms.add(`${nom}у`);
    forms.add(`${nom}ом`);
    forms.add(`${nom}ем`);
    forms.add(`${nom}е`);
  }

  return forms.has(cand);
}

function fioTokensMatch(candText: string, dbName: string): boolean {
  const candTokens = (candText.match(/\p{L}+/gu) ?? []).map((t) =>
    t.toLowerCase().replace(/ё/g, 'е')
  );
  const dbTokens = (dbName.match(/\p{L}+/gu) ?? []).map((t) =>
    t.toLowerCase().replace(/ё/g, 'е')
  );
  if (candTokens.length === 0 || dbTokens.length === 0) return false;
  // Exclude legal entity names from FIO inflection matching
  const legalStopWords = new Set(['ооо', 'пао', 'зао', 'ао', 'гуп', 'муп', 'общество', 'компания', 'завод']);
  if (dbTokens.some((t) => legalStopWords.has(t)) || candTokens.some((t) => legalStopWords.has(t))) {
    return false;
  }
  const dbOffset = dbTokens[0] === 'ип' ? 1 : 0;
  const candOffset = candTokens[0] === 'ип' ? 1 : 0;
  const dbSur = dbTokens[dbOffset];
  const candSur = candTokens[candOffset];
  if (!dbSur || !candSur || dbSur.length < 2 || candSur.length < 2) return false;

  if (!russianSurnameMatches(candSur, dbSur)) return false;

  const dbGiven = dbTokens[dbOffset + 1];
  const candGiven = candTokens[candOffset + 1];
  if (dbGiven && candGiven && dbGiven[0] !== candGiven[0]) {
    return false;
  }

  const dbPatr = dbTokens[dbOffset + 2];
  const candPatr = candTokens[candOffset + 2];
  if (dbPatr && candPatr && dbPatr[0] !== candPatr[0]) {
    return false;
  }

  return true;
}

/**
 * Returns unified autocomplete and lookup entries from `ВсеСправочники.Контрагенты`
 * and `ВсеСправочники.ФизическиеЛица` of the loaded 1C database.
 */
export function get1CCounterpartyAndIndividualOptions(
  db1C: Database1CSnapshot | null
): DirectoryAutocompleteOption1C[] {
  if (!db1C) return [];
  const options: DirectoryAutocompleteOption1C[] = [];
  const seenKeys = new Set<string>();

  for (const cp of db1C.counterparties) {
    const trimmed = cp.name.trim();
    if (trimmed.length < 2) continue;
    const cleanInn = (cp.inn ?? '').replace(/\D/g, '');
    const cleanKpp = (cp.kpp ?? '').replace(/\D/g, '');
    const kindRaw = (cp.kind ?? '').toLowerCase();
    const kind: DirectoryAutocompleteOption1C['kind'] = /физ/i.test(kindRaw)
      ? 'ФизическоеЛицо'
      : /предпринимат|ип/i.test(kindRaw)
        ? 'ИндивидуальныйПредприниматель'
        : inferCounterpartyKind(trimmed, cleanInn);

    const key = `cp:${normalizeEntityKey(trimmed) || trimmed.toLowerCase()}:${cleanInn}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    options.push({
      id: cp.id,
      name: trimmed,
      fullName: cp.fullName || trimmed,
      inn: cleanInn,
      kpp: cleanKpp,
      code1C: cp.code1C,
      source: 'Контрагенты',
      kind,
      defaultContract: cp.defaultContract,
    });
  }

  for (const ind of db1C.individuals) {
    const trimmed = ind.name.trim();
    if (trimmed.length < 2) continue;
    const rawInn = ind.extra?.inn || (/^\d{10,12}$/.test(ind.kind ?? '') ? ind.kind! : '');
    const cleanInn = rawInn.replace(/\D/g, '');
    const normKey = normalizeEntityKey(trimmed) || trimmed.toLowerCase();

    // Skip duplicate if exact same person with same INN is already listed under Контрагенты
    const alreadyInCp = options.some(
      (o) =>
        (normalizeEntityKey(o.name) === normKey ||
          (cleanInn && o.inn === cleanInn)) &&
        o.kind === 'ФизическоеЛицо'
    );
    if (alreadyInCp) continue;

    const key = `ind:${normKey}:${cleanInn}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    options.push({
      id: ind.id,
      name: trimmed,
      fullName: ind.extra?.fullName || trimmed,
      inn: cleanInn,
      kpp: '',
      code1C: ind.code1C,
      source: 'ФизическиеЛица',
      kind: 'ФизическоеЛицо',
    });
  }

  return options;
}

export function matchPersonOrCounterpartyIn1C(
  candidateName: string,
  candidateInn: string,
  db1C: Database1CSnapshot | null
): DirectoryAutocompleteOption1C | null {
  if (!db1C) return null;
  const trimmedName = candidateName.trim();
  const cleanInn = candidateInn.replace(/\D/g, '');
  if (trimmedName.length < 2 && cleanInn.length < 10) return null;

  const options = get1CCounterpartyAndIndividualOptions(db1C);
  const normCand = normalizeEntityKey(trimmedName);

  // 1. Exact INN match
  if (cleanInn.length === 10 || cleanInn.length === 12) {
    const byInn = options.find((o) => o.inn === cleanInn);
    if (byInn) return byInn;
  }

  // 2. Exact normalized name or fullName match
  if (normCand.length >= 2) {
    const exact = options.find((o) => {
      const dbNorm = normalizeEntityKey(o.name);
      const dbFullNorm = normalizeEntityKey(o.fullName ?? '');
      return dbNorm === normCand || (Boolean(dbFullNorm) && dbFullNorm === normCand);
    });
    if (exact) return exact;
  }

  // 3. Inflected Russian FIO / Surname+Initials match (for Контрагенты & ФизическиеЛица)
  if (trimmedName.length >= 2) {
    const byFio = options.find(
      (o) => fioTokensMatch(trimmedName, o.name) || (o.fullName && fioTokensMatch(trimmedName, o.fullName))
    );
    if (byFio) return byFio;
  }

  return null;
}

export function findPersonMentionedInDescription1C(
  description: string,
  db1C: Database1CSnapshot | null
): DirectoryAutocompleteOption1C | null {
  if (!db1C || !description.trim()) return null;
  const options = get1CCounterpartyAndIndividualOptions(db1C);
  const words = description.match(/[А-ЯЁ][а-яё]+/gu) ?? [];
  for (let i = 0; i < words.length; i++) {
    const window3 = words.slice(i, i + 3).join(' ');
    const window1 = words[i];
    for (const opt of options) {
      if (opt.source === 'ФизическиеЛица' || opt.kind === 'ФизическоеЛицо') {
        if (fioTokensMatch(window3, opt.name) || fioTokensMatch(window1, opt.name)) {
          return opt;
        }
      }
    }
  }
  return null;
}

export function checkDuplicateIn1CDb(
  candidate: {
    date: string;
    amount: number;
    docNumber: string;
    counterpartyName: string;
    counterpartyInn: string;
  },
  db1C: Database1CSnapshot | null
): { isDuplicate: boolean; reason?: string } {
  if (!db1C || Math.abs(candidate.amount) < 0.01) {
    return { isDuplicate: false };
  }

  const candNormCp = normalizeEntityKey(candidate.counterpartyName);
  const candDocNum = candidate.docNumber.trim().replace(/^0+/, '').toLowerCase();
  const candInn = candidate.counterpartyInn.replace(/\D/g, '');

  // 1. Check against ВсеДокументы
  for (const doc of db1C.documents) {
    if (!doc.posted) continue;
    if (doc.date && candidate.date && doc.date !== candidate.date) continue;
    if (Math.abs(doc.amount - candidate.amount) > 0.02) continue;

    const dbDocNum = doc.number.trim().replace(/^0+/, '').toLowerCase();
    const dbNormCp = normalizeEntityKey(doc.counterparty);
    const dbInn = (doc.counterpartyInn ?? '').replace(/\D/g, '');

    const sameDocNum = Boolean(candDocNum && dbDocNum && candDocNum === dbDocNum);
    const sameInn = Boolean(candInn && dbInn && candInn === dbInn);
    const sameCp = Boolean(
      candNormCp &&
        dbNormCp &&
        (candNormCp === dbNormCp ||
          candNormCp.includes(dbNormCp) ||
          dbNormCp.includes(candNormCp))
    );

    if (sameDocNum || sameInn || sameCp || (!candNormCp && !candDocNum)) {
      return {
        isDuplicate: true,
        reason: `Уже проведён в БД 1С: ${doc.documentKind} №${doc.number || 'б/н'} от ${doc.date} на сумму ${doc.amount.toFixed(2)} ₽`,
      };
    }
  }

  // 2. Check against Проводки grouped by document/date
  for (const p of db1C.postings) {
    if (p.date && candidate.date && p.date !== candidate.date) continue;
    if (Math.abs(p.amount - candidate.amount) > 0.02) continue;

    const dbDocNum = p.documentNumber.trim().replace(/^0+/, '').toLowerCase();
    const sameDocNum = Boolean(candDocNum && dbDocNum && candDocNum === dbDocNum);
    const postingText = normalizeEntityKey(
      `${p.counterpartyName ?? ''} ${p.debitSubconto.join(' ')} ${p.creditSubconto.join(' ')} ${p.description}`
    );
    const sameCp = Boolean(candNormCp && postingText.includes(candNormCp));

    if (sameDocNum || sameCp) {
      return {
        isDuplicate: true,
        reason: `Найдена проводка в БД 1С (${p.debit} — ${p.credit}) от ${p.date} (${p.documentLabel || p.description})`,
      };
    }
  }

  return { isDuplicate: false };
}

export interface RawDraftOperationInput {
  rowKey?: string;
  sourceFileName: string;
  date: string;
  docNumber?: string;
  incomingDocNumber?: string;
  incomingDocDate?: string;
  description: string;
  amount: number;
  needsAmount?: boolean;
  amountCalculationNote?: string;
  vatRate?: number;
  vatRule?: 'included' | 'on_top' | 'none';
  vatAmount?: number;
  quantity?: number;
  unitPrice?: number;
  hasInvoiceSF?: boolean;
  counterpartyName?: string;
  counterpartyInn?: string;
  counterpartyKpp?: string;
  counterpartyOgrn?: string;
  counterpartyBankAccount?: string;
  counterpartyBik?: string;
  counterpartyBankName?: string;
  counterpartyCorrAccount?: string;
  counterpartySource?: CounterpartyResolutionSource;
  egrulCandidates?: EgrulCandidate[];
  organizationBik?: string;
  organizationBankName?: string;
  organizationBankAccount?: string;
  contractName?: string;
  contractNumber?: string;
  contractDate?: string;
  nomenclatureName?: string;
  nomenclatureGroupHint?: string;
  warehouseName?: string;
  warehouseToHint?: string;
  expenseItemName?: string;
  cashFlowItemName?: string;
  employeeName?: string;
  employeePosition?: string;
  monthlySalary?: number;
  injuryInsuranceRate?: number;
  usefulLifeMonths?: number;
  depreciationBaseAmount?: number;
  costAccountHint?: string;
  materialAccountHint?: string;
  directionHint?: 'in' | 'out';
  docTypeHint?: DocType1CBP30;
  categoryHint?: OperationCategory;
  explicitDebit?: string;
  explicitCredit?: string;
}

export interface BatchSequentialContext {
  priorOperations: QueuedOperation[];
  reportingYear?: number;
  defaultBik?: string;
  defaultBankName?: string;
  assumeInvoiceOnVatPurchase?: boolean;
}

export function stemRuItemKey(raw: string): string {
  const ACTION_STOPWORDS = new Set([
    'ооо',
    'ао',
    'пао',
    'зао',
    'ип',
    'шт',
    'ед',
    'компл',
    'упак',
    'кг',
    'тонн',
    'руб',
    'ндс',
    'инн',
    'кпп',
    'введен',
    'введена',
    'введено',
    'введены',
    'ввод',
    'эксплуатацию',
    'эксплуатация',
    'эксплуатации',
    'принят',
    'принята',
    'принято',
    'приняты',
    'учету',
    'учет',
    'состав',
    'объект',
    'основных',
    'средств',
    'приобретен',
    'приобретена',
    'приобретено',
    'приобретены',
    'поступил',
    'поступила',
    'поступило',
    'поступили',
    'оприходован',
    'передан',
    'передана',
    'передано',
    'переданы',
    'выдан',
    'выдана',
    'выдано',
    'выдали',
    'списан',
    'списана',
    'списано',
    'списаны',
    'отпущен',
    'склад',
    'склада',
    'для',
    'при',
    'или',
    'со',
    'сроком',
    'срок',
    'полезного',
    'полезный',
    'полезной',
    'использования',
    'использование',
    'спи',
    'месяцев',
    'месяца',
    'месяц',
    'мес',
    'лет',
    'года',
    'год',
    'линейным',
    'линейный',
    'способом',
    'способ',
    'амортизации',
    'амортизация',
  ]);

  const tokens = raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`„“”()]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !ACTION_STOPWORDS.has(t) && !/^\d+$/u.test(t));

  return tokens
    .map((word) => {
      if (word.length < 4) return word;
      let w = word.replace(
        /(?:ами|ями|ого|его|ому|ему|ыми|ими|ую|юю|ой|ей|ом|ем|ам|ям|ах|ях|ов|ев)$/u,
        ''
      );
      if (w === word && word.length >= 4) {
        w = word.replace(/[аяуюыиеоь]$/u, '');
      }
      // Normalize fleeting vowel in common equipment nouns: станок / станка -> станк
      if (w === 'станок') return 'станк';
      if (w === 'песок') return 'песк';
      if (w === 'щебень' || w === 'щебен') return 'щебн';
      return w.length >= 3 ? w : word;
    })
    .join(' ')
    .trim();
}

export function inferMaterialSubaccount1C(itemAndDesc: string): {
  materialAccount: string;
  offBalanceAccount?: string;
} {
  const lower = itemAndDesc.toLowerCase().replace(/ё/g, 'е');
  if (
    /спецодежд|спецоснастк|спецобув|(?:^|[^\p{L}])сиз(?=$|[^\p{L}])|каск\p{L}*|халат|комбинезон|жилет|перчатк\p{L}*\s+рабоч|рабоч\p{L}*\s+(?:форм|костюм|ботинк|куртк)/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.10', offBalanceAccount: 'МЦ.02' };
  }
  if (
    /инвентар|хозпринадлежност|хозтовар|инструмент|лопат|дрел|перфоратор|стремянк|швабр|ведро/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.09', offBalanceAccount: 'МЦ.04' };
  }
  if (
    /кирпич|цемент|бетон|раствор|арматур|песок|песк|щебен|щебн|гравий|доск|пиломатериал|брус|фанер|гипсокартон|утеплител|минват|шифер|черепиц|штукатурк|шпаклевк|шпатлевк|сух\p{L}*\s+смес|газоблок|пеноблок|шлакоблок|керамзит|грунтовк|краск|эмал|стройматериал|строительн\p{L}*\s+материал/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.08' };
  }
  if (/топлив|бензин|дизел|солярк|(?:^|[^\p{L}])гсм(?=$|[^\p{L}])|моторн\p{L}*\s+масл/iu.test(lower)) {
    return { materialAccount: '10.03' };
  }
  if (/тар[аыуе](?=$|[^\p{L}])|упаковочн|гофрокороб|паллет|поддон/iu.test(lower)) {
    return { materialAccount: '10.04' };
  }
  if (/запчаст|запасн\p{L}*\s+част|подшипник|фильтр\s+маслян/iu.test(lower)) {
    return { materialAccount: '10.05' };
  }
  return { materialAccount: '10.01' };
}

export function detectOperationClassification(
  draft: Pick<
    RawDraftOperationInput,
    | 'description'
    | 'nomenclatureName'
    | 'counterpartyName'
    | 'directionHint'
    | 'explicitDebit'
    | 'explicitCredit'
  >,
  matchedNomKind?: string
): {
  category: OperationCategory;
  docType1C: DocType1CBP30;
  documentSubKind1C?: string;
} {
  const itemAndDescText = `${draft.description} ${draft.nomenclatureName ?? ''}`
    .toLowerCase()
    .replace(/ё/g, 'е');
  const fullText = `${itemAndDescText} ${draft.counterpartyName ?? ''}`
    .toLowerCase()
    .replace(/ё/g, 'е');

  // 1. Month-End Closing
  if (
    /закрытие\s+месяца|закрытие\s+счетов?\s+(?:20|23|25|26|44|90|91)|реформация\s+баланса/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'closing',
      docType1C: 'ЗакрытиеМесяца',
      documentSubKind1C: 'Регламентное закрытие месяца',
    };
  }

  // 2. Depreciation accrual (02.01)
  if (
    draft.explicitCredit === '02.01' ||
    /начислен\p{L}*\s+амортизац|амортизаци\p{L}*\s+(?:основн\p{L}*\s+средств|ос(?=$|[^\p{L}])|оборудован)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'depreciation_accrual',
      docType1C: 'ЗакрытиеМесяца',
      documentSubKind1C: 'Амортизация и износ основных средств',
    };
  }

  // 3. Advance offset
  if (/зачет\s+аванс|корректировка\s+долга/iu.test(itemAndDescText)) {
    return {
      category: 'advance_offset',
      docType1C: 'КорректировкаДолга',
      documentSubKind1C: 'Зачёт авансов',
    };
  }

  // 4. Workwear / special tooling / inventory issued to an employee (10.10 / 10.09 -> 20/26 + МЦ.02/МЦ.04)
  const hasSupplierReceiptVerb =
    /(?:^|[^\p{L}])(?:поступил\p{L}*|приобретен\p{L}*|закуплен\p{L}*|купил\p{L}*|получен\p{L}*\s+от|оплачен\p{L}*|перечислен\p{L}*)(?=$|[^\p{L}])/iu.test(
      itemAndDescText
    );
  if (
    !hasSupplierReceiptVerb &&
    (/(?:выда(?:ли|н\p{L}*)|передан\p{L}*\s+в\s+эксплуатац\p{L}*|отпущен\p{L}*\s+в\s+эксплуатац\p{L}*)\s+(?:со\s+склада\s+)?(?:рабоч\p{L}*\s+|защитн\p{L}*\s+)?(?:спецодежд|спецоснастк|спецобув|сиз(?=$|[^\p{L}])|инвентар|хозпринадлежност|инструмент|каск|форм\p{L}*|халат|комбинезон|перчатк|костюм|жилет)/iu.test(
      itemAndDescText
    ) ||
      /(?:выда(?:ли|н\p{L}*)|передан\p{L}*)\s+.*(?:спецодежд|спецоснастк|спецобув|инвентар|хозпринадлежност|каск).*(?:сотрудник|работник|каменщик|сварщик|монтажник|слесар|токар|электрик|мастер|прораб|водител|кладовщик|маляр|штукатур|плотник|грузчик|рабоч|в\s+эксплуатац)/iu.test(
        itemAndDescText
      ) ||
      /передач\p{L}*\s+материал\p{L}*\s+в\s+эксплуатац/iu.test(itemAndDescText))
  ) {
    return {
      category: 'workwear_issue',
      docType1C: 'ПередачаМатериаловВЭксплуатацию',
      documentSubKind1C: 'Передача спецодежды / инвентаря в эксплуатацию',
    };
  }

  // 5. Fixed Asset Commissioning (Ввод в эксплуатацию / Принятие к учёту ОС: 01.01 <- 08.04.1)
  if (
    (draft.explicitDebit === '01.01' && draft.explicitCredit?.startsWith('08')) ||
    (!/спецодежд|спецоснастк|спецобув|инвентар/iu.test(itemAndDescText) &&
      /введен\p{L}*\s+в\s+эксплуатац|ввод\s+в\s+эксплуатац|принят\p{L}*\s+к\s+учету\s+(?:объект\p{L}*\s+)?(?:ос(?=$|[^\p{L}])|основн\p{L}*\s+средств|оборудован|станок|станк|здани|сооружен|автомобил|транспорт|компьютер|сервер)/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'os_commissioning',
      docType1C: 'ПринятиеКУчетуОС',
      documentSubKind1C: 'Принятие к учёту ОС (ввод в эксплуатацию)',
    };
  }

  // 6. Internal Materials Write-off to Production / Site (Расход материалов / Требование-накладная: 20/25/26 <- 10.*)
  const hasExternalCounterpartyMarker =
    /(?:^|\s)(?:от|у|поставщик\p{L}*|покупател\p{L}*|заказчик\p{L}*)\s+(?:ооо|ао|пао|зао|ип)(?=$|[^\p{L}])|с\s+расчетн\p{L}*\s+счет|на\s+расчетн\p{L}*\s+счет|с\s+р\/с|на\s+р\/с/iu.test(
      fullText
    );
  if (
    !hasExternalCounterpartyMarker &&
    !hasSupplierReceiptVerb &&
    (/(?:передан|списан|отпущен|израсходован|направлен)\p{L}*\s+.*(?:на\s+объект|в\s+производств|на\s+строительств|для\s+производств|для\s+строительств|для\s+изготовлен|в\s+цех|на\s+участок|на\s+собственн\p{L}*\s+нужд|на\s+хознужд|на\s+ремонт|в\s+переработк)/iu.test(
      itemAndDescText
    ) ||
      /требовани[ея]-накладн|расход\s+материалов/iu.test(itemAndDescText))
  ) {
    return {
      category: 'materials_writeoff',
      docType1C: 'РасходМатериалов',
      documentSubKind1C: 'Использование материалов',
    };
  }

  // 7. Production Output of Finished Goods (43 <- 20.01)
  if (
    (draft.explicitDebit === '43' && draft.explicitCredit?.startsWith('20')) ||
    /выпущен\p{L}*\s+(?:из\s+производств\p{L}*\s+)?(?:готов\p{L}*\s+)?продукц|выпуск\s+(?:готов\p{L}*\s+)?продукц|оприходован\p{L}*\s+(?:на\s+склад\s+|из\s+цеха\s+|из\s+производств\p{L}*\s+)готов\p{L}*\s+продукц|сдан\p{L}*\s+на\s+склад\s+готов\p{L}*\s+продукц|отчет\s+производства\s+за\s+смену/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'production_output',
      docType1C: 'ВыпускПродукции',
      documentSubKind1C: 'Отчёт производства за смену',
    };
  }

  // 8. Internal Warehouse Transfer (10/41 <-> 10/41)
  if (/перемещен\p{L}*.*(?:между\s+склад|со\s+склада.*на\s+склад|в\s+цехов\p{L}*\s+кладов)/iu.test(itemAndDescText)) {
    return {
      category: 'warehouse_transfer',
      docType1C: 'ПеремещениеТоваров',
      documentSubKind1C: 'Перемещение между складами',
    };
  }

  // 9. Internal Cash <-> Bank Movement (50.01 <-> 51 / 57.01)
  if (
    /по\s+чеку\s+(?:сня\p{L}*|получен\p{L}*)|(?:снят|снял|получен)\p{L}*.*(?:денежн\p{L}*\s+средств|наличн|деньг).*(?:с\s+(?:р\/с|расчетн)|в\s+банк|по\s+чеку)|из\s+банка\s+в\s+кассу|получен\p{L}*\s+денежн\p{L}*\s+средств\p{L}*\s+по\s+чеку|поступлен\p{L}*\s+наличн\p{L}*\s+из\s+банк/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'cash_bank_internal',
      docType1C: 'ПоступлениеНаличных',
      documentSubKind1C: 'Получение наличных в банке',
    };
  }
  if (
    /(?:внесен|сдан)\p{L}*.*(?:наличн|выручк|денежн).*(?:на\s+р\/с|на\s+расчетн|в\s+банк)|взнос\s+наличн\p{L}*\s+в\s+банк|передан\p{L}*\s+инкассат|инкассац\p{L}*/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'cash_bank_internal',
      docType1C: 'ВыдачаНаличных',
      documentSubKind1C: /инкассат|инкассац/iu.test(itemAndDescText)
        ? 'Инкассация денежных средств (57.01)'
        : 'Взнос наличными в банк',
    };
  }

  // 9a. Accountable Person Settlements (счёт 71.01 — Подотчётные лица)
  if (
    draft.explicitCredit === '71.01' &&
    draft.explicitDebit === '50.01'
  ) {
    return {
      category: 'accountable_return',
      docType1C: 'ПоступлениеНаличных',
      documentSubKind1C: 'Возврат от подотчетного лица',
    };
  }
  if (
    /(?:возвращ\p{L}*|возврат|внесен\p{L}*.*в\s+кассу|сдан\p{L}*.*в\s+кассу).*(?:остат\p{L}*\s+)?(?:подотчет|под\s+отчет|неиспользованн\p{L}*\s+подотчет)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'accountable_return',
      docType1C: 'ПоступлениеНаличных',
      documentSubKind1C: 'Возврат от подотчетного лица',
    };
  }
  if (
    draft.explicitCredit === '71.01' ||
    /авансов\p{L}*\s+отчет|отчитал(?:ся|ась)\s+.*за|приобретен\p{L}*\s+подотчетн\p{L}*\s+лиц|израсходован\p{L}*\s+подотчетн/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'expense_report',
      docType1C: 'АвансовыйОтчет',
      documentSubKind1C: 'Авансовый отчёт подотчётного лица',
    };
  }
  if (
    draft.explicitDebit === '71.01' ||
    /подотчет|под\s+отчет|(?:выдан|выдал|перечислен)\p{L}*.*(?:на\s+хоз(?:яйственн\p{L}*)?\s*нужд|на\s+командиров)/iu.test(
      itemAndDescText
    )
  ) {
    const isBankAccountable =
      (/с\s+р\/с|с\s+расчетн|на\s+(?:банковск\p{L}*\s+|корпоративн\p{L}*\s+)?карт|безналичн|перечислен/iu.test(
        itemAndDescText
      ) ||
        draft.explicitCredit === '51') &&
      !/из\s+касс|(?:^|[^\p{L}])рко(?=$|[^\p{L}])/iu.test(itemAndDescText);
    return {
      category: 'accountable_issue',
      docType1C: isBankAccountable ? 'СписаниеСРасчетногоСчета' : 'ВыдачаНаличных',
      documentSubKind1C: isBankAccountable
        ? 'Перечисление подотчетному лицу'
        : 'Выдача подотчетному лицу',
    };
  }

  // 9b. HR Hiring / Employment Order (Приём на работу — кадровый учёт окладов без проводок)
  if (
    /принят[аы]?\s+на\s+работу|прием\s+на\s+работу|оформлен[аы]?\s+в\s+штат|трудовой\s+договор.*оклад/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'hr_hire',
      docType1C: 'ПриемНаРаботу',
      documentSubKind1C: 'Приём на работу (регистрация штатного оклада)',
    };
  }

  // 10. Insurance & Payroll Accruals
  if (
    /начислен\p{L}*\s+страхов\p{L}*\s+взнос/iu.test(itemAndDescText) &&
    !/заработн|зарплат|оплат\p{L}*\s+труд/iu.test(itemAndDescText) &&
    draft.directionHint !== 'out'
  ) {
    return {
      category: 'insurance_accrual',
      docType1C: 'НачислениеЗарплаты',
      documentSubKind1C: 'Начисление страховых взносов',
    };
  }
  if (
    /начислен[аоы]?\s+(?:заработн|зарплат|оплат\p{L}*\s+труд|з\/п|зп(?=$|[^\p{L}]))|расчетная\s+ведомость|начисление\s+зарплат/iu.test(
      itemAndDescText
    ) &&
    draft.directionHint !== 'out'
  ) {
    return {
      category: 'payroll_accrual',
      docType1C: 'НачислениеЗарплаты',
      documentSubKind1C: 'Начисление зарплаты и взносов',
    };
  }

  // 10b. Payroll Payout (both bank 51 and cash 50.01)
  if (
    /(?:выплачен|выплат|перечислен|выдан)\p{L}*(?:\s+(?:с\s+р\/с(?:ч)?|с\s+расчетн\p{L}*\s+счет\p{L}*|из\s+касс\p{L}*|по\s+рко|наличн\p{L}*|на\s+банковск\p{L}*\s+карт\p{L}*|на\s+карт\p{L}*|по\s+ведомост\p{L}*|по\s+реестр\p{L}*|сотрудник\p{L}*|работник\p{L}*|персонал\p{L}*))*\s+(?:заработн\p{L}*\s+плат|зарплат|з\/п|оплат\p{L}*\s+труд)|зарплат\p{L}*\s+по\s+ведомост|(?:выплачен|выплат|перечислен)\p{L}*.*аванс\p{L}*\s+за\s+перв\p{L}*\s+половин/iu.test(
      itemAndDescText
    )
  ) {
    const isCashPayout = /из\s+касс|(?:^|[^\p{L}])рко(?=$|[^\p{L}])|наличн/iu.test(itemAndDescText);
    return {
      category: 'payroll_payout',
      docType1C: isCashPayout ? 'ВыдачаНаличных' : 'СписаниеСРасчетногоСчета',
      documentSubKind1C: isCashPayout ? 'Выплата заработной платы по ведомости' : 'Перечисление заработной платы',
    };
  }

  // 10c. Loans & Credits (66.03 / 67.03)
  if (
    draft.explicitCredit?.startsWith('66') ||
    draft.explicitCredit?.startsWith('67') ||
    /(?:получен|поступил|зачислен)\p{L}*.*(?:краткосрочн\p{L}*\s+|долгосрочн\p{L}*\s+|банковск\p{L}*\s+)?(?:за[её]м|кредит)(?=$|[^\p{L}])/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'loan_received',
      docType1C: 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: 'Получение кредита / займа',
    };
  }
  if (
    draft.explicitDebit?.startsWith('66') ||
    draft.explicitDebit?.startsWith('67') ||
    /(?:погашен|возвращ|возврат|перечислен\p{L}*\s+в\s+погашен|списан\p{L}*\s+в\s+погашен)\p{L}*.*(?:краткосрочн\p{L}*\s+|долгосрочн\p{L}*\s+|основн\p{L}*\s+долг\p{L}*\s+по\s+)?(?:за[её]м\p{L}*|кредит\p{L}*)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'loan_repaid',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Погашение кредита / займа',
    };
  }

  // 11. External Cash Operations
  if (/(?:^|[^\p{L}])пко(?=$|[^\p{L}])|приходный кассовый|поступление наличных|в кассу от покупател/iu.test(itemAndDescText)) {
    return { category: 'cash_in', docType1C: 'ПоступлениеНаличных' };
  }
  if (
    /(?:^|[^\p{L}])рко(?=$|[^\p{L}]).*касс|расходный кассовый|выдача наличных|из кассы поставщик/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'cash_out', docType1C: 'ВыдачаНаличных' };
  }

  // 12. Bank Fee
  if (/комиссия банка|за ведение счета|расчетно-кассовое обслуж|услуги банка|банковск\p{L}*\s+обслуживан/iu.test(itemAndDescText)) {
    return {
      category: 'bank_fee',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Комиссия банка (РКО)',
    };
  }

  // 13. Tax / Social Contribution Payments
  if (
    !/начислен/i.test(itemAndDescText) &&
    (draft.directionHint === 'out' ||
      /перечислен\p{L}*|уплат\p{L}*|оплат\p{L}*|списан\p{L}*|погашен\p{L}*/iu.test(fullText))
  ) {
    if (
      /в\s+бюджет|задолженност\p{L}*\s+по\s+налог|налог\p{L}*\s+и\s+(?:страхов\p{L}*\s+)?взнос|ндс\s+в\s+бюджет|уплата\s+ндс|(?:^|[^\p{L}])(ндфл|налог\s+на\s+прибыль|страхов\p{L}*\s+взнос\p{L}*|единый\s+налоговый\s+платеж|енп|ми\s*фнс|ифнс|фнс|уфк|сфр)(?=$|[^\p{L}])/iu.test(
        fullText
      )
    ) {
      return {
        category: 'tax_payment',
        docType1C: 'СписаниеСРасчетногоСчета',
        documentSubKind1C: 'Уплата налога / взносов',
      };
    }
  }

  // 14. Penalty / Writ of Execution
  if (/исполнительн\w*\s+лист|штраф по договор|неустойк|претензи|судебн\w*\s+взыскан/iu.test(itemAndDescText)) {
    return {
      category: 'penalty_claim',
      docType1C:
        draft.directionHint === 'out' || /оплат|списан|перечислен/i.test(itemAndDescText)
          ? 'СписаниеСРасчетногоСчета'
          : 'ОперацияБух',
    };
  }

  // 16. Founder Contribution to Charter Capital (75.01)
  if (
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(itemAndDescText)
  ) {
    const isCash = /(?:^|[^\p{L}])пко(?=$|[^\p{L}])|в кассу|наличн/iu.test(itemAndDescText);
    return {
      category: 'founder_contribution',
      docType1C: isCash ? 'ПоступлениеНаличных' : 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: 'Прочее поступление (вклад в УК — счёт 75.01)',
    };
  }

  // 17. Explicit Bank IN
  if (
    draft.directionHint === 'in' ||
    /поступил\p{L}*\s+(?:на\s+р\/с(?:ч)?|на\s+расчетн\p{L}*\s+счет\s*)?(?:\d+\s*%\s*)?(?:оплат|аванс|предоплат|выручк|денежн\p{L}*\s+средств)|поступление\s+на\s+(?:р\/с|расчетн)|оплата\s+от\s+(?:покупател|заказчик)|платежное\s+поручение\s+входящ|выручка\s+на\s+расчетный\s+счет|получен\p{L}*\s+(?:\d+\s*%\s*)?(?:аванс|предоплат|оплат)\s+от|зачислен\p{L}*\s+на\s+(?:р\/с|расчетн)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'bank_in',
      docType1C: 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: 'Оплата от покупателя',
    };
  }

  // 18. Explicit Bank OUT
  if (
    draft.directionHint === 'out' ||
    /перечислен\p{L}*\s+(?:с\s+р\/с(?:ч)?\s+|с\s+расчетн\p{L}*\s+счета\s+)?(?:\d+\s*%\s*)?(?:аванс|предоплат|оплат|задолженност|сумма|денежн|по\s+счету|поставщик|подрядчик|арендодател)|оплачен\p{L}*\s+(?:поставщик|счет|аванс|с\s+р\/с|с\s+расчетн)|списание\s+с\s+(?:р\/с|расчетн)|платежное\s+поручение\s+исходящ|оплата\s+по\s+счету/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'bank_out',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Оплата поставщику',
    };
  }

  // 19. Sales / Shipment / Delivery of Finished Goods, Goods, Works, Services (Реализация товаров, продукции, услуг)
  if (
    !/от\s+поставщик|поставлен\p{L}*\s+поставщик/iu.test(itemAndDescText) &&
    (/(?:^|[^\p{L}])(?:поставлен[аоы]?|отгружен\p{L}*|реализован\p{L}*|прода[нж]\p{L}*)\s+(?:готов\p{L}*\s+|собственн\p{L}*\s+)?(?:продукц|товар|издели|парти|покупател|заказчик|клиент|в\s+адрес|ооо|ао|пао|зао|ип|\d)/iu.test(
      itemAndDescText
    ) ||
      /(?:^|[^\p{L}])(?:реализован\p{L}*|отгружен\p{L}*)(?=$|[^\p{L}])|выполнен\p{L}*\s+(?:строительн\p{L}*\s+|монтажн\p{L}*\s+|подрядн\p{L}*\s+)?работ|сдан\p{L}*\s+работ|(?:оказан\p{L}*|реализаци\p{L}*)\s+услуг\p{L}*\s+(?:заказчик|покупател|клиент)|акт\s+(?:оказанных\s+услуг|выполненных\s+работ)\s+(?:покупател|заказчик)|реализация\s+(?:товаров|продукции|услуг|работ)|выручка\s+от\s+реализац/iu.test(
        itemAndDescText
      ))
  ) {
    if (matchedNomKind === 'Товар' || matchedNomKind === 'Продукция') {
      return {
        category: 'sale_goods',
        docType1C: 'РеализацияТоваровУслуг',
        documentSubKind1C: matchedNomKind === 'Продукция' ? 'Готовая продукция (накладная, УПД)' : 'Товары (накладная, УПД)',
      };
    }
    if (
      matchedNomKind === 'Услуга' ||
      /оказан\p{L}*\s+услуг|реализация\s+услуг|выполнен\p{L}*\s+работ|сдан\p{L}*\s+работ|акт\s+выполненных\s+работ/iu.test(
        itemAndDescText
      )
    ) {
      return {
        category: 'sale_services',
        docType1C: 'РеализацияТоваровУслуг',
        documentSubKind1C: 'Услуги / работы (акт, УПД)',
      };
    }
    return {
      category: 'sale_goods',
      docType1C: 'РеализацияТоваровУслуг',
      documentSubKind1C: /продукц|издели/iu.test(itemAndDescText)
        ? 'Готовая продукция (накладная, УПД)'
        : 'Товары (накладная, УПД)',
    };
  }

  // 20. Purchases: Equipment (08.04.1) -> Goods (41.01) -> Materials (10.*) -> Services (20/26/44)
  if (
    matchedNomKind === 'Оборудование' ||
    matchedNomKind === 'ОС' ||
    (!/ремонт|обслуживан|аренд|доставк/iu.test(itemAndDescText) &&
      /(?:поступил|приобретен|оприходован|получен|купил|закуплен)\p{L}*.*(?:оборудован|станок|станк|производственн\p{L}*\s+лини|объект\s+основн\p{L}*\s+средств|объект\s+ос(?=$|[^\p{L}]))/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'purchase_equipment',
      docType1C: 'ПоступлениеТоваровУслуг',
      documentSubKind1C: 'Оборудование (счёт 08.04.1)',
    };
  }

  if (matchedNomKind === 'Товар') {
    return { category: 'purchase_goods', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Товары (накладная, УПД)' };
  }
  if (matchedNomKind === 'Материал') {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Материалы (накладная, УПД)' };
  }
  if (
    matchedNomKind === 'Услуга' ||
    /аренд|услуг|связ|интернет|телефон|электроэнерг|коммунальн|доставк|транспортн|перевозк|реклам|консультац|обслуживан|нотариус|юридическ|аудиторск|охран|уборк|ремонт/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_services', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Услуги (акт, УПД)' };
  }

  if (
    /материал|сырь[её]|канцтовар|бумаг|топлив|бензин|дизел|гсм|запчаст|инвентар|хозтовар|хозпринадлежност|спецодежд|спецоснастк|спецобув|(?:^|[^\p{L}])сиз(?=$|[^\p{L}])|каск|халат|комбинезон|кирпич|цемент|бетон|раствор|арматур|песок|щебен|гравий|доск|пиломатериал|брус|фанер|гипсокартон|утеплител|минват|шифер|штукатурк|шпаклевк|грунтовк|краск|стройматериал|металл|профил|кабел|провод|метиз|крепеж|саморез|электрод/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Материалы (накладная, УПД)' };
  }

  // Explicit purchase / supplier receipt markers -> purchase_goods
  if (
    /(?:^|[^\p{L}])(?:поступил\p{L}*|приобретен\p{L}*|оприходован\p{L}*|закуплен\p{L}*|купил\p{L}*|получен\p{L}*\s+(?:товар|парти|накладн|счет|акт|упд|от\s+(?:поставщик|ооо|ао|пао|зао|ип))|акцептован\p{L}*|принят\p{L}*\s+к\s+(?:учету\s+товар|оплат)|товарн\p{L}*\s+накладн|торг-12|(?:^|[^\p{L}])упд(?=$|[^\p{L}])|от\s+поставщик)/iu.test(
      fullText
    )
  ) {
    return {
      category: 'purchase_goods',
      docType1C: 'ПоступлениеТоваровУслуг',
      documentSubKind1C: 'Товары (накладная, УПД)',
    };
  }

  // Safe neutral fallback: never force ПоступлениеТоваровУслуг with 20% VAT & counterparty error on unrecognized text
  return {
    category: 'manual',
    docType1C: 'ОперацияБух',
    documentSubKind1C: 'Операция, введённая вручную (уточните вид документа или Дт/Кт)',
  };
}

function detectCategoryAndDocType(
  draft: RawDraftOperationInput,
  matchedNomKind?: string
): {
  category: OperationCategory;
  docType1C: DocType1CBP30;
  documentSubKind1C?: string;
} {
  if (draft.categoryHint && draft.docTypeHint) {
    return {
      category: draft.categoryHint,
      docType1C: draft.docTypeHint,
    };
  }
  return detectOperationClassification(draft, matchedNomKind);
}

interface StockBatchResolution {
  amount: number;
  account: string;
  availableQty: number;
  resolvedQty?: number;
  sourceNote: string;
}

function resolveStockBatchCost(params: {
  itemText: string;
  preferredAccount: string;
  accountPrefixFilter: string[];
  requestedQty?: number;
  opDate?: string;
  db1C: Database1CSnapshot | null;
  priorOperations: QueuedOperation[];
}): StockBatchResolution | null {
  const {
    itemText,
    preferredAccount,
    accountPrefixFilter,
    requestedQty,
    opDate,
    db1C,
    priorOperations,
  } = params;
  const stem = stemRuItemKey(itemText);
  if (!stem) return null;
  const stemTokens = stem.split(' ').filter((t) => t.length >= 3);
  if (stemTokens.length === 0) return null;

  const matchesItem = (candidateText: string): boolean => {
    const candStem = stemRuItemKey(candidateText);
    if (!candStem) return false;
    return stemTokens.every((tok) => candStem.includes(tok));
  };

  const isTargetAccount = (acc: string): boolean =>
    accountPrefixFilter.some((pref) => acc === pref || acc.startsWith(`${pref}.`));

  // Track net balance & quantity per subaccount for this item
  const buckets = new Map<string, { netAmt: number; netQty: number }>();
  const addBucket = (acc: string, deltaAmt: number, deltaQty: number) => {
    const cur = buckets.get(acc) ?? { netAmt: 0, netQty: 0 };
    cur.netAmt = round2(cur.netAmt + deltaAmt);
    cur.netQty = round2(cur.netQty + deltaQty);
    buckets.set(acc, cur);
  };

  if (db1C) {
    for (const b of db1C.rawBalances) {
      if (!isTargetAccount(b.account)) continue;
      if (b.subconto && matchesItem(b.subconto)) {
        const dt = b.hasExplicitStart ? b.startDebit : b.rawDebit;
        const kt = b.hasExplicitStart ? b.startCredit : b.rawCredit;
        addBucket(b.account, dt - kt, b.quantity ?? 0);
      }
    }
    for (const p of db1C.postings) {
      if (opDate && p.date && p.date > opDate) continue;
      if (isTargetAccount(p.debit) && matchesItem(`${p.debitSubconto.join(' ')} ${p.description}`)) {
        addBucket(p.debit, p.amount, p.quantityDebit ?? 0);
      }
      if (isTargetAccount(p.credit) && matchesItem(`${p.creditSubconto.join(' ')} ${p.description}`)) {
        addBucket(p.credit, -p.amount, -(p.quantityCredit ?? 0));
      }
    }
  }

  for (const pOp of priorOperations) {
    if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
    if (opDate && pOp.date && pOp.date > opDate) continue;
    const opLevelMatch = matchesItem(`${pOp.nomenclatureName} ${pOp.description}`);
    for (const e of pOp.entries) {
      if (e.isOffBalance) continue;
      if (isTargetAccount(e.debit) && (opLevelMatch || matchesItem(`${e.debitSubconto} ${e.description}`))) {
        addBucket(e.debit, e.amount, pOp.quantity ?? 0);
      }
      if (isTargetAccount(e.credit) && (opLevelMatch || matchesItem(`${e.creditSubconto} ${e.description}`))) {
        addBucket(e.credit, -e.amount, -(pOp.quantity ?? 0));
      }
    }
  }

  // Pick preferredAccount first if positive, otherwise highest positive bucket
  let chosenAcc = preferredAccount;
  let chosen = buckets.get(preferredAccount);
  if (!chosen || chosen.netAmt <= 0.01) {
    chosen = undefined;
    for (const [acc, val] of buckets.entries()) {
      if (val.netAmt > 0.01 && (!chosen || val.netAmt > chosen.netAmt)) {
        chosenAcc = acc;
        chosen = val;
      }
    }
  }

  if (!chosen || chosen.netAmt <= 0.01) {
    return null;
  }

  if (requestedQty && requestedQty > 0 && chosen.netQty > 0) {
    const unitCost = chosen.netAmt / chosen.netQty;
    const calcAmt =
      requestedQty >= chosen.netQty
        ? chosen.netAmt
        : round2(unitCost * requestedQty);
    return {
      amount: calcAmt,
      account: chosenAcc,
      availableQty: chosen.netQty,
      resolvedQty: requestedQty,
      sourceNote: `Рассчитано по себестоимости остатка на счёте ${chosenAcc} (без НДС): ${requestedQty} × ${round2(unitCost).toFixed(2)} ₽ = ${calcAmt.toFixed(2)} ₽`,
    };
  }

  return {
    amount: chosen.netAmt,
    account: chosenAcc,
    availableQty: chosen.netQty,
    resolvedQty: chosen.netQty > 0 ? chosen.netQty : requestedQty,
    sourceNote: `Себестоимость партии без НДС со счёта ${chosenAcc}: ${chosen.netAmt.toFixed(2)} ₽`,
  };
}

function estimateUnitCostFrom1C(
  nomenclatureName: string,
  account: string,
  db1C: Database1CSnapshot | null
): number | null {
  if (!db1C) return null;
  const normNom = normalizeEntityKey(nomenclatureName);

  // 1. Check rawBalances with quantity for matching subconto or account
  for (const b of db1C.rawBalances) {
    if (b.account === account && b.quantity && b.quantity > 0) {
      const amt = b.rawDebit || b.startDebit || b.endDebit;
      if (amt > 0) {
        if (!normNom || (b.subconto && normalizeEntityKey(b.subconto).includes(normNom))) {
          return round2(amt / b.quantity);
        }
      }
    }
  }

  // 2. Check postings to debit of 41.01 / 43 with quantityDebit
  for (const p of db1C.postings) {
    if (p.debit === account && p.quantityDebit && p.quantityDebit > 0 && p.amount > 0) {
      if (
        !normNom ||
        p.debitSubconto.some((s) => normalizeEntityKey(s).includes(normNom))
      ) {
        return round2(p.amount / p.quantityDebit);
      }
    }
  }

  return null;
}

function findHistoricalExpenseAccount(
  counterpartyName: string,
  db1C: Database1CSnapshot | null
): string | null {
  if (!db1C || !counterpartyName) return null;
  const norm = normalizeEntityKey(counterpartyName);
  if (!norm) return null;

  for (const p of db1C.postings) {
    if (
      (p.credit === '60.01' || p.credit === '76.09') &&
      ['20.01', '25', '26', '44.01', '91.02'].includes(p.debit)
    ) {
      const hay = normalizeEntityKey(
        `${p.counterpartyName ?? ''} ${p.creditSubconto.join(' ')} ${p.description}`
      );
      if (hay.includes(norm)) {
        return p.debit;
      }
    }
  }
  return null;
}

function computeCounterpartyAdvanceBalance(
  accountCode: '60.02' | '62.02',
  counterpartyName: string,
  counterpartyInn: string,
  db1C: Database1CSnapshot | null,
  priorOperations: QueuedOperation[]
): number {
  const normCp = normalizeEntityKey(counterpartyName);
  const cleanInn = counterpartyInn.replace(/\D/g, '');
  if (!normCp && !cleanInn) return 0;

  const matchesText = (text: string, inn?: string): boolean => {
    if (cleanInn && inn && inn.replace(/\D/g, '') === cleanInn) return true;
    const n = normalizeEntityKey(text);
    return Boolean(normCp && n && (n === normCp || n.includes(normCp) || normCp.includes(n)));
  };

  let netDebitMinusCredit = 0;

  if (db1C) {
    for (const b of db1C.rawBalances) {
      if (b.account === accountCode && b.subconto && matchesText(b.subconto)) {
        const dt = b.hasExplicitStart ? b.startDebit : b.rawDebit;
        const kt = b.hasExplicitStart ? b.startCredit : b.rawCredit;
        netDebitMinusCredit = round2(netDebitMinusCredit + (dt - kt));
      }
    }
    for (const p of db1C.postings) {
      if (p.debit === accountCode && matchesText(`${p.counterpartyName ?? ''} ${p.debitSubconto.join(' ')}`)) {
        netDebitMinusCredit = round2(netDebitMinusCredit + p.amount);
      }
      if (p.credit === accountCode && matchesText(`${p.counterpartyName ?? ''} ${p.creditSubconto.join(' ')}`)) {
        netDebitMinusCredit = round2(netDebitMinusCredit - p.amount);
      }
    }
  }

  for (const op of priorOperations) {
    if (!op.includeInProcessing || op.isDuplicateIn1C) continue;
    const sameOpCp = matchesText(op.counterpartyName, op.counterpartyInn);
    for (const e of op.entries) {
      if (e.debit === accountCode && (sameOpCp || matchesText(e.debitSubconto))) {
        netDebitMinusCredit = round2(netDebitMinusCredit + e.amount);
      }
      if (e.credit === accountCode && (sameOpCp || matchesText(e.creditSubconto))) {
        netDebitMinusCredit = round2(netDebitMinusCredit - e.amount);
      }
    }
  }

  return accountCode === '60.02'
    ? Math.max(0, round2(netDebitMinusCredit))
    : Math.max(0, round2(-netDebitMinusCredit));
}

let opIdSequence = 0;

export function bindAndGenerateOperation(
  draft: RawDraftOperationInput,
  db1C: Database1CSnapshot | null,
  existingId?: string,
  batchContext?: BatchSequentialContext
): QueuedOperation {
  const opId = existingId ?? `op-${Date.now()}-${++opIdSequence}-${Math.random().toString(36).slice(2, 6)}`;
  const policyVatRate = db1C?.accountingPolicy.vatRate ?? 20;
  const isOsno = (db1C?.accountingPolicy.taxSystem ?? 'ОСНО') === 'ОСНО';

  let cpName = (draft.counterpartyName ?? '').trim();
  // Never accept <2-character single-letter fragments as a counterparty name
  if (cpName.length < 2) {
    cpName = '';
  }
  let cpInn = (draft.counterpartyInn ?? '').replace(/\D/g, '');
  let cpKpp = (draft.counterpartyKpp ?? '').replace(/\D/g, '');
  let cpOgrn = (draft.counterpartyOgrn ?? '').replace(/\D/g, '');
  let cpBankAccount = (draft.counterpartyBankAccount ?? '').replace(/\D/g, '');
  let cpBik = (draft.counterpartyBik ?? '').replace(/\D/g, '');
  let cpBankName = (draft.counterpartyBankName ?? '').trim();
  const cpCorrAccount = (draft.counterpartyCorrAccount ?? '').replace(/\D/g, '');
  let cpSource: CounterpartyResolutionSource =
    draft.counterpartySource ??
    (cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : 'unresolved');

  const orgDefaultBik =
    (draft.organizationBik ?? '').replace(/\D/g, '') ||
    (db1C?.organization.bik ?? '').replace(/\D/g, '') ||
    batchContext?.defaultBik ||
    DEFAULT_SBERBANK_BIK;
  const orgDefaultBankName =
    (draft.organizationBankName ?? '').trim() ||
    (db1C?.organization.bankName ?? '').trim() ||
    batchContext?.defaultBankName ||
    DEFAULT_SBERBANK_NAME;
  const orgDefaultBankAccount =
    (draft.organizationBankAccount ?? '').replace(/\D/g, '') ||
    (db1C?.organization.bankAccount ?? '').replace(/\D/g, '');

  let contractName = (draft.contractName ?? '').trim();
  let contractNumber = (draft.contractNumber ?? '').trim();
  let contractDate = (draft.contractDate ?? '').trim();
  let nomName = (draft.nomenclatureName ?? '').trim();
  let warehouseName = (draft.warehouseName ?? '').trim();
  const warehouseToName = (draft.warehouseToHint ?? '').trim();
  let expenseItemName = (draft.expenseItemName ?? '').trim();
  let cashFlowItemName = (draft.cashFlowItemName ?? '').trim();
  let employeeName = (draft.employeeName ?? '').trim();

  const descNormForLookup = normalizeEntityKey(draft.description);
  const preClassification = detectCategoryAndDocType(draft);
  const isStrictlyInternalNoCpOp = [
    'materials_writeoff',
    'workwear_issue',
    'os_commissioning',
    'production_output',
    'warehouse_transfer',
    'cash_bank_internal',
    'accountable_issue',
    'expense_report',
    'accountable_return',
    'depreciation_accrual',
    'insurance_accrual',
    'payroll_accrual',
    'hr_hire',
    'closing',
    'manual',
  ].includes(preClassification.category);

  // For strictly internal or accountable 71.01 operations, never pollute counterparty with employee or stray text
  if (isStrictlyInternalNoCpOp) {
    if (
      !employeeName &&
      cpName &&
      [
        'workwear_issue',
        'os_commissioning',
        'payroll_accrual',
        'hr_hire',
        'accountable_issue',
        'expense_report',
        'accountable_return',
      ].includes(preClassification.category)
    ) {
      employeeName = cpName;
    }
    cpName = '';
    cpInn = '';
    cpKpp = '';
    cpOgrn = '';
    contractName = '';
    contractNumber = '';
    contractDate = '';
  }

  if (
    !employeeName &&
    ['accountable_issue', 'expense_report', 'accountable_return'].includes(preClassification.category)
  ) {
    const extractedAccFio = extractAccountableFioFromDescription(draft.description);
    if (extractedAccFio) {
      employeeName = extractedAccFio;
    }
  }

  // Match employee against db1C.individuals if applicable
  if (
    [
      'workwear_issue',
      'os_commissioning',
      'payroll_accrual',
      'payroll_payout',
      'hr_hire',
      'accountable_issue',
      'expense_report',
      'accountable_return',
    ].includes(preClassification.category) &&
    db1C
  ) {
    if (employeeName) {
      const matchedEmp = matchPersonOrCounterpartyIn1C(employeeName, '', db1C);
      if (matchedEmp && (matchedEmp.source === 'ФизическиеЛица' || matchedEmp.kind === 'ФизическоеЛицо')) {
        employeeName = matchedEmp.name;
      }
    } else {
      const mentionedEmp = findPersonMentionedInDescription1C(draft.description, db1C);
      if (mentionedEmp) {
        employeeName = mentionedEmp.name;
      }
    }
  }

  const founderShareOp =
    draft.categoryHint === 'founder_contribution' ||
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(draft.description);

  // Extract founder FIO for charter capital share contributions ("Поступление на расчетный счет доли <ФИО>")
  if (!isStrictlyInternalNoCpOp && !cpName && founderShareOp) {
    const extractedFounderFio = extractFounderFioFromDescription(draft.description);
    if (extractedFounderFio) {
      const matchedFounder1C = matchPersonOrCounterpartyIn1C(extractedFounderFio, cpInn, db1C);
      if (matchedFounder1C) {
        cpName = matchedFounder1C.name;
        cpInn = matchedFounder1C.inn || cpInn;
        cpKpp = matchedFounder1C.kpp || cpKpp;
        cpSource = 'db_1c';
      } else {
        cpName = normalizeGenitiveFioToNominative(extractedFounderFio);
      }
    } else if (db1C) {
      const mentionedPerson = findPersonMentionedInDescription1C(draft.description, db1C);
      if (mentionedPerson) {
        cpName = mentionedPerson.name;
        cpInn = mentionedPerson.inn || cpInn;
        cpSource = 'db_1c';
      }
    }
  }

  // If counterparty was not extracted by legal-entity regex, check if any known 1C counterparty or individual appears in description
  if (!isStrictlyInternalNoCpOp && !cpName && !cpInn && db1C && descNormForLookup) {
    const foundCpInDesc = db1C.counterparties.find((c) => {
      const cn = normalizeEntityKey(c.name);
      return cn.length >= 4 && descNormForLookup.includes(cn);
    });
    if (foundCpInDesc) {
      cpName = foundCpInDesc.name;
      cpInn = foundCpInDesc.inn || '';
      cpKpp = foundCpInDesc.kpp || '';
      cpSource = 'db_1c';
    } else {
      const foundPerson = findPersonMentionedInDescription1C(draft.description, db1C);
      if (foundPerson) {
        cpName = foundPerson.name;
        cpInn = foundPerson.inn || '';
        cpSource = 'db_1c';
      }
    }
  }

  // If nomenclature was not in a separate column, check if any known 1C nomenclature item appears in description
  if (!nomName && db1C && descNormForLookup) {
    const foundNomInDesc = db1C.nomenclature.find((n) => {
      const nn = normalizeEntityKey(n.name);
      return nn.length >= 3 && descNormForLookup.includes(nn);
    });
    if (foundNomInDesc) {
      nomName = foundNomInDesc.name;
    }
  }

  // --- 1. Bind Counterparty / Individual strictly with Priority (1: Excel explicit -> 2: 1C DB -> 3: EGRUL -> 4: New/Educational) ---
  let cpBinding: EntityBindingStatus = { status: 'not_required' };
  let matchedCpIdName = '';
  let matchedCpKind: DirectoryAutocompleteOption1C['kind'] | undefined;

  if (cpName || cpInn) {
    const hadExplicitInnFromExcel = cpInn.length === 10 || cpInn.length === 12;
    const matched1C = matchPersonOrCounterpartyIn1C(cpName, cpInn, db1C);

    if (matched1C) {
      const cpDirRow = db1C?.counterparties.find((c) => c.id === matched1C.id);
      cpName = matched1C.name;
      // Priority 1: keep explicit Excel INN/KPP/bank if provided, otherwise fill from 1C
      cpInn = hadExplicitInnFromExcel ? cpInn : matched1C.inn || cpInn;
      cpKpp = cpKpp || matched1C.kpp || '';
      cpBankAccount = cpBankAccount || cpDirRow?.bankAccount || '';
      cpBik = cpBik || cpDirRow?.bik || '';
      cpBankName = cpBankName || cpDirRow?.bankName || '';
      cpSource =
        hadExplicitInnFromExcel && draft.counterpartySource === 'excel_explicit'
          ? 'excel_explicit'
          : 'db_1c';
      matchedCpIdName = matched1C.name;
      matchedCpKind = matched1C.kind;
      if (!contractName && matched1C.defaultContract && !founderShareOp) {
        contractName = matched1C.defaultContract;
      }
      cpBinding = {
        status: 'matched_1c',
        matchedName: matched1C.name,
        matchedCode1C: matched1C.code1C,
        matchedInn: cpInn,
        note:
          matched1C.source === 'ФизическиеЛица'
            ? 'Привязано к справочнику 1С «ФизическиеЛица»'
            : undefined,
      };
    } else {
      if (hadExplicitInnFromExcel && cpSource === 'unresolved') {
        cpSource = 'excel_explicit';
      }
      if (draft.egrulCandidates && draft.egrulCandidates.length > 0 && !hadExplicitInnFromExcel) {
        const best = draft.egrulCandidates[0];
        cpInn = best.inn;
        cpKpp = cpKpp || best.kpp;
        cpOgrn = cpOgrn || best.ogrn;
        cpSource = 'egrul_verified';
      } else if (!cpInn && cpName && batchContext?.priorOperations?.length) {
        const normTargetCp = normalizeEntityKey(cpName);
        for (let i = batchContext.priorOperations.length - 1; i >= 0; i--) {
          const prior = batchContext.priorOperations[i];
          if (
            normalizeEntityKey(prior.counterpartyName) === normTargetCp &&
            (prior.counterpartyInn.length === 10 || prior.counterpartyInn.length === 12)
          ) {
            cpInn = prior.counterpartyInn;
            cpKpp = cpKpp || prior.counterpartyKpp;
            cpOgrn = cpOgrn || (prior.counterpartyOgrn ?? '');
            if (!contractName && prior.contractName && !founderShareOp) {
              contractName = prior.contractName;
            }
            if (cpSource === 'unresolved' && prior.counterpartySource) {
              cpSource = prior.counterpartySource;
            }
            break;
          }
        }
      }
      cpBinding = {
        status: 'new_for_1c',
        note:
          cpSource === 'excel_explicit'
            ? 'Реквизиты извлечены из текста операции (карточка будет создана при экспорте)'
            : cpSource === 'egrul_verified'
              ? 'Реквизиты подтверждены по ЕГРЮЛ ФНС (карточка будет создана при экспорте)'
              : cpSource === 'educational_unverified'
                ? 'Учебный контрагент (не найден в ЕГРЮЛ — можно указать реквизиты вручную)'
                : db1C
                  ? 'Новый элемент (будет создан при экспорте в 1С)'
                  : 'База 1С не подключена — элемент будет создан при экспорте',
      };
    }
  }

  // --- 2. Bind Nomenclature against 1C DB ---
  let nomBinding: EntityBindingStatus = { status: 'not_required' };
  let matchedNomKind: string | undefined;
  let matchedNomAccount: string | undefined;
  let matchedNomGroup = '';

  if (nomName) {
    const normNom = normalizeEntityKey(nomName);
    const matchedNom = db1C?.nomenclature.find(
      (n) =>
        normalizeEntityKey(n.name) === normNom ||
        normalizeEntityKey(n.fullName ?? '') === normNom ||
        (n.article && n.article.toLowerCase() === nomName.toLowerCase())
    );
    if (matchedNom) {
      nomName = matchedNom.name;
      matchedNomKind = matchedNom.itemKind;
      matchedNomAccount = matchedNom.defaultAccount || undefined;
      matchedNomGroup = matchedNom.nomenclatureGroup || '';
      nomBinding = {
        status: 'matched_1c',
        matchedName: matchedNom.name,
        matchedCode1C: matchedNom.code1C,
      };
    } else {
      nomBinding = {
        status: 'new_for_1c',
        note: 'Новый элемент номенклатуры (будет создан при экспорте в 1С)',
      };
    }
  }

  // --- 3. Detect category & 1C document type ---
  const { category, docType1C, documentSubKind1C } = detectCategoryAndDocType(draft, matchedNomKind);

  // Auto-link buyer for sales/shipments when buyer name is omitted in the shipment row itself
  if ((category === 'sale_goods' || category === 'sale_services') && !cpName && !cpInn) {
    const priorCandidateOps = batchContext?.priorOperations ?? [];
    const saleItemStem = stemRuItemKey(nomName || draft.description);
    const saleTokens = saleItemStem.split(' ').filter((t) => t.length >= 3);

    let inferredBuyer: {
      name: string;
      inn: string;
      kpp: string;
      contractName: string;
      source: CounterpartyResolutionSource;
    } | null = null;

    // 1) Search prior operations for buyer advances (62.02) or buyer settlements (62.01)
    for (let i = priorCandidateOps.length - 1; i >= 0; i--) {
      const p = priorCandidateOps[i];
      if (!p.includeInProcessing || !p.counterpartyName.trim()) continue;
      if (draft.date && p.date && p.date > draft.date) continue;
      const isBuyerOp =
        p.category === 'bank_in' ||
        p.category === 'sale_goods' ||
        p.category === 'sale_services' ||
        p.entries.some((e) => e.credit === '62.02' || e.debit === '62.01');
      if (!isBuyerOp) continue;

      const pStem = stemRuItemKey(`${p.nomenclatureName} ${p.description}`);
      const sharesProduct =
        saleTokens.length > 0 && saleTokens.some((tok) => pStem.includes(tok));
      const hasOpenAdvance =
        computeCounterpartyAdvanceBalance(
          '62.02',
          p.counterpartyName,
          p.counterpartyInn,
          db1C,
          priorCandidateOps
        ) > 0.01;

      if (sharesProduct || hasOpenAdvance) {
        inferredBuyer = {
          name: p.counterpartyName,
          inn: p.counterpartyInn,
          kpp: p.counterpartyKpp,
          contractName: p.contractName,
          source: p.counterpartySource ?? 'unresolved',
        };
        break;
      }
      if (!inferredBuyer) {
        inferredBuyer = {
          name: p.counterpartyName,
          inn: p.counterpartyInn,
          kpp: p.counterpartyKpp,
          contractName: p.contractName,
          source: p.counterpartySource ?? 'unresolved',
        };
      }
    }

    // 2) Fallback: search 1C DB 62.02 balances, buyer contracts, or historical sales docs
    if (!inferredBuyer && db1C) {
      const bal6202 = db1C.rawBalances.find(
        (b) => b.account === '62.02' && b.subconto && (b.rawCredit > 0.01 || b.startCredit > 0.01)
      );
      if (bal6202?.subconto) {
        const subName = bal6202.subconto.split('/')[0].trim();
        const m1c = matchPersonOrCounterpartyIn1C(subName, '', db1C);
        if (m1c) {
          inferredBuyer = {
            name: m1c.name,
            inn: m1c.inn,
            kpp: m1c.kpp,
            contractName: m1c.defaultContract || '',
            source: 'db_1c',
          };
        }
      }
      if (!inferredBuyer) {
        const buyerContract = db1C.contracts.find((c) =>
          /покупател/iu.test(c.contractKind ?? '')
        );
        if (buyerContract?.counterpartyName) {
          const m1c = matchPersonOrCounterpartyIn1C(
            buyerContract.counterpartyName,
            buyerContract.counterpartyInn ?? '',
            db1C
          );
          inferredBuyer = {
            name: m1c?.name || buyerContract.counterpartyName,
            inn: m1c?.inn || buyerContract.counterpartyInn || '',
            kpp: m1c?.kpp || '',
            contractName: buyerContract.name || '',
            source: 'db_1c',
          };
        }
      }
    }

    if (inferredBuyer && inferredBuyer.name.trim().length >= 2) {
      cpName = inferredBuyer.name.trim();
      cpInn = inferredBuyer.inn.replace(/\D/g, '');
      cpKpp = inferredBuyer.kpp.replace(/\D/g, '');
      if (!contractName && inferredBuyer.contractName) {
        contractName = inferredBuyer.contractName;
      }
      cpSource = inferredBuyer.source;
      const m1c = matchPersonOrCounterpartyIn1C(cpName, cpInn, db1C);
      if (m1c) {
        matchedCpIdName = m1c.name;
        matchedCpKind = m1c.kind;
        cpInn = cpInn || m1c.inn;
        cpKpp = cpKpp || m1c.kpp;
        cpSource = 'db_1c';
        cpBinding = {
          status: 'matched_1c',
          matchedName: m1c.name,
          matchedCode1C: m1c.code1C,
          matchedInn: cpInn,
          note: 'Покупатель определён автоматически по связанному авансу / договору 1С',
        };
      } else {
        cpBinding = {
          status: 'new_for_1c',
          note: 'Покупатель определён автоматически по связанному авансу (счёт 62.02)',
        };
      }
    }
  }

  const needsCounterparty = doesOperationRequireCounterparty(category);

  if (!needsCounterparty && isStrictlyInternalNoCpOp) {
    cpBinding = { status: 'not_required' };
  } else if (needsCounterparty && !cpName && !cpInn) {
    cpBinding = { status: 'missing', note: 'Не указан контрагент' };
  }

  // --- 4. Bind Contract against 1C DB ---
  const needsContract = [
    'bank_out',
    'bank_in',
    'purchase_goods',
    'purchase_materials',
    'purchase_equipment',
    'purchase_services',
    'sale_goods',
    'sale_services',
    'advance_offset',
  ].includes(category);

  let contractBinding: EntityBindingStatus = { status: 'not_required' };
  if (needsContract) {
    const expectedKind =
      category === 'bank_in' || category === 'sale_goods' || category === 'sale_services'
        ? 'СПокупателем'
        : 'СПоставщиком';

    const cpContracts = (db1C?.contracts ?? []).filter((c) => {
      if (cpInn && c.counterpartyInn && c.counterpartyInn.replace(/\D/g, '') === cpInn) {
        return true;
      }
      if (matchedCpIdName || cpName) {
        return (
          normalizeEntityKey(c.counterpartyName) ===
          normalizeEntityKey(matchedCpIdName || cpName)
        );
      }
      return false;
    });

    let matchedCtr = cpContracts.find((c) => {
      if (contractNumber && c.number && c.number.toLowerCase() === contractNumber.toLowerCase()) {
        return true;
      }
      if (contractName && normalizeEntityKey(c.name) === normalizeEntityKey(contractName)) {
        return true;
      }
      return false;
    });

    // If contract wasn't explicitly named in file, only auto-bind if counterparty has a single matching contract in 1C
    if (!matchedCtr && !contractName && cpContracts.length === 1) {
      const single = cpContracts[0];
      if (!single.contractKind || single.contractKind.includes(expectedKind.slice(1))) {
        matchedCtr = single;
      }
    }

    if (matchedCtr) {
      contractName = matchedCtr.name;
      contractNumber = matchedCtr.number || contractNumber;
      contractDate = matchedCtr.date || contractDate;
      contractBinding = {
        status: 'matched_1c',
        matchedName: matchedCtr.name,
        matchedCode1C: matchedCtr.code1C,
      };
    } else if (contractName || contractNumber) {
      if (!contractName && contractNumber) {
        contractName = `Договор № ${contractNumber}${contractDate ? ` от ${contractDate}` : ''}`;
      }
      contractBinding = {
        status: 'new_for_1c',
        note: 'Новый договор (будет создан при экспорте в 1С)',
      };
    } else {
      contractBinding = {
        status: 'missing',
        note: 'Не указан договор контрагента',
      };
    }
  }

  // --- 5. Bind Warehouse, ExpenseItem, CashFlowItem ---
  const internalDefaultWarehouseCategories: OperationCategory[] = [
    'materials_writeoff',
    'workwear_issue',
    'os_commissioning',
    'production_output',
    'warehouse_transfer',
  ];
  const needsWarehouse = [
    'purchase_goods',
    'purchase_materials',
    'purchase_equipment',
    'sale_goods',
    ...internalDefaultWarehouseCategories,
  ].includes(category);

  let warehouseBinding: EntityBindingStatus = { status: 'not_required' };
  if (needsWarehouse) {
    if (warehouseName) {
      const mWh = db1C?.warehouses.find(
        (w) => normalizeEntityKey(w.name) === normalizeEntityKey(warehouseName)
      );
      if (mWh) {
        warehouseName = mWh.name;
        warehouseBinding = { status: 'matched_1c', matchedName: mWh.name, matchedCode1C: mWh.code1C };
      } else {
        warehouseBinding = { status: 'new_for_1c', note: 'Новый склад (будет создан при экспорте)' };
      }
    } else if (db1C && db1C.warehouses.length >= 1 && (db1C.warehouses.length === 1 || internalDefaultWarehouseCategories.includes(category))) {
      warehouseName = db1C.warehouses[0].name;
      warehouseBinding = {
        status: 'matched_1c',
        matchedName: db1C.warehouses[0].name,
        matchedCode1C: db1C.warehouses[0].code1C,
      };
    } else if (internalDefaultWarehouseCategories.includes(category)) {
      warehouseName = 'Основной склад';
      warehouseBinding = {
        status: db1C ? 'new_for_1c' : 'not_required',
        note: 'Основной склад по умолчанию',
      };
    } else {
      warehouseBinding = { status: 'missing', note: 'Не выбран склад учёта МПЗ' };
    }
  }

  const needsExpenseItem = [
    'purchase_services',
    'payroll_accrual',
    'insurance_accrual',
    'materials_writeoff',
    'workwear_issue',
    'depreciation_accrual',
  ].includes(category);
  let expenseBinding: EntityBindingStatus = { status: 'not_required' };
  if (needsExpenseItem) {
    if (expenseItemName) {
      const mExp = db1C?.expenseItems.find(
        (e) => normalizeEntityKey(e.name) === normalizeEntityKey(expenseItemName)
      );
      if (mExp) {
        expenseItemName = mExp.name;
        expenseBinding = { status: 'matched_1c', matchedName: mExp.name, matchedCode1C: mExp.code1C };
      } else {
        expenseBinding = { status: 'new_for_1c', note: 'Новая статья затрат' };
      }
    } else {
      const descNorm = normalizeEntityKey(draft.description);
      const inferredExp = db1C?.expenseItems.find((e) => {
        const en = normalizeEntityKey(e.name);
        return en.length > 3 && descNorm.includes(en);
      });
      if (inferredExp) {
        expenseItemName = inferredExp.name;
        expenseBinding = {
          status: 'matched_1c',
          matchedName: inferredExp.name,
          matchedCode1C: inferredExp.code1C,
        };
      } else if (category === 'payroll_accrual') {
        const payExp = db1C?.expenseItems.find((e) => /оплата труда|зарплат/i.test(e.name));
        if (payExp) {
          expenseItemName = payExp.name;
          expenseBinding = { status: 'matched_1c', matchedName: payExp.name, matchedCode1C: payExp.code1C };
        } else {
          expenseItemName = 'Оплата труда';
          expenseBinding = { status: 'new_for_1c', note: 'Статья затрат будет создана' };
        }
      } else if (category === 'insurance_accrual') {
        expenseItemName = 'Страховые взносы';
        expenseBinding = { status: 'new_for_1c', note: 'Типовая статья затрат 1С' };
      } else if (category === 'materials_writeoff' || category === 'workwear_issue') {
        const matExp = db1C?.expenseItems.find((e) => /материальн/i.test(e.name));
        if (matExp) {
          expenseItemName = matExp.name;
          expenseBinding = { status: 'matched_1c', matchedName: matExp.name, matchedCode1C: matExp.code1C };
        } else {
          expenseItemName = 'Материальные расходы';
          expenseBinding = { status: db1C ? 'new_for_1c' : 'not_required', note: 'Типовая статья затрат (ФСБУ 5/2019)' };
        }
      } else if (category === 'depreciation_accrual') {
        expenseItemName = 'Амортизация';
        expenseBinding = { status: db1C ? 'new_for_1c' : 'not_required', note: 'Типовая статья затрат (ФСБУ 6/2020)' };
      } else {
        expenseBinding = { status: 'missing', note: 'Не указана статья затрат' };
      }
    }
  }

  const needsCashFlow = [
    'bank_out',
    'bank_in',
    'founder_contribution',
    'tax_payment',
    'bank_fee',
    'payroll_payout',
    'cash_in',
    'cash_out',
    'cash_bank_internal',
    'accountable_issue',
    'accountable_return',
    'loan_received',
    'loan_repaid',
  ].includes(category);
  let cashFlowBinding: EntityBindingStatus = { status: 'not_required' };
  if (needsCashFlow) {
    if (cashFlowItemName) {
      const mDds = db1C?.cashFlowItems.find(
        (d) => normalizeEntityKey(d.name) === normalizeEntityKey(cashFlowItemName)
      );
      if (mDds) {
        cashFlowItemName = mDds.name;
        cashFlowBinding = { status: 'matched_1c', matchedName: mDds.name, matchedCode1C: mDds.code1C };
      } else {
        cashFlowBinding = { status: 'new_for_1c', note: 'Новая статья ДДС' };
      }
    } else {
      const targetPattern =
        category === 'founder_contribution'
          ? /вклад\p{L}*\s+собственник|уставн\p{L}+\s+капитал|учредител/iu
          : category === 'accountable_issue' || category === 'accountable_return'
            ? /подотчет/iu
            : category === 'loan_received' || category === 'loan_repaid'
              ? /кредит|за[её]м/iu
              : category === 'bank_in' || category === 'cash_in'
                ? /поступление от продажи|оплата от покупател/i
                : category === 'tax_payment'
                  ? /налог|бюджет/i
                  : category === 'payroll_payout'
                    ? /оплата труда/i
                    : /оплата товаров, работ, услуг|поставщик/i;
      const foundDds = db1C?.cashFlowItems.find((d) => targetPattern.test(d.name));
      if (foundDds) {
        cashFlowItemName = foundDds.name;
        cashFlowBinding = { status: 'matched_1c', matchedName: foundDds.name, matchedCode1C: foundDds.code1C };
      } else {
        cashFlowItemName =
          category === 'founder_contribution'
            ? 'Поступления денежных вкладов собственников (участников)'
            : category === 'cash_bank_internal'
              ? 'Получение / взнос наличных в банке'
              : category === 'accountable_issue'
                ? 'Выдача денежных средств подотчетнику'
                : category === 'accountable_return'
                  ? 'Возврат денежных средств подотчетником'
                  : category === 'loan_received'
                    ? 'Получение кредитов и займов'
                    : category === 'loan_repaid'
                      ? 'Погашение кредитов и займов'
                      : category === 'bank_in' || category === 'cash_in'
                        ? 'Поступление от продажи продукции и товаров, выполнения работ, оказания услуг'
                        : category === 'tax_payment'
                          ? 'Прочие налоги и сборы'
                          : category === 'payroll_payout'
                            ? 'Оплата труда'
                            : 'Оплата товаров, работ, услуг, сырья и иных оборотных активов';
        cashFlowBinding = {
          status: db1C ? 'new_for_1c' : 'not_required',
          note: 'Типовая статья ДДС 1С БП 3.0',
        };
      }
    }
  }

  // --- 6. Automatic Calculation of Amount + VAT + Stock Batch Tracking ---
  const descLower = draft.description.toLowerCase();
  const priorOps = batchContext?.priorOperations ?? [];
  const hadExplicitInputAmount =
    category === 'hr_hire' ? false : Math.abs(draft.amount) >= 0.01;
  let effectiveDraftAmount =
    category === 'hr_hire' ? 0 : round2(Math.abs(draft.amount));
  let resolvedMonthlySalary =
    category === 'hr_hire'
      ? round2(Math.abs(draft.monthlySalary ?? draft.amount ?? 0))
      : draft.monthlySalary && draft.monthlySalary > 0
        ? round2(draft.monthlySalary)
        : undefined;
  const resolvedEmployeePosition = draft.employeePosition?.trim() || undefined;
  const resolvedInjuryRate =
    draft.injuryInsuranceRate !== undefined && draft.injuryInsuranceRate >= 0
      ? draft.injuryInsuranceRate
      : 0.2;
  let resolvedUsefulLifeMonths =
    draft.usefulLifeMonths && draft.usefulLifeMonths > 0
      ? Math.round(draft.usefulLifeMonths)
      : category === 'os_commissioning' || category === 'depreciation_accrual'
        ? 60
        : undefined;
  let resolvedDeprBaseAmount = draft.depreciationBaseAmount;
  let payrollStaffSummary: QueuedOperation['payrollStaffSummary'] = undefined;
  let calculationProvenance: string | undefined;

  let amountMode: OperationAmountMode = hadExplicitInputAmount ? 'explicit' : 'required_missing';
  let amountCalculationNote = draft.amountCalculationNote;
  let stockSourceNote: string | undefined;
  let effectiveQty = draft.quantity;
  let effectiveUnitPrice = draft.unitPrice;
  let inheritedVatRule = draft.vatRule;
  let inheritedVatRate = draft.vatRate;
  let taxBreakdownFromBalances: Array<{ account: string; amount: number; name: string }> = [];

  const inferredMat = inferMaterialSubaccount1C(`${nomName} ${draft.description}`);
  let resolvedMaterialAccount =
    draft.materialAccountHint ||
    matchedNomAccount ||
    (category === 'os_commissioning' || category === 'purchase_equipment'
      ? '08.04.1'
      : inferredMat.materialAccount);
  const resolvedOffBalanceAccount =
    category === 'workwear_issue' ? inferredMat.offBalanceAccount || 'МЦ.02' : undefined;
  const resolvedCostAccount =
    draft.costAccountHint ||
    (/администрац|офис|бухгалтер|директор|общехозяйствен|управленч/iu.test(
      `${descLower} ${resolvedEmployeePosition ?? ''}`
    )
      ? '26'
      : /общепроизводствен|цехов/iu.test(descLower)
        ? '25'
        : /торгов|магазин|продаж/iu.test(descLower)
          ? '44.01'
          : category === 'payroll_accrual' || category === 'insurance_accrual'
            ? db1C?.postings.find((p) => p.credit === '70' && ['20.01', '26', '44.01'].includes(p.debit))
                ?.debit ??
              (priorOps.find((p) => p.category === 'hr_hire' && p.costAccount)?.costAccount ||
                (/рабоч|прораб|каменщик|сварщик|монтажник|мастер|производств|объект/iu.test(descLower)
                  ? '20.01'
                  : '26'))
            : '20.01');

  // 6a-0. HR Hiring ('hr_hire'): record employee & monthly salary into chronological staff roster (0 balance postings)
  if (category === 'hr_hire') {
    amountMode = 'calculated_by_1c';
    const salLabel =
      resolvedMonthlySalary && resolvedMonthlySalary >= 0.01
        ? `${resolvedMonthlySalary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽/мес.`
        : 'по штатному расписанию';
    calculationProvenance = `Кадровый приказ: ${employeeName || 'Сотрудник'}${resolvedEmployeePosition ? ` (${resolvedEmployeePosition})` : ''}, оклад ${salLabel} — используется для автозаполнения «Начисление зарплаты»`;
    amountCalculationNote = calculationProvenance;
  }

  // 6a-1. Payroll & Insurance Accrual: pull active staff roster salaries from 1C DB + prior ПриемНаРаботу / prior НачислениеЗарплаты
  if (category === 'payroll_accrual' || category === 'insurance_accrual') {
    const rosterMap = new Map<
      string,
      { name: string; position?: string; salary: number; source: string }
    >();

    // 1. Check 1C DB employees / individuals for salary metadata
    for (const emp of [...(db1C?.employees ?? []), ...(db1C?.individuals ?? [])]) {
      const rawSal =
        emp.extra?.salary ??
        emp.extra?.оклад ??
        emp.extra?.Оклад ??
        emp.extra?.fot ??
        emp.extra?.ФОТ ??
        '';
      const parsedSal = Number(String(rawSal).replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (Number.isFinite(parsedSal) && parsedSal > 0) {
        const key = normalizeEntityKey(emp.name) || emp.id;
        rosterMap.set(key, {
          name: emp.name,
          position: emp.extra?.position || emp.extra?.должность || emp.kind,
          salary: round2(parsedSal),
          source: 'Штатное расписание базы 1С',
        });
      }
    }

    // 2. Check chronological prior ПриемНаРаботу operations up to draft.date
    for (const pOp of priorOps) {
      if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
      if (draft.date && pOp.date && pOp.date > draft.date) continue;
      if (pOp.category === 'hr_hire') {
        const sal = round2(pOp.monthlySalary ?? pOp.amount ?? 0);
        if (sal > 0) {
          const empLabel = pOp.employeeName || `Сотрудник (${pOp.date})`;
          const key = normalizeEntityKey(empLabel) || pOp.id;
          rosterMap.set(key, {
            name: empLabel,
            position: pOp.employeePosition,
            salary: sal,
            source: `Приём на работу от ${pOp.date}`,
          });
        }
      }
    }

    const rosterArr = Array.from(rosterMap.values());
    if (rosterArr.length > 0) {
      payrollStaffSummary = rosterArr;
    } else if (db1C && (db1C.employees.length > 0 || db1C.individuals.length > 0)) {
      const namesSource = db1C.employees.length > 0 ? db1C.employees : db1C.individuals;
      payrollStaffSummary = namesSource.slice(0, 8).map((e) => ({
        name: e.name,
        position: e.kind,
        salary: 0,
        source: 'Справочник сотрудников 1С (оклад не выгружен)',
      }));
    }

    const rosterFot = round2(rosterArr.reduce((s, r) => s + r.salary, 0));

    if (resolvedMonthlySalary && resolvedMonthlySalary >= 0.01 && effectiveDraftAmount < 0.01) {
      effectiveDraftAmount =
        category === 'insurance_accrual'
          ? round2(resolvedMonthlySalary * (0.3 + resolvedInjuryRate / 100))
          : resolvedMonthlySalary;
      amountMode = 'explicit';
      calculationProvenance = `Рассчитано из указанного штатного ФОТ за месяц: ${resolvedMonthlySalary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
      amountCalculationNote = calculationProvenance;
    } else if (effectiveDraftAmount < 0.01 && rosterFot >= 0.01) {
      resolvedMonthlySalary = rosterFot;
      effectiveDraftAmount =
        category === 'insurance_accrual'
          ? round2(rosterFot * (0.3 + resolvedInjuryRate / 100))
          : rosterFot;
      amountMode = 'from_related_doc';
      const breakdown = rosterArr
        .map((r) => `${r.name}: ${r.salary.toLocaleString('ru-RU')} ₽`)
        .join(' + ');
      calculationProvenance = `Авторасчёт из кадровых приказов / штата (${breakdown}) → ФОТ ${rosterFot.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
      amountCalculationNote = calculationProvenance;
    } else if (effectiveDraftAmount < 0.01) {
      // Inherit monthly ФОТ from earlier payroll_accrual in the same reporting year if already filled
      const prevPayroll = [...priorOps]
        .reverse()
        .find(
          (p) =>
            p.includeInProcessing &&
            p.category === 'payroll_accrual' &&
            (p.monthlySalary ?? p.amount) >= 0.01 &&
            (!draft.date || !p.date || p.date <= draft.date)
        );
      if (prevPayroll) {
        const inheritedFot = round2(prevPayroll.monthlySalary ?? prevPayroll.amount);
        resolvedMonthlySalary = inheritedFot;
        effectiveDraftAmount =
          category === 'insurance_accrual'
            ? round2(inheritedFot * (0.3 + resolvedInjuryRate / 100))
            : inheritedFot;
        amountMode = 'from_related_doc';
        calculationProvenance = `Штатный ФОТ унаследован из предыдущего начисления ЗП от ${prevPayroll.date}: ${inheritedFot.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
        amountCalculationNote = calculationProvenance;
      } else {
        amountMode = 'calculated_by_1c';
        calculationProvenance =
          'Оклады сотрудников ещё не заданы в базе 1С или кадровых приказах — укажите месячный ФОТ в карточке операции для расчёта НДФЛ 13% и взносов 30,2%';
        amountCalculationNote = calculationProvenance;
      }
    } else {
      resolvedMonthlySalary = effectiveDraftAmount;
      calculationProvenance = `ФОТ задан в условии операции: ${effectiveDraftAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
    }
  }

  // 6a. Compute from quantity × unitPrice if present in row/text
  if (
    effectiveDraftAmount < 0.01 &&
    effectiveQty &&
    effectiveUnitPrice &&
    effectiveQty > 0 &&
    effectiveUnitPrice > 0
  ) {
    effectiveDraftAmount = round2(effectiveQty * effectiveUnitPrice);
    amountCalculationNote = `Рассчитано автоматически: ${effectiveQty} × ${effectiveUnitPrice.toFixed(2)} ₽ = ${effectiveDraftAmount.toFixed(2)} ₽`;
    calculationProvenance = amountCalculationNote;
  }

  // 6b. Compute tax/social contribution debt payoff from current credit balances on 68.* / 69.* as of draft.date
  const isCombinedTaxAndContrib =
    category === 'tax_payment' &&
    (/налог\p{L}*\s+и\s+(?:страхов\p{L}*\s+)?взнос|задолженност\p{L}*\s+по\s+налог|в\s+бюджет\s+задолженност/iu.test(
      descLower
    ) ||
      (effectiveDraftAmount < 0.01 && !/ндфл|прибыл|травматизм/i.test(descLower)));

  if (category === 'tax_payment' && (effectiveDraftAmount < 0.01 || isCombinedTaxAndContrib)) {
    const runningOsv = calculateOsvReport({
      db1C,
      operations: priorOps,
      dateTo: draft.date || undefined,
      reportingYear: batchContext?.reportingYear,
      includeQueuedOperations: true,
    });
    const candidateTaxRows = runningOsv.leafRows.filter((r) => {
      if (r.endCredit <= 0.01) return false;
      if (/ндфл/i.test(descLower) && !isCombinedTaxAndContrib) return r.code === '68.01';
      if (/прибыл/i.test(descLower) && !isCombinedTaxAndContrib) return r.code.startsWith('68.04');
      if (/ндс/i.test(descLower) && !isCombinedTaxAndContrib) return r.code === '68.02';
      if (/травматизм|нс и пз/i.test(descLower) && !isCombinedTaxAndContrib) return r.code === '69.11';
      if (/страхов\p{L}*\s+взнос/iu.test(descLower) && !isCombinedTaxAndContrib) return r.code.startsWith('69.');
      return r.code.startsWith('68.') || r.code.startsWith('69.');
    });

    const sumCreditBalances = round2(
      candidateTaxRows.reduce((s, r) => s + r.endCredit, 0)
    );

    if (sumCreditBalances > 0.01) {
      if (effectiveDraftAmount < 0.01) {
        effectiveDraftAmount = sumCreditBalances;
        taxBreakdownFromBalances = candidateTaxRows.map((r) => ({
          account: r.code,
          amount: r.endCredit,
          name: r.name,
        }));
        amountCalculationNote = `Рассчитано из кредитового сальдо счетов 68/69 на ${draft.date || 'дату платежа'}: ${candidateTaxRows
          .map((r) => `${r.code} (${r.endCredit.toFixed(2)} ₽)`)
          .join(' + ')} = ${sumCreditBalances.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
      } else if (Math.abs(effectiveDraftAmount - sumCreditBalances) < 0.05 && candidateTaxRows.length > 1) {
        taxBreakdownFromBalances = candidateTaxRows.map((r) => ({
          account: r.code,
          amount: r.endCredit,
          name: r.name,
        }));
      }
    }
  }

  // 6c. Compute empty amount from linked earlier operation (e.g., 100% advance in Row 2 -> goods receipt in Row 3)
  if (effectiveDraftAmount < 0.01 && priorOps.length > 0 && doesOperationRequireCounterparty(category)) {
    const normCp = normalizeEntityKey(cpName);
    const normNom = normalizeEntityKey(nomName);

    for (let i = priorOps.length - 1; i >= 0; i--) {
      const prev = priorOps[i];
      if (!prev.includeInProcessing || prev.amount <= 0) continue;
      if (draft.date && prev.date && prev.date > draft.date) continue;
      const prevCpNorm = normalizeEntityKey(prev.counterpartyName);
      const sameCp =
        (cpInn && prev.counterpartyInn && cpInn === prev.counterpartyInn) ||
        (normCp && prevCpNorm && (normCp === prevCpNorm || normCp.includes(prevCpNorm) || prevCpNorm.includes(normCp)));

      if (!sameCp) continue;

      if (effectiveQty && effectiveQty > 0 && prev.unitPrice && prev.unitPrice > 0) {
        effectiveUnitPrice = prev.unitPrice;
        effectiveDraftAmount = round2(effectiveQty * prev.unitPrice);
        if (inheritedVatRule === undefined) inheritedVatRule = prev.vatRule;
        if (inheritedVatRate === undefined && prev.vatRate > 0) inheritedVatRate = prev.vatRate;
        amountCalculationNote = `Рассчитано по связанной операции от ${prev.date} (${effectiveQty} × ${prev.unitPrice.toFixed(2)} ₽ = ${effectiveDraftAmount.toFixed(2)} ₽)`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (effectiveQty && effectiveQty > 0 && prev.quantity && prev.quantity > 0) {
        const derivedPrice = round2(prev.amount / prev.quantity);
        effectiveUnitPrice = derivedPrice;
        effectiveDraftAmount =
          effectiveQty === prev.quantity ? prev.amount : round2(effectiveQty * derivedPrice);
        if (inheritedVatRule === undefined) inheritedVatRule = prev.vatRule;
        if (inheritedVatRate === undefined && prev.vatRate > 0) inheritedVatRate = prev.vatRate;
        amountCalculationNote = `Рассчитано по связанному авансу/документу «${prev.counterpartyName}» (${effectiveQty} шт. = ${effectiveDraftAmount.toFixed(2)} ₽)`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (
        ['purchase_goods', 'purchase_materials', 'purchase_services', 'purchase_equipment'].includes(category) &&
        prev.entries.some((e) => e.debit === '60.02')
      ) {
        const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
        const fallbackAmt = availAdv > 0.01 ? availAdv : prev.amount;
        effectiveDraftAmount = fallbackAmt;
        if (!effectiveQty && prev.quantity) effectiveQty = prev.quantity;
        if (!effectiveUnitPrice && prev.unitPrice) effectiveUnitPrice = prev.unitPrice;
        if (!nomName && prev.nomenclatureName && (!normNom || normNom === normalizeEntityKey(prev.nomenclatureName))) {
          nomName = prev.nomenclatureName;
        }
        if (inheritedVatRule === undefined) inheritedVatRule = prev.vatRule;
        if (inheritedVatRate === undefined && prev.vatRate > 0) inheritedVatRate = prev.vatRate;
        amountCalculationNote = `Сумма определена по связанному авансу поставщику «${cpName}» от ${prev.date} (счёт 60.02): ${effectiveDraftAmount.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (
        ['sale_goods', 'sale_services'].includes(category) &&
        prev.entries.some((e) => e.credit === '62.02')
      ) {
        const availAdv = computeCounterpartyAdvanceBalance('62.02', cpName, cpInn, db1C, priorOps);
        effectiveDraftAmount = availAdv > 0.01 ? availAdv : prev.amount;
        if (inheritedVatRule === undefined) inheritedVatRule = prev.vatRule;
        if (inheritedVatRate === undefined && prev.vatRate > 0) inheritedVatRate = prev.vatRate;
        amountCalculationNote = `Сумма определена по связанному авансу покупателя «${cpName}» от ${prev.date} (счёт 62.02): ${effectiveDraftAmount.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (
        category === 'bank_out' &&
        ['purchase_goods', 'purchase_materials', 'purchase_services', 'purchase_equipment'].includes(prev.category)
      ) {
        effectiveDraftAmount = prev.amount;
        amountCalculationNote = `Сумма оплаты определена по связанному поступлению от «${cpName}» (${prev.date}): ${effectiveDraftAmount.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (
        category === 'bank_in' &&
        ['sale_goods', 'sale_services'].includes(prev.category)
      ) {
        effectiveDraftAmount = prev.amount;
        amountCalculationNote = `Сумма поступления определена по связанной реализации «${cpName}» (${prev.date}): ${effectiveDraftAmount.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
        break;
      }
    }
  }

  // 6d. Compute payroll payout from credit balance of account 70 as of draft.date if empty
  if (effectiveDraftAmount < 0.01 && category === 'payroll_payout') {
    const runningOsv = calculateOsvReport({
      db1C,
      operations: priorOps,
      dateTo: draft.date || undefined,
      reportingYear: batchContext?.reportingYear,
      includeQueuedOperations: true,
    });
    const row70 = runningOsv.leafRows.find((r) => r.code === '70');
    if (row70 && row70.endCredit > 0.01) {
      effectiveDraftAmount = row70.endCredit;
      amountCalculationNote = `Сумма «на руки» (за вычетом НДФЛ 13%) определена по кредитовому сальдо счёта 70 на ${draft.date || 'дату выплаты'}: ${effectiveDraftAmount.toFixed(2)} ₽`;
      calculationProvenance = amountCalculationNote;
    }
  }

  // Track explicit / balance / related-doc modes for steps 6a..6d
  if (
    !hadExplicitInputAmount &&
    effectiveDraftAmount >= 0.01 &&
    amountMode === 'required_missing'
  ) {
    if (taxBreakdownFromBalances.length > 0 || category === 'tax_payment' || category === 'payroll_payout') {
      amountMode = 'from_account_balance';
    } else if (effectiveUnitPrice && effectiveQty && amountCalculationNote?.startsWith('Рассчитано автоматически')) {
      amountMode = 'explicit';
    } else {
      amountMode = 'from_related_doc';
    }
  }

  // 6e. Internal Stock, Fixed Assets Commissioning & Depreciation Resolution
  if (
    effectiveDraftAmount < 0.01 &&
    ['materials_writeoff', 'workwear_issue', 'warehouse_transfer'].includes(category)
  ) {
    const stockRes = resolveStockBatchCost({
      itemText: nomName || draft.description,
      preferredAccount: resolvedMaterialAccount,
      accountPrefixFilter: ['10', '41'],
      requestedQty: effectiveQty,
      opDate: draft.date,
      db1C,
      priorOperations: priorOps,
    });
    if (stockRes && stockRes.amount >= 0.01) {
      effectiveDraftAmount = stockRes.amount;
      resolvedMaterialAccount = stockRes.account;
      if (!effectiveQty && stockRes.resolvedQty) {
        effectiveQty = stockRes.resolvedQty;
      }
      amountMode = 'from_stock_balance';
      stockSourceNote = stockRes.sourceNote;
      amountCalculationNote = stockRes.sourceNote;
      calculationProvenance = stockRes.sourceNote;
    } else {
      amountMode = 'calculated_by_1c';
      amountCalculationNote = `Сумма определяется 1С автоматически при проведении по себестоимости остатка счёта ${resolvedMaterialAccount} (вводить сумму вручную не требуется)`;
      calculationProvenance = amountCalculationNote;
    }
  } else if (category === 'os_commissioning') {
    if (effectiveDraftAmount < 0.01) {
      const capRes = resolveStockBatchCost({
        itemText: nomName || draft.description,
        preferredAccount: '08.04.1',
        accountPrefixFilter: ['08'],
        requestedQty: effectiveQty || 1,
        opDate: draft.date,
        db1C,
        priorOperations: priorOps,
      });
      if (capRes && capRes.amount >= 0.01) {
        effectiveDraftAmount = capRes.amount;
        resolvedMaterialAccount = capRes.account;
        resolvedDeprBaseAmount = capRes.amount;
        amountMode = 'from_stock_balance';
        stockSourceNote = `Первоначальная стоимость собрана со счёта ${capRes.account} (без НДС): ${capRes.amount.toFixed(2)} ₽ · СПИ ${resolvedUsefulLifeMonths ?? 60} мес.`;
        amountCalculationNote = stockSourceNote;
        calculationProvenance = stockSourceNote;
      } else {
        // Fallback: check open debit balance on 08.04.1 / 08.04 as of draft.date
        const osv08 = calculateOsvReport({
          db1C,
          operations: priorOps,
          dateTo: draft.date || undefined,
          reportingYear: batchContext?.reportingYear,
          includeQueuedOperations: true,
        });
        const row08 =
          osv08.leafRows.find((r) => r.code === '08.04.1' && r.endDebit >= 0.01) ||
          osv08.leafRows.find((r) => r.code.startsWith('08.') && r.endDebit >= 0.01);
        if (row08) {
          effectiveDraftAmount = row08.endDebit;
          resolvedMaterialAccount = row08.code;
          resolvedDeprBaseAmount = row08.endDebit;
          amountMode = 'from_account_balance';
          stockSourceNote = `Первоначальная стоимость определена по остатку счёта ${row08.code} (без НДС): ${row08.endDebit.toFixed(2)} ₽ · СПИ ${resolvedUsefulLifeMonths ?? 60} мес.`;
          amountCalculationNote = stockSourceNote;
          calculationProvenance = stockSourceNote;
        } else {
          amountMode = 'calculated_by_1c';
          amountCalculationNote =
            'Первоначальная стоимость определяется 1С автоматически по накопленному дебетовому сальдо счёта 08.04.1';
          calculationProvenance = amountCalculationNote;
        }
      }
    } else {
      resolvedDeprBaseAmount = effectiveDraftAmount;
    }
  } else if (effectiveDraftAmount < 0.01 && category === 'depreciation_accrual') {
    // Calculate monthly linear depreciation from commissioned fixed assets in priorOps or 1C DB 01.01
    const commissionedOps = priorOps.filter(
      (p) =>
        p.includeInProcessing &&
        !p.isDuplicateIn1C &&
        p.category === 'os_commissioning' &&
        p.amount >= 0.01 &&
        (!draft.date || !p.date || p.date <= draft.date)
    );
    if (commissionedOps.length > 0) {
      let monthlyDeprSum = 0;
      const deprParts: string[] = [];
      for (const osOp of commissionedOps) {
        const base = osOp.depreciationBaseAmount ?? osOp.amount;
        const spi = osOp.usefulLifeMonths ?? resolvedUsefulLifeMonths ?? 60;
        const mDepr = round2(base / spi);
        if (mDepr > 0) {
          monthlyDeprSum = round2(monthlyDeprSum + mDepr);
          deprParts.push(
            `${osOp.nomenclatureName || 'ОС'}: ${base.toFixed(2)} / ${spi} мес. = ${mDepr.toFixed(2)} ₽`
          );
          if (!nomName && osOp.nomenclatureName) nomName = osOp.nomenclatureName;
          resolvedDeprBaseAmount = base;
          resolvedUsefulLifeMonths = spi;
        }
      }
      if (monthlyDeprSum >= 0.01) {
        effectiveDraftAmount = monthlyDeprSum;
        amountMode = 'from_related_doc';
        calculationProvenance = `Линейная амортизация по принятым к учёту ОС (${deprParts.join('; ')})`;
        amountCalculationNote = calculationProvenance;
      }
    }
    if (effectiveDraftAmount < 0.01) {
      const runningOsv = calculateOsvReport({
        db1C,
        operations: priorOps,
        dateTo: draft.date || undefined,
        reportingYear: batchContext?.reportingYear,
        includeQueuedOperations: true,
      });
      const row01 = runningOsv.leafRows.find((r) => r.code === '01.01' || r.code === '01');
      if (row01 && row01.endDebit >= 0.01) {
        const spi = resolvedUsefulLifeMonths ?? 60;
        effectiveDraftAmount = round2(row01.endDebit / spi);
        resolvedDeprBaseAmount = row01.endDebit;
        amountMode = 'from_account_balance';
        calculationProvenance = `Амортизация от сальдо счёта ${row01.code} (${row01.endDebit.toFixed(2)} ₽ / СПИ ${spi} мес. = ${effectiveDraftAmount.toFixed(2)} ₽)`;
        amountCalculationNote = calculationProvenance;
      } else {
        amountMode = 'calculated_by_1c';
        amountCalculationNote =
          'Сумма амортизации рассчитывается 1С регламентной операцией по первоначальной стоимости и СПИ';
        calculationProvenance = amountCalculationNote;
      }
    }
  } else if (
    effectiveDraftAmount < 0.01 &&
    ['production_output', 'closing'].includes(category)
  ) {
    amountMode = 'calculated_by_1c';
    amountCalculationNote =
      category === 'production_output'
        ? `Фактическая себестоимость выпуска рассчитывается 1С автоматически при закрытии счёта ${resolvedCostAccount}`
        : 'Рассчитывается регламентной операцией «Закрытие месяца» по оборотам периода';
    calculationProvenance = amountCalculationNote;
  }

  const nonVatCategories: OperationCategory[] = [
    'tax_payment',
    'bank_fee',
    'founder_contribution',
    'hr_hire',
    'payroll_accrual',
    'insurance_accrual',
    'payroll_payout',
    'closing',
    'advance_offset',
    'materials_writeoff',
    'workwear_issue',
    'os_commissioning',
    'production_output',
    'warehouse_transfer',
    'cash_bank_internal',
    'accountable_issue',
    'accountable_return',
    'loan_received',
    'loan_repaid',
    'depreciation_accrual',
    'manual',
  ];

  let vatRule: 'included' | 'on_top' | 'none' = inheritedVatRule ?? 'included';
  let vatRate = inheritedVatRate !== undefined ? inheritedVatRate : isOsno ? policyVatRate : 0;

  const isPriceNetWithVatOnTop =
    /(?:по\s+)?цен\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|стоимост\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|сумм\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|кроме\s+того\s+ндс|сверху\s*ндс|плюс\s*ндс|\+\s*ндс|ндс\s+сверху/iu.test(
      descLower
    );

  if (
    nonVatCategories.includes(category) ||
    (category === 'expense_report' && !/ндс/iu.test(descLower)) ||
    (!isPriceNetWithVatOnTop &&
      /без\s*ндс|ндс\s+не\s+облагается|не\s+облагается\s+ндс/iu.test(descLower)) ||
    !isOsno
  ) {
    vatRule = 'none';
    vatRate = 0;
  } else if (isPriceNetWithVatOnTop) {
    vatRule = 'on_top';
    if (!vatRate || vatRate <= 0) {
      vatRate = policyVatRate || 20;
    }
  }

  const grossOrBaseAmount = round2(Math.abs(effectiveDraftAmount));
  let vatAmount = 0;
  if (draft.vatAmount !== undefined && draft.vatAmount >= 0 && vatRule !== 'none') {
    vatAmount = round2(draft.vatAmount);
  } else if (vatRule === 'included' && vatRate > 0) {
    vatAmount = round2((grossOrBaseAmount * vatRate) / (100 + vatRate));
  } else if (vatRule === 'on_top' && vatRate > 0) {
    vatAmount = round2((grossOrBaseAmount * vatRate) / 100);
  }

  const totalWithVat =
    vatRule === 'on_top' ? round2(grossOrBaseAmount + vatAmount) : grossOrBaseAmount;
  const netWithoutVat = round2(totalWithVat - vatAmount);

  const isCalculatedBy1C = amountMode === 'calculated_by_1c';
  const needsAmount = !isCalculatedBy1C && totalWithVat < 0.01 && category !== 'closing';
  if (needsAmount) {
    amountMode = 'required_missing';
  }

  if (needsAmount && !amountCalculationNote) {
    amountCalculationNote = 'Требуется указать сумму первичного документа';
  }

  const explicitlyNoSF =
    /без\s+сч[её]та?-фактур|сч[её]т-фактур\p{L}*\s+не\s+(?:получен|предоставлен|выставлен)|отсутств\p{L}*\s+сч[её]т-фактур/iu.test(
      descLower
    );

  const hasInvoiceSF = nonVatCategories.includes(category)
    ? false
    : draft.hasInvoiceSF !== undefined
      ? draft.hasInvoiceSF
      : explicitlyNoSF
        ? false
        : /счет-фактур|счёт-фактур|сч-ф|с\/ф|(?:^|[^\p{L}])упд(?=$|[^\p{L}])/iu.test(descLower) ||
          Boolean(
            batchContext?.assumeInvoiceOnVatPurchase &&
              isOsno &&
              vatAmount > 0 &&
              [
                'purchase_goods',
                'purchase_materials',
                'purchase_equipment',
                'purchase_services',
              ].includes(category)
          );

  const nomGroup =
    draft.nomenclatureGroupHint?.trim() ||
    matchedNomGroup ||
    db1C?.nomenclatureGroups[0]?.name ||
    'Основная номенклатурная группа';

  // --- 7. Build deterministic RSBU entries (full 1C 8.3 BP 3.0 posting set) ---
  const entries: AccountingEntry[] = [];
  const pushEntry = (
    debit: string,
    credit: string,
    amount: number,
    debitSubconto: string,
    creditSubconto: string,
    description: string,
    opts?: {
      allowZeroCalculated?: boolean;
      amountRuleNote?: string;
      isOffBalance?: boolean;
    }
  ) => {
    const cleanAmt = round2(amount);
    if (cleanAmt <= 0 && !opts?.allowZeroCalculated) return;
    entries.push({
      id: `${opId}-e${entries.length + 1}`,
      debit,
      credit,
      debitSubconto,
      creditSubconto,
      amount: Math.max(0, cleanAmt),
      amountRuleNote: opts?.amountRuleNote,
      isOffBalance: opts?.isOffBalance,
      description,
    });
  };

  const cpSubconto = [cpName, contractName].filter(Boolean).join(' / ');
  const bankLabel = orgDefaultBankAccount
    ? `${orgDefaultBankAccount} (${orgDefaultBankName}, БИК ${orgDefaultBik})`
    : `${orgDefaultBankName} (БИК ${orgDefaultBik})`;
  const bankSubconto = [bankLabel, cashFlowItemName].filter(Boolean).join(' / ');

  if (draft.explicitDebit && draft.explicitCredit) {
    pushEntry(
      draft.explicitDebit,
      draft.explicitCredit,
      totalWithVat,
      cpSubconto || nomName,
      cpSubconto || bankSubconto,
      draft.description
    );
  } else {
    switch (category) {
      case 'bank_out': {
        const isExplicitAdvance = /аванс|предоплат/i.test(descLower);
        let dtAcc = isExplicitAdvance ? '60.02' : '60.01';
        // If batchContext is active and not explicitly named, check whether supplier has debt on 60.01; if 0, post to 60.02
        if (!isExplicitAdvance && batchContext && cpName) {
          const hasPriorReceipt = priorOps.some(
            (o) =>
              normalizeEntityKey(o.counterpartyName) === normalizeEntityKey(cpName) &&
              o.entries.some((e) => e.credit === '60.01')
          );
          const hasDbDebt = db1C?.postings.some(
            (p) =>
              p.credit === '60.01' &&
              normalizeEntityKey(`${p.counterpartyName ?? ''} ${p.creditSubconto.join(' ')}`).includes(
                normalizeEntityKey(cpName)
              )
          );
          if (!hasPriorReceipt && !hasDbDebt && !db1C?.rawBalances.some((b) => b.account === '60.01' && b.rawCredit > 0)) {
            dtAcc = '60.02';
          }
        }
        pushEntry(
          dtAcc,
          '51',
          totalWithVat,
          cpSubconto || cpName,
          bankSubconto,
          dtAcc === '60.02' ? 'Перечислен аванс поставщику' : 'Оплата поставщику с расчётного счёта'
        );
        break;
      }

      case 'bank_in': {
        const isAdvance = /аванс|предоплат/i.test(descLower);
        const ktAcc = isAdvance ? '62.02' : '62.01';
        pushEntry(
          '51',
          ktAcc,
          totalWithVat,
          bankSubconto,
          cpSubconto || cpName,
          isAdvance ? 'Получен аванс от покупателя' : 'Поступление оплаты от покупателя'
        );
        if (isAdvance && vatAmount > 0 && (hasInvoiceSF || batchContext?.assumeInvoiceOnVatPurchase)) {
          pushEntry(
            '76.АВ',
            '68.02',
            vatAmount,
            cpName,
            'Налог (взносы): начислено / уплачено',
            'Исчислен НДС с полученного аванса (СФ на аванс)'
          );
        }
        break;
      }

      case 'founder_contribution': {
        const cashOrBankDt = docType1C === 'ПоступлениеНаличных' ? '50.01' : '51';
        pushEntry(
          cashOrBankDt,
          '75.01',
          totalWithVat,
          cashOrBankDt === '51' ? bankSubconto : cashFlowItemName,
          cpName || 'Учредитель',
          draft.description || 'Взнос учредителя в уставный капитал (оплата доли)'
        );
        break;
      }

      case 'tax_payment': {
        if (taxBreakdownFromBalances.length > 0) {
          for (const item of taxBreakdownFromBalances) {
            pushEntry(
              item.account,
              '51',
              item.amount,
              `${cpName ? `${cpName} / ` : ''}Налог (взносы): уплачено (${item.name})`,
              bankSubconto,
              `Перечисление задолженности в бюджет (${item.account} — ${item.name})`
            );
          }
        } else {
          let taxAcc = '68.02';
          if (/ндфл/i.test(descLower)) taxAcc = '68.01';
          else if (/прибыл/i.test(descLower)) taxAcc = '68.04.1';
          else if (/травматизм|нс и пз/i.test(descLower)) taxAcc = '69.11';
          else if (/страхов\p{L}*\s+взнос|единый тариф|сфр|пфр|фсс/iu.test(descLower)) taxAcc = '69.09';
          else if (/единый налоговый платеж|(?:^|[^\p{L}])енп(?=$|[^\p{L}])/iu.test(descLower)) taxAcc = '68.90';
          else if (/штраф|пен[ия]/i.test(descLower)) taxAcc = '68.10';

          pushEntry(
            taxAcc,
            '51',
            totalWithVat,
            `${cpName ? `${cpName} / ` : ''}Налог (взносы): начислено / уплачено`,
            bankSubconto,
            draft.description || `Перечисление налога/взносов (${taxAcc})`
          );
        }
        break;
      }

      case 'bank_fee': {
        pushEntry(
          '91.02',
          '51',
          totalWithVat,
          'Расходы на услуги банков',
          bankSubconto,
          draft.description || 'Комиссия банка за РКО'
        );
        break;
      }

      case 'penalty_claim': {
        if (docType1C === 'СписаниеСРасчетногоСчета') {
          pushEntry(
            '76.02',
            '51',
            totalWithVat,
            cpSubconto,
            bankSubconto,
            draft.description || 'Перечисление по претензии / исполнительному листу'
          );
        } else {
          pushEntry(
            '91.02',
            '76.02',
            totalWithVat,
            'Штрафы, пени и неустойки к уплате',
            cpSubconto,
            draft.description || 'Начислена претензия / неустойка'
          );
        }
        break;
      }

      case 'payroll_payout': {
        const ktAcc = docType1C === 'ВыдачаНаличных' ? '50.01' : '51';
        pushEntry(
          '70',
          ktAcc,
          totalWithVat,
          employeeName || 'Сотрудники организации',
          ktAcc === '51' ? bankSubconto : cashFlowItemName || 'Выплата заработной платы по ведомости',
          draft.description ||
            (ktAcc === '50.01'
              ? 'Выплата заработной платы из кассы по ведомости (РКО)'
              : 'Перечисление заработной платы на банковские карты')
        );
        break;
      }

      case 'accountable_issue': {
        const ktAcc = docType1C === 'СписаниеСРасчетногоСчета' ? '51' : '50.01';
        pushEntry(
          '71.01',
          ktAcc,
          totalWithVat,
          employeeName || 'Подотчётное лицо',
          ktAcc === '51' ? bankSubconto : cashFlowItemName || 'Выдача подотчетному лицу',
          draft.description || 'Выдача денежных средств под отчёт сотруднику'
        );
        break;
      }

      case 'accountable_return': {
        pushEntry(
          '50.01',
          '71.01',
          totalWithVat,
          cashFlowItemName || 'Возврат от подотчетного лица',
          employeeName || 'Подотчётное лицо',
          draft.description || 'Возврат неизрасходованных подотчётных сумм в кассу (ПКО)'
        );
        break;
      }

      case 'expense_report': {
        const isServiceOrTravel =
          /командиров|проезд|суточн|проживан|гостиниц|билет|почтов|нотариус|услуг/iu.test(descLower);
        const aoDtAcc = isServiceOrTravel
          ? resolvedCostAccount || '26'
          : resolvedMaterialAccount || '10.01';
        const aoDtSubconto = isServiceOrTravel
          ? expenseItemName || 'Командировочные и хозяйственные расходы'
          : [nomName || 'ТМЦ по авансовому отчёту', warehouseName || 'Основной склад']
              .filter(Boolean)
              .join(' / ');
        pushEntry(
          aoDtAcc,
          '71.01',
          netWithoutVat,
          aoDtSubconto,
          employeeName || 'Подотчётное лицо',
          draft.description || 'Утверждён авансовый отчёт подотчётного лица'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.03',
            '71.01',
            vatAmount,
            employeeName || 'Подотчётное лицо',
            employeeName || 'Подотчётное лицо',
            'Учтён входной НДС по документам к авансовому отчёту'
          );
          if (hasInvoiceSF) {
            pushEntry(
              '68.02',
              '19.03',
              vatAmount,
              'Налог (взносы): начислено / уплачено',
              employeeName || 'Подотчётное лицо',
              'Принят к вычету НДС по счёту-фактуре / БСО к авансовому отчёту'
            );
          }
        }
        break;
      }

      case 'loan_received': {
        const loanAcc = /долгосрочн/iu.test(descLower) ? '67.03' : '66.03';
        pushEntry(
          '51',
          loanAcc,
          totalWithVat,
          bankSubconto,
          cpSubconto || cpName || 'Заимодавец (банк)',
          draft.description || 'Получен заём / кредит на расчётный счёт'
        );
        break;
      }

      case 'loan_repaid': {
        const loanAcc = /долгосрочн/iu.test(descLower) ? '67.03' : '66.03';
        pushEntry(
          loanAcc,
          '51',
          totalWithVat,
          cpSubconto || cpName || 'Заимодавец (банк)',
          bankSubconto,
          draft.description || 'Погашение основного долга по кредиту / займу'
        );
        break;
      }

      case 'purchase_goods': {
        const stockAcc = matchedNomAccount || '41.01';
        const stockSubconto = [nomName || 'Товары', warehouseName].filter(Boolean).join(' / ');
        pushEntry(
          stockAcc,
          '60.01',
          netWithoutVat,
          stockSubconto,
          cpSubconto || cpName,
          'Поступление товаров от поставщика'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.03',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto || cpName,
            'Учтён входной НДС по приобретённым товарам'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '60.01',
              '60.02',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее выданного аванса поставщику'
            );
          }
        }
        if (vatAmount > 0 && hasInvoiceSF) {
          pushEntry(
            '68.02',
            '19.03',
            vatAmount,
            'Налог (взносы): начислено / уплачено',
            cpName,
            'Принят к вычету НДС по счёту-фактуре поставщика'
          );
        }
        break;
      }

      case 'purchase_materials': {
        const matAcc = resolvedMaterialAccount || '10.01';
        const matSubconto = [nomName || 'Материалы', warehouseName].filter(Boolean).join(' / ');
        pushEntry(
          matAcc,
          '60.01',
          netWithoutVat,
          matSubconto,
          cpSubconto || cpName,
          `Поступление материалов (${matAcc})`
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.03',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto || cpName,
            'Учтён входной НДС по приобретённым материалам'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '60.01',
              '60.02',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее выданного аванса поставщику'
            );
          }
        }
        if (vatAmount > 0 && hasInvoiceSF) {
          pushEntry(
            '68.02',
            '19.03',
            vatAmount,
            'Налог (взносы): начислено / уплачено',
            cpName,
            'Принят к вычету НДС по счёту-фактуре поставщика'
          );
        }
        break;
      }

      case 'purchase_equipment': {
        const equipAcc = '08.04.1';
        const equipSubconto = [nomName || 'Оборудование (ОС)', warehouseName].filter(Boolean).join(' / ');
        pushEntry(
          equipAcc,
          '60.01',
          netWithoutVat,
          equipSubconto,
          cpSubconto || cpName,
          'Поступление оборудования (капитальные вложения в ОС)'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.01',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto || cpName,
            'Учтён входной НДС при приобретении основных средств'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '60.01',
              '60.02',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее выданного аванса поставщику оборудования'
            );
          }
        }
        if (vatAmount > 0 && hasInvoiceSF) {
          pushEntry(
            '68.02',
            '19.01',
            vatAmount,
            'Налог (взносы): начислено / уплачено',
            cpName,
            'Принят к вычету НДС по приобретённому оборудованию'
          );
        }
        break;
      }

      case 'materials_writeoff': {
        const matAcc = resolvedMaterialAccount || '10.01';
        const costAcc = resolvedCostAccount || '20.01';
        const dtSub =
          costAcc === '20.01'
            ? [nomGroup, expenseItemName || 'Материальные расходы'].filter(Boolean).join(' / ')
            : expenseItemName || 'Материальные расходы';
        const ktSub = [nomName || 'Материалы', warehouseName || 'Основной склад']
          .filter(Boolean)
          .join(' / ');
        pushEntry(
          costAcc,
          matAcc,
          totalWithVat,
          dtSub,
          ktSub,
          `Списание материалов в производство / на объект (${nomName || 'ТМЦ'})`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `Автоматически по себестоимости остатка счёта ${matAcc} (средняя / ФИФО)`,
          }
        );
        break;
      }

      case 'workwear_issue': {
        const matAcc = resolvedMaterialAccount || '10.10';
        const offAcc = resolvedOffBalanceAccount || 'МЦ.02';
        const costAcc = resolvedCostAccount || '20.01';
        const dtSub =
          costAcc === '20.01'
            ? [nomGroup, expenseItemName || 'Материальные расходы'].filter(Boolean).join(' / ')
            : expenseItemName || 'Материальные расходы';
        const ktSub = [nomName || 'Спецодежда', warehouseName || 'Основной склад']
          .filter(Boolean)
          .join(' / ');
        const empLabel = employeeName || 'Сотрудник (МОЛ)';
        pushEntry(
          costAcc,
          matAcc,
          totalWithVat,
          dtSub,
          ktSub,
          `Передача спецодежды / инвентаря в эксплуатацию (ФСБУ 5/2019 — списание стоимости)`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `Автоматически по учётной себестоимости склада (${matAcc})`,
          }
        );
        pushEntry(
          offAcc,
          '',
          totalWithVat,
          `${empLabel} / ${nomName || 'Спецодежда'}`,
          '',
          `Принята на забалансовый контроль спецодежда / инвентарь за сотрудником «${empLabel}»`,
          {
            allowZeroCalculated: true,
            isOffBalance: true,
            amountRuleNote: `Забалансовый количественный учёт за МОЛ (${effectiveQty || 1} шт.)`,
          }
        );
        break;
      }

      case 'os_commissioning': {
        const capAcc = resolvedMaterialAccount.startsWith('08') ? resolvedMaterialAccount : '08.04.1';
        pushEntry(
          '01.01',
          capAcc,
          totalWithVat,
          nomName || 'Объект основных средств',
          [nomName || 'Оборудование', warehouseName].filter(Boolean).join(' / '),
          `Принятие к учёту и ввод в эксплуатацию объекта ОС (${nomName || 'ОС'})`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `Автоматически по накопленному сальдо капитальных вложений на счёте ${capAcc}`,
          }
        );
        break;
      }

      case 'production_output': {
        const costAcc = resolvedCostAccount || '20.01';
        pushEntry(
          '43',
          costAcc,
          totalWithVat,
          [nomName || 'Готовая продукция', warehouseName || 'Основной склад']
            .filter(Boolean)
            .join(' / '),
          nomGroup,
          `Выпуск готовой продукции из производства (${nomName || 'Продукция'})`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `Фактическая себестоимость рассчитывается 1С при закрытии счёта ${costAcc}`,
          }
        );
        break;
      }

      case 'warehouse_transfer': {
        const matAcc = resolvedMaterialAccount || '10.01';
        const whFrom = warehouseName || 'Основной склад';
        const whTo = warehouseToName || 'Цеховая кладовая';
        pushEntry(
          matAcc,
          matAcc,
          totalWithVat,
          [nomName || 'ТМЦ', whTo].filter(Boolean).join(' / '),
          [nomName || 'ТМЦ', whFrom].filter(Boolean).join(' / '),
          `Внутреннее перемещение ТМЦ между складами (${whFrom} → ${whTo})`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `Автоматически по себестоимости партии на счёте ${matAcc}`,
          }
        );
        break;
      }

      case 'cash_bank_internal': {
        if (docType1C === 'ПоступлениеНаличных') {
          pushEntry(
            '50.01',
            '51',
            totalWithVat,
            cashFlowItemName || 'Получение наличных в банке',
            bankSubconto,
            draft.description || 'Получение наличных денежных средств в банке по чеку (ПКО)'
          );
        } else {
          const isTransitCash = /инкассат|инкассац/iu.test(descLower);
          pushEntry(
            isTransitCash ? '57.01' : '51',
            '50.01',
            totalWithVat,
            isTransitCash ? 'Переводы в пути (инкассация)' : bankSubconto,
            cashFlowItemName || 'Взнос наличными в банк',
            draft.description ||
              (isTransitCash
                ? 'Сдача наличной выручки инкассатору (РКО)'
                : 'Взнос наличными из кассы на расчётный счёт (РКО)')
          );
        }
        break;
      }

      case 'depreciation_accrual': {
        const costAcc = resolvedCostAccount || '20.01';
        pushEntry(
          costAcc,
          '02.01',
          totalWithVat,
          expenseItemName || 'Амортизация',
          nomName || 'Основные средства в организации',
          draft.description || 'Начислена амортизация основных средств за месяц',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: 'Рассчитывается 1С по первоначальной стоимости и СПИ (ФСБУ 6/2020)',
          }
        );
        break;
      }

      case 'insurance_accrual': {
        const costAcc = resolvedCostAccount || '26';
        pushEntry(
          costAcc,
          '69.09',
          totalWithVat,
          expenseItemName || 'Страховые взносы',
          'Страховые взносы по единому тарифу',
          draft.description || 'Начислены страховые взносы',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: '30% от штатного ФОТ за месяц',
          }
        );
        break;
      }

      case 'hr_hire': {
        // HR employment order (ПриемНаРаботу) registers staff salary for payroll_accrual without balance-sheet entries
        break;
      }

      case 'purchase_services': {
        const histAcc = findHistoricalExpenseAccount(cpName, db1C);
        const costAcc =
          matchedNomAccount ||
          histAcc ||
          (/основн\w+\s+производств|субподряд|переработк\w+\s+сырь/iu.test(descLower)
            ? '20.01'
            : /доставк\w*\s+покупател|реклам|маркетинг|торгов/iu.test(descLower)
              ? '44.01'
              : '26');
        pushEntry(
          costAcc,
          '60.01',
          netWithoutVat,
          expenseItemName || nomName,
          cpSubconto || cpName,
          'Отражены услуги сторонних организаций'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.04',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto || cpName,
            'Учтён входной НДС по приобретённым услугам'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '60.01',
              '60.02',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее выданного аванса поставщику'
            );
          }
        }
        if (vatAmount > 0 && hasInvoiceSF) {
          pushEntry(
            '68.02',
            '19.04',
            vatAmount,
            'Налог (взносы): начислено / уплачено',
            cpName,
            'Принят к вычету НДС по услугам (СФ / УПД)'
          );
        }
        break;
      }

      case 'sale_goods': {
        pushEntry(
          '62.01',
          '90.01.1',
          totalWithVat,
          cpSubconto || cpName,
          nomGroup,
          'Выручка от реализации товаров (продукции)'
        );
        if (vatAmount > 0) {
          pushEntry(
            '90.03',
            '68.02',
            vatAmount,
            nomGroup,
            'Налог (взносы): начислено / уплачено',
            'Начислен НДС с реализации'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availBuyerAdv = computeCounterpartyAdvanceBalance('62.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availBuyerAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '62.02',
              '62.01',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее полученного аванса от покупателя'
            );
            if (vatRate > 0 && isOsno) {
              const offsetVat = round2((offsetAmt * vatRate) / (100 + vatRate));
              const hasPrior76AV = priorOps.some(
                (o) =>
                  normalizeEntityKey(o.counterpartyName) === normalizeEntityKey(cpName) &&
                  o.entries.some((e) => e.debit === '76.АВ')
              );
              if (hasPrior76AV && offsetVat > 0.01) {
                pushEntry(
                  '68.02',
                  '76.АВ',
                  offsetVat,
                  'Налог (взносы): начислено / уплачено',
                  cpName,
                  'Вычет НДС с зачтённого аванса покупателя'
                );
              }
            }
          }
        }
        // Check deterministic COGS strictly from 1C stock balances/receipts (43 for finished goods, 41.01 for goods)
        const isFinishedGoods =
          matchedNomKind === 'Продукция' ||
          /(?:поставлен|отгружен|реализован|прода)\p{L}*\s+(?:готов\p{L}*\s+|собственн\p{L}*\s+)?продукц|готов\p{L}*\s+продукц|издели/iu.test(
            descLower
          );
        const preferredSaleStockAcc = isFinishedGoods ? '43' : matchedNomAccount || '41.01';
        const batchCogs = resolveStockBatchCost({
          itemText: nomName || draft.description,
          preferredAccount: preferredSaleStockAcc,
          accountPrefixFilter: isFinishedGoods ? ['43', '41'] : ['41', '43'],
          requestedQty: effectiveQty,
          opDate: draft.date,
          db1C,
          priorOperations: priorOps,
        });
        if (batchCogs && batchCogs.amount > 0) {
          pushEntry(
            '90.02.1',
            batchCogs.account,
            batchCogs.amount,
            nomGroup,
            [nomName || 'Продукция / товары', warehouseName || 'Основной склад']
              .filter(Boolean)
              .join(' / '),
            `Списана себестоимость реализованных ТМЦ со счёта ${batchCogs.account}`
          );
        } else if (effectiveQty && effectiveQty > 0) {
          let unitCost = estimateUnitCostFrom1C(nomName, preferredSaleStockAcc, db1C);
          if (!unitCost && priorOps.length > 0) {
            const normNom = normalizeEntityKey(nomName);
            for (const pOp of priorOps) {
              if (
                pOp.includeInProcessing &&
                pOp.quantity &&
                pOp.quantity > 0 &&
                (!normNom || normalizeEntityKey(pOp.nomenclatureName) === normNom)
              ) {
                const stockEntry = pOp.entries.find(
                  (e) => e.debit === preferredSaleStockAcc || e.debit === '43' || e.debit === '41.01'
                );
                if (stockEntry && stockEntry.amount > 0) {
                  unitCost = round2(stockEntry.amount / pOp.quantity);
                  break;
                }
              }
            }
          }
          if (unitCost && unitCost > 0) {
            pushEntry(
              '90.02.1',
              preferredSaleStockAcc,
              round2(unitCost * effectiveQty),
              nomGroup,
              [nomName, warehouseName].filter(Boolean).join(' / '),
              'Списана себестоимость реализованных ТМЦ'
            );
          }
        }
        break;
      }

      case 'sale_services': {
        pushEntry(
          '62.01',
          '90.01.1',
          totalWithVat,
          cpSubconto || cpName,
          nomGroup,
          'Выручка от оказания услуг (выполнения работ)'
        );
        if (vatAmount > 0) {
          pushEntry(
            '90.03',
            '68.02',
            vatAmount,
            nomGroup,
            'Налог (взносы): начислено / уплачено',
            'Начислен НДС с реализации услуг'
          );
        }
        if (batchContext && cpName && totalWithVat > 0) {
          const availBuyerAdv = computeCounterpartyAdvanceBalance('62.02', cpName, cpInn, db1C, priorOps);
          const offsetAmt = round2(Math.min(totalWithVat, availBuyerAdv));
          if (offsetAmt > 0.01) {
            pushEntry(
              '62.02',
              '62.01',
              offsetAmt,
              cpSubconto || cpName,
              cpSubconto || cpName,
              'Зачёт ранее полученного аванса от покупателя'
            );
          }
        }
        break;
      }

      case 'cash_in': {
        const ktCash = /из банка|с расчетного счета/i.test(descLower) ? '51' : '62.01';
        pushEntry(
          '50.01',
          ktCash,
          totalWithVat,
          cashFlowItemName,
          ktCash === '51' ? bankSubconto : cpSubconto,
          draft.description || 'Поступление наличных в кассу (ПКО)'
        );
        break;
      }

      case 'cash_out': {
        const dtCash = /в банк|на расчетный счет/i.test(descLower)
          ? '51'
          : /под отчет|подотчет/i.test(descLower)
            ? '71.01'
            : /зарплат/i.test(descLower)
              ? '70'
              : '60.01';
        pushEntry(
          dtCash,
          '50.01',
          totalWithVat,
          dtCash === '71.01' || dtCash === '70' ? employeeName || 'Сотрудник' : cpSubconto,
          cashFlowItemName,
          draft.description || 'Выдача наличных из кассы (РКО)'
        );
        break;
      }

      case 'payroll_accrual': {
        const wageCostAcc = resolvedCostAccount || '26';
        const empLabel =
          employeeName ||
          (payrollStaffSummary && payrollStaffSummary.length > 0
            ? payrollStaffSummary.map((s) => s.name).join(', ')
            : 'Сотрудники организации');
        const injRate = resolvedInjuryRate;
        pushEntry(
          wageCostAcc,
          '70',
          totalWithVat,
          wageCostAcc === '20.01'
            ? [nomGroup, expenseItemName || 'Оплата труда'].filter(Boolean).join(' / ')
            : expenseItemName || 'Оплата труда',
          empLabel,
          'Начислена заработная плата за месяц',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: 'По штатному ФОТ за месяц (кнопка «Заполнить» в 1С)',
          }
        );
        pushEntry(
          '70',
          '68.01',
          round2(totalWithVat * 0.13),
          empLabel,
          'НДФЛ исчисленный',
          'Удержан НДФЛ 13%',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: '13% от начисленного ФОТ',
          }
        );
        pushEntry(
          wageCostAcc,
          '69.09',
          round2(totalWithVat * 0.3),
          wageCostAcc === '20.01'
            ? [nomGroup, 'Страховые взносы'].filter(Boolean).join(' / ')
            : 'Страховые взносы',
          'Страховые взносы по единому тарифу',
          'Начислены страховые взносы по единому тарифу (30%)',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: '30% от начисленного ФОТ',
          }
        );
        pushEntry(
          wageCostAcc,
          '69.11',
          round2(totalWithVat * (injRate / 100)),
          wageCostAcc === '20.01'
            ? [nomGroup, 'Страховые взносы'].filter(Boolean).join(' / ')
            : 'Страховые взносы',
          'Взносы от НС и ПЗ',
          `Начислены взносы на травматизм (${injRate}%)`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: `${injRate}% от начисленного ФОТ`,
          }
        );
        break;
      }

      case 'closing': {
        // Chronological Month-End Closing (ЗакрытиеМесяца):
        // 1) Accrue monthly depreciation on commissioned OS if not already accrued in this month
        // 2) Close 20.01, 25, 26, 44.01 -> 90.02.1 / 90.08.1
        // 3) Close 90 & 91 -> 99.01.1
        // 4) At quarter-end (03, 06, 09, 12) on OSNO, accrue 20% corporate income tax (Дт 99.01.1 Кт 68.04.1)
        const closeMonthPrefix = (draft.date ?? '').slice(0, 7);
        const alreadyHasDeprInMonth = priorOps.some(
          (p) =>
            p.includeInProcessing &&
            !p.isDuplicateIn1C &&
            closeMonthPrefix &&
            (p.date ?? '').startsWith(closeMonthPrefix) &&
            p.entries.some((e) => e.credit === '02.01')
        );

        let extraDepr20 = 0;
        let extraDepr26 = 0;
        if (!alreadyHasDeprInMonth && closeMonthPrefix) {
          const priorCommissioned = priorOps.filter(
            (p) =>
              p.includeInProcessing &&
              !p.isDuplicateIn1C &&
              p.category === 'os_commissioning' &&
              p.amount >= 0.01 &&
              Boolean(p.date) &&
              p.date.slice(0, 7) < closeMonthPrefix
          );
          for (const osOp of priorCommissioned) {
            const base = osOp.depreciationBaseAmount ?? osOp.amount;
            const spi = osOp.usefulLifeMonths ?? 60;
            const mDepr = round2(base / spi);
            if (mDepr >= 0.01) {
              const targetAcc = osOp.costAccount || '20.01';
              pushEntry(
                targetAcc,
                '02.01',
                mDepr,
                'Амортизация',
                osOp.nomenclatureName || 'Основные средства',
                `Регламентное начисление амортизации ОС (${osOp.nomenclatureName || 'ОС'})`
              );
              if (targetAcc === '26') extraDepr26 = round2(extraDepr26 + mDepr);
              else extraDepr20 = round2(extraDepr20 + mDepr);
            }
          }
        }

        const runningOsv = calculateOsvReport({
          db1C,
          operations: priorOps,
          dateTo: draft.date || undefined,
          reportingYear: batchContext?.reportingYear,
          includeQueuedOperations: true,
        });
        const directCosting = db1C?.accountingPolicy.directCosting26To9008 ?? true;
        let added9002 = 0;
        let added9008 = 0;

        const bal25 = runningOsv.leafRows.find((r) => r.code.startsWith('25'))?.endDebit ?? 0;
        if (bal25 > 0.01) {
          pushEntry(
            '20.01',
            '25',
            bal25,
            nomGroup,
            'Общепроизводственные расходы',
            'Распределение счёта 25 на счёт 20.01'
          );
          extraDepr20 = round2(extraDepr20 + bal25);
        }

        const bal20 = round2(
          (runningOsv.leafRows.find((r) => r.code === '20.01')?.endDebit ?? 0) + extraDepr20
        );
        if (bal20 > 0.01) {
          pushEntry(
            '90.02.1',
            '20.01',
            bal20,
            nomGroup,
            nomGroup,
            'Закрытие счёта 20.01 в себестоимость продаж'
          );
          added9002 = round2(added9002 + bal20);
        }

        const bal26 = round2(
          (runningOsv.leafRows.find((r) => r.code === '26')?.endDebit ?? 0) + extraDepr26
        );
        if (bal26 > 0.01) {
          const target26 = directCosting ? '90.08.1' : '90.02.1';
          pushEntry(
            target26,
            '26',
            bal26,
            nomGroup,
            'Общехозяйственные расходы',
            'Закрытие счёта 26 («Директ-костинг»)'
          );
          if (directCosting) added9008 = round2(added9008 + bal26);
          else added9002 = round2(added9002 + bal26);
        }

        const bal44 = runningOsv.leafRows.find((r) => r.code === '44.01')?.endDebit ?? 0;
        if (bal44 > 0.01) {
          pushEntry(
            '90.02.1',
            '44.01',
            bal44,
            nomGroup,
            'Издержки обращения',
            'Закрытие счёта 44.01'
          );
          added9002 = round2(added9002 + bal44);
        }

        const children90 = runningOsv.leafRows.filter((r) => r.code.startsWith('90.'));
        const net90 = round2(
          children90.reduce((s, r) => s + (r.endDebit - r.endCredit), 0) + added9002 + added9008
        );
        let profitDeltaTo99 = 0;
        if (Math.abs(net90) > 0.01) {
          if (net90 < 0) {
            const p90 = round2(-net90);
            pushEntry(
              '90.09',
              '99.01.1',
              p90,
              nomGroup,
              'Прибыль (убыток) от продаж',
              'Финансовый результат (прибыль от продаж)'
            );
            profitDeltaTo99 = round2(profitDeltaTo99 + p90);
          } else {
            pushEntry(
              '99.01.1',
              '90.09',
              net90,
              'Прибыль (убыток) от продаж',
              nomGroup,
              'Финансовый результат (убыток от продаж)'
            );
            profitDeltaTo99 = round2(profitDeltaTo99 - net90);
          }
        }

        const children91 = runningOsv.leafRows.filter((r) => r.code.startsWith('91.'));
        const net91 = round2(children91.reduce((s, r) => s + (r.endDebit - r.endCredit), 0));
        if (Math.abs(net91) > 0.01) {
          if (net91 < 0) {
            const p91 = round2(-net91);
            pushEntry(
              '91.09',
              '99.01.1',
              p91,
              '',
              'Прочие доходы и расходы',
              'Закрытие счёта 91 (прибыль по прочим операциям)'
            );
            profitDeltaTo99 = round2(profitDeltaTo99 + p91);
          } else {
            pushEntry(
              '99.01.1',
              '91.09',
              net91,
              'Прочие доходы и расходы',
              '',
              'Закрытие счёта 91 (сальдо прочих расходов)'
            );
            profitDeltaTo99 = round2(profitDeltaTo99 - net91);
          }
        }

        // Quarter-end (03, 06, 09, 12) corporate income tax 20% on OSNO
        const closeMonth = (draft.date ?? '').slice(5, 7);
        if (isOsno && ['03', '06', '09', '12'].includes(closeMonth)) {
          const row99 = runningOsv.leafRows.find((r) => r.code === '99.01.1');
          const alreadyAccruedTax = priorOps
            .filter(
              (p) =>
                p.includeInProcessing &&
                !p.isDuplicateIn1C &&
                (!draft.date || !p.date || p.date <= draft.date)
            )
            .flatMap((p) => p.entries)
            .filter((e) => e.debit === '99.01.1' && e.credit.startsWith('68.04'))
            .reduce((s, e) => s + e.amount, 0);

          const currentNetProfitAfterPrevTax = round2(
            ((row99?.endCredit ?? 0) - (row99?.endDebit ?? 0)) + profitDeltaTo99
          );
          const preTaxCumulativeProfit = round2(currentNetProfitAfterPrevTax + alreadyAccruedTax);
          if (preTaxCumulativeProfit > 0.01) {
            const targetTaxTotal = round2(preTaxCumulativeProfit * 0.2);
            const taxDelta = round2(targetTaxTotal - alreadyAccruedTax);
            if (taxDelta > 0.01) {
              pushEntry(
                '99.01.1',
                '68.04.1',
                taxDelta,
                'Налог на прибыль и аналогичные платежи',
                'Налог на прибыль организаций (20%)',
                'Регламентный расчёт налога на прибыль организаций (20%) за отчётный период'
              );
            }
          }
        }

        if (entries.length > 0) {
          calculationProvenance = `Автозакрытие периода на ${draft.date || 'конец месяца'}: сформировано ${entries.length} регламентных проводок по накопленным оборотам`;
          amountCalculationNote = calculationProvenance;
        }
        break;
      }

      case 'manual': {
        // Safe neutral ОперацияБух: do not invent 26/60.01 or force VAT/counterparty when accounts are not yet specified
        break;
      }

      default: {
        pushEntry('26', '60.01', totalWithVat, expenseItemName, cpSubconto, draft.description);
        break;
      }
    }
  }

  const finalOpAmount =
    category === 'closing' && entries.length > 0
      ? round2(entries.reduce((s, e) => s + e.amount, 0))
      : totalWithVat;

  // --- 8. Deduplication check against 1C DB (never deduplicates between imported Excel rows!) ---
  const dupCheck = checkDuplicateIn1CDb(
    {
      date: draft.date,
      amount: finalOpAmount,
      docNumber: draft.docNumber ?? '',
      counterpartyName: cpName,
      counterpartyInn: cpInn,
    },
    db1C
  );

  // --- 9. Determine 4-Tier Student-Friendly Readiness Status ---
  let readinessStatus: OperationReadinessStatus = 'ready';
  let readinessNote = 'Все реквизиты и проводки 1С:БП 3.0 заполнены';

  const hasUnverifiedExternalCp =
    needsCounterparty &&
    cpBinding.status !== 'matched_1c' &&
    !(cpInn.length === 10 || cpInn.length === 12);

  if (category === 'hr_hire') {
    readinessStatus = 'ready';
    readinessNote =
      resolvedMonthlySalary && resolvedMonthlySalary >= 0.01
        ? `Кадровый приказ учтён (оклад ${resolvedMonthlySalary.toLocaleString('ru-RU')} ₽/мес.)`
        : 'Кадровый приказ о приёме на работу (без бухгалтерских проводок)';
  } else if (category === 'manual' && entries.length === 0) {
    readinessStatus = 'needs_clarification';
    readinessNote =
      'Операция отнесена к ручным (ОперацияБух) — выберите профильный документ 1С или добавьте проводку Дт/Кт';
  } else if (
    (category === 'payroll_accrual' || category === 'insurance_accrual') &&
    finalOpAmount < 0.01
  ) {
    readinessStatus = 'needs_clarification';
    readinessNote =
      'Укажите штатный ФОТ за месяц в карточке для расчёта зарплаты, НДФЛ (13%) и страховых взносов';
  } else if (needsAmount || amountMode === 'required_missing') {
    readinessStatus = 'critical_error';
    readinessNote = 'Требуется указать сумму первичного документа';
  } else if (needsCounterparty && cpBinding.status === 'missing') {
    readinessStatus = 'critical_error';
    readinessNote =
      category === 'sale_goods' || category === 'sale_services'
        ? 'Не указан покупатель для счёта 62'
        : 'Не указан контрагент для счёта расчётов';
  } else if (entries.length === 0 && category !== 'closing') {
    readinessStatus = 'critical_error';
    readinessNote = 'Не сформированы проводки документа';
  } else if (amountMode === 'calculated_by_1c') {
    readinessStatus = 'calculated_1c';
    readinessNote =
      amountCalculationNote ||
      'Сумма рассчитывается 1С:Бухгалтерия автоматически при проведении документа';
  } else if (
    hasUnverifiedExternalCp ||
    contractBinding.status === 'missing' ||
    warehouseBinding.status === 'missing' ||
    expenseBinding.status === 'missing'
  ) {
    readinessStatus = 'needs_clarification';
    readinessNote = hasUnverifiedExternalCp
      ? 'Рекомендуется уточнить ИНН контрагента или выполнить автозаполнение'
      : 'Рекомендуется нажать «Исправить всё автоматически» для подстановки аналитики 1С';
  }

  const builtOp: QueuedOperation = {
    id: opId,
    rowKey: draft.rowKey,
    createdAt: new Date().toISOString(),
    sourceFileName: draft.sourceFileName,
    date: draft.date,
    docNumber: (draft.docNumber ?? '').trim(),
    incomingDocNumber: draft.incomingDocNumber,
    incomingDocDate: draft.incomingDocDate,
    description: draft.description.trim(),
    category,
    docType1C,
    documentSubKind1C,
    amount: finalOpAmount,
    amountMode: category === 'closing' && finalOpAmount >= 0.01 ? 'from_account_balance' : amountMode,
    readinessStatus: category === 'closing' && finalOpAmount >= 0.01 ? 'ready' : readinessStatus,
    readinessNote:
      category === 'closing' && finalOpAmount >= 0.01
        ? `Готово (${entries.length} регламентных проводок закрытия периода)`
        : readinessNote,
    stockSourceNote,
    calculationProvenance: calculationProvenance || amountCalculationNote,
    needsAmount: needsAmount || undefined,
    amountCalculationNote,
    monthlySalary: resolvedMonthlySalary,
    employeePosition: resolvedEmployeePosition,
    injuryInsuranceRate:
      category === 'payroll_accrual' || category === 'insurance_accrual'
        ? resolvedInjuryRate
        : undefined,
    payrollStaffSummary,
    usefulLifeMonths: resolvedUsefulLifeMonths,
    depreciationBaseAmount: resolvedDeprBaseAmount,
    vatRate,
    vatRule,
    vatAmount,
    quantity: effectiveQty,
    unitPrice: effectiveUnitPrice,
    hasInvoiceSF,
    counterpartyName: cpName,
    counterpartyInn: cpInn,
    counterpartyKpp: cpKpp,
    counterpartyOgrn: cpOgrn || undefined,
    counterpartyBankAccount: cpBankAccount || undefined,
    counterpartyBik: cpBik || undefined,
    counterpartyBankName: cpBankName || undefined,
    counterpartyCorrAccount: cpCorrAccount || undefined,
    counterpartySource: cpSource,
    egrulCandidates: draft.egrulCandidates,
    organizationBik: orgDefaultBik,
    organizationBankName: orgDefaultBankName,
    organizationBankAccount: orgDefaultBankAccount || undefined,
    counterpartyKind:
      matchedCpKind ??
      (category === 'founder_contribution' && !/^\s*(ооо|ао|пао|зао|гуп|муп)(?=$|[^\p{L}])/iu.test(cpName)
        ? 'ФизическоеЛицо'
        : inferCounterpartyKind(cpName, cpInn)),
    contractName,
    contractNumber,
    contractDate,
    nomenclatureName: nomName,
    warehouseName,
    warehouseToName: warehouseToName || undefined,
    expenseItemName,
    cashFlowItemName,
    employeeName,
    nomenclatureGroupName: nomGroup,
    costAccount: [
      'materials_writeoff',
      'workwear_issue',
      'production_output',
      'os_commissioning',
      'depreciation_accrual',
      'hr_hire',
      'payroll_accrual',
      'insurance_accrual',
    ].includes(category)
      ? resolvedCostAccount
      : undefined,
    materialAccount: [
      'purchase_materials',
      'purchase_equipment',
      'materials_writeoff',
      'workwear_issue',
      'os_commissioning',
      'warehouse_transfer',
    ].includes(category)
      ? resolvedMaterialAccount
      : undefined,
    offBalanceAccount: resolvedOffBalanceAccount,
    isDuplicateIn1C: dupCheck.isDuplicate,
    includeInProcessing: !dupCheck.isDuplicate,
    duplicateReason: dupCheck.reason,
    bindings: {
      counterparty: cpBinding,
      contract: contractBinding,
      nomenclature: nomBinding,
      warehouse: warehouseBinding,
      expenseItem: expenseBinding,
      cashFlowItem: cashFlowBinding,
    },
    entries,
  };

  builtOp.mentorGuide1C = buildOperationMentorGuide1C(builtOp, db1C);
  return builtOp;
}

/**
 * Chronologically recalculates dependent operations in the ledger whenever an upstream
 * operation (e.g. ПриемНаРаботу salary, НачислениеЗарплаты ФОТ, OS commissioning СПИ,
 * advance, or receipt) is updated by the user.
 */
export function recalculateOperationsChronologically(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null,
  options?: { reportingYear?: number; defaultBik?: string }
): QueuedOperation[] {
  const manualAndImported = operations.filter((o) => !o.autoGeneratedKind);
  const autoGenerated = operations.filter((o) => Boolean(o.autoGeneratedKind));

  // Process in chronological order while preserving original array positions if desired,
  // or keep stable chronological order by date -> original index:
  const indexed = manualAndImported.map((op, idx) => ({ op, idx }));
  indexed.sort((a, b) => {
    const dA = a.op.date || '9999-12-31';
    const dB = b.op.date || '9999-12-31';
    if (dA !== dB) return dA.localeCompare(dB);
    return a.idx - b.idx;
  });

  const recomputedChrono: QueuedOperation[] = [];
  for (const { op } of indexed) {
    const isDynamicDependent =
      op.amountMode === 'calculated_by_1c' ||
      op.amountMode === 'from_account_balance' ||
      op.amountMode === 'from_related_doc' ||
      op.amountMode === 'from_stock_balance' ||
      op.category === 'closing' ||
      op.category === 'payroll_accrual' ||
      op.category === 'insurance_accrual' ||
      op.category === 'payroll_payout' ||
      op.category === 'tax_payment' ||
      op.category === 'depreciation_accrual' ||
      op.category === 'os_commissioning' ||
      op.category === 'materials_writeoff' ||
      op.category === 'workwear_issue' ||
      op.category === 'sale_goods' ||
      op.category === 'sale_services';

    if (!isDynamicDependent && op.entries.length > 0 && !op.needsAmount) {
      recomputedChrono.push(op);
      continue;
    }

    const keepExplicitAmount =
      op.amountMode === 'explicit'
        ? op.vatRule === 'on_top' && op.vatAmount > 0
          ? round2(op.amount - op.vatAmount)
          : op.amount
        : 0;
    const rebuilt = bindAndGenerateOperation(
      {
        rowKey: op.rowKey,
        sourceFileName: op.sourceFileName,
        date: op.date,
        docNumber: op.docNumber,
        incomingDocNumber: op.incomingDocNumber,
        incomingDocDate: op.incomingDocDate,
        description: op.description,
        amount: keepExplicitAmount,
        monthlySalary:
          op.category === 'hr_hire'
            ? op.monthlySalary
            : op.amountMode === 'explicit'
              ? op.monthlySalary
              : undefined,
        employeePosition: op.employeePosition,
        injuryInsuranceRate: op.injuryInsuranceRate,
        usefulLifeMonths: op.usefulLifeMonths,
        depreciationBaseAmount:
          op.amountMode === 'explicit' ? op.depreciationBaseAmount : undefined,
        vatRate: op.vatRate,
        vatRule: op.vatRule,
        vatAmount: op.amountMode === 'explicit' ? op.vatAmount : undefined,
        quantity: op.quantity,
        unitPrice: op.unitPrice,
        hasInvoiceSF: op.hasInvoiceSF,
        counterpartyName: op.counterpartyName,
        counterpartyInn: op.counterpartyInn,
        counterpartyKpp: op.counterpartyKpp,
        counterpartyOgrn: op.counterpartyOgrn,
        counterpartyBankAccount: op.counterpartyBankAccount,
        counterpartyBik: op.counterpartyBik,
        counterpartyBankName: op.counterpartyBankName,
        counterpartyCorrAccount: op.counterpartyCorrAccount,
        counterpartySource: op.counterpartySource,
        egrulCandidates: op.egrulCandidates,
        organizationBik: op.organizationBik,
        organizationBankName: op.organizationBankName,
        organizationBankAccount: op.organizationBankAccount,
        contractName: op.contractName,
        contractNumber: op.contractNumber,
        contractDate: op.contractDate,
        nomenclatureName: op.nomenclatureName,
        nomenclatureGroupHint: op.nomenclatureGroupName,
        warehouseName: op.warehouseName,
        warehouseToHint: op.warehouseToName,
        expenseItemName: op.expenseItemName,
        cashFlowItemName: op.cashFlowItemName,
        employeeName: op.employeeName,
        costAccountHint: op.costAccount,
        materialAccountHint: op.materialAccount,
        docTypeHint: op.docType1C,
        categoryHint: op.category,
      },
      db1C,
      op.id,
      {
        priorOperations: recomputedChrono,
        reportingYear: options?.reportingYear,
        defaultBik: options?.defaultBik ?? DEFAULT_SBERBANK_BIK,
        defaultBankName: DEFAULT_SBERBANK_NAME,
        assumeInvoiceOnVatPurchase: true,
      }
    );

    recomputedChrono.push({
      ...rebuilt,
      includeInProcessing: op.includeInProcessing,
    });
  }

  return [...recomputedChrono, ...autoGenerated];
}

export function isMisclassifiedLegacyOperation(op: QueuedOperation): boolean {
  // Never overwrite a custom manual ОперацияБух where the user intentionally filled entries
  if (op.category === 'manual' && op.docType1C === 'ОперацияБух' && op.entries.length > 0) {
    return false;
  }
  const natural = detectOperationClassification({
    description: op.description,
    nomenclatureName: op.nomenclatureName,
    counterpartyName: op.counterpartyName,
  });
  if (op.category !== natural.category || op.docType1C !== natural.docType1C) {
    // Reclassify whenever stuck in a wrong docType/category (especially legacy ПоступлениеТоваровУслуг fallbacks)
    if (
      op.docType1C === 'ПоступлениеТоваровУслуг' ||
      [
        'materials_writeoff',
        'workwear_issue',
        'os_commissioning',
        'production_output',
        'warehouse_transfer',
        'cash_bank_internal',
        'accountable_issue',
        'expense_report',
        'accountable_return',
        'loan_received',
        'loan_repaid',
        'sale_goods',
        'sale_services',
        'depreciation_accrual',
        'insurance_accrual',
        'hr_hire',
        'payroll_accrual',
        'payroll_payout',
        'tax_payment',
        'bank_fee',
        'purchase_equipment',
        'founder_contribution',
      ].includes(natural.category)
    ) {
      return true;
    }
  }
  return false;
}

export function rebindOperationsAgainst1CDb(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  const result: QueuedOperation[] = [];
  for (const op of operations) {
    if (op.autoGeneratedKind) {
      result.push({
        ...op,
        mentorGuide1C: op.mentorGuide1C ?? buildOperationMentorGuide1C(op, db1C),
      });
      continue;
    }

    const cleanCpName = op.counterpartyName.trim().length >= 2 ? op.counterpartyName.trim() : '';
    const shouldReclassify =
      isMisclassifiedLegacyOperation(op) ||
      (op.category !== 'founder_contribution' && isFounderContributionText(op.description));

    const rebound = bindAndGenerateOperation(
      {
        rowKey: op.rowKey,
        sourceFileName: op.sourceFileName,
        date: op.date,
        docNumber: op.docNumber,
        incomingDocNumber: op.incomingDocNumber,
        incomingDocDate: op.incomingDocDate,
        description: op.description,
        amount: op.amount,
        monthlySalary: op.monthlySalary,
        employeePosition: op.employeePosition,
        injuryInsuranceRate: op.injuryInsuranceRate,
        usefulLifeMonths: op.usefulLifeMonths,
        depreciationBaseAmount: op.depreciationBaseAmount,
        vatRate: shouldReclassify ? undefined : op.vatRate,
        vatRule: shouldReclassify ? undefined : op.vatRule,
        vatAmount: shouldReclassify ? undefined : op.vatAmount,
        quantity: op.quantity,
        unitPrice: op.unitPrice,
        hasInvoiceSF: shouldReclassify ? undefined : op.hasInvoiceSF,
        counterpartyName: cleanCpName,
        counterpartyInn: cleanCpName ? op.counterpartyInn : '',
        counterpartyKpp: cleanCpName ? op.counterpartyKpp : '',
        counterpartySource: cleanCpName ? op.counterpartySource : undefined,
        contractName: op.contractName,
        contractNumber: op.contractNumber,
        contractDate: op.contractDate,
        nomenclatureName: op.nomenclatureName,
        nomenclatureGroupHint: op.nomenclatureGroupName,
        warehouseName: op.warehouseName,
        warehouseToHint: op.warehouseToName,
        expenseItemName: op.expenseItemName,
        cashFlowItemName: op.cashFlowItemName,
        employeeName: op.employeeName,
        costAccountHint: op.costAccount,
        materialAccountHint: shouldReclassify ? undefined : op.materialAccount,
        docTypeHint: shouldReclassify ? undefined : op.docType1C,
        categoryHint: shouldReclassify ? undefined : op.category,
      },
      db1C,
      op.id,
      { priorOperations: result, assumeInvoiceOnVatPurchase: true }
    );

    const merged: QueuedOperation = {
      ...rebound,
      includeInProcessing: op.includeInProcessing,
      entries:
        !shouldReclassify &&
        op.entries.length > 0 &&
        rebound.amountMode !== 'from_stock_balance' &&
        rebound.category !== 'payroll_accrual' &&
        rebound.category !== 'closing'
          ? op.entries
          : rebound.entries,
    };
    merged.mentorGuide1C = buildOperationMentorGuide1C(merged, db1C);
    result.push(merged);
  }
  return result;
}

/**
 * Cleans up corrupted single-character (`length < 2`) counterparties or legacy misclassified
 * internal operations upon hydrating state from `localStorage`, and ensures mentorGuide1C is populated.
 */
export function sanitizeHydratedOperations(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  const sanitized: QueuedOperation[] = [];
  for (const op of operations) {
    if (op.autoGeneratedKind) {
      sanitized.push({
        ...op,
        readinessStatus: op.readinessStatus ?? 'ready',
        mentorGuide1C: op.mentorGuide1C ?? buildOperationMentorGuide1C(op, db1C),
      });
      continue;
    }

    const rawTrimmed = (op.counterpartyName ?? '').trim();
    const hadCorruptedShortName = rawTrimmed.length > 0 && rawTrimmed.length < 2;
    const isFounderOp = isFounderContributionText(op.description);
    const legacyBrokenPayroll =
      op.docType1C === 'НачислениеЗарплаты' &&
      (op.readinessStatus === 'critical_error' || op.entries.length === 0);
    const shouldRebuild =
      hadCorruptedShortName ||
      isMisclassifiedLegacyOperation(op) ||
      legacyBrokenPayroll ||
      !op.readinessStatus ||
      !op.mentorGuide1C ||
      (isFounderOp && (op.category !== 'founder_contribution' || !rawTrimmed));

    if (shouldRebuild) {
      const resetClass = isMisclassifiedLegacyOperation(op) || isFounderOp;
      const rebuilt = bindAndGenerateOperation(
        {
          rowKey: op.rowKey,
          sourceFileName: op.sourceFileName,
          date: op.date,
          docNumber: op.docNumber,
          incomingDocNumber: op.incomingDocNumber,
          incomingDocDate: op.incomingDocDate,
          description: op.description,
          amount: op.amount,
          monthlySalary: op.monthlySalary,
          employeePosition: op.employeePosition,
          injuryInsuranceRate: op.injuryInsuranceRate,
          usefulLifeMonths: op.usefulLifeMonths,
          depreciationBaseAmount: op.depreciationBaseAmount,
          vatRate: resetClass ? undefined : op.vatRate,
          vatRule: resetClass ? undefined : op.vatRule,
          vatAmount: resetClass ? undefined : op.vatAmount,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          hasInvoiceSF: resetClass ? undefined : op.hasInvoiceSF,
          counterpartyName: hadCorruptedShortName ? '' : rawTrimmed,
          counterpartyInn: hadCorruptedShortName ? '' : op.counterpartyInn,
          counterpartyKpp: hadCorruptedShortName ? '' : op.counterpartyKpp,
          counterpartySource: hadCorruptedShortName ? undefined : op.counterpartySource,
          contractName: resetClass ? '' : op.contractName,
          contractNumber: resetClass ? '' : op.contractNumber,
          contractDate: resetClass ? '' : op.contractDate,
          nomenclatureName: op.nomenclatureName,
          nomenclatureGroupHint: op.nomenclatureGroupName,
          warehouseName: op.warehouseName,
          warehouseToHint: op.warehouseToName,
          expenseItemName: op.expenseItemName,
          cashFlowItemName: resetClass ? '' : op.cashFlowItemName,
          employeeName: op.employeeName,
          costAccountHint: op.costAccount,
          materialAccountHint: resetClass ? undefined : op.materialAccount,
          docTypeHint: resetClass ? undefined : op.docType1C,
          categoryHint: resetClass ? undefined : op.category,
        },
        db1C,
        op.id,
        { priorOperations: sanitized, assumeInvoiceOnVatPurchase: true }
      );
      sanitized.push({
        ...rebuilt,
        includeInProcessing: op.includeInProcessing,
      });
      continue;
    }

    if (rawTrimmed.length >= 2 && db1C && op.bindings.counterparty.status !== 'matched_1c') {
      const matched = matchPersonOrCounterpartyIn1C(rawTrimmed, op.counterpartyInn, db1C);
      if (matched) {
        const updated: QueuedOperation = {
          ...op,
          counterpartyName: matched.name,
          counterpartyInn: matched.inn || op.counterpartyInn,
          counterpartyKpp: matched.kpp || op.counterpartyKpp,
          counterpartyKind: matched.kind,
          bindings: {
            ...op.bindings,
            counterparty: {
              status: 'matched_1c',
              matchedName: matched.name,
              matchedCode1C: matched.code1C,
              matchedInn: matched.inn,
            },
          },
        };
        updated.mentorGuide1C = buildOperationMentorGuide1C(updated, db1C);
        sanitized.push(updated);
        continue;
      }
    }

    sanitized.push(op);
  }
  return sanitized;
}

/**
 * Generates accompanying preparatory & regulatory 1C actions required for clean posting in 1C:BP 3.0:
 * - Organization & counterparty bank accounts (with default Sberbank BIK 044030653 or operation-specific BIK)
 * - Counterparty cards & contracts
 * - Incoming / outgoing VAT invoices (Счет-фактура полученный / выданный)
 * - Advance offsets (60.01/60.02, 62.02/62.01) & Month-End Closing
 */
export function buildAccompanyingActions1C(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null,
  defaultBik = DEFAULT_SBERBANK_BIK,
  defaultBankName = DEFAULT_SBERBANK_NAME
): AccompanyingAction1C[] {
  const actions: AccompanyingAction1C[] = [];
  const activeOps = operations.filter((op) => op.includeInProcessing && !op.isDuplicateIn1C);
  if (activeOps.length === 0) return actions;

  // 1. Organization default bank account if missing in 1C DB and bank operations exist
  const hasBankMovement = activeOps.some((op) =>
    op.entries.some((e) => e.debit === '51' || e.credit === '51')
  );
  const orgBikInDb = (db1C?.organization.bik ?? '').replace(/\D/g, '');
  if (hasBankMovement && (!db1C || !orgBikInDb)) {
    const effBik = activeOps.find((o) => o.organizationBik)?.organizationBik || defaultBik;
    const effBank = activeOps.find((o) => o.organizationBankName)?.organizationBankName || defaultBankName;
    actions.push({
      id: `acc-org-bank-${effBik}`,
      kind: 'create_bank_account',
      title: `Проверить / создать расчётный счёт организации в банке по умолчанию (БИК ${effBik})`,
      details: `${effBank}, БИК ${effBik}${db1C?.organization.bankAccount ? `, р/с ${db1C.organization.bankAccount}` : ''}`,
      bik: effBik,
      bankName: effBank,
      accountNumber: db1C?.organization.bankAccount || undefined,
      docType1C: 'Справочник.БанковскиеСчета',
      menuPath1C: 'Главное → Организации → Банковские счета → Создать (по БИК ' + effBik + ')',
    });
  }

  // 2. Counterparty bank accounts (explicit BIK / r/s from operation or default Sberbank 044030653 for new bank counterparties)
  const seenCpBanks = new Set<string>();
  for (const op of activeOps) {
    if (!op.counterpartyName || op.autoGeneratedKind) continue;
    const usesBank = op.entries.some((e) => e.debit === '51' || e.credit === '51');
    if (!usesBank && !op.counterpartyBankAccount && !op.counterpartyBik) continue;

    const cpMatchedWithBank = db1C?.counterparties.some(
      (c) =>
        normalizeEntityKey(c.name) === normalizeEntityKey(op.counterpartyName) &&
        Boolean(c.bankAccount || c.bik)
    );
    if (cpMatchedWithBank && !op.counterpartyBankAccount && !op.counterpartyBik) continue;

    const effBik = op.counterpartyBik || defaultBik;
    const effBankName =
      op.counterpartyBankName ||
      (effBik === DEFAULT_SBERBANK_BIK ? DEFAULT_SBERBANK_NAME : `Банк БИК ${effBik}`);
    const bankKey = `${normalizeEntityKey(op.counterpartyName)}:${effBik}:${op.counterpartyBankAccount || ''}`;
    if (seenCpBanks.has(bankKey)) continue;
    seenCpBanks.add(bankKey);

    actions.push({
      id: `acc-cp-bank-${op.id}`,
      kind: 'create_bank_account',
      title: `Банковский счёт контрагента «${op.counterpartyName}» (БИК ${effBik})`,
      details: `${effBankName}, БИК ${effBik}${op.counterpartyBankAccount ? `, р/с ${op.counterpartyBankAccount}` : ' (банк по умолчанию из шапки задания)'}`,
      bik: effBik,
      bankName: effBankName,
      accountNumber: op.counterpartyBankAccount,
      counterpartyName: op.counterpartyName,
      docType1C: 'Справочник.БанковскиеСчета',
      menuPath1C: 'Справочники → Контрагенты → Карточка контрагента → Банковские счета',
    });
  }

  // 3. New Counterparty Contracts
  const seenContracts = new Set<string>();
  for (const op of activeOps) {
    if (op.autoGeneratedKind || !op.counterpartyName) continue;
    if (op.bindings.contract.status === 'new_for_1c' || op.bindings.contract.status === 'missing') {
      const ctrTitle = op.contractName || 'Основной договор';
      const ctrKey = `${normalizeEntityKey(op.counterpartyName)}:${ctrTitle.toLowerCase()}`;
      if (seenContracts.has(ctrKey)) continue;
      seenContracts.add(ctrKey);
      actions.push({
        id: `acc-ctr-${op.id}`,
        kind: 'create_contract',
        title: `Создать договор «${ctrTitle}» с «${op.counterpartyName}»`,
        details: `Вид договора: ${['bank_in', 'sale_goods', 'sale_services'].includes(op.category) ? 'С покупателем' : 'С поставщиком'}, валюта RUB`,
        counterpartyName: op.counterpartyName,
        docType1C: 'Справочник.ДоговорыКонтрагентов',
        menuPath1C: 'Справочники → Контрагенты → Договоры → Создать',
      });
    }
  }

  // 4. VAT Invoices (Счет-фактура полученный / выданный)
  for (const op of activeOps) {
    if (
      ['purchase_goods', 'purchase_materials', 'purchase_equipment', 'purchase_services'].includes(
        op.category
      ) &&
      op.vatAmount > 0 &&
      op.hasInvoiceSF
    ) {
      actions.push({
        id: `acc-sf-in-${op.id}`,
        kind: 'register_sf_incoming',
        title: `Зарегистрировать Счёт-фактуру полученный от «${op.counterpartyName || 'поставщика'}»`,
        details: `Вычет НДС Дт 68.02 Кт ${op.category === 'purchase_services' ? '19.04' : op.category === 'purchase_equipment' ? '19.01' : '19.03'} на сумму ${op.vatAmount.toFixed(2)} ₽ (флаг «Отразить вычет НДС в книге покупок датой получения»)`,
        counterpartyName: op.counterpartyName,
        docType1C: 'Документ.СчетФактураПолученный',
        menuPath1C: 'Покупки → Поступление (акты, накладные, УПД) → Зарегистрировать счёт-фактуру',
      });
    } else if (
      (['sale_goods', 'sale_services'].includes(op.category) ||
        (op.category === 'bank_in' && op.entries.some((e) => e.debit === '76.АВ'))) &&
      op.vatAmount > 0
    ) {
      actions.push({
        id: `acc-sf-out-${op.id}`,
        kind: 'register_sf_outgoing',
        title:
          op.category === 'bank_in'
            ? `Выписать Счёт-фактуру на аванс покупателю «${op.counterpartyName || 'покупателю'}»`
            : `Выписать Счёт-фактуру выданный покупателю «${op.counterpartyName || 'покупателю'}»`,
        details:
          op.category === 'bank_in'
            ? `Исчисление НДС с аванса Дт 76.АВ Кт 68.02 на сумму ${op.vatAmount.toFixed(2)} ₽`
            : `Начисление НДС с реализации Дт 90.03 Кт 68.02 на сумму ${op.vatAmount.toFixed(2)} ₽`,
        counterpartyName: op.counterpartyName,
        docType1C: 'Документ.СчетФактураВыданный',
        menuPath1C:
          op.category === 'bank_in'
            ? 'Банк и касса → Счета-фактуры на аванс → Заполнить и выполнить'
            : 'Продажи → Реализация (акты, накладные, УПД) → Выписать счёт-фактуру',
      });
    }
  }

  // 5. Advance offsets & Month-End Closing
  const offsetEntriesCount = activeOps.reduce(
    (sum, op) =>
      sum +
      op.entries.filter(
        (e) =>
          (e.debit === '60.01' && e.credit === '60.02') ||
          (e.debit === '62.02' && e.credit === '62.01')
      ).length,
    0
  );
  if (offsetEntriesCount > 0) {
    actions.push({
      id: 'acc-offset-advances',
      kind: 'offset_advance',
      title: `Автоматический зачёт авансов (${offsetEntriesCount} провод.)`,
      details:
        'В документах поступления/реализации установлен способ зачёта аванса «Автоматически» (счета 60.01↔60.02 и 62.02↔62.01)',
      docType1C: 'ПоступлениеТоваровУслуг / КорректировкаДолга',
      menuPath1C: 'Покупки / Продажи → Зачёт авансов: Автоматически (или Корректировка долга)',
    });
  }

  const hasCostOrFinResult = activeOps.some((op) =>
    op.entries.some(
      (e) =>
        ['20.01', '26', '44.01'].includes(e.debit) ||
        e.credit.startsWith('90.') ||
        e.debit.startsWith('91.')
    )
  );
  if (hasCostOrFinResult) {
    actions.push({
      id: 'acc-month-closing',
      kind: 'month_closing',
      title: 'Регламентное закрытие месяца (счета 20, 26, 44, 90, 91)',
      details:
        'Перепроведение документов в хронологическом порядке, закрытие затратных счетов и определение финансового результата (99.01.1)',
      docType1C: 'Обработка.ЗакрытиеМесяца',
      menuPath1C: 'Операции → Закрытие месяца → Выполнить закрытие месяца',
    });
  }

  return actions;
}


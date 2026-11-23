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
  FounderShareItem1C,
  OperationAmountMode,
  OperationCategory,
  OperationReadinessStatus,
  ParsedFinancialNoteItem1C,
  QueuedOperation,
  Step01CalculationBreakdown1C,
  Virtual1CStateSnapshot,
} from '@/types/accounting';
import { getAccountInfo, isOffBalanceAccountCode, normalizeAccountToLeaf1C } from '@/data/chartOfAccounts';
import {
  DOC_TYPE_TO_DEFAULT_CATEGORY_1C,
  doesSpecAcceptCounterpartySubconto,
  doesSpecAllowZeroPostings,
  getDocumentSpecByCategory,
} from '@/lib/engine/documentSpecs1C';
import {
  cleanNomenclatureName1C,
  ExplicitCorrespondenceHint1C,
  extractCharterCapitalInfo1C,
  extractCounterpartyFromText1C,
  extractEmployeeTaxDeductions1C,
  extractExplicitCorrespondencesFromText1C,
  extractPersonFioFromText1C,
  extractUsefulLifeMonths1C,
  normalizeEmployeeOrFounderName1C,
  normalizeLegalEntityName1C,
} from '@/lib/engine/entityNormalizer1C';
import {
  buildOperationMentorGuide1C,
  doesOperationRequireCounterparty,
} from '@/lib/engine/mentorGuide1C';
import { calculateOsvReport, normalizeSubcontoLabel } from '@/lib/engine/osvCalculator';
import {
  advanceVirtual1CStateWithOperation,
  buildCanonicalCounterpartyRegistry1C,
  buildStep00DirectoryPrepSteps,
  buildVirtual1CStateTimeline,
  CanonicalCounterpartyRecord1C,
  computeMonthlyRpbWriteOff1C,
  createInitialVirtual1CState,
  extractFinancialNotesFromText1C,
  extractRecurringContractTerms1C,
  inferEmployeeCostAccount1C,
  matchTargetActiveFinancialNote1C,
  normalizeCounterpartyKey1C,
  normalizePersonIdentityKey1C,
  resolveActiveWritsOfExecution1C,
  resolveAlimonyPayable7641,
  resolveUnpaidSupplier6001ByKeywords,
  stemsMatch1C,
  extractKeywordStems1C,
  UnpaidSupplierResolution1C,
} from '@/lib/engine/virtual1CState';
import {
  resolveOperationAmountAndLinks,
  synchronizeStep01ResolverTraceWithFinalOp,
} from '@/lib/engine/amountAndLinkResolver';
import {
  inferOrganizationRegionCode,
  selectBestEgrulCandidate,
} from '@/lib/egrul/egrulLookup';

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
  return /поступлен\p{L}*\s+(?:на\s+расч[её]тн\p{L}+\s+сч[её]т\s+|на\s+р\/с\s+)?доли(?=$|[^\p{L}])|оплат\p{L}*\s+доли(?=$|[^\p{L}])|внесени\p{L}*\s+доли(?=$|[^\p{L}])|свою\s+долю\s+в\s+(?:ук(?=$|[^\p{L}])|уставн\p{L}+\s+капитал)\s+внес|в\s+сч[её]т\s+вклада\s+в\s+(?:ук(?=$|[^\p{L}])|уставн\p{L}+\s+капитал)|взнос\p{L}*\s+(?:(?:от\s+)?(?:учредител\p{L}*|участник\p{L}*)\s+.*)?в\s+(?:ук(?=$|[^\p{L}])|уставн\p{L}+\s+капитал)|вклад\p{L}*\s+(?:(?:от\s+)?(?:учредител\p{L}*|участник\p{L}*)\s+.*)?в\s+(?:ук(?=$|[^\p{L}])|уставн\p{L}+\s+капитал)|(?:внесен|внес|поступил|получен|перечислен)\p{L}*.*(?:вклад|взнос|долю)\p{L}*\s+(?:в\s+ук(?=$|[^\p{L}])|(?:от\s+)?(?:учредител|участник))|вклад\p{L}*\s+(?:от\s+)?учредител|взнос\p{L}*\s+(?:от\s+)?учредител/iu.test(
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
  const leadingShare = cleaned.match(
    /^([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)\s+свою\s+долю\s+в\s+(?:ук|уставн)/iu
  );
  if (leadingShare?.[1]) {
    return normalizeEmployeeOrFounderName1C(leadingShare[1]);
  }
  const re =
    /(?:доли(?:\s+в\s+уставн\p{L}+\s+капитал\p{L}*)?(?:\s+учредителя|\s+участника|\s+от)?|(?:взнос\p{L}*|вклад\p{L}*)\s+(?:в\s+уставн\p{L}+\s+капитал\p{L}*\s+)?(?:от\s+)?(?:учредителя\s+|участника\s+)|(?:взнос\p{L}*|вклад\p{L}*)\s+в\s+уставн\p{L}+\s+капитал\p{L}*\s+(?:от\s+)?|(?:от\s+)?(?:учредителя|участника)\s+)([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?))?)/u;
  const m = cleaned.match(re);
  if (m && m[1]) {
    const candidate = m[1]
      .replace(/\s+(?:Сумма|НДС|Без|По|Договор|Счет|Счёт|В|На|в|на).*$/u, '')
      .trim();
    if (candidate.length >= 2) {
      return normalizeEmployeeOrFounderName1C(candidate, { obliqueContext: true });
    }
  }
  const fallbackFio = extractPersonFioFromText1C(text);
  if (fallbackFio) {
    return normalizeEmployeeOrFounderName1C(fallbackFio, { obliqueContext: true });
  }
  return '';
}

export function extractAccountableFioFromDescription(text: string): string {
  const viaPerson = extractPersonFioFromText1C(text);
  if (viaPerson) {
    return normalizeEmployeeOrFounderName1C(viaPerson);
  }
  const cleaned = text.replace(/[«»"'„“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  const patterns = [
    /через\s+([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/u,
    /(?:выдан\p{L}*|перечислен\p{L}*|возвращ\p{L}*|внесен\p{L}*|авансов\p{L}*\s+отч[её]т|отчитал(?:ся|ась))\s+(?:из\s+касс\p{L}*\s+|с\s+р\/с\s+|на\s+карт\p{L}*\s+|подотч[её]т\s+|под\s+отч[её]т\s+|остат\p{L}*\s+подотч[её]тн\p{L}*\s+сумм\s+|сотрудник\p{L}*\s+|работник\p{L}*\s+|каменщик\p{L}*\s+)*([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/u,
    /([А-ЯЁ][а-яё]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)\s+(?:подотч[её]т|под\s+отч[её]т|на\s+хоз|на\s+командиров)/u,
    /(?:подотч[её]т|под\s+отч[её]т)\s+(?:сотрудник\p{L}*\s+|работник\p{L}*\s+)?([А-ЯЁ][а-яё]{2,}(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)))/u,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m && m[1]) {
      return normalizeEmployeeOrFounderName1C(m[1]);
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
  rawExcelAmount?: number;
  orderTotalAmount?: number;
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
  employeeHireStartDate?: string;
  employeeTerminationDate?: string;
  monthlySalary?: number;
  employeeChildCount?: number;
  employeeIsSingleParent?: boolean;
  employeePropertyDeduction?: number;
  founderShares?: FounderShareItem1C[];
  ownOrganization?: {
    name: string;
    inn: string;
    kpp?: string;
  };
  injuryInsuranceRate?: number;
  usefulLifeMonths?: number;
  depreciationBaseAmount?: number;
  isOsModernization?: boolean;
  rpbTermMonths?: number;
  rpbWriteOffMethod?: 'calendar_days' | 'monthly';
  rpbStartDate?: string;
  rpbEndDate?: string;
  rpbSettlementAccount?: '76.09' | '60.01';
  paidImmediatelyVia?: 'bank_51' | 'cash_50' | 'accountable_71';
  alimonyRecipientName?: string;
  alimonyRecipientInn?: string;
  alimonyRatePercent?: number;
  alimonyShareLabel?: string;
  alimonyFixedAmount?: number;
  writStartDate?: string;
  financialNotesSummary?: string;
  financialNotesList?: ParsedFinancialNoteItem1C[];
  disposedFinancialNoteId?: string;
  periodicPaymentAmount?: number;
  interestRatePercent?: number;
  counterpartyKindHint?: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  costAccountHint?: string;
  materialAccountHint?: string;
  directionHint?: 'in' | 'out';
  docTypeHint?: DocType1CBP30;
  categoryHint?: OperationCategory;
  actionSequenceHint?: string;
  explicitDebit?: string;
  explicitCredit?: string;
  explicitCorrespondences?: ExplicitCorrespondenceHint1C[];
  customPostings?: Array<{
    debit: string;
    credit: string;
    amount?: number;
    debitSubconto?: string;
    creditSubconto?: string;
    description?: string;
  }>;
  semanticIntent?: import('@/types/semanticIntent').ParsedOperationIntent;
  studentExplanation?: string;
}

import { calculateEmployeeMonthlySalaryProRata2026 } from './productionCalendar2026';

export function extractCanonicalProjectNomGroup1C(rawText?: string): string | undefined {
  const t = (rawText ?? '').trim();
  if (!t) return undefined;
  const low = t.toLowerCase().replace(/ё/g, 'е');

  if (/реконструкц\p{L}*\s+кровл\p{L}*|ремонт\p{L}*\s+кровл\p{L}*/iu.test(low)) {
    return 'Реконструкция кровли';
  }
  if (/бетонн\p{L}*\s+(?:покрыт|пол)\p{L}*/iu.test(low)) {
    return 'Бетонное покрытие';
  }
  if (/ремонт\p{L}*\s+фасад\p{L}*/iu.test(low)) {
    return 'Ремонт фасада';
  }
  if (/ремонт\p{L}*\s+помещен\p{L}*/iu.test(low)) {
    return 'Ремонт помещений';
  }
  if (/потолочн\p{L}*\s+плит\p{L}*/iu.test(low)) {
    return 'Устройство потолочных плит';
  }
  if (/кирпичн\p{L}*\s+кладк\p{L}*/iu.test(low)) {
    return 'Кирпичная кладка';
  }
  if (/благоустройств\p{L}*(?:\s+территор\p{L}*)?/iu.test(low)) {
    return 'Благоустройство территории';
  }
  if (
    !/отделочн\p{L}*\s+материал/iu.test(low) &&
    /отделк\p{L}*\s+помещен\p{L}*|(?:^|[-—:\s])отделк[аеиуой](?=$|[.,);\s])/iu.test(low)
  ) {
    return 'Отделка помещений';
  }
  if (/панел\p{L}*\s+из\s+пвх\s+и\s+мдф/iu.test(low)) {
    return 'Панели из ПВХ и МДФ';
  }
  const mQuoted = t.match(
    /(?:по\s+объекту|на\s+объекте|объект(?:\s+работ)?)\s*[«"']([^«"'\n]{3,60})[»"']/iu
  );
  if (mQuoted?.[1]) {
    const cleaned = mQuoted[1].trim();
    if (!/^(?:ооо|ао|пао|зао|ип)(?:\s|$)/iu.test(cleaned)) {
      return extractCanonicalProjectNomGroup1C(cleaned) || cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
  return undefined;
}

function extractSurnameRootForProjectMatch1C(empName: string): string {
  return (empName || '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(?:ова|ева|ина|ына|ая|яя|а)$/u, '');
}

function resolveWorkerProjectAssignmentsFromText1C(opText: string): Array<{
  surnameRootPattern: string;
  projectGroup: string;
}> {
  const results: Array<{ surnameRootPattern: string; projectGroup: string }> = [];
  if (!opText) return results;
  // Look inside parentheses or whole text, splitting on sentence dots/semicolons or comma before new surname assignment
  const parentheticalMatches = [...opText.matchAll(/\(([^()]{5,400})\)/g)].map((m) => m[1]);
  const candidateBlocks = parentheticalMatches.length > 0 ? parentheticalMatches : [opText];

  for (const block of candidateBlocks) {
    // Split on '.', ';' or ', <CapitalizedSurname> ... (-|работал)', carrying forward comma-listed surnames that share the next project predicate
    const segments = block.split(
      /[.;]+|,\s*(?=[А-ЯЁ][а-яё]{2,}(?:\s+и\s+[А-ЯЁ][а-яё]{2,}|\s*,\s*[А-ЯЁ][а-яё]{2,})*\s*(?:[-—:]|работал))/u
    );
    let pendingSurnamesPrefix = '';
    for (const seg of segments) {
      const combinedSeg = pendingSurnamesPrefix ? `${pendingSurnamesPrefix}, ${seg}` : seg;
      const proj = extractCanonicalProjectNomGroup1C(combinedSeg);
      if (!proj) {
        if (/[А-ЯЁ][а-яё]{2,}/u.test(seg) && !/[-—:]|работал/iu.test(seg)) {
          pendingSurnamesPrefix = combinedSeg.trim();
        } else {
          pendingSurnamesPrefix = '';
        }
        continue;
      }
      pendingSurnamesPrefix = '';
      const cleanSegLow = combinedSeg.toLowerCase().replace(/ё/g, 'е');
      results.push({ surnameRootPattern: cleanSegLow, projectGroup: proj });
    }
  }
  return results;
}

export interface BatchSequentialContext {
  priorOperations: QueuedOperation[];
  futureOperations?: QueuedOperation[];
  currentOpNumber?: number;
  virtualStateBefore?: Virtual1CStateSnapshot;
  canonicalCounterpartyMap?: Map<string, CanonicalCounterpartyRecord1C>;
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
    'списание',
    'списания',
    'передача',
    'передачи',
    'отпуск',
    'расход',
    'отпущен',
    'производство',
    'производства',
    'работ',
    'работы',
    'материал',
    'материалы',
    'материалов',
    'полученные',
    'полученных',
    'благоустройства',
    'благоустройство',
    'склад',
    'склада',
    'для',
    'при',
    'или',
    'со',
    'на',
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
    /спецодежд|спецоснастк|спецобув|(?:^|[^\p{L}])сиз(?=$|[^\p{L}])|каск\p{L}*|халат|комбинезон|жилет|перчатк\p{L}*\s+рабоч|рабоч\p{L}*\s+(?:одежд|форм|костюм|ботинк|куртк)|форменн\p{L}*\s+одежд/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.10', offBalanceAccount: 'МЦ.02' };
  }
  if (
    /инвентар|хозпринадлежност|хозтовар|инструмент|лопат|дрел|перфоратор|стремянк|швабр|ведро|принтер|оргтехник|офисн\p{L}*\s+мебел|стул|стол(?=$|[^\p{L}])|кресл|шкаф|стеллаж|канцтовар|бумаг/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.09', offBalanceAccount: 'МЦ.04' };
  }
  if (
    /кирпич|цемент|бетон|раствор|арматур|песок|песк|щебен|щебн|гравий|доск|пиломатериал|брус|фанер|гипсокартон|утеплител|минват|шифер|черепиц|штукатурк|шпаклевк|шпатлевк|сух\p{L}*\s+смес|газоблок|пеноблок|шлакоблок|керамзит|грунтовк|краск|эмал|стройматериал|строительн\p{L}*\s+материал|потолочн\p{L}*\s+плит|керамогранит|металлопрофил|обо[ий]|паркет|рейк|плинтус|газонн\p{L}*\s+трав|лак\s+паркетн/iu.test(
      lower
    )
  ) {
    return { materialAccount: '10.08' };
  }
  if (
    /топлив|бензин|дизел|солярк|(?:^|[^\p{L}])гсм(?=$|[^\p{L}])|смазк|автомасл|(?:моторн|машинн|трансмиссионн)\p{L}*\s+масл|керосин|антифриз|тосол/iu.test(
      lower
    )
  ) {
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
    | 'actionSequenceHint'
    | 'directionHint'
    | 'explicitDebit'
    | 'explicitCredit'
    | 'explicitCorrespondences'
    | 'isOsModernization'
    | 'semanticIntent'
  > & { amount?: number },
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

  // 0a. Organizational / Accounting Policy / WIP Note / Tax Deduction Notice / Reporting Instruction (0 postings)
  if (
    /уведомлени\p{L}*.*(?:имущественн\p{L}*|налогов\p{L}*)\s+вычет/iu.test(itemAndDescText) ||
    /(?:утвержден|принят|установлен|издан)\p{L}*.*(?:учетн\p{L}*\s+политик|лимит\s+(?:остатка\s+)?касс|штатн\p{L}*\s+расписан|приказ\s+об\s+учетн)|(?:отрази|отраж[её]н)\p{L}*\s+незавер[шщ][её]нн\p{L}*\s+производств|инвентаризаци\p{L}*\s+нзп/iu.test(
      itemAndDescText
    ) ||
    (/(?:сформировать|сформирован\p{L}*)\s+(?:осв|оборотно-сальдов|бухгалтерск\p{L}*\s+отчетност)|закрыть\s+период/iu.test(
      itemAndDescText
    ) &&
      !/результат\p{L}*\s+за\s+месяц|закрытие\s+(?:месяца|счет)/iu.test(itemAndDescText))
  ) {
    return {
      category: 'policy_event',
      docType1C: 'ОперацияБух',
      documentSubKind1C: /вычет/iu.test(itemAndDescText)
        ? 'Уведомление о праве на имущественный / налоговый вычет НДФЛ (без проводок при подаче)'
        : 'Учётная политика / регламентная памятка (без проводок)',
    };
  }

  // 0b. Standalone Invoice to Customer (СчетПокупателю) / Invoice from Supplier (СчетОтПоставщика) / Framework Contract Signing (0 postings)
  const hasPaymentOrShipmentInSameRow =
    /(?:получен|поступил|зачислен)\p{L}*.*(?:\d+\s*%\s*)?(?:товар|материал|оборудован|деньг|денежн|аванс|предоплат|оплат|доплат)|оплачен|оплатил|произведен\p{L}*\s+оплат|перечислен|списан\p{L}*\s+с\s+р\/с|оказан\p{L}*\s+.*услуг|выполнен\p{L}*\s+.*работ|передан\p{L}*\s+.*работ|(?:^|[^\p{L}])акт(?=$|[^\p{L}])|товарн\p{L}*\s+накладн|торг-12|(?:^|[^\p{L}])упд(?=$|[^\p{L}])/iu.test(
      itemAndDescText
    );
  if (!hasPaymentOrShipmentInSameRow && !/трудовой\s+договор.*оклад/iu.test(itemAndDescText)) {
    if (/(?:выписан|выписал|выставлен)\p{L}*\s+счет(?!-фактур)/iu.test(itemAndDescText)) {
      return {
        category: 'customer_invoice',
        docType1C: 'СчетПокупателю',
        documentSubKind1C: 'Счёт покупателю на оплату (без проводок, регистрация суммы заказа)',
      };
    }
    if (/(?:получен|поступил)\p{L}*\s+счет(?!-фактур)/iu.test(itemAndDescText)) {
      return {
        category: 'supplier_invoice',
        docType1C: 'СчетОтПоставщика',
        documentSubKind1C: 'Счёт от поставщика на оплату (без проводок)',
      };
    }
    if (
      /выдана\s+доверенност/iu.test(itemAndDescText) ||
      /(?:заключен|подписан|пролонгирован)\p{L}*\s+договор/iu.test(itemAndDescText)
    ) {
      return {
        category: 'contract_event',
        docType1C: 'ОперацияБух',
        documentSubKind1C: 'Регистрация договора / доверенности (без проводок)',
      };
    }
  }

  // 0b-off. Unilateral off-balance operations (001–009, МЦ)
  if (
    isOffBalanceAccountCode(draft.explicitDebit ?? '') ||
    isOffBalanceAccountCode(draft.explicitCredit ?? '') ||
    (draft.explicitCorrespondences?.length &&
      draft.explicitCorrespondences.every((c) => c.isOffBalance)) ||
    /(?:принят|получен|оприходован|списан|возвращ)\p{L}*.*(?:на\s+забаланс|забалансов\p{L}*\s+счет|арендованн\p{L}*\s+основн\p{L}*\s+средств|на\s+ответственн\p{L}*\s+хранен|в\s+переработк\p{L}*\s+давальческ)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'off_balance_op',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Односторонняя запись по забалансовому счёту (001–009, МЦ)',
    };
  }

  // 0c. Promissory Notes & Securities: Disposal BEFORE Interest Accrual, plus Bank Settlements on 76.09
  if (
    /(?:передан|индоссирован|предъявлен|погашен|продан|реализован|выбыл)\p{L}*.*(?:перв\p{L}*\s+|втор\p{L}*\s+|трет\p{L}*\s+)?(?:вексел|облигац|ценн\p{L}*\s+бумаг)|в\s+счет\s+(?:оплат\p{L}*|погашен\p{L}*).*вексел/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'financial_disposal',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Выбытие / индоссамент / погашение ценной бумаги (счёт 58.02 через 91)',
    };
  }

  if (
    /начислен\p{L}*.*(?:%%|процент\p{L}*|доход\p{L}*|дисконт).*(?:по\s+)?(?:оставш\p{L}*\s+|приобретенн\p{L}*\s+|процентн\p{L}*\s+)?(?:вексел|облигац|ценн\p{L}*\s+бумаг)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'financial_interest_accrual',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Начисление процентного дохода по ценным бумагам (Дт 76.09 Кт 91.01)',
    };
  }

  if (
    /списан\p{L}*.*денежн\p{L}*\s+средств.*за\s+(?:приобретен\p{L}*\s+)?(?:вексел|ценн\p{L}*\s+бумаг)|(?:оплачен|перечислен)\p{L}*.*за\s+(?:приобретен\p{L}*\s+)?(?:вексел|ценн\p{L}*\s+бумаг)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'bank_out',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Оплата за приобретённые ценные бумаги (Дт 76.09 Кт 51)',
    };
  }

  if (
    !/начислен/iu.test(itemAndDescText) &&
    /(?:получен|поступил|зачислен)\p{L}*.*(?:(?:задолженност\p{L}*\s+по\s+)?(?:%%|процент\p{L}*).*(?:от\s+банк|вексел|ценн\p{L}*\s+бумаг)|от\s+банк\p{L}*.*(?:%%|процент\p{L}*)|задолженност\p{L}*\s+по\s+(?:%%|процент\p{L}*))/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'bank_in',
      docType1C: 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: 'Поступление процентного дохода по ценным бумагам (Дт 51 Кт 76.09)',
    };
  }

  // 0d. Fixed Asset Disposal / Write-off / Sale (счёт 01.09)
  if (
    draft.explicitDebit === '01.09' ||
    draft.explicitCredit === '01.09' ||
    (!/(?:получен|поступил|зачислен)\p{L}*.*(?:оплат|доплат|аванс|денежн)/iu.test(itemAndDescText) &&
      (/(?:списан|ликвидирован|демонтирован|выбыл|продан|реализован)\p{L}*.*(?:вследствие\s+износ|по\s+причине\s+износ|объект\p{L}*\s+ос(?=$|[^\p{L}])|объект\p{L}*\s+основн\p{L}*\s+средств|основн\p{L}*\s+средств\p{L}*|инвентарн\p{L}*\s+объект|со\s+счета\s+01)|(?:списан|ликвидирован)\p{L}*.*(?:станок|бетоносмесител|оборудован).*(?:износ|непригодн|амортиз|ликвидац)|(?:продан|реализован)\p{L}*.*(?:станок|станк|леса\s+строительн|строительн\p{L}*\s+леса|бетоносмесител|экскаватор|погрузчик|минитрактор|плоттер|бытовк)/iu.test(
        itemAndDescText
      )))
  ) {
    return {
      category: 'os_disposal',
      docType1C: /продан|реализован|передач\p{L}*\s+ос/iu.test(itemAndDescText)
        ? 'ПередачаОС'
        : /ликвидирован|вследствие\s+износ|по\s+причине\s+износ/iu.test(itemAndDescText)
          ? 'СписаниеОС'
          : 'ОперацияБух',
      documentSubKind1C: 'Выбытие / списание объекта основных средств (счёт 01.09)',
    };
  }

  // 0e. Standalone VAT Deduction from Account 19 (Дт 68.02 Кт 19.*)
  if (
    (draft.explicitDebit === '68.02' && draft.explicitCredit?.startsWith('19')) ||
    (/(?:принят\p{L}*\s+к\s+вычету|отражен\p{L}*\s+вычет|предъявлен\p{L}*\s+к\s+вычету)\s+(?:входн\p{L}*\s+)?ндс|(?:формирован|сформировать)\p{L}*\s+запис\p{L}*\s+книг\p{L}*\s+покупок/iu.test(
      itemAndDescText
    ) &&
      !/поступил\p{L}*\s+(?:товар|материал|оборудован)|оказан\p{L}*\s+услуг/iu.test(itemAndDescText))
  ) {
    return {
      category: 'vat_deduction',
      docType1C: 'СчетФактураПолученный',
      documentSubKind1C: 'Принятие входного НДС к вычету (Дт 68.02 Кт 19)',
    };
  }

  // 0f. Charter Capital Formation (Дт 75.01 Кт 80.09)
  if (
    draft.explicitCredit === '80.09' ||
    draft.explicitCredit === '80' ||
    (!isFounderContributionText(itemAndDescText) &&
      /(?:объявлен|зарегистрирован|сформирован|начислен|увеличен|отражен\p{L}*\s+формирован)\p{L}*.*уставн\p{L}+\s+капитал|формирован\p{L}*\s+уставн\p{L}+\s+капитал|уставн\p{L}+\s+капитал\s+в\s+размер/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'charter_capital',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Формирование / увеличение уставного капитала организации (Дт 75.01 Кт 80.09)',
    };
  }

  if (
    (draft.explicitDebit?.startsWith('84') && draft.explicitCredit === '75.02') ||
    (/(?:начислен|объявлен)\p{L}*\s+дивиденд|распределен\p{L}*.*прибыл\p{L}*.*дивиденд|направлен\p{L}*.*прибыл\p{L}*.*дивиденд/iu.test(
      itemAndDescText
    ) &&
      !/(?:выплачен|перечислен)\p{L}*\s+дивиденд/iu.test(itemAndDescText))
  ) {
    return {
      category: 'dividends_accrual',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Начисление дивидендов участникам (Дт 84.01 Кт 75.02)',
    };
  }

  if (
    draft.explicitDebit === '75.02' ||
    /(?:выплачен|перечислен|выдан|уплачен)\p{L}*\s+дивиденд/iu.test(itemAndDescText)
  ) {
    return {
      category: 'dividends_payout',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Выплата дивидендов учредителям (Дт 75.02 Кт 51)',
    };
  }

  // 0g. Intangible Assets (НМА: 08.05 -> 04.01, амортизация 05)
  if (
    (draft.explicitDebit === '04.01' && draft.explicitCredit?.startsWith('08')) ||
    /(?:принят\p{L}*\s+к\s+учету|введен\p{L}*\s+в\s+эксплуатац)\p{L}*.*(?:нематериальн\p{L}*\s+актив|(?:^|[^\p{L}])нма(?=$|[^\p{L}])|исключительн\p{L}*\s+прав|патент|товарн\p{L}*\s+знак)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'intangible_commissioning',
      docType1C: 'ПринятиеКУчетуНМА',
      documentSubKind1C: 'Принятие к учёту нематериального актива (Дт 04.01 Кт 08.05)',
    };
  }

  if (
    draft.explicitCredit === '05' ||
    /амортизац\p{L}*.*(?:нематериальн\p{L}*\s+актив|(?:^|[^\p{L}])нма(?=$|[^\p{L}])|исключительн\p{L}*\s+прав|патент|товарн\p{L}*\s+знак)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'intangible_amortization',
      docType1C: 'ЗакрытиеМесяца',
      documentSubKind1C: 'Амортизация НМА (Дт 20/26/44 Кт 05)',
    };
  }

  if (
    draft.explicitDebit === '08.05' ||
    (!/принят\p{L}*\s+к\s+учету|введен\p{L}*\s+в\s+эксплуатац|амортизац|оплачен|перечислен/iu.test(
      itemAndDescText
    ) &&
      /(?:приобретен|получен|поступил)\p{L}*.*(?:нематериальн\p{L}*\s+актив|(?:^|[^\p{L}])нма(?=$|[^\p{L}])|исключительн\p{L}*\s+прав\p{L}*\s+на|патент|товарн\p{L}*\s+знак)/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'intangible_acquisition',
      docType1C: 'ПоступлениеТоваровУслуг',
      documentSubKind1C: 'Поступление нематериального актива (Дт 08.05 Кт 60.01)',
    };
  }

  // 0h. Inventory Surplus / Shortage (счёт 94, ИнвентаризацияТоваров)
  if (
    draft.explicitDebit === '94' ||
    draft.explicitCredit === '94' ||
    /инвентаризац\p{L}*.*(?:выявлен|обнаружен|оприходован|излиш|недостач)|(?:выявлен|обнаружен|оприходован)\p{L}*\s+(?:излиш|недостач)|списан\p{L}*\s+недостач/iu.test(
      itemAndDescText
    )
  ) {
    const isShortage = /недостач|потер\p{L}*\s+от\s+порч/iu.test(itemAndDescText) || draft.explicitDebit === '94' || draft.explicitCredit === '94';
    return {
      category: 'inventory_result',
      docType1C: 'ИнвентаризацияТоваров',
      documentSubKind1C: isShortage
        ? 'Недостача по результатам инвентаризации (счёт 94)'
        : 'Оприходование излишков по инвентаризации (Кт 91.01)',
    };
  }

  // 0i. Acquiring & Payment Cards (счёт 57.03), Special Bank Accounts (счёт 55), Employee Settlements (счёт 73), Deferred Expenses (97), Doubtful Debt Reserve (63)
  if (
    draft.explicitDebit === '57.03' ||
    draft.explicitCredit === '57.03' ||
    /эквайринг|оплат\p{L}*\s+платежн\p{L}*\s+карт|выручк\p{L}*\s+по\s+(?:платежн\p{L}*\s+|банковск\p{L}*\s+)?карт|зачислен\p{L}*.*эквайр/iu.test(
      itemAndDescText
    )
  ) {
    const isBankCredit =
      draft.explicitCredit === '57.03' ||
      /(?:зачислен|поступил)\p{L}*.*(?:на\s+р\/с|на\s+расчетн|выручк.*эквайр|средств.*эквайр|от\s+банк.*эквайр)/iu.test(
        itemAndDescText
      );
    return {
      category: 'acquiring_receipt',
      docType1C: isBankCredit ? 'ПоступлениеНаРасчетныйСчет' : 'ОперацияПоПлатежнойКарте',
      documentSubKind1C: isBankCredit
        ? 'Поступление средств от продаж по платёжным картам (Дт 51 Кт 57.03)'
        : 'Оплата платёжной картой / эквайринг (Дт 57.03)',
    };
  }

  if (
    draft.explicitDebit?.startsWith('55') ||
    draft.explicitCredit?.startsWith('55') ||
    /(?:открыт|пополнен|зачислен|возвращ|закрыт|выставлен)\p{L}*.*(?:аккредитив|депозитн\p{L}*\s+счет|депозит\s+в\s+банк|специальн\p{L}*\s+счет\s+в\s+банк)/iu.test(
      itemAndDescText
    )
  ) {
    const isReturnTo51 =
      draft.explicitCredit?.startsWith('55') &&
      /возврат|возвращ|закрыт.*депозит|неиспользованн.*аккредитив/iu.test(itemAndDescText);
    return {
      category: 'special_bank_55',
      docType1C: isReturnTo51 ? 'ПоступлениеНаРасчетныйСчет' : 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Операция по специальному счёту в банке (счёт 55: аккредитив / депозит)',
    };
  }

  if (
    draft.explicitDebit?.startsWith('73') ||
    draft.explicitCredit?.startsWith('73') ||
    /(?:выдан|предоставлен|погашен|возвращ)\p{L}*\s+за[её]м\s+(?:работник|сотрудник)|удержан\p{L}*.*(?:за\s+недостач|материальн\p{L}*\s+ущерб|займ).*(?:работник|сотрудник|из\s+зарплат)|возмещен\p{L}*\s+материальн\p{L}*\s+ущерб|вручен\p{L}*\s+подарк\p{L}*\s+сотрудник|подарк\p{L}*\s+сотрудник|(?:оказан\p{L}*|выплачен\p{L}*)\s+материальн\p{L}*\s+помощ/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'employee_settlement_73',
      docType1C: /с\s+р\/с|с\s+расчетн|перечислен/iu.test(itemAndDescText)
        ? 'СписаниеСРасчетногоСчета'
        : /из\s+касс|через\s+касс|выдан\p{L}*\s+из\s+касс|наличн/iu.test(itemAndDescText)
          ? 'ВыдачаНаличных'
          : /в\s+касс|внесен\p{L}*\s+в\s+касс/iu.test(itemAndDescText)
            ? 'ПоступлениеНаличных'
            : 'ОперацияБух',
      documentSubKind1C: 'Расчёты с персоналом по прочим операциям (счёт 73.01 / 73.02 / 73.03)',
    };
  }

  if (
    draft.explicitDebit?.startsWith('97') ||
    draft.explicitCredit?.startsWith('97') ||
    draft.explicitCorrespondences?.some((c) => c.debit.startsWith('97') || c.credit.startsWith('97')) ||
    /(?:^|[^\p{L}])д\s*97(?:\.\d+)?\s*к\s*(?:76|60)/iu.test(draft.actionSequenceHint ?? '') ||
    /вступительн\p{L}*\s+взнос.*(?:сро|саморегулируем)|расход\p{L}*\s+будущ\p{L}*\s+период|(?:^|[^\p{L}])рбп(?=$|[^\p{L}])|неисключительн\p{L}*\s+лицензи\p{L}*\s+на\s+срок/iu.test(
      itemAndDescText
    )
  ) {
    const isWriteoff97 =
      draft.explicitCredit?.startsWith('97') ||
      draft.explicitCorrespondences?.some((c) => c.credit.startsWith('97') && !c.debit.startsWith('97')) ||
      /списан\p{L}*.*(?:рбп|расход\p{L}*\s+будущ)/iu.test(itemAndDescText);
    return {
      category: 'deferred_expense_97',
      docType1C: isWriteoff97 ? 'ЗакрытиеМесяца' : 'ПоступлениеТоваровУслуг',
      documentSubKind1C: isWriteoff97
        ? 'Регламентное списание РБП (Дт 20/26/44 Кт 97.21)'
        : 'Отражение расходов будущих периодов (счёт 97.21)',
    };
  }

  if (
    draft.explicitDebit === '63' ||
    draft.explicitCredit === '63' ||
    /резерв\p{L}*\s+по\s+сомнительн\p{L}*\s+долг|за\s+счет\s+резерв\p{L}*\s+по\s+сомнительн/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'reserve_doubtful_63',
      docType1C: 'ОперацияБух',
      documentSubKind1C: 'Формирование / списание резерва по сомнительным долгам (счёт 63)',
    };
  }

  // 1. Month-End Closing (checked BEFORE depreciation_accrual so composite "Начислена амортизация и сформирован результат за месяц" runs full closing)
  if (
    /закрытие\s+месяца|закрытие\s+счетов?\s+(?:20|23|25|26|44|90|91)|реформация\s+баланса|сформирован\p{L}*\s+(?:финансов\p{L}*\s+)?результат\p{L}*\s+за\s+месяц|начислен\p{L}*\s+амортизаци\p{L}*\s+и\s+сформирован\p{L}*\s+результат/iu.test(
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

  // 3. Advance offset (unless penalty/court claim debt adjustment onto 91.02)
  const hintLowerForClass = ((draft as RawDraftOperationInput).actionSequenceHint ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (
    /зачет\s+аванс|корректировка\s+долга/iu.test(itemAndDescText) &&
    !/неуй?стойк|штраф|пен[ия]|судебн|иск\p{L}*|91\.02/iu.test(`${itemAndDescText} ${hintLowerForClass}`)
  ) {
    return {
      category: 'advance_offset',
      docType1C: 'КорректировкаДолга',
      documentSubKind1C: 'Зачёт авансов',
    };
  }

  // 4. Workwear / special tooling / inventory issued to an employee (10.10 / 10.09 -> 20/26 + МЦ.02/МЦ.04)
  const hasSupplierReceiptVerb =
    /(?:^|[^\p{L}])(?:поступил\p{L}*|приобретен\p{L}*|закуплен\p{L}*|купил\p{L}*|оприходован\p{L}*|получен\p{L}*\s+(?!оплат|доплат|аванс|предоплат|денежн|выручк|счет(?!-фактур)|задолженност|кредит|за[её]м|наличн)|оплачен\p{L}*|перечислен\p{L}*)(?=$|[^\p{L}])/iu.test(
      itemAndDescText
    );
  const hasExternalCounterpartyMarker =
    /(?:^|\s)(?:от|у|поставщик\p{L}*|покупател\p{L}*|заказчик\p{L}*)\s+(?:ооо|ао|пао|зао|ип)(?=$|[^\p{L}])|с\s+расчетн\p{L}*\s+счет|на\s+расчетн\p{L}*\s+счет|с\s+р\/с|на\s+р\/с/iu.test(
      fullText
    );

  if (
    !hasSupplierReceiptVerb &&
    (/(?:выда(?:ли|н\p{L}*)|передан\p{L}*\s+в\s+эксплуатац\p{L}*|отпущен\p{L}*\s+в\s+эксплуатац\p{L}*)\s+(?:со\s+склада\s+)?(?:рабоч\p{L}*\s+|защитн\p{L}*\s+)?(?:спецодежд|спецоснастк|спецобув|сиз(?=$|[^\p{L}])|инвентар|хозпринадлежност|инструмент|каск|форм\p{L}*|халат|комбинезон|перчатк|костюм|жилет)/iu.test(
      itemAndDescText
    ) ||
      /(?:выда(?:ли|н\p{L}*)|передан\p{L}*)\s+.*(?:спецодежд|спецоснастк|спецобув|рабоч\p{L}*\s+одежд|форменн\p{L}*\s+одежд|инвентар|хозпринадлежност|каск).*(?:сотрудник|работник|каменщик|сварщик|монтажник|слесар|токар|электрик|мастер|прораб|водител|кладовщик|маляр|штукатур|плотник|грузчик|рабоч|в\s+эксплуатац)/iu.test(
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

  // 5. Fixed Asset Commissioning & Modernization (Ввод в эксплуатацию / Принятие к учёту / Модернизация ОС: 01.01 <- 08.04.1 / 08.03)
  const isModernizationText =
    Boolean(draft.isOsModernization) ||
    (!hasSupplierReceiptVerb &&
      !/кровл/iu.test(itemAndDescText) &&
      /(?:проведен|завершен|выполнен|принят|оформлен)\p{L}*\s+(?:работ\p{L}*\s+по\s+)?(?:модернизац|дооборудован)|(?:^|[^\p{L}])модернизаци\p{L}*\s+(?:объект\p{L}*\s+)?(?:ос(?=$|[^\p{L}])|основн\p{L}*\s+средств|оборудован|станк|бетоносмесител|автомобил|сервер|плоттер)/iu.test(
        itemAndDescText
      ));
  if (
    isModernizationText ||
    (!hasSupplierReceiptVerb &&
      !isFounderContributionText(itemAndDescText) &&
      ((draft.explicitDebit === '01.01' && draft.explicitCredit?.startsWith('08')) ||
        (!/спецодежд|спецоснастк|спецобув|инвентар/iu.test(itemAndDescText) &&
          /введен\p{L}*\s+(?:[^\n,;()]{1,90}\s+)?в\s+эксплуатац|ввод\s+(?:[^\n,;()]{1,90}\s+)?в\s+эксплуатац|принят\p{L}*\s+к\s+учету\s+(?:объект\p{L}*\s+)?(?:ос(?=$|[^\p{L}])|основн\p{L}*\s+средств|оборудован|станок|станк|бетоносмесител|здани|сооружен|автомобил|транспорт|компьютер|сервер|леса|минитрактор|плоттер|бытовк)/iu.test(
            itemAndDescText
          ))))
  ) {
    return {
      category: 'os_commissioning',
      docType1C: 'ПринятиеКУчетуОС',
      documentSubKind1C: isModernizationText
        ? 'Модернизация ОС (увеличение первоначальной стоимости)'
        : 'Принятие к учёту ОС (ввод в эксплуатацию)',
    };
  }

  // 6. Internal Materials Write-off to Production / Site (Расход материалов / Требование-накладная: 20/25/26 <- 10.*)
  if (
    !hasExternalCounterpartyMarker &&
    !hasSupplierReceiptVerb &&
    (/(?:передан|списан|списани|отпущен|израсходован|направлен)\p{L}*\s+.*(?:на\s+объект|в[о]?(?:\s+(?:основн\p{L}*|вспомогательн\p{L}*|обслуживающ\p{L}*|строительн\p{L}*))?\s+производств|на\s+производств|на\s+строительств|для\s+производств|для\s+строительств|для\s+изготовлен|в\s+цех|на\s+участок|на\s+собственн\p{L}*\s+нужд|на\s+хознужд|на\s+ремонт|в\s+переработк)/iu.test(
      itemAndDescText
    ) ||
      /материал\p{L}*\s+передан\p{L}*\s+на\s+объект|требовани[ея]-накладн|расход\s+материалов/iu.test(
        itemAndDescText
      ))
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
    !/(?:возвращ\p{L}*|возврат).*(?:подотчет|под\s+отчет)/iu.test(itemAndDescText) &&
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
  if (draft.explicitCredit === '71.01' && draft.explicitDebit === '50.01') {
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
    !/(?:приобретен|куплен|получен|поступил)\p{L}*.*через\s+подотчетн\p{L}*\s+лиц/iu.test(itemAndDescText) &&
    (draft.explicitCredit === '71.01' ||
      /авансов\p{L}*\s+отчет|отчитал(?:ся|ась)\s+.*за|приобретен\p{L}*\s+подотчетн\p{L}*\s+лиц|израсходован\p{L}*\s+подотчетн/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'expense_report',
      docType1C: 'АвансовыйОтчет',
      documentSubKind1C: 'Авансовый отчёт подотчётного лица',
    };
  }
  if (
    !/(?:приобретен|куплен|получен|поступил)\p{L}*.*через\s+подотчетн\p{L}*\s+лиц/iu.test(itemAndDescText) &&
    (draft.explicitDebit === '71.01' ||
      /подотчет|под\s+отчет|(?:выдан|выдал|перечислен)\p{L}*.*(?:на\s+хоз(?:яйственн\p{L}*)?\s*нужд|на\s+командиров)/iu.test(
        itemAndDescText
      ))
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

  // 9b. HR Hiring / Transfer / Dismissal Order (кадровый учёт без проводок)
  const isDismissalOrderWithoutAccrual =
    (draft.amount ?? 0) < 0.01 &&
    !/компенсац|начислен|выплачен|окончательн\p{L}*\s+расчет/iu.test(itemAndDescText) &&
    /приказ\p{L}*.*увольнен|(?:^|[^\p{L}])уволен[аы]?(?:\s+с\s+работ|\s+по\s+собственн|\s+с\s+\d)/iu.test(
      itemAndDescText
    );
  if (
    isDismissalOrderWithoutAccrual ||
    /принят[аы]?\s+на\s+работу|прием\s+на\s+работу|оформлен[аы]?\s+в\s+штат|трудовой\s+договор.*оклад|переведен\p{L}*\s+на\s+должност|кадров\p{L}*\s+перевод/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'hr_hire',
      docType1C: 'ПриемНаРаботу',
      documentSubKind1C: isDismissalOrderWithoutAccrual
        ? 'Увольнение сотрудника (прекращение начислений)'
        : 'Приём на работу / кадровый перевод (регистрация оклада)',
    };
  }

  // 10. Insurance & Payroll Accruals (including vacation pay, dismissal compensation, sick leave, bonus, material aid)
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
    (/(?:начислен\p{L}*|рассчитан\p{L}*).*(?:заработн|зарплат|оплат\p{L}*\s+труд|з\/п|зп(?=$|[^\p{L}])|отпускн|компенсац\p{L}*.*отпуск|пособи\p{L}*.*нетрудоспособност|больничн|преми\p{L}*|материальн\p{L}*\s+помощ)|расчетная\s+ведомость|начисление\s+зарплат|расчет\p{L}*\s+при\s+увольнен/iu.test(
      itemAndDescText
    ) ||
      Boolean(draft.semanticIntent?.employee?.isSickLeave)) &&
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
    /(?:выплачен\p{L}*|произведен\p{L}*\s+выплат\p{L}*|перечислен\p{L}*|выдан\p{L}*).*(?:заработн\p{L}*\s+плат|зарплат|(?:^|[^\p{L}])з\/?п(?=$|[^\p{L}])|оплат\p{L}*\s+труд)|зарплат\p{L}*\s+по\s+ведомост|(?:выплачен|выплат|перечислен)\p{L}*.*аванс\p{L}*\s+за\s+перв\p{L}*\s+половин/iu.test(
      itemAndDescText
    )
  ) {
    const isCashPayout =
      /из\s+касс|через\s+касс|ведомост\p{L}*\s+в\s+касс|(?:^|[^\p{L}])рко(?=$|[^\p{L}])|наличн/iu.test(
        itemAndDescText
      );
    return {
      category: 'payroll_payout',
      docType1C: isCashPayout ? 'ВыдачаНаличных' : 'СписаниеСРасчетногоСчета',
      documentSubKind1C: isCashPayout
        ? 'Выплата заработной платы по ведомости'
        : 'Перечисление заработной платы',
    };
  }

  // 10c. Loans Issued (58.03), Loan Interest Accrual (66.02/66.04/67.02/67.04), and Loans Received / Repaid (66.03 / 67.03)
  if (
    draft.explicitCredit === '66.02' ||
    draft.explicitCredit === '66.04' ||
    draft.explicitCredit === '67.02' ||
    draft.explicitCredit === '67.04' ||
    /начислен\p{L}*.*(?:%%|процент\p{L}*).*(?:по|за\s+пользовани\p{L}*)\s+(?:выданн\p{L}*\s+|предоставленн\p{L}*\s+|полученн\p{L}*\s+|краткосрочн\p{L}*\s+|долгосрочн\p{L}*\s+|банковск\p{L}*\s+|процентн\p{L}*\s+)?(?:кредит|займ)/iu.test(
      itemAndDescText
    )
  ) {
    const isIssuedInterest =
      /выданн\p{L}*\s+займ|предоставленн\p{L}*\s+займ/iu.test(itemAndDescText) &&
      !/полученн\p{L}*\s+(?:займ|кредит)|пользовани\p{L}*\s+кредит/iu.test(itemAndDescText);
    return {
      category: 'loan_interest_accrual',
      docType1C: 'ОперацияБух',
      documentSubKind1C: isIssuedInterest
        ? 'Начисление процентов по выданному займу (Дт 76.09 Кт 91.01)'
        : 'Начисление процентов по полученному кредиту / займу (Дт 91.02 Кт 66.02)',
    };
  }

  if (
    draft.explicitDebit === '58.03' ||
    /(?:выдан|предоставлен|перечислен)\p{L}*.*(?:процентн\p{L}*\s+|краткосрочн\p{L}*\s+|долгосрочн\p{L}*\s+|денежн\p{L}*\s+)?за[её]м(?:\s+контрагент|\s+организац|\s+заемщик|\s+ооо|\s+ао|\s+пао|\s+зао|\s+ип|\s+под\s+\d)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'loan_issued',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Выдача займа контрагенту (счёт 58.03)',
    };
  }

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
  if (
    /комисси\p{L}*\s+банк|за\s+ведени\p{L}*\s+(?:расчетн\p{L}*\s+|текущ\p{L}*\s+|банковск\p{L}*\s+)?счет|расчетно-кассовое\s+обслуж|услуг\p{L}*\s+банк|банковск\p{L}*\s+обслуживан/iu.test(
      itemAndDescText
    )
  ) {
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

  // 13a. Alimony / Employee Writ Payout (76.41 -> 51)
  if (
    draft.explicitDebit === '76.41' ||
    /(?:перечислен|выплачен|уплачен|списан|погашен)\p{L}*.*(?:алимент|по\s+исполнительн\p{L}*\s+лист\p{L}*\s+(?:работник|сотрудник|в\s+пользу|супруг))/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'alimony_payout',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: 'Перечисление по исполнительному листу работника (счёт 76.41)',
    };
  }

  // 13b. Employee Writ of Execution Registration (Исполнительный лист — удержание алиментов 76.41)
  if (
    draft.explicitCredit === '76.41' ||
    (!/неуй?стойк|штраф|пен[ия]|по\s+дог|иск\p{L}*|судебн|арбитраж|ооо(?=$|[^\p{L}])|ао(?=$|[^\p{L}])|пао(?=$|[^\p{L}])|зао(?=$|[^\p{L}])/iu.test(
      fullText
    ) &&
      /поступил\p{L}*\s+исполнительн\p{L}*\s+лист|исполнительн\p{L}*\s+лист.*(?:алимент|удержан|заработк|доход|в\s+пользу\s+[а-яё]|взыскан\p{L}*\s+с\s+[а-яё])|взыскан\p{L}*\s+алимент/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'writ_of_execution',
      docType1C: 'ИсполнительныйЛист',
      documentSubKind1C: 'Исполнительный лист (удержание алиментов — счёт 76.41)',
    };
  }

  // 13c. Financial Investments / Promissory Notes & Securities (счёт 58.02)
  if (
    draft.explicitDebit?.startsWith('58') ||
    /(?:приобретен|куплен|приобрел|получен|оприходован|поступил)\p{L}*.*(?:вексел|облигац|ценн\p{L}*\s+бумаг|долговы\p{L}*\s+ценн)/iu.test(
      itemAndDescText
    )
  ) {
    return {
      category: 'financial_investment',
      docType1C: 'ФинансовыеВложения',
      documentSubKind1C: 'Приобретение долговых ценных бумаг / векселей (счёт 58.02)',
    };
  }

  // 14. Penalty / Commercial Claim / Court Fine / Tax Sanction (91.02 or 99.02.3)
  if (
    /исполнительн\w*\s+лист|штраф\p{L}*\s+(?:по\s+дог|налогов|фнс|ифнс|сфр|пфр)|налогов\p{L}*\s+санкц|(?:начислен|уплачен|перечислен|взыскан)\p{L}*\s+штраф|неуй?стойк|претензи|судебн\p{L}*\s+(?:взыскан|решени\p{L}*.*иск)/iu.test(
      itemAndDescText
    )
  ) {
    const isBankPenaltyOut =
      draft.directionHint === 'out' ||
      /оплат|оплачен|списан\p{L}*.*(?:р\/с|расчетн)|перечислен/iu.test(itemAndDescText);
    const isDebtAdjustmentPenalty =
      !isBankPenaltyOut &&
      (/корректировк\p{L}*\s+долг/iu.test(`${itemAndDescText} ${hintLowerForClass}`) ||
        (/судебн\p{L}*\s+решени\p{L}*.*по\s+иску|по\s+дог\.?\s*№?\s*\d+/iu.test(itemAndDescText) &&
          !draft.explicitCredit?.startsWith('76')));
    return {
      category: 'penalty_claim',
      docType1C: isBankPenaltyOut
        ? 'СписаниеСРасчетногоСчета'
        : isDebtAdjustmentPenalty
          ? 'КорректировкаДолга'
          : 'ОперацияБух',
      documentSubKind1C: isDebtAdjustmentPenalty
        ? 'Прочие корректировки (начисление штрафных санкций на счёт 60.01 / 91.02)'
        : undefined,
    };
  }

  // 16. Founder Contribution to Charter Capital (75.01)
  if (
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(itemAndDescText)
  ) {
    const isInKindAsset =
      /в\s+виде\s+|бытовк|станок|станк|леса|бетоносмесител|оборудован|основн\p{L}*\s+средств|имуществ|ос(?=$|[^\p{L}])/iu.test(
        itemAndDescText
      ) && !/денежн|наличн|на\s+р\/с|на\s+расчетн/iu.test(itemAndDescText);
    const isCommissionedInKind =
      isInKindAsset &&
      /введен\p{L}*.*в\s+эксплуатац|принят\p{L}*\s+к\s+уч[её]т/iu.test(itemAndDescText);
    const isCash = /(?:^|[^\p{L}])пко(?=$|[^\p{L}])|в кассу|наличн/iu.test(itemAndDescText);
    return {
      category: 'founder_contribution',
      docType1C: isCommissionedInKind
        ? 'ПринятиеКУчетуОС'
        : isInKindAsset
          ? 'ОперацияБух'
          : isCash
            ? 'ПоступлениеНаличных'
            : 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: isInKindAsset
        ? 'Вклад учредителя в УК основным средством / имуществом (Дт 08.04.1 Кт 75.01 → Дт 01.01 Кт 08.04.1)'
        : 'Прочее поступление (вклад в УК — счёт 75.01)',
    };
  }

  // 17. Explicit Bank IN (strictly BEFORE sales so "Получена оплата за оконные блоки от ООО..." or "доплата за отгруженную..." never falls into sale_goods or manual!)
  if (
    draft.directionHint === 'in' ||
    (!/получен\p{L}*\s+счет(?!-фактур)|получен\p{L}*.*(?:кредит|за[её]м)|(?:приобретен|приобрел|получен|поступил|купил)\p{L}*\s+и\s+(?:оплачен|оплатил)/iu.test(
      itemAndDescText
    ) &&
      (/(?:получен|поступил|зачислен)\p{L}*(?:[^\n.;]{0,95}?)(?:оплат\p{L}*|доплат\p{L}*|предоплат\p{L}*|аванс\p{L}*|выручк\p{L}*|денежн\p{L}*\s+средств|задолженност\p{L}*\s+(?:покупател|заказчик|от\s+|по\s+%%|по\s+процент)|остаток\s+(?:оплат|долг|задолженност))/iu.test(
        itemAndDescText
      ) ||
        /поступление\s+на\s+(?:р\/с|расчетн)|(?:оплата|доплата|предоплата|аванс)\s+от\s+(?:покупател|заказчик|ооо|ао|пао|зао|ип)|платежное\s+поручение\s+входящ|выручка\s+на\s+расчетный\s+счет/iu.test(
          itemAndDescText
        )))
  ) {
    return {
      category: 'bank_in',
      docType1C: 'ПоступлениеНаРасчетныйСчет',
      documentSubKind1C: 'Оплата от покупателя',
    };
  }

  // 18. Explicit Bank OUT (unless row is a composite primary receipt/act + payment!)
  const isCompositePurchaseAndPayment =
    /(?:(?:приобретен|приобрел|получен|поступил|купил)\p{L}*\s+и\s+(?:оплачен|оплатил)\p{L}*|на\s+основании\s+[^\n]{0,65}произведен\p{L}*\s+оплат|произведен\p{L}*\s+оплат\p{L}*\s+на\s+основании\s+(?:счета[,\s]+)?(?:акт|накладн)|акт\p{L}*\s+и\s+счет-фактур|(?:приобретен|поступил|получен|оказан)\p{L}*.*оплат\p{L}*\s+(?:поставщику\s+)?произведен|(?:вступительн\p{L}*|членск\p{L}*|целев\p{L}*)?\s*взнос\p{L}*.*(?:саморегулируем|(?:^|[^\p{L}])сро(?=$|[^\p{L}])|союз\s+строител|ассоциац))/iu.test(
      itemAndDescText
    );
  if (
    !isCompositePurchaseAndPayment &&
    (draft.directionHint === 'out' ||
      /возврат\p{L}*\s+(?:части\s+|частичн\p{L}*\s+|неиспользованн\p{L}*\s+)?аванс|произведен\p{L}*\s+(?:частичн\p{L}*\s+)?возврат\s+аванс|(?:перечислен|оплачен|уплачен|списан)\p{L}*\s+(?:с\s+р\/с(?:ч)?\s+|с\s+расчетн\p{L}*\s+счета\s+)?(?:\d+\s*%\s*)?(?:ежемесячн\p{L}*\s+|очередн\p{L}*\s+|окончательн\p{L}*\s+)?(?:платеж|оплат|доплат|аванс|предоплат|задолженност|долг|остаток|сумма|денежн|средств|по\s+счету|по\s+договору|поставщик|подрядчик|исполнител|арендодател|за\s+\p{L}+|полученн\p{L}*\s+(?:материал|товар|услуг|работ))|произведен\p{L}*\s+(?:окончательн\p{L}*\s+)?(?:расчет|оплат\p{L}*|доплат\p{L}*|платеж)|списание\s+с\s+(?:р\/с|расчетн)|платежное\s+поручение\s+исходящ|оплата\s+(?:по\s+счету|счета|поставщику)/iu.test(
        itemAndDescText
      ) ||
      (/^\s*(?:оплачен\p{L}*|оплатил\p{L}*)\s+/iu.test(itemAndDescText) &&
        !/^(?:приобретен|приобрел|купил|получен|поступил|оказан|выполнен)/iu.test(itemAndDescText.trim())))
  ) {
    const isBuyerRefund = /возврат\p{L}*.*аванс/iu.test(itemAndDescText);
    return {
      category: 'bank_out',
      docType1C: 'СписаниеСРасчетногоСчета',
      documentSubKind1C: isBuyerRefund ? 'Возврат оплаты покупателю' : 'Оплата поставщику',
    };
  }

  // 19. Sales / Shipment / Delivery of Finished Goods, Goods, Works, Services (Реализация товаров, продукции, услуг)
  // Guard strictly against supplier material/equipment receipts that contain "Передача материалов в производство работ"!
  if (
    !hasSupplierReceiptVerb &&
    !/от\s+поставщик|поставлен\p{L}*\s+поставщик|переда(?:н|ч)\p{L}*.*(?:в|на)\s+производств\p{L}*\s+работ/iu.test(
      itemAndDescText
    ) &&
    (/(?:^|[^\p{L}])(?:поставлен[аоы]?|отгружен\p{L}*|реализован\p{L}*|прода[нж]\p{L}*)\s+(?:готов\p{L}*\s+|собственн\p{L}*\s+)?(?:продукц|товар|издели|оконн\p{L}*\s+блок|дверн\p{L}*\s+блок|конструкц|парти|покупател|заказчик|клиент|в\s+адрес|ооо|ао|пао|зао|ип|\d)/iu.test(
      itemAndDescText
    ) ||
      /(?:^|[^\p{L}])(?:реализован\p{L}*|отгружен\p{L}*)(?=$|[^\p{L}])|(?:выполнен|сдан|сдал|передан)\p{L}*\s+(?!материал|спецодежд|сырь|инвентар|в\s+производств|на\s+производств)(?:\p{L}+\s+){0,4}работ|выставлен\p{L}*\s+акт|(?:оказан\p{L}*|реализаци\p{L}*)\s+(?:\p{L}+\s+){0,4}услуг\p{L}*\s+(?:заказчик|покупател|клиент|ооо|ао|пао|зао|ип)|акт\s+(?:оказанных\s+услуг|выполненных\s+работ|приемки)|реализация\s+(?:товаров|продукции|услуг|работ)|выручка\s+от\s+реализац/iu.test(
        itemAndDescText
      ))
  ) {
    if (matchedNomKind === 'Товар' || matchedNomKind === 'Продукция') {
      return {
        category: 'sale_goods',
        docType1C: 'РеализацияТоваровУслуг',
        documentSubKind1C:
          matchedNomKind === 'Продукция'
            ? 'Готовая продукция (накладная, УПД)'
            : 'Товары (накладная, УПД)',
      };
    }
    if (
      matchedNomKind === 'Услуга' ||
      /оказан\p{L}*\s+(?:\p{L}+\s+){0,4}услуг|реализация\s+(?:\p{L}+\s+){0,2}услуг|(?:выполнен|сдан|сдал|передан)\p{L}*\s+(?!материал|спецодежд|в\s+производств|на\s+производств)(?:\p{L}+\s+){0,4}работ|выставлен\p{L}*\s+акт|акт\s+(?:выполненных\s+работ|приемки)|аренд/iu.test(
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
      documentSubKind1C: /продукц|издели|оконн\p{L}*\s+блок|дверн\p{L}*\s+блок/iu.test(itemAndDescText)
        ? 'Готовая продукция (накладная, УПД)'
        : 'Товары (накладная, УПД)',
    };
  }

  // 20. Purchases: Equipment & Capex Delivery/Mounting on 08.04.1 -> Goods (41.01) -> Materials (10.*) -> Services (20/26/44)
  const isCapexEquipmentDeliveryOrMounting =
    !(!isCompositePurchaseAndPayment && /оплачен|перечислен|списан\p{L}*\s+с\s+р\/с/iu.test(itemAndDescText)) &&
    (/(?:доставк|монтаж|пусконалад|сборк|установк|подключен|настройк)\p{L}*.*(?:приобретенн\p{L}*\s+|поступивш\p{L}*\s+|купленн\p{L}*\s+)?(?:оборудован|станок|станк|бетоносмесител|бетономешалк|компрессор|генератор|трансформатор|погрузчик|экскаватор|производственн\p{L}*\s+лини|леса\s+строительн|строительн\p{L}*\s+леса|минитрактор|плоттер|бытовк|объект\p{L}*\s+ос(?=$|[^\p{L}]))/iu.test(
      itemAndDescText
    ) ||
      /включен\p{L}*\s+в\s+стоимост\p{L}*\s+(?:ос(?=$|[^\p{L}])|основн\p{L}*\s+средств|оборудован)|поступление\s+доп\.?\s*расход.*(?:ос(?=$|[^\p{L}])|оборудован|бетоносмесител|плоттер|станк)/iu.test(
        itemAndDescText
      ));
  if (
    matchedNomKind === 'Оборудование' ||
    matchedNomKind === 'ОС' ||
    isCapexEquipmentDeliveryOrMounting ||
    (!/услуг\p{L}*.*(?:ремонт|обслуживан|аренд|доставк)|арендн\p{L}*\s+плат|(?:оплат|начислен)\p{L}*.*аренд|доставк/iu.test(
      itemAndDescText
    ) &&
      /(?:поступил|приобретен|приобрел|оприходован|получен|купил|закуплен)\p{L}*.*(?:оборудован|станок|станк|бетоносмесител|бетономешалк|компрессор|генератор|трансформатор|погрузчик|экскаватор|производственн\p{L}*\s+лини|леса\s+строительн|строительн\p{L}*\s+леса|минитрактор|плоттер|вагон-бытовк|бытовк|объект\s+основн\p{L}*\s+средств|объект\s+ос(?=$|[^\p{L}]))/iu.test(
        itemAndDescText
      ))
  ) {
    return {
      category: 'purchase_equipment',
      docType1C: 'ПоступлениеТоваровУслуг',
      documentSubKind1C: isCapexEquipmentDeliveryOrMounting
        ? 'Доп. расходы по приобретению оборудования (счёт 08.04.1)'
        : 'Оборудование (счёт 08.04.1)',
    };
  }

  if (
    matchedNomKind === 'Товар' ||
    /(?:приобретен|приобрел|поступил|закуплен)\p{L}*.*(?:подарк|оконн\p{L}*\s+блок)/iu.test(itemAndDescText)
  ) {
    return { category: 'purchase_goods', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Товары (накладная, УПД)' };
  }
  if (
    matchedNomKind === 'Материал' ||
    /включен\p{L}*\s+в\s+стоимост\p{L}*\s+материал|доставк\p{L}*.*материал.*поступление\s+доп\.?\s*расход/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Материалы (накладная, УПД)' };
  }
  if (
    matchedNomKind === 'Услуга' ||
    /отражен\p{L}*\s+расход\p{L}*\s+на\s+(?:работ|услуг)|аренд|услуг|связ|интернет|телефон|электроэнерг|коммунальн|доставк|транспортн|перевозк|реклам|консультац|обслуживан|нотариус|юридическ|аудиторск|ведени\p{L}*\s+бухгалтерск|озеленен|благоустройств.*(?:выполнен|оказан|акт)|работ\p{L}*.*выполнен\p{L}*.*на\s+основании\s+акт|на\s+основании\s+(?:счета[,\s]+)?акт\p{L}*|охран|уборк|ремонт|(?:вступительн\p{L}*|членск\p{L}*|целев\p{L}*)?\s*взнос\p{L}*.*(?:саморегулируем|(?:^|[^\p{L}])сро(?=$|[^\p{L}])|союз\s+строител|ассоциац)|сертификац|лицензи|подписк/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_services', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Услуги (акт, УПД)' };
  }

  if (
    /материал|сырь[её]|канцтовар|бумаг|топлив|бензин|дизел|солярк|гсм|смазк|автомасл|моторн\p{L}*\s+масл|машинн\p{L}*\s+масл|антифриз|тосол|керосин|запчаст|инвентар|хозтовар|хозпринадлежност|принтер|оргтехник|офисн\p{L}*\s+мебел|стул|стол(?=$|[^\p{L}])|кресл|шкаф|стеллаж|спецодежд|спецоснастк|спецобув|рабоч\p{L}*\s+одежд|форменн\p{L}*\s+одежд|(?:^|[^\p{L}])сиз(?=$|[^\p{L}])|каск|халат|комбинезон|кирпич|цемент|бетон|раствор|арматур|песок|щебен|гравий|доск|пиломатериал|брус|фанер|плит\p{L}*\s+пвх|потолочн\p{L}*\s+плит|керамогранит|металлопрофил|заготовк\p{L}*\s+мдф|стеклопакет|фурнитур|клей|герметик|пен\p{L}*\s+монтажн|гипсокартон|утеплител|минват|шифер|штукатурк|шпаклевк|грунтовк|краск|лак|обо[ий]|паркет|рейк|плинтус|газонн\p{L}*\s+трав|стройматериал|металл|профил|кабел|провод|метиз|крепеж|саморез|электрод/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг', documentSubKind1C: 'Материалы (накладная, УПД)' };
  }

  // Explicit purchase / supplier receipt markers -> purchase_goods
  if (
    /(?:^|[^\p{L}])(?:поступил\p{L}*|приобретен\p{L}*|приобрел\p{L}*|оприходован\p{L}*|закуплен\p{L}*|купил\p{L}*|получен\p{L}*\s+(?:товар|парти|накладн|акт|упд|от\s+(?:поставщик|ооо|ао|пао|зао|ип))|акцептован\p{L}*|принят\p{L}*\s+к\s+(?:учету\s+товар|оплат)|товарн\p{L}*\s+накладн|торг-12|(?:^|[^\p{L}])упд(?=$|[^\p{L}])|от\s+поставщик)/iu.test(
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
  if (draft.docTypeHint && !draft.categoryHint) {
    const natural = detectOperationClassification(draft, matchedNomKind);
    if (natural.docType1C === draft.docTypeHint) {
      return natural;
    }
    return {
      category: DOC_TYPE_TO_DEFAULT_CATEGORY_1C[draft.docTypeHint],
      docType1C: draft.docTypeHint,
    };
  }
  if (draft.categoryHint && !draft.docTypeHint) {
    return {
      category: draft.categoryHint,
      docType1C: getDocumentSpecByCategory(draft.categoryHint).docType,
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
  // Strip trailing destination / purpose clauses so item matching focuses purely on the material/product name
  const cleanedItemText = itemText
    .replace(
      /\s+(?:на\s+объект|в[о]?\s+(?:основн\p{L}*\s+|вспомогательн\p{L}*\s+)?производств|на\s+производств|для\s+производств|на\s+строительств|для\s+благоустройств|в\s+эксплуатац|в\s+цех|покупател|заказчик).*$/iu,
      ''
    )
    .trim();

  // Multi-item comma/semicolon list ("(плита ПВХ 284 шт, заготовка МДФ 284 шт, клей 284 шт)" or "кирпич, строительный раствор")
  const parentheticalList = itemText.match(/\(([^()]*[,;][^()]*)\)/u)?.[1];
  const multiListCandidate = parentheticalList || (/[,;]/.test(cleanedItemText) ? cleanedItemText : '');
  if (multiListCandidate) {
    const parts = multiListCandidate
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2);
    if (parts.length >= 2) {
      let sumAmt = 0;
      let resolvedCount = 0;
      let chosenSubAcc = preferredAccount;
      const partNotes: string[] = [];
      for (const p of parts) {
        const qtyMatch = p.match(/(\d+(?:[.,]\d+)?)\s*(?:шт|ед|кг|тонн|т(?=$|\s|\.)|м2|м3|упак|компл)/iu);
        const partQty = qtyMatch?.[1] ? Number(qtyMatch[1].replace(',', '.')) : undefined;
        const partName = p
          .replace(/(\d+(?:[.,]\d+)?)\s*(?:шт|ед|кг|тонн|т(?=$|\s|\.)|м2|м3|упак|компл)\.?/giu, ' ')
          .trim();
        const subRes = resolveStockBatchCost({
          ...params,
          itemText: partName || p,
          requestedQty: partQty && partQty > 0 ? partQty : undefined,
        });
        if (subRes && subRes.amount > 0.01) {
          sumAmt = round2(sumAmt + subRes.amount);
          chosenSubAcc = subRes.account;
          resolvedCount += 1;
          partNotes.push(`${partName || p}: ${subRes.amount.toFixed(2)} ₽`);
        }
      }
      if (resolvedCount >= 1 && sumAmt > 0.01) {
        return {
          amount: sumAmt,
          account: chosenSubAcc,
          availableQty: resolvedCount,
          sourceNote: `Суммарная себестоимость партий (${partNotes.join(' + ')}) = ${sumAmt.toFixed(2)} ₽`,
        };
      }
    }
  }

  const stem = stemRuItemKey(cleanedItemText || itemText);
  const stemTokens = stem
    ? stem
        .split(' ')
        .filter((t) => t.length >= 3 && !/^(материал|товар|сырь|объект|склад|производств)/iu.test(t))
    : [];

  const matchesItem = (candidateText: string): boolean => {
    if (stemTokens.length === 0) return true;
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

  // Fallback for workwear (10.10) when recipient names or synonyms ("рабочая одежда" vs "спецодежда") prevented token match
  if ((!chosen || chosen.netAmt <= 0.01) && preferredAccount === '10.10' && stemTokens.length > 0) {
    let fallbackNetAmt = 0;
    let fallbackNetQty = 0;
    for (const pOp of priorOperations) {
      if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
      if (opDate && pOp.date && pOp.date > opDate) continue;
      for (const e of pOp.entries) {
        if (e.isOffBalance) continue;
        if (e.debit === '10.10') {
          fallbackNetAmt = round2(fallbackNetAmt + e.amount);
          fallbackNetQty = round2(fallbackNetQty + (pOp.quantity ?? 0));
        }
        if (e.credit === '10.10') {
          fallbackNetAmt = round2(fallbackNetAmt - e.amount);
          fallbackNetQty = round2(fallbackNetQty - (pOp.quantity ?? 0));
        }
      }
    }
    if (fallbackNetAmt > 0.01) {
      chosenAcc = '10.10';
      chosen = { netAmt: fallbackNetAmt, netQty: Math.max(0, fallbackNetQty) };
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
  let nomName = cleanNomenclatureName1C((draft.nomenclatureName ?? '').trim(), draft.description);
  let warehouseName = (draft.warehouseName ?? '').trim();
  const warehouseToName = (draft.warehouseToHint ?? '').trim();
  let expenseItemName = (draft.expenseItemName ?? '').trim();
  let cashFlowItemName = (draft.cashFlowItemName ?? '').trim();
  let employeeName = normalizeEmployeeOrFounderName1C((draft.employeeName ?? '').trim());

  const parsedDeductionHints = extractEmployeeTaxDeductions1C(draft.description);
  const resolvedEmployeeChildCount =
    draft.employeeChildCount ?? parsedDeductionHints.childCount;
  const resolvedEmployeeIsSingleParent =
    draft.employeeIsSingleParent ?? parsedDeductionHints.isSingleParent;
  const resolvedEmployeePropertyDeduction =
    draft.employeePropertyDeduction ?? parsedDeductionHints.propertyTaxDeduction;

  let resolvedAlimonyRecipientName = (draft.alimonyRecipientName ?? '').trim();
  let resolvedAlimonyRecipientInn = (draft.alimonyRecipientInn ?? '').replace(/\D/g, '');
  let resolvedAlimonyRatePercent = draft.alimonyRatePercent;
  let resolvedAlimonyShareLabel = draft.alimonyShareLabel;
  let resolvedFinancialNotesSummary = (draft.financialNotesSummary ?? '').trim();

  const descNormForLookup = normalizeEntityKey(draft.description);
  const preClassification = detectCategoryAndDocType(draft);

  const charterExtracted =
    preClassification.category === 'charter_capital'
      ? extractCharterCapitalInfo1C(
          draft.description,
          draft.rawExcelAmount ?? Math.abs(draft.amount)
        )
      : null;
  const resolvedFounderShares: FounderShareItem1C[] | undefined =
    draft.founderShares && draft.founderShares.length > 0
      ? draft.founderShares
      : charterExtracted && charterExtracted.founders.length > 0
        ? charterExtracted.founders.map((f) => ({
            founderName: f.founderName,
            sharePercent: f.sharePercent,
            amount: f.amount ?? 0,
          }))
        : undefined;
  const resolvedOwnOrganization =
    draft.ownOrganization ?? charterExtracted?.ownOrganization;

  // On charter_capital, never store own organization ("ООО «Завод»") as external counterparty!
  if (preClassification.category === 'charter_capital') {
    const ownOrgInn =
      resolvedOwnOrganization?.inn ||
      db1C?.organization.inn ||
      batchContext?.virtualStateBefore?.ownOrganization?.inn ||
      '';
    const ownOrgName =
      resolvedOwnOrganization?.name ||
      db1C?.organization.name ||
      batchContext?.virtualStateBefore?.ownOrganization?.name ||
      '';
    if (
      (cpInn && ownOrgInn && cpInn === ownOrgInn.replace(/\D/g, '')) ||
      (cpName &&
        ownOrgName &&
        normalizeCounterpartyKey1C(cpName) === normalizeCounterpartyKey1C(ownOrgName)) ||
      /^\s*(?:ооо|ао|пао|зао)(?=$|[^\p{L}])/iu.test(cpName)
    ) {
      cpName = '';
      cpInn = '';
      cpKpp = '';
      cpOgrn = '';
      cpSource = 'unresolved';
    }
    if (!cpName && resolvedFounderShares && resolvedFounderShares.length === 1) {
      cpName = resolvedFounderShares[0].founderName;
    }
  }

  // Preserve recipient INN / hint before clearing commercial counterparty on employee alimony ops
  if (
    preClassification.category === 'writ_of_execution' ||
    preClassification.category === 'alimony_payout'
  ) {
    if (!resolvedAlimonyRecipientInn && cpInn) {
      resolvedAlimonyRecipientInn = cpInn;
    }
    if (!resolvedAlimonyRecipientName && cpName && preClassification.category === 'alimony_payout') {
      resolvedAlimonyRecipientName = cpName;
    }
  }

  const hasManualSettlementAccounts =
    preClassification.category === 'manual' &&
    Boolean(
      draft.explicitDebit?.match(/^(?:58|60|62|63|66|67|75|76)/) ||
        draft.explicitCredit?.match(/^(?:58|60|62|63|66|67|75|76)/) ||
        draft.explicitCorrespondences?.some(
          (c) =>
            /^(?:58|60|62|63|66|67|75|76)/.test(c.debit) ||
            /^(?:58|60|62|63|66|67|75|76)/.test(c.credit)
        )
    );

  const isStrictlyInternalNoCpOp =
    !doesSpecAcceptCounterpartySubconto(preClassification.category) && !hasManualSettlementAccounts;

  // For strictly internal or employee alimony/accountable operations, never pollute commercial counterparty
  if (isStrictlyInternalNoCpOp) {
    if (
      !employeeName &&
      cpName &&
      [
        'workwear_issue',
        'os_commissioning',
        'payroll_accrual',
        'hr_hire',
        'policy_event',
        'writ_of_execution',
        'accountable_issue',
        'expense_report',
        'accountable_return',
        'employee_settlement_73',
      ].includes(preClassification.category)
    ) {
      employeeName = normalizeEmployeeOrFounderName1C(cpName);
    }
    cpName = '';
    cpInn = '';
    cpKpp = '';
    cpOgrn = '';
    contractName = '';
    contractNumber = '';
    contractDate = '';
  }

  const involvesAccountableViaPurchase =
    (preClassification.category === 'purchase_materials' ||
      preClassification.category === 'purchase_equipment' ||
      preClassification.category === 'purchase_services') &&
    (/через\s+[А-ЯЁа-яё]/iu.test(draft.description) ||
      /авансов\p{L}*\s+отчет/iu.test(draft.actionSequenceHint ?? ''));

  if (
    !employeeName &&
    ([
      'accountable_issue',
      'expense_report',
      'accountable_return',
      'employee_settlement_73',
      'workwear_issue',
      'hr_hire',
      'policy_event',
    ].includes(preClassification.category) ||
      involvesAccountableViaPurchase)
  ) {
    const extractedAccFio = extractAccountableFioFromDescription(draft.description);
    if (extractedAccFio) {
      employeeName = normalizeEmployeeOrFounderName1C(extractedAccFio);
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
      'employee_settlement_73',
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
    preClassification.category === 'founder_contribution' ||
    preClassification.category === 'charter_capital' ||
    preClassification.category === 'dividends_accrual' ||
    preClassification.category === 'dividends_payout' ||
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75.02' ||
    draft.explicitDebit === '75.01' ||
    draft.explicitDebit === '75.02' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(draft.description);

  if (preClassification.category === 'founder_contribution' && cpName) {
    const isLeadingNominativeShare = /^\s*[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?\s+свою\s+долю/iu.test(
      draft.description
    );
    cpName = normalizeEmployeeOrFounderName1C(cpName, {
      obliqueContext: !isLeadingNominativeShare,
    });
  }

  // Extract founder FIO for charter capital share contributions / dividends (excluding multi-founder charter_capital)
  if (
    !isStrictlyInternalNoCpOp &&
    !cpName &&
    founderShareOp &&
    !(preClassification.category === 'charter_capital' && (resolvedFounderShares?.length ?? 0) > 1)
  ) {
    const extractedFounderFio = extractFounderFioFromDescription(draft.description);
    if (extractedFounderFio) {
      const matchedFounder1C = matchPersonOrCounterpartyIn1C(extractedFounderFio, cpInn, db1C);
      if (matchedFounder1C) {
        cpName = matchedFounder1C.name;
        cpInn = matchedFounder1C.inn || cpInn;
        cpKpp = matchedFounder1C.kpp || cpKpp;
        cpSource = 'db_1c';
      } else {
        cpName = normalizeEmployeeOrFounderName1C(extractedFounderFio, { obliqueContext: true });
      }
    } else if (employeeName) {
      cpName = normalizeEmployeeOrFounderName1C(employeeName);
    } else if (db1C) {
      const mentionedPerson = findPersonMentionedInDescription1C(draft.description, db1C);
      if (mentionedPerson) {
        cpName = mentionedPerson.name;
        cpInn = mentionedPerson.inn || cpInn;
        cpSource = 'db_1c';
      }
    }
  }

  // Match founder name against prior 75.01 charter capital declarations (so "Сидорова С.С." -> "Сидоров С.С." with 100% subconto unity)
  if (
    preClassification.category === 'founder_contribution' &&
    cpName &&
    batchContext?.priorOperations
  ) {
    const targetFounderKey = normalizePersonIdentityKey1C(cpName);
    for (const prevCharter of batchContext.priorOperations) {
      if (prevCharter.category !== 'charter_capital') continue;
      const candidateNames = [
        ...(prevCharter.founderShares?.map((fs) => fs.founderName) ?? []),
        ...prevCharter.entries.filter((e) => e.debit === '75.01').map((e) => e.debitSubconto),
      ].filter(Boolean);
      const matchedName = candidateNames.find(
        (n) => normalizePersonIdentityKey1C(n) === targetFounderKey
      );
      if (matchedName) {
        cpName = matchedName;
        break;
      }
    }
  }

  // Normalize legal entity quotes & typography
  if (cpName && !founderShareOp && inferCounterpartyKind(cpName, cpInn) !== 'ФизическоеЛицо') {
    cpName = normalizeLegalEntityName1C(cpName) || cpName;
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

  // --- 1. Bind Counterparty / Individual strictly with Priority (1: Excel explicit / Canonical Registry -> 2: 1C DB -> 3: EGRUL -> 4: New/Educational) ---
  let cpBinding: EntityBindingStatus = { status: 'not_required' };
  let matchedCpIdName = '';
  let matchedCpKind: DirectoryAutocompleteOption1C['kind'] | undefined;

  if (cpName && batchContext?.canonicalCounterpartyMap) {
    const canonRec = batchContext.canonicalCounterpartyMap.get(normalizeCounterpartyKey1C(cpName));
    if (canonRec) {
      cpName = canonRec.canonicalName || cpName;
      if (canonRec.inn) {
        cpInn = canonRec.inn;
        cpKpp = canonRec.kpp || cpKpp;
        cpSource = canonRec.source;
      }
    }
  }

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
        const homeRegion = inferOrganizationRegionCode({
          organizationInn: db1C?.organization.inn,
          organizationBik: orgDefaultBik,
        });
        const best =
          selectBestEgrulCandidate(draft.egrulCandidates, {
            targetName: cpName,
            homeRegionCode: homeRegion,
          }) ?? draft.egrulCandidates[0];
        cpInn = best.inn;
        cpKpp = cpKpp || best.kpp;
        cpOgrn = cpOgrn || best.ogrn;
        cpSource = 'egrul_verified';
      } else if (!cpInn && cpName && batchContext?.priorOperations?.length) {
        const normTargetCp = normalizeCounterpartyKey1C(cpName);
        for (let i = batchContext.priorOperations.length - 1; i >= 0; i--) {
          const prior = batchContext.priorOperations[i];
          if (
            normalizeCounterpartyKey1C(prior.counterpartyName) === normTargetCp &&
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
    nomName = cleanNomenclatureName1C(nomName, draft.description);
  }
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

    // 1A) Strictly prefer prior buyer operations / invoices / contracts sharing subject stems FIRST
    for (let i = priorCandidateOps.length - 1; i >= 0; i--) {
      const p = priorCandidateOps[i];
      if (!p.includeInProcessing || !p.counterpartyName.trim()) continue;
      if (draft.date && p.date && p.date > draft.date) continue;
      const isBuyerOp =
        p.category === 'customer_invoice' ||
        p.category === 'contract_event' ||
        p.category === 'bank_in' ||
        p.category === 'sale_goods' ||
        p.category === 'sale_services' ||
        p.entries.some((e) => e.credit === '62.02' || e.debit === '62.01');
      if (!isBuyerOp) continue;

      const pStem = stemRuItemKey(`${p.nomenclatureName} ${p.description}`);
      const sharesProduct =
        saleTokens.length > 0 && saleTokens.some((tok) => pStem.includes(tok));

      if (sharesProduct) {
        inferredBuyer = {
          name: p.counterpartyName,
          inn: p.counterpartyInn,
          kpp: p.counterpartyKpp,
          contractName: p.contractName,
          source: p.counterpartySource ?? 'unresolved',
        };
        break;
      }
    }

    // 1B) Fallback to an open advance (62.02) ONLY if no stem match was found AND no contradictory subject tokens exist
    if (!inferredBuyer && saleTokens.length === 0) {
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

        const hasOpenAdvance =
          computeCounterpartyAdvanceBalance(
            '62.02',
            p.counterpartyName,
            p.counterpartyInn,
            db1C,
            priorCandidateOps
          ) > 0.01;
        if (hasOpenAdvance) {
          inferredBuyer = {
            name: p.counterpartyName,
            inn: p.counterpartyInn,
            kpp: p.counterpartyKpp,
            contractName: p.contractName,
            source: p.counterpartySource ?? 'unresolved',
          };
          break;
        }
      }
    }

    // Only pick a general prior buyer without open advance or stem match if there is a SINGLE unique buyer in priorOps
    if (!inferredBuyer) {
      const uniquePriorBuyerOps = new Map<string, QueuedOperation>();
      for (const p of priorCandidateOps) {
        if (!p.includeInProcessing || !p.counterpartyName.trim()) continue;
        if (draft.date && p.date && p.date > draft.date) continue;
        const isBuyerOp =
          p.category === 'customer_invoice' ||
          p.category === 'bank_in' ||
          p.category === 'sale_goods' ||
          p.category === 'sale_services' ||
          p.entries.some((e) => e.credit === '62.02' || e.debit === '62.01');
        if (!isBuyerOp) continue;
        uniquePriorBuyerOps.set(normalizeEntityKey(p.counterpartyName), p);
      }
      if (uniquePriorBuyerOps.size === 1) {
        const single = Array.from(uniquePriorBuyerOps.values())[0];
        inferredBuyer = {
          name: single.counterpartyName,
          inn: single.counterpartyInn,
          kpp: single.counterpartyKpp,
          contractName: single.contractName,
          source: single.counterpartySource ?? 'unresolved',
        };
      }
    }

    // 2) Fallback: search 1C DB 62.02 balances or buyer contracts ONLY when unambiguous (size === 1)
    if (!inferredBuyer && db1C) {
      const bal6202List = db1C.rawBalances.filter(
        (b) => b.account === '62.02' && b.subconto && (b.rawCredit > 0.01 || b.startCredit > 0.01)
      );
      if (bal6202List.length === 1 && bal6202List[0]?.subconto) {
        const subName = bal6202List[0].subconto.split('/')[0].trim();
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
        const buyerContracts = db1C.contracts.filter(
          (c) => /покупател/iu.test(c.contractKind ?? '') && c.counterpartyName.trim().length >= 2
        );
        const uniqueBuyerNames = new Set(
          buyerContracts.map((c) => normalizeEntityKey(c.counterpartyName))
        );
        if (uniqueBuyerNames.size === 1 && buyerContracts[0]?.counterpartyName) {
          const buyerContract = buyerContracts[0];
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
          note: 'Покупатель определён автоматически по связанному счёту / авансу / договору 1С',
        };
      } else {
        cpBinding = {
          status: 'new_for_1c',
          note: 'Покупатель определён автоматически по связанному счёту / авансу (счёт 62)',
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
    'customer_invoice',
    'supplier_invoice',
    'purchase_goods',
    'purchase_materials',
    'purchase_equipment',
    'purchase_services',
    'intangible_acquisition',
    'sale_goods',
    'sale_services',
    'advance_offset',
  ].includes(category);

  let contractBinding: EntityBindingStatus = { status: 'not_required' };
  if (needsContract) {
    const expectedKind =
      category === 'bank_in' ||
      category === 'customer_invoice' ||
      category === 'sale_goods' ||
      category === 'sale_services'
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
      } else if (
        expectedKind === 'СПоставщиком' &&
        /^основной\s+договор\s+с\s+покупателем$/iu.test(contractName)
      ) {
        contractName = 'Основной договор';
      } else if (
        expectedKind === 'СПокупателем' &&
        /^основной\s+договор\s+с\s+поставщиком$/iu.test(contractName)
      ) {
        contractName = 'Основной договор';
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
  const isCapexServiceExpense =
    category === 'purchase_equipment' &&
    /(?:доставк|транспорт|перевозк|монтаж|пусконалад|сборк|установк|подключен|настройк|доп\.?\s*расход|включен\p{L}*\s+в\s+стоимост)/iu.test(
      draft.description
    );

  const internalDefaultWarehouseCategories: OperationCategory[] = [
    'materials_writeoff',
    'workwear_issue',
    'os_commissioning',
    'production_output',
    'warehouse_transfer',
    ...(isCapexServiceExpense ? (['purchase_equipment'] as OperationCategory[]) : []),
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
    'intangible_amortization',
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
      } else if (category === 'depreciation_accrual' || category === 'intangible_amortization') {
        expenseItemName = 'Амортизация';
        expenseBinding = { status: db1C ? 'new_for_1c' : 'not_required', note: 'Типовая статья затрат (ФСБУ 6/2020 и 14/2022)' };
      } else {
        expenseBinding = { status: 'missing', note: 'Не указана статья затрат' };
      }
    }
  }

  const needsCashFlow = [
    'bank_out',
    'bank_in',
    'founder_contribution',
    'dividends_payout',
    'tax_payment',
    'bank_fee',
    'payroll_payout',
    'alimony_payout',
    'cash_in',
    'cash_out',
    'cash_bank_internal',
    'accountable_issue',
    'accountable_return',
    'loan_received',
    'loan_repaid',
    'loan_issued',
    'acquiring_receipt',
    'special_bank_55',
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
          : category === 'dividends_payout'
            ? /дивиденд/iu
            : category === 'accountable_issue' || category === 'accountable_return'
              ? /подотчет/iu
              : category === 'loan_received' || category === 'loan_repaid' || category === 'loan_issued'
                ? /кредит|за[её]м/iu
                : category === 'bank_in' || category === 'cash_in' || category === 'acquiring_receipt'
                  ? /поступление от продажи|оплата от покупател|розничн/i
                  : category === 'tax_payment'
                    ? /налог|бюджет/i
                    : category === 'payroll_payout' || category === 'alimony_payout'
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
                      : category === 'loan_issued'
                        ? 'Предоставление займов контрагентам'
                        : category === 'bank_in' || category === 'cash_in'
                          ? 'Поступление от продажи продукции и товаров, выполнения работ, оказания услуг'
                          : category === 'tax_payment'
                            ? 'Прочие налоги и сборы'
                            : category === 'payroll_payout' || category === 'alimony_payout'
                              ? 'Оплата труда'
                              : 'Оплата товаров, работ, услуг, сырья и иных оборотных активов';
        cashFlowBinding = {
          status: db1C ? 'new_for_1c' : 'not_required',
          note: 'Типовая статья ДДС 1С БП 3.0',
        };
      }
    }
  }

  // --- 6. Automatic Calculation of Amount + VAT + Virtual 1C State Context ---
  const descLower = draft.description.toLowerCase();
  const priorOps = batchContext?.priorOperations ?? [];
  const priorVirtualState: Virtual1CStateSnapshot =
    batchContext?.virtualStateBefore ??
    (() => {
      let st = createInitialVirtual1CState(db1C);
      priorOps.forEach((pOp, idx) => {
        if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) return;
        if (draft.date && pOp.date && pOp.date > draft.date) return;
        st = advanceVirtual1CStateWithOperation(st, pOp, idx + 1);
      });
      return st;
    })();
  const resolvedRawExcelAmount =
    draft.rawExcelAmount !== undefined && draft.rawExcelAmount >= 0.01 && draft.rawExcelAmount < 500_000_000
      ? round2(draft.rawExcelAmount)
      : Math.abs(draft.amount) >= 0.01 && Math.abs(draft.amount) < 500_000_000
        ? round2(Math.abs(draft.amount))
        : undefined;

  const isNonPostingEventCategory =
    category === 'hr_hire' ||
    category === 'writ_of_execution' ||
    category === 'contract_event' ||
    category === 'policy_event';

  const hadExplicitInputAmount = isNonPostingEventCategory
    ? false
    : Math.abs(draft.amount) >= 0.01 ||
      ((category === 'customer_invoice' || category === 'supplier_invoice') &&
        Boolean(resolvedRawExcelAmount));
  let effectiveDraftAmount = isNonPostingEventCategory
    ? 0
    : category === 'customer_invoice' || category === 'supplier_invoice'
      ? round2(Math.abs(draft.amount || resolvedRawExcelAmount || 0))
      : round2(Math.abs(draft.amount));
  let resolvedMonthlySalary =
    category === 'hr_hire'
      ? round2(Math.abs(draft.monthlySalary || resolvedRawExcelAmount || draft.amount || 0))
      : draft.monthlySalary && draft.monthlySalary > 0
        ? round2(draft.monthlySalary)
        : undefined;
  if (
    category === 'hr_hire' &&
    (!resolvedMonthlySalary || resolvedMonthlySalary < 0.01) &&
    employeeName &&
    priorVirtualState.employees
  ) {
    const empKey = normalizePersonIdentityKey1C(employeeName);
    const existingEmp = priorVirtualState.employees.find(
      (e) => normalizePersonIdentityKey1C(e.fullName) === empKey && e.monthlySalary > 0
    );
    if (existingEmp) {
      resolvedMonthlySalary = round2(existingEmp.monthlySalary);
    }
  }
  let resolvedPeriodicPaymentAmount =
    draft.periodicPaymentAmount && draft.periodicPaymentAmount > 0
      ? round2(draft.periodicPaymentAmount)
      : undefined;
  let resolvedInterestRatePercent =
    draft.interestRatePercent !== undefined && draft.interestRatePercent >= 0
      ? draft.interestRatePercent
      : undefined;
  const cleanedDraftNotes = draft.financialNotesList?.filter(
    (n) => n.principal > 0 && n.principal <= 100_000_000
  );
  let resolvedFinancialNotesList: ParsedFinancialNoteItem1C[] | undefined =
    cleanedDraftNotes && cleanedDraftNotes.length > 0 ? cleanedDraftNotes : undefined;
  let resolvedDisposedNoteId: string | undefined = draft.disposedFinancialNoteId;
  let resolverStep01Trace: Step01CalculationBreakdown1C | undefined;

  if (!resolvedInterestRatePercent) {
    const rateMatch = draft.description.match(/под\s*(\d+(?:[.,]\d+)?)\s*%/iu) ||
      draft.description.match(/ставк\p{L}*\s*(\d+(?:[.,]\d+)?)\s*%/iu);
    if (rateMatch?.[1]) {
      const parsedRate = Number(rateMatch[1].replace(',', '.'));
      if (Number.isFinite(parsedRate) && parsedRate > 0) {
        resolvedInterestRatePercent = parsedRate;
      }
    }
  }

  const resolvedEmployeePosition = draft.employeePosition?.trim() || undefined;
  const resolvedInjuryRate =
    draft.injuryInsuranceRate !== undefined && draft.injuryInsuranceRate >= 0
      ? draft.injuryInsuranceRate
      : 0.2;

  // Inline extraction fallback for СПИ & OS item name if not pre-extracted
  let inlineSpiMonths = draft.usefulLifeMonths;
  if (
    !inlineSpiMonths &&
    (category === 'os_commissioning' ||
      category === 'purchase_equipment' ||
      category === 'founder_contribution' ||
      category === 'depreciation_accrual' ||
      category === 'intangible_commissioning' ||
      category === 'intangible_amortization' ||
      category === 'deferred_expense_97')
  ) {
    inlineSpiMonths = extractUsefulLifeMonths1C(draft.description);
  }
  if (category === 'os_commissioning' || category === 'os_disposal') {
    const targetPool = Object.values(priorVirtualState.fixedAssets).filter((fa) =>
      category === 'os_commissioning'
        ? fa.status === 'На счёте 08.04.1 (к вводу)'
        : fa.status === 'Введено в эксплуатацию (счёт 01.01)'
    );
    const reqOsStems = extractKeywordStems1C(`${nomName} ${draft.description}`);
    const matchedPriorOs =
      targetPool.find((fa) =>
        extractKeywordStems1C(fa.name).some((fs) => reqOsStems.some((rs) => stemsMatch1C(rs, fs)))
      ) ?? (category === 'os_commissioning' && targetPool.length === 1 ? targetPool[0] : undefined);
    if (matchedPriorOs && matchedPriorOs.name) {
      nomName = matchedPriorOs.name;
    } else if (!nomName) {
      const mOsBefore = draft.description.match(
        /^\s*([А-ЯЁа-яё0-9][^\n(,;]{2,45}?)\s+введен[аоы]?\s+в\s+эксплуатац/iu
      );
      const mOsMiddle = draft.description.match(
        /введен[аоы]?\s+(.+?)\s+в\s+эксплуатац/iu
      );
      const mOsAfter = draft.description.match(
        /в\s+эксплуатац\p{L}*\s+([^\n(,;]+)/iu
      );
      const mOsDisp = draft.description.match(
        /(?:реализован[аоы]?|продан[аоы]?|ликвидирован[аоы]?|списан[аоы]?|демонтирован[аоы]?|выбыл[аои]?)\s+(?:объект\s+ос\s+)?([^\n(,;]+?)(?=\s+(?:с\s+ндс|без\s+ндс|в\s+ооо|покупател|$))/iu
      );
      const rawOsName = (mOsBefore?.[1] || mOsMiddle?.[1] || mOsAfter?.[1] || mOsDisp?.[1] || '').trim();
      if (rawOsName.length >= 2) {
        nomName = rawOsName.charAt(0).toUpperCase() + rawOsName.slice(1);
      }
    }
  } else if (!nomName && category === 'purchase_equipment' && !isCapexServiceExpense) {
    const mEq = draft.description.match(
      /(?:поступил[аои]?|приобретен[аоы]?|приобрел[аи]?|получен[аоы]?|куплен[аоы]?)(?:\s+и\s+(?:оплачен[аоы]?|оплатил[аи]?))?\s+([а-яёa-z][^\n(,;—-]{2,55}?)(?=\s+(?:от|у|в\s+ооо|в\s+ао|на\s+сумм|в\s+сумме|стоимост|по\s+цен|с\s+ндс|для\s+сдач|\(|$))/iu
    );
    if (mEq?.[1]) {
      const cleanedEq = mEq[1].trim();
      if (cleanedEq.length >= 3) {
        nomName = cleanedEq.charAt(0).toUpperCase() + cleanedEq.slice(1);
      }
    }
  }
  // Link equipment capex delivery/mounting expense on 08.04.1 to the uncommissioned fixed asset so 08.04.1 accumulates cleanly
  if (isCapexServiceExpense) {
    const capexAssets = Object.values(priorVirtualState.fixedAssets).filter(
      (fa) => fa.status === 'На счёте 08.04.1 (к вводу)'
    );
    const reqStems = extractKeywordStems1C(draft.description);
    const matchedCapex =
      capexAssets.find((fa) =>
        extractKeywordStems1C(fa.name).some((fs) => reqStems.some((rs) => stemsMatch1C(rs, fs)))
      ) ?? (capexAssets.length === 1 ? capexAssets[0] : undefined);
    if (matchedCapex && matchedCapex.name) {
      nomName = matchedCapex.name;
      nomBinding = {
        status: 'new_for_1c',
        note: `Доп. расходы включены в первоначальную стоимость объекта «${matchedCapex.name}» на счёте 08.04.1 (ФСБУ 26/2020)`,
      };
    }
  }
  if (
    category === 'purchase_materials' &&
    /включен\p{L}*\s+в\s+стоимост\p{L}*\s+материал|поступление\s+доп\.?\s*расход/iu.test(draft.description)
  ) {
    const prevMatOp = [...(batchContext?.priorOperations ?? [])]
      .reverse()
      .find(
        (o) =>
          o.includeInProcessing &&
          o.category === 'purchase_materials' &&
          o.nomenclatureName &&
          (!draft.date || !o.date || o.date <= draft.date)
      );
    if (prevMatOp) {
      nomName = prevMatOp.nomenclatureName;
      if (!draft.materialAccountHint && prevMatOp.materialAccount) {
        draft = { ...draft, materialAccountHint: prevMatOp.materialAccount };
      }
      nomBinding = {
        status: 'new_for_1c',
        note: `Доп. расходы включены в фактическую себестоимость партии «${prevMatOp.nomenclatureName}» (ФСБУ 5/2019)`,
      };
    }
  } else if (!nomName && category === 'purchase_materials') {
    const mMat = draft.description.match(
      /(?:поступил[аои]?|приобретен[аоы]?|приобрел[аи]?|закуплен[аоы]?|оприходован[аоы]?|получен[аоы]?)(?:\s+и\s+(?:оплачен[аоы]?|оплатил[аи]?))?(?:\s+через\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?)?(?:\s+от\s+(?:ООО|АО|ПАО|ЗАО|ИП)\s*[«"'][^»"']+[»"'](?:\s*\([^)]*\))?)?\s+([а-яёa-z][^\n(,;—-]{2,55}?)(?=\s+(?:от|у|поставщик|на\s+основани|на\s+сумм|в\s+сумме|стоимост|по\s+цен|в\s+т\.?\s*ч|\(|$))/iu
    );
    if (mMat?.[1]) {
      const cleanedMat = mMat[1].trim();
      if (cleanedMat.length >= 3) {
        nomName = cleanedMat.charAt(0).toUpperCase() + cleanedMat.slice(1);
        nomBinding = {
          status: 'new_for_1c',
          note: 'Новый элемент номенклатуры (будет создан при экспорте в 1С)',
        };
      }
    }
  }

  if (nomName) {
    nomName = cleanNomenclatureName1C(nomName, draft.description) || nomName;
  }

  let resolvedUsefulLifeMonths =
    inlineSpiMonths && inlineSpiMonths > 0
      ? Math.round(inlineSpiMonths)
      : category === 'os_commissioning' || category === 'depreciation_accrual'
        ? 60
        : undefined;
  let resolvedDeprBaseAmount = draft.depreciationBaseAmount;
  let payrollStaffSummary: QueuedOperation['payrollStaffSummary'] = undefined;
  let calculationProvenance: string | undefined;
  let unpaid6001Resolution: UnpaidSupplierResolution1C | null = null;

  let amountMode: OperationAmountMode = hadExplicitInputAmount ? 'explicit' : 'required_missing';
  let amountCalculationNote = draft.amountCalculationNote;
  let stockSourceNote: string | undefined;
  let effectiveQty = draft.quantity;
  let effectiveUnitPrice = draft.unitPrice;
  if (!effectiveQty) {
    const inlineQtyMatch = draft.description.match(
      /(\d+(?:[.,]\d+)?)\s*(?:шт\.?|штук|ед\.?|компл\.?|упак\.?|п\.?\s*м\.?|м2|м3|кв\.?\s*м|тонн|кг)(?=$|[^\p{L}])/iu
    );
    if (inlineQtyMatch?.[1]) {
      const qVal = Number(inlineQtyMatch[1].replace(',', '.'));
      if (Number.isFinite(qVal) && qVal > 0) effectiveQty = qVal;
    }
  }
  if (!effectiveUnitPrice) {
    const inlinePriceMatch = draft.description.match(
      /(?:по\s+цен[еы]|цен[аы](?:\s+за\s+(?:единиц\p{L}*|1\s*шт\.?|шт\.?|ед\.?))?(?:\s+(?:с|без)\s+ндс)?)\s*[:=—-]?\s*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{2,9}(?:[.,]\d{1,2})?)\s*(?:₽|руб|р\.?)/iu
    );
    if (inlinePriceMatch?.[1]) {
      const pVal = Number(inlinePriceMatch[1].replace(/[\s\u00A0]/g, '').replace(',', '.'));
      if (Number.isFinite(pVal) && pVal > 0 && pVal < 500_000_000) effectiveUnitPrice = pVal;
    }
  }
  // Guard: if effectiveDraftAmount equals unitPrice while quantity > 1 (e.g. #19: 284 × 34 400 = 9 769 600), multiply!
  if (
    !isNonPostingEventCategory &&
    category !== 'bank_out' &&
    category !== 'bank_in' &&
    effectiveQty &&
    effectiveQty > 1 &&
    effectiveUnitPrice &&
    effectiveUnitPrice > 0 &&
    Math.abs(effectiveDraftAmount - effectiveUnitPrice) < 0.01
  ) {
    effectiveDraftAmount = round2(effectiveQty * effectiveUnitPrice);
    amountMode = 'explicit';
    calculationProvenance = `${effectiveQty} × ${effectiveUnitPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽ = ${effectiveDraftAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
    amountCalculationNote = calculationProvenance;
  }
  const resolvedOrderTotalAmount =
    draft.orderTotalAmount ??
    ((category === 'bank_out' || category === 'bank_in') &&
    /аванс|предоплат/iu.test(draft.description) &&
    effectiveQty &&
    effectiveQty > 1 &&
    effectiveUnitPrice &&
    effectiveUnitPrice > 0 &&
    round2(effectiveQty * effectiveUnitPrice) > effectiveDraftAmount + 0.01
      ? round2(effectiveQty * effectiveUnitPrice)
      : undefined);

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

  // 6a-0a. Management Contract Event ('contract_event') & Accounting Policy Event ('policy_event'): 0 postings on signing
  if (category === 'contract_event') {
    const terms = extractRecurringContractTerms1C(draft.description);
    if (!resolvedPeriodicPaymentAmount && terms?.periodicAmount && terms.periodicAmount >= 0.01) {
      resolvedPeriodicPaymentAmount = terms.periodicAmount;
    }
    if (terms?.vatRule && inheritedVatRule === undefined) {
      inheritedVatRule = terms.vatRule;
    }
    if (terms?.vatRate !== undefined && inheritedVatRate === undefined) {
      inheritedVatRate = terms.vatRate;
    }
    if (!contractName) {
      contractName = /аренд/iu.test(draft.description)
        ? 'Договор аренды'
        : /связ|интернет/iu.test(draft.description)
          ? 'Договор услуг связи'
          : 'Основной договор';
      contractBinding = { status: 'new_for_1c', note: 'Договор зарегистрирован в справочнике 1С' };
    }
    amountMode = 'calculated_by_1c';
    const perStr = resolvedPeriodicPaymentAmount
      ? ` (ставка ${resolvedPeriodicPaymentAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽/период)`
      : '';
    calculationProvenance = `Управленческое событие: заключение договора${cpName ? ` с «${cpName}»` : ''}${perStr} — сохранено в карточке «Договоры контрагентов» для последующих актов и оплат (0 проводок при подписании)`;
    amountCalculationNote = calculationProvenance;
  }

  if (category === 'policy_event') {
    amountMode = 'calculated_by_1c';
    calculationProvenance =
      'Управленческое событие: настройка параметров учётной политики / вычета в 1С:БП 3.0 (0 бухгалтерских проводок)';
    amountCalculationNote = calculationProvenance;
  }

  if (category === 'customer_invoice' || category === 'supplier_invoice') {
    const terms = extractRecurringContractTerms1C(draft.description, effectiveDraftAmount);
    if (!resolvedPeriodicPaymentAmount && terms?.periodicAmount && terms.periodicAmount >= 0.01) {
      resolvedPeriodicPaymentAmount = terms.periodicAmount;
    }
    if (terms?.vatRule && inheritedVatRule === undefined) {
      inheritedVatRule = terms.vatRule;
    }
    if (terms?.vatRate !== undefined && inheritedVatRate === undefined) {
      inheritedVatRate = terms.vatRate;
    }
    if (!contractName) {
      contractName = /аренд/iu.test(draft.description)
        ? 'Договор аренды'
        : category === 'customer_invoice'
          ? 'Основной договор с покупателем'
          : 'Основной договор с поставщиком';
      contractBinding = { status: 'new_for_1c', note: 'Договор / счёт зарегистрирован в 1С' };
    }
    amountMode = effectiveDraftAmount >= 0.01 ? 'explicit' : 'calculated_by_1c';
    const perStr = resolvedPeriodicPaymentAmount
      ? ` (ежемесячно ${resolvedPeriodicPaymentAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽)`
      : '';
    calculationProvenance =
      category === 'customer_invoice'
        ? `Счёт покупателю${cpName ? ` «${cpName}»` : ''} на сумму ${effectiveDraftAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽${perStr} — 0 проводок при выписке, заказ сохранён для последующей оплаты и отгрузки`
        : `Счёт от поставщика${cpName ? ` «${cpName}»` : ''} на сумму ${effectiveDraftAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽ — 0 проводок при регистрации`;
    amountCalculationNote = calculationProvenance;
  }

  // 6a-0b. Writ of Execution ('writ_of_execution' / ИсполнительныйЛист): register 76.41 withholding rule (0 postings on registration)
  if (category === 'writ_of_execution') {
    if (!employeeName) {
      const mDebtor = draft.description.match(
        /(?:взыскан\p{L}*\s+алимент\p{L}*\s+с|с\s+работник\p{L}*|с\s+сотрудник\p{L}*|должник\s*[:—-]?|алимент\p{L}*\s+с)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?)/u
      );
      if (mDebtor?.[1]) {
        employeeName = normalizeInflectedSurnameWithInitials(mDebtor[1]);
      }
    }
    if (!resolvedAlimonyRecipientName) {
      const mRec = draft.description.match(
        /(?:в\s+пользу|получател[ьяю]\s*[:—-]?)\s+((?:супруг[иае]\s+)?[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?|\s+[А-ЯЁ][а-яё]+)?)/iu
      );
      if (mRec?.[1]) {
        let recRaw = mRec[1].trim();
        recRaw = recRaw
          .replace(/^супруг[ие]\s+/iu, 'Супруга ')
          .replace(/^([А-ЯЁ][а-яё]+?)(?:овой|евой|ёвой|иной|ыной)(?=$|\s)/u, '$1а');
        resolvedAlimonyRecipientName = recRaw;
      }
    }
    if (!resolvedAlimonyRecipientInn) {
      const mInn = draft.description.match(/инн\s*[:№]?\s*(\d{10}|\d{12})/iu);
      if (mInn?.[1]) resolvedAlimonyRecipientInn = mInn[1];
    }
    if (!resolvedAlimonyRatePercent) {
      if (/1\s*\/\s*4|одной?\s+четверт|четверт\p{L}*\s+част|25\s*%/iu.test(draft.description)) {
        resolvedAlimonyRatePercent = 25;
        resolvedAlimonyShareLabel = '1/4 (25%)';
      } else if (/1\s*\/\s*3|одной?\s+трет|трет\p{L}*\s+част|33(?:[.,]3+)?\s*%/iu.test(draft.description)) {
        resolvedAlimonyRatePercent = 33.33;
        resolvedAlimonyShareLabel = '1/3 (33,33%)';
      } else if (/1\s*\/\s*2|половин|50\s*%/iu.test(draft.description)) {
        resolvedAlimonyRatePercent = 50;
        resolvedAlimonyShareLabel = '1/2 (50%)';
      } else {
        const mPct = draft.description.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
        if (mPct) {
          resolvedAlimonyRatePercent = Number(mPct[1].replace(',', '.'));
          resolvedAlimonyShareLabel = `${mPct[1]}%`;
        } else {
          resolvedAlimonyRatePercent = 25;
          resolvedAlimonyShareLabel = '1/4 (25%)';
        }
      }
    } else if (!resolvedAlimonyShareLabel) {
      resolvedAlimonyShareLabel =
        resolvedAlimonyRatePercent === 25
          ? '1/4 (25%)'
          : `${resolvedAlimonyRatePercent}%`;
    }

    amountMode = 'calculated_by_1c';
    calculationProvenance = `Исполнительный лист зарегистрирован: удержание с «${employeeName || 'сотрудника'}» в пользу «${resolvedAlimonyRecipientName || 'получателя'}» в размере ${resolvedAlimonyShareLabel} от дохода после НДФЛ 13% (автопроводка Дт 70 Кт 76.41 при начислении ЗП)`;
    amountCalculationNote = calculationProvenance;
  }

  // 6a-0c. Alimony Payout ('alimony_payout' / 76.41 -> 51): resolve recipient + accumulated 76.41 balance
  if (category === 'alimony_payout') {
    const isMultiAlimony =
      /(?:,|\s+и)\s*супруг|супруг\p{L}*.*супруг|по\s+исполнительн\p{L}*\s+листам|всем\s+получател/iu.test(
        draft.description
      ) || (draft.description.match(/\b\d{12}\b/g)?.length ?? 0) >= 2;
    if (!isMultiAlimony && !resolvedAlimonyRecipientInn) {
      const mInn = draft.description.match(/инн\s*[:№]?\s*(\d{10}|\d{12})/iu);
      if (mInn?.[1]) resolvedAlimonyRecipientInn = mInn[1];
    }
    if (!isMultiAlimony && !resolvedAlimonyRecipientName) {
      const mRec = draft.description.match(
        /алимент\p{L}*\s+((?:супруг[еиа]\s+)?[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?|\s+[А-ЯЁ][а-яё]+)?)/iu
      );
      if (mRec?.[1]) {
        resolvedAlimonyRecipientName = mRec[1]
          .trim()
          .replace(/^супруге\s+/iu, 'Супруга ')
          .replace(/^([А-ЯЁ][а-яё]+?)(?:овой|евой|ёвой|иной|ыной)(?=$|\s)/u, '$1а');
      }
    }
    const alimonyRes = !isMultiAlimony
      ? resolveAlimonyPayable7641(
          priorVirtualState,
          resolvedAlimonyRecipientName,
          resolvedAlimonyRecipientInn
        )
      : null;
    if (alimonyRes) {
      if (!resolvedAlimonyRecipientName && alimonyRes.recipientName) {
        resolvedAlimonyRecipientName = alimonyRes.recipientName;
      }
      if (!resolvedAlimonyRecipientInn && alimonyRes.recipientInn) {
        resolvedAlimonyRecipientInn = alimonyRes.recipientInn;
      }
      if (!employeeName && alimonyRes.debtorEmployeeName) {
        employeeName = alimonyRes.debtorEmployeeName;
      }
      if (effectiveDraftAmount < 0.01 && alimonyRes.accumulatedBalance >= 0.01) {
        effectiveDraftAmount = alimonyRes.accumulatedBalance;
        amountMode = 'from_account_balance';
        calculationProvenance = alimonyRes.provenanceNote;
        amountCalculationNote = alimonyRes.provenanceNote;
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
      const row7641 = runningOsv.leafRows.find((r) => r.code === '76.41');
      if (row7641 && row7641.endCredit >= 0.01) {
        effectiveDraftAmount = row7641.endCredit;
        amountMode = 'from_account_balance';
        const openSubs7641 = (runningOsv.subcontoRowsByAccount?.['76.41'] ?? []).filter(
          (s) => s.endCredit >= 0.01
        );
        if (isMultiAlimony && openSubs7641.length > 0) {
          resolvedAlimonyRecipientName = openSubs7641.map((s) => s.subcontoLabel).join('; ');
        }
        calculationProvenance = `Сумма удержанных алиментов определена по кредитовому сальдо счёта 76.41 на ${draft.date || 'дату выплаты'}: ${row7641.endCredit.toFixed(2)} ₽`;
        amountCalculationNote = calculationProvenance;
      }
    }
  }

  // 6a-0d. Financial Investments ('financial_investment' / 58.02): multi-note principal sum (e.g. 280 000 + 540 000 = 820 000)
  if (category === 'financial_investment') {
    const parsedNotesList =
      resolvedFinancialNotesList && resolvedFinancialNotesList.length > 0
        ? resolvedFinancialNotesList
        : extractFinancialNotesFromText1C(draft.description);
    if (parsedNotesList.length >= 1) {
      resolvedFinancialNotesList = parsedNotesList;
      const sumNotes = round2(parsedNotesList.reduce((acc, n) => acc + n.principal, 0));
      if (!resolvedFinancialNotesSummary) {
        resolvedFinancialNotesSummary = parsedNotesList
          .map(
            (n) =>
              `${n.label || `Вексель №${n.index}`}: ${n.principal.toLocaleString('ru-RU')} ₽ (${n.ratePercent}% годовых)`
          )
          .join('; ');
      }
      if (effectiveDraftAmount < 0.01 && sumNotes >= 0.01) {
        effectiveDraftAmount = sumNotes;
        amountMode = 'explicit';
        calculationProvenance = `Суммарная стоимость векселей (счёт 58.02, без НДС по ст. 149 НК РФ): ${parsedNotesList.map((n) => `${n.principal.toLocaleString('ru-RU')} ₽`).join(' + ')} = ${sumNotes.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
        amountCalculationNote = calculationProvenance;
      }
    }
    // Always use clean security nomenclature on 58.02 (never clipped text like '...я третьих лиц')
    nomName =
      resolvedFinancialNotesList && resolvedFinancialNotesList.length > 1
        ? 'Долговые ценные бумаги (векселя)'
        : 'Вексель';
  }

  // 6a-0e. Supplier Payment ('bank_out'): resolve missing counterparty & sum unpaid 60.01 invoices by subject stems (excluding buyer advance refunds)
  if (
    category === 'bank_out' &&
    !/возврат\p{L}*.*(?:аванс|предоплат)/iu.test(descLower) &&
    (!cpName || effectiveDraftAmount < 0.01)
  ) {
    unpaid6001Resolution = resolveUnpaidSupplier6001ByKeywords(
      priorVirtualState,
      `${nomName} ${draft.description}`,
      cpName || undefined,
      effectiveDraftAmount
    );
    if (unpaid6001Resolution) {
      if (!cpName && unpaid6001Resolution.counterpartyName) {
        cpName = unpaid6001Resolution.counterpartyName;
        cpInn = unpaid6001Resolution.counterpartyInn || cpInn;
        cpKpp = unpaid6001Resolution.counterpartyKpp || cpKpp;
        if (!contractName && unpaid6001Resolution.contractName) {
          contractName = unpaid6001Resolution.contractName;
        }
        const m1c = matchPersonOrCounterpartyIn1C(cpName, cpInn, db1C);
        if (m1c) {
          cpName = m1c.name;
          cpInn = cpInn || m1c.inn;
          cpKpp = cpKpp || m1c.kpp;
          cpSource = 'db_1c';
          cpBinding = {
            status: 'matched_1c',
            matchedName: m1c.name,
            matchedCode1C: m1c.code1C,
            matchedInn: cpInn,
            note: unpaid6001Resolution.provenanceNote,
          };
        } else {
          cpSource = cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : 'unresolved';
          cpBinding = {
            status: 'new_for_1c',
            note: unpaid6001Resolution.provenanceNote,
          };
        }
        if (contractName && contractBinding.status === 'missing') {
          contractBinding = {
            status: cpBinding.status === 'matched_1c' ? 'matched_1c' : 'new_for_1c',
            matchedName: cpBinding.status === 'matched_1c' ? contractName : undefined,
            note: 'Договор подтянут из оплачиваемого поступления 60.01',
          };
        }
      }
      if (effectiveDraftAmount < 0.01 && unpaid6001Resolution.totalUnpaidAmount >= 0.01) {
        effectiveDraftAmount = unpaid6001Resolution.totalUnpaidAmount;
        amountMode = 'from_related_doc';
        calculationProvenance = unpaid6001Resolution.provenanceNote;
        amountCalculationNote = unpaid6001Resolution.provenanceNote;
      }
    }
  }

  // 6a-1. Payroll & Insurance Accrual: pull active staff roster salaries from 1C DB + prior ПриемНаРаботу
  // with Official 2026 RF Production Calendar pro-rata calculation and split by costAccount (20.01 vs 26 vs 44.01)
  if (category === 'payroll_accrual' || category === 'insurance_accrual') {
    const workerProjectRules = resolveWorkerProjectAssignmentsFromText1C(
      `${draft.description} ${draft.actionSequenceHint ?? ''}`
    );
    const singleOpProject = extractCanonicalProjectNomGroup1C(
      `${draft.nomenclatureGroupHint ?? ''} ${draft.description}`
    );

    const resolveEmpProjectForMonth = (
      empName: string,
      costAcc: '20.01' | '26' | '44.01',
      prevGroup?: string
    ): string | undefined => {
      if (costAcc !== '20.01') return undefined;
      const root = extractSurnameRootForProjectMatch1C(empName);
      if (root.length >= 3) {
        const matchedRule = workerProjectRules.find((r) => r.surnameRootPattern.includes(root));
        if (matchedRule) return matchedRule.projectGroup;
      }
      if (workerProjectRules.length === 0 && singleOpProject) {
        return singleOpProject;
      }
      // Inherit worker's project from most recent prior payroll_accrual if worker keeps working on same object
      if (root.length >= 3) {
        for (let i = priorOps.length - 1; i >= 0; i--) {
          const pOp = priorOps[i];
          if (!pOp.includeInProcessing || pOp.category !== 'payroll_accrual') continue;
          const prevStaff = pOp.payrollStaffSummary?.find((s) =>
            extractSurnameRootForProjectMatch1C(s.name) === root
          );
          if (prevStaff?.nomenclatureGroup) {
            return prevStaff.nomenclatureGroup;
          }
        }
      }
      // Or check if there is an active construction project in the current month
      for (let i = priorOps.length - 1; i >= 0; i--) {
        const pOp = priorOps[i];
        if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
        if (
          pOp.nomenclatureGroupName &&
          pOp.nomenclatureGroupName !== 'Основная номенклатурная группа' &&
          pOp.nomenclatureGroupName !== 'Панели из ПВХ и МДФ' &&
          (pOp.category === 'materials_writeoff' ||
            pOp.category === 'customer_invoice' ||
            (pOp.category === 'bank_in' && /аванс|предоплат/iu.test(pOp.description)))
        ) {
          return pOp.nomenclatureGroupName;
        }
      }
      return prevGroup;
    };

    const rosterMap = new Map<
      string,
      {
        name: string;
        position?: string;
        costAccount: '20.01' | '26' | '44.01';
        nomenclatureGroup?: string;
        salary: number;
        fullMonthlySalary: number;
        workedDays?: number;
        totalWorkingDays?: number;
        hireDate?: string;
        terminationDate?: string;
        source: string;
      }
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
        const key = normalizePersonIdentityKey1C(emp.name) || emp.id;
        const pos = emp.extra?.position || emp.extra?.должность || emp.kind;
        const costAcc = inferEmployeeCostAccount1C(pos, emp.extra?.Подразделение);
        const hireDt = emp.extra?.ДатаПриема || db1C?.periodStart || undefined;
        const proRata = calculateEmployeeMonthlySalaryProRata2026({
          monthlySalary: round2(parsedSal),
          payrollDateIso: draft.date || '2026-01-31',
          hireDateIso: hireDt,
        });
        if (proRata.accruedSalary > 0) {
          rosterMap.set(key, {
            name: emp.name,
            position: pos,
            costAccount: costAcc,
            nomenclatureGroup: resolveEmpProjectForMonth(emp.name, costAcc),
            salary: proRata.accruedSalary,
            fullMonthlySalary: round2(parsedSal),
            workedDays: proRata.workedDays,
            totalWorkingDays: proRata.totalWorkingDays,
            hireDate: hireDt,
            source: proRata.isProRata
              ? `Штат 1С (${proRata.workedDays}/${proRata.totalWorkingDays} раб. дн.)`
              : 'Штатное расписание базы 1С',
          });
        }
      }
    }

    // 2. Check chronological Virtual1CState employees up to draft.date
    for (const vEmp of priorVirtualState.employees) {
      const fullSal = round2(vEmp.monthlySalary ?? 0);
      if (fullSal <= 0) continue;
      const proRata = calculateEmployeeMonthlySalaryProRata2026({
        monthlySalary: fullSal,
        payrollDateIso: draft.date || '2026-01-31',
        hireDateIso: vEmp.hireDate,
        terminationDateIso: vEmp.terminationDate,
      });
      const key = normalizePersonIdentityKey1C(vEmp.fullName) || vEmp.key;
      if (proRata.accruedSalary <= 0) {
        rosterMap.delete(key);
        continue;
      }
      const costAcc = vEmp.costAccount || inferEmployeeCostAccount1C(vEmp.position);
      rosterMap.set(key, {
        name: vEmp.fullName,
        position: vEmp.position,
        costAccount: costAcc,
        nomenclatureGroup: resolveEmpProjectForMonth(vEmp.fullName, costAcc, vEmp.nomenclatureGroup),
        salary: proRata.accruedSalary,
        fullMonthlySalary: fullSal,
        workedDays: proRata.workedDays,
        totalWorkingDays: proRata.totalWorkingDays,
        hireDate: vEmp.hireDate,
        terminationDate: vEmp.terminationDate,
        source: proRata.isProRata
          ? `Приём с ${vEmp.hireDate} (${proRata.workedDays}/${proRata.totalWorkingDays} раб. дн. 2026 г.)`
          : vEmp.hireDate
            ? `Приём на работу с ${vEmp.hireDate}`
            : 'Штатное расписание 1С',
      });
    }

    const rosterArr = Array.from(rosterMap.values());
    const rosterFot = round2(rosterArr.reduce((s, r) => s + r.salary, 0));
    const isSingleEmployeeTargetedAccrual =
      effectiveDraftAmount >= 0.01 &&
      Math.abs(rosterFot - effectiveDraftAmount) >= 1 &&
      (Boolean(employeeName) ||
        /больничн|нетрудоспособност|компенсац\p{L}*.*отпуск|отпускн|материальн\p{L}*\s+помощ|при\s+увольнен|преми\p{L}*/iu.test(
          draft.description
        ));

    if (isSingleEmployeeTargetedAccrual) {
      if (employeeName) {
        const matchedEmp = rosterArr.find(
          (r) => normalizePersonIdentityKey1C(r.name) === normalizePersonIdentityKey1C(employeeName)
        );
        const targetCostAcc: '20.01' | '26' | '44.01' =
          matchedEmp?.costAccount ||
          (resolvedCostAccount === '20.01' || resolvedCostAccount === '44.01'
            ? resolvedCostAccount
            : '26');
        payrollStaffSummary = [
          {
            name: matchedEmp?.name || employeeName,
            position: matchedEmp?.position || resolvedEmployeePosition,
            costAccount: targetCostAcc,
            nomenclatureGroup: matchedEmp?.nomenclatureGroup,
            salary: effectiveDraftAmount,
            fullMonthlySalary: matchedEmp?.fullMonthlySalary ?? effectiveDraftAmount,
            source: 'Индивидуальное начисление по документу',
          },
        ];
      } else {
        payrollStaffSummary = undefined;
      }
    } else if (rosterArr.length > 0) {
      payrollStaffSummary = rosterArr.map((r) => ({
        name: r.name,
        position: r.position,
        costAccount: r.costAccount,
        nomenclatureGroup: r.nomenclatureGroup,
        salary: r.salary,
        fullMonthlySalary: r.fullMonthlySalary,
        workedDays: r.workedDays,
        totalWorkingDays: r.totalWorkingDays,
        source: r.source,
      }));
    } else if (db1C && (db1C.employees.length > 0 || db1C.individuals.length > 0)) {
      const namesSource = db1C.employees.length > 0 ? db1C.employees : db1C.individuals;
      payrollStaffSummary = namesSource.slice(0, 8).map((e) => ({
        name: e.name,
        position: e.kind,
        salary: 0,
        source: 'Справочник сотрудников 1С (оклад не выгружен)',
      }));
    }

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
        .map((r) =>
          r.workedDays && r.totalWorkingDays && r.workedDays < r.totalWorkingDays
            ? `${r.name} [сч. ${r.costAccount}]: ${r.salary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽ (${r.workedDays}/${r.totalWorkingDays} дн.)`
            : `${r.name} [сч. ${r.costAccount}]: ${r.salary.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`
        )
        .join(' + ');
      calculationProvenance = `Авторасчёт по производственному календарю 2026 г. (${breakdown}) → ФОТ ${rosterFot.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
      amountCalculationNote = calculationProvenance;
    } else if (effectiveDraftAmount < 0.01) {
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
      if (!isSingleEmployeeTargetedAccrual) {
        resolvedMonthlySalary = effectiveDraftAmount;
      }
      calculationProvenance = `Сумма начисления задана в условии операции: ${effectiveDraftAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
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
  if (
    effectiveDraftAmount < 0.01 &&
    priorOps.length > 0 &&
    doesOperationRequireCounterparty(category) &&
    category !== 'founder_contribution' &&
    category !== 'charter_capital'
  ) {
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
        const fullInvoiceInPrev =
          prev.quantity && prev.quantity > 0 && prev.unitPrice && prev.unitPrice > 0
            ? round2(prev.quantity * prev.unitPrice)
            : 0;
        const fallbackAmt =
          fullInvoiceInPrev >= 0.01
            ? fullInvoiceInPrev
            : availAdv > 0.01
              ? availAdv
              : prev.amount;
        effectiveDraftAmount = fallbackAmt;
        if (!effectiveQty && prev.quantity) effectiveQty = prev.quantity;
        if (!effectiveUnitPrice && prev.unitPrice) effectiveUnitPrice = prev.unitPrice;
        if (!nomName && prev.nomenclatureName && (!normNom || normNom === normalizeEntityKey(prev.nomenclatureName))) {
          nomName = prev.nomenclatureName;
        }
        if (inheritedVatRule === undefined) inheritedVatRule = prev.vatRule;
        if (inheritedVatRate === undefined && prev.vatRate > 0) inheritedVatRate = prev.vatRate;
        amountCalculationNote =
          fullInvoiceInPrev >= 0.01
            ? `Сумма накладной определена по условиям счёта от ${prev.date} (${prev.quantity} × ${prev.unitPrice?.toFixed(2)} ₽ = ${effectiveDraftAmount.toFixed(2)} ₽; аванс зачтён)`
            : `Сумма определена по связанному авансу поставщику «${cpName}» от ${prev.date} (счёт 60.02): ${effectiveDraftAmount.toFixed(2)} ₽`;
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
        const open6001ForCp = round2(
          priorVirtualState.openSettlements
            .filter((s) => {
              if (s.account !== '60.01' || s.remainingAmount <= 0.01) return false;
              const sCpNorm = normalizeEntityKey(s.counterpartyName);
              return (
                (cpInn && s.counterpartyInn && cpInn === s.counterpartyInn) ||
                (normCp && sCpNorm && (normCp === sCpNorm || normCp.includes(sCpNorm) || sCpNorm.includes(normCp)))
              );
            })
            .reduce((acc, s) => acc + s.remainingAmount, 0)
        );
        const offset6002InPrev = round2(
          prev.entries
            .filter((e) => e.debit === '60.01' && e.credit === '60.02')
            .reduce((acc, e) => acc + e.amount, 0)
        );
        const netAfterPrevOffset = round2(Math.max(0, prev.amount - offset6002InPrev));
        effectiveDraftAmount =
          open6001ForCp >= 0.01
            ? open6001ForCp
            : netAfterPrevOffset >= 0.01
              ? netAfterPrevOffset
              : prev.amount;
        amountCalculationNote =
          offset6002InPrev >= 0.01
            ? `Сумма доплаты поставщику «${cpName}» за вычетом ранее зачтённого аванса (${prev.amount.toFixed(2)} − ${offset6002InPrev.toFixed(2)} = ${effectiveDraftAmount.toFixed(2)} ₽)`
            : `Сумма оплаты определена по остатку задолженности поставщику «${cpName}» (счёт 60.01): ${effectiveDraftAmount.toFixed(2)} ₽`;
        calculationProvenance = amountCalculationNote;
        break;
      }

      if (
        category === 'bank_in' &&
        ['sale_goods', 'sale_services'].includes(prev.category)
      ) {
        const open6201ForCp = round2(
          priorVirtualState.openSettlements
            .filter((s) => {
              if (s.account !== '62.01' || s.remainingAmount <= 0.01) return false;
              const sCpNorm = normalizeEntityKey(s.counterpartyName);
              return (
                (cpInn && s.counterpartyInn && cpInn === s.counterpartyInn) ||
                (normCp && sCpNorm && (normCp === sCpNorm || normCp.includes(sCpNorm) || sCpNorm.includes(normCp)))
              );
            })
            .reduce((acc, s) => acc + s.remainingAmount, 0)
        );
        const offset6202InPrev = round2(
          prev.entries
            .filter((e) => e.debit === '62.02' && e.credit === '62.01')
            .reduce((acc, e) => acc + e.amount, 0)
        );
        const netAfterPrevOffset = round2(Math.max(0, prev.amount - offset6202InPrev));
        effectiveDraftAmount =
          open6201ForCp >= 0.01
            ? open6201ForCp
            : netAfterPrevOffset >= 0.01
              ? netAfterPrevOffset
              : prev.amount;
        amountCalculationNote =
          offset6202InPrev >= 0.01
            ? `Сумма доплаты от покупателя «${cpName}» за вычетом ранее зачтённого аванса (${prev.amount.toFixed(2)} − ${offset6202InPrev.toFixed(2)} = ${effectiveDraftAmount.toFixed(2)} ₽)`
            : `Сумма поступления определена по остатку дебиторской задолженности «${cpName}» (счёт 62.01): ${effectiveDraftAmount.toFixed(2)} ₽`;
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
      itemText: /\([^()]*[,;][^()]*\)/u.test(draft.description)
        ? draft.description
        : nomName || draft.description,
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
    const curMonthPrefix = (draft.date ?? '').slice(0, 7);
    const activeAssets = Object.values(priorVirtualState.fixedAssets).filter(
      (fa) =>
        fa.status === 'Введено в эксплуатацию (счёт 01.01)' &&
        fa.initialCost >= 0.01 &&
        (!curMonthPrefix || !fa.commissioningDate || fa.commissioningDate.slice(0, 7) < curMonthPrefix)
    );
    if (activeAssets.length > 0) {
      let monthlyDeprSum = 0;
      const deprParts: string[] = [];
      for (const fa of activeAssets) {
        const spi = fa.usefulLifeMonths && fa.usefulLifeMonths > 0 ? fa.usefulLifeMonths : resolvedUsefulLifeMonths ?? 60;
        const mDepr = round2(fa.initialCost / spi);
        if (mDepr > 0) {
          monthlyDeprSum = round2(monthlyDeprSum + mDepr);
          deprParts.push(`${fa.name}: ${fa.initialCost.toFixed(2)} / ${spi} мес. = ${mDepr.toFixed(2)} ₽`);
          if (!nomName && fa.name) nomName = fa.name;
          resolvedDeprBaseAmount = fa.initialCost;
          resolvedUsefulLifeMonths = spi;
        }
      }
      if (monthlyDeprSum >= 0.01) {
        effectiveDraftAmount = monthlyDeprSum;
        amountMode = 'from_related_doc';
        calculationProvenance = `Линейная амортизация по действующим ОС (${deprParts.join('; ')})`;
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

  // --- 6f. Universal 8-Level Amount & Link Resolver («Замкнутый контур учебного задания») ---
  const inlineCorr: ExplicitCorrespondenceHint1C[] =
    draft.explicitCorrespondences && draft.explicitCorrespondences.length > 0
      ? draft.explicitCorrespondences
      : extractExplicitCorrespondencesFromText1C(draft.description);

  const inlineCorrExplicitTotal = round2(
    inlineCorr.reduce((sum, c) => sum + (c.amount && c.amount > 0 ? c.amount : 0), 0)
  );
  if (effectiveDraftAmount < 0.01 && inlineCorrExplicitTotal >= 0.01) {
    effectiveDraftAmount = inlineCorrExplicitTotal;
    amountMode = 'explicit';
    calculationProvenance = 'Сумма задана в явной корреспонденции счетов условия операции';
    amountCalculationNote = calculationProvenance;
  }

  const universalResolved = resolveOperationAmountAndLinks({
    opId,
    date: draft.date,
    description: draft.description,
    category,
    explicitColumnAmount: hadExplicitInputAmount ? round2(Math.abs(draft.amount)) : 0,
    textDerivedAmount:
      !hadExplicitInputAmount && effectiveDraftAmount >= 0.01 ? effectiveDraftAmount : undefined,
    quantity: effectiveQty,
    unitPrice: effectiveUnitPrice,
    vatRate: inheritedVatRate !== undefined ? inheritedVatRate : isOsno ? policyVatRate : 0,
    vatRule: inheritedVatRule ?? 'included',
    counterpartyName: cpName,
    counterpartyInn: cpInn,
    counterpartyKpp: cpKpp,
    contractName,
    nomenclatureName: nomName,
    employeeName,
    usefulLifeMonths: resolvedUsefulLifeMonths,
    db1C,
    priorOperations: priorOps,
    futureOperations: batchContext?.futureOperations,
    virtualStateBefore: priorVirtualState,
    currentOpNumber: batchContext?.currentOpNumber,
  });
  resolverStep01Trace = universalResolved.step01Breakdown;

  if (category === 'financial_disposal' && universalResolved.disposedNote) {
    resolvedDisposedNoteId = universalResolved.disposedNote.key;
  }

  if (
    !isNonPostingEventCategory &&
    effectiveDraftAmount < 0.01 &&
    universalResolved.resolvedAmount >= 0.01
  ) {
    effectiveDraftAmount = universalResolved.resolvedAmount;
    amountMode = universalResolved.amountMode;
    calculationProvenance = universalResolved.step01Breakdown.summaryFormula;
    amountCalculationNote = universalResolved.step01Breakdown.summaryFormula;
    if (universalResolved.vatRule !== undefined && inheritedVatRule === undefined) {
      inheritedVatRule = universalResolved.vatRule;
    }
    if (universalResolved.vatRate !== undefined && inheritedVatRate === undefined) {
      inheritedVatRate = universalResolved.vatRate;
    }
  } else if (
    (category === 'intangible_commissioning' || category === 'intangible_amortization') &&
    effectiveDraftAmount < 0.01 &&
    universalResolved.amountMode === 'calculated_by_1c'
  ) {
    amountMode = 'calculated_by_1c';
    calculationProvenance = universalResolved.step01Breakdown.summaryFormula;
    amountCalculationNote = universalResolved.step01Breakdown.summaryFormula;
  }

  if (
    !cpName &&
    universalResolved.counterpartyName &&
    (needsCounterparty || doesSpecAcceptCounterpartySubconto(category))
  ) {
    cpName = universalResolved.counterpartyName;
    cpInn = universalResolved.counterpartyInn || cpInn;
    cpKpp = universalResolved.counterpartyKpp || cpKpp;
    if (!contractName && universalResolved.contractName) {
      contractName = universalResolved.contractName;
    }
    const m1c = matchPersonOrCounterpartyIn1C(cpName, cpInn, db1C);
    if (m1c) {
      cpName = m1c.name;
      cpInn = cpInn || m1c.inn;
      cpKpp = cpKpp || m1c.kpp;
      cpSource = 'db_1c';
      cpBinding = {
        status: 'matched_1c',
        matchedName: m1c.name,
        matchedCode1C: m1c.code1C,
        matchedInn: cpInn,
        note: universalResolved.step01Breakdown.summaryFormula,
      };
    } else {
      cpSource = cpInn.length === 10 || cpInn.length === 12 ? 'excel_explicit' : 'unresolved';
      cpBinding = {
        status: 'new_for_1c',
        note: universalResolved.step01Breakdown.summaryFormula,
      };
    }
    if (contractName && contractBinding.status === 'missing') {
      contractBinding = {
        status: cpBinding.status === 'matched_1c' ? 'matched_1c' : 'new_for_1c',
        matchedName: cpBinding.status === 'matched_1c' ? contractName : undefined,
        note: 'Договор связан из хронологического контекста',
      };
    }
  }

  const isOsSaleDisposal =
    category === 'os_disposal' && /продан|реализ/iu.test(descLower) && hadExplicitInputAmount;

  const specForVat = getDocumentSpecByCategory(category);
  const isNeverVatBySpec =
    specForVat.vatPolicy === 'forbidden' ||
    (category === 'os_disposal' && !isOsSaleDisposal) ||
    ((category === 'manual' || category === 'off_balance_op') && inlineCorr.length > 0) ||
    Boolean(draft.explicitDebit && draft.explicitCredit);

  let vatRule: 'included' | 'on_top' | 'none' = inheritedVatRule ?? 'included';
  let vatRate = inheritedVatRate !== undefined ? inheritedVatRate : isOsno ? policyVatRate : 0;

  const isPriceNetWithVatOnTop =
    /(?:по\s+)?цен\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|стоимост\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|сумм\p{L}*\s+без\s*(?:уч[её]та\s*)?ндс|кроме\s+того\s+ндс|сверху\s*ндс|плюс\s*ндс|\+\s*ндс|ндс\s+сверху/iu.test(
      descLower
    );

  if (
    isNeverVatBySpec ||
    (specForVat.vatPolicy === 'optional_by_text' && !/ндс/iu.test(descLower)) ||
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
  const needsAmount =
    !isCalculatedBy1C &&
    !doesSpecAllowZeroPostings(category) &&
    category !== 'manual' &&
    totalWithVat < 0.01;
  if (needsAmount) {
    amountMode = 'required_missing';
  }

  if (needsAmount && !amountCalculationNote) {
    amountCalculationNote =
      resolverStep01Trace?.summaryFormula ||
      'Сумма не найдена в колонках файла и открытых регистрах учёта';
  }

  const explicitlyNoSF =
    /без\s+сч[её]та?-фактур|сч[её]т-фактур\p{L}*\s+не\s+(?:получен|предоставлен|выставлен)|отсутств\p{L}*\s+сч[её]т-фактур/iu.test(
      descLower
    );

  const hasInvoiceSF = isNeverVatBySpec
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
                'intangible_acquisition',
              ].includes(category)
          );

  const resolvedProjectNomGroup = (() => {
    if (
      /производств\p{L}*\s+труб\p{L}*|кирпичн\p{L}*\s+труб\p{L}*/iu.test(
        `${draft.description} ${draft.nomenclatureGroupHint || ''}`
      ) &&
      priorOps.some(
        (p) =>
          p.includeInProcessing &&
          !p.isDuplicateIn1C &&
          p.nomenclatureGroupName === 'Реконструкция кровли'
      )
    ) {
      return 'Реконструкция кровли';
    }

    const explicitHint =
      draft.nomenclatureGroupHint &&
      draft.nomenclatureGroupHint.trim() &&
      draft.nomenclatureGroupHint.trim() !== 'Основная номенклатурная группа'
        ? extractCanonicalProjectNomGroup1C(draft.nomenclatureGroupHint) || draft.nomenclatureGroupHint.trim()
        : undefined;
    if (explicitHint) return explicitHint;

    const fromText = extractCanonicalProjectNomGroup1C(
      `${draft.description} ${nomName || ''} ${draft.actionSequenceHint || ''}`
    );
    if (fromText) return fromText;

    // For customer handover / advance / invoice with known counterparty (e.g. "Сданы работы заказчику ООО «Слава»"),
    // inherit project group from earlier customer_invoice / advance for the same counterparty
    if (
      cpName &&
      ['sale_services', 'sale_goods', 'customer_invoice', 'bank_in'].includes(category)
    ) {
      const cpNorm = normalizeCounterpartyKey1C(cpName);
      for (let i = priorOps.length - 1; i >= 0; i--) {
        const pOp = priorOps[i];
        if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
        if (normalizeCounterpartyKey1C(pOp.counterpartyName) !== cpNorm) continue;
        if (
          pOp.nomenclatureGroupName &&
          pOp.nomenclatureGroupName !== 'Основная номенклатурная группа'
        ) {
          return pOp.nomenclatureGroupName;
        }
        const pProj = extractCanonicalProjectNomGroup1C(pOp.description);
        if (pProj) return pProj;
      }
    }

    // For 20.01 direct production costs (materials write-off, purchase_materials with immediate write-off, workwear, subcontract services),
    // infer active construction project from material type or current month's open customer order
    if (
      resolvedCostAccount === '20.01' &&
      ['materials_writeoff', 'purchase_materials', 'workwear_issue', 'purchase_services'].includes(category)
    ) {
      const matLow = `${nomName || ''} ${draft.description}`.toLowerCase().replace(/ё/g, 'е');
      const findActivePriorProject = (preferred: string[]): string | undefined => {
        for (const pref of preferred) {
          if (
            priorOps.some(
              (p) =>
                p.includeInProcessing &&
                !p.isDuplicateIn1C &&
                p.nomenclatureGroupName === pref
            )
          ) {
            return pref;
          }
        }
        return undefined;
      };
      if (/обои|краск/iu.test(matLow)) {
        const p = findActivePriorProject(['Отделка помещений', 'Ремонт помещений']);
        if (p) return p;
      }
      if (/бетон|доск/iu.test(matLow)) {
        const p = findActivePriorProject(['Бетонное покрытие']);
        if (p) return p;
      }
      if (/керамогранит|металлопрофил|утеплител/iu.test(matLow)) {
        const p = findActivePriorProject(['Ремонт фасада']);
        if (p) return p;
      }
      const curMonth = (draft.date || '').slice(0, 7);
      for (let i = priorOps.length - 1; i >= 0; i--) {
        const pOp = priorOps[i];
        if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
        if (curMonth && !(pOp.date || '').startsWith(curMonth)) continue;
        if (
          pOp.nomenclatureGroupName &&
          pOp.nomenclatureGroupName !== 'Основная номенклатурная группа' &&
          (pOp.category === 'customer_invoice' ||
            (pOp.category === 'bank_in' && /аванс|предоплат/iu.test(pOp.description)) ||
            pOp.category === 'materials_writeoff')
        ) {
          return pOp.nomenclatureGroupName;
        }
      }
    }

    return undefined;
  })();

  const nomGroup =
    resolvedProjectNomGroup ||
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

  // Safety valve: validated customPostings from Layer 1 LLM Chief Accountant (or manual entry) for exotic ОперацияБух
  const validCustomPostings = (draft.customPostings ?? [])
    .map((cp) => {
      const rawDt = (cp.debit ?? '').trim();
      const rawKt = (cp.credit ?? '').trim();
      const dtLeaf = rawDt ? normalizeAccountToLeaf1C(rawDt, 'debit', cp.description || draft.description) : '';
      const ktLeaf = rawKt ? normalizeAccountToLeaf1C(rawKt, 'credit', cp.description || draft.description) : '';
      const isOffBal = isOffBalanceAccountCode(dtLeaf) || isOffBalanceAccountCode(ktLeaf);
      const dtInfo = dtLeaf ? getAccountInfo(dtLeaf) : undefined;
      const ktInfo = ktLeaf ? getAccountInfo(ktLeaf) : undefined;
      const valid = isOffBal
        ? Boolean((dtInfo && !dtInfo.isGroup) || (ktInfo && !ktInfo.isGroup))
        : Boolean(dtInfo && !dtInfo.isGroup && ktInfo && !ktInfo.isGroup);
      return { cp, dtLeaf, ktLeaf, isOffBal, valid };
    })
    .filter((item) => item.valid);

  if (
    validCustomPostings.length > 0 &&
    (category === 'manual' || category === 'off_balance_op' || docType1C === 'ОперацияБух')
  ) {
    for (const { cp, dtLeaf, ktLeaf, isOffBal } of validCustomPostings) {
      const pairAmt =
        cp.amount && cp.amount > 0
          ? round2(cp.amount)
          : validCustomPostings.length === 1
            ? totalWithVat
            : round2(totalWithVat / validCustomPostings.length);
      pushEntry(
        dtLeaf,
        ktLeaf,
        pairAmt,
        dtLeaf
          ? cp.debitSubconto || cpSubconto || nomName || employeeName || expenseItemName || 'Прочие операции'
          : '',
        ktLeaf
          ? cp.creditSubconto || cpSubconto || bankSubconto || nomName || employeeName || 'Прочие операции'
          : '',
        cp.description || draft.description,
        isOffBal ? { isOffBalance: true } : undefined
      );
    }
  } else if (inlineCorr.length > 0 && (category === 'manual' || category === 'off_balance_op')) {
    for (const corr of inlineCorr) {
      const pairAmt =
        corr.amount && corr.amount > 0
          ? corr.amount
          : inlineCorr.length === 1
            ? totalWithVat
            : round2(totalWithVat / inlineCorr.length);
      if (corr.isOffBalance) {
        const dtLeaf = corr.debit
          ? normalizeAccountToLeaf1C(corr.debit, 'debit', draft.description)
          : '';
        const ktLeaf = corr.credit
          ? normalizeAccountToLeaf1C(corr.credit, 'credit', draft.description)
          : '';
        pushEntry(
          dtLeaf,
          ktLeaf,
          pairAmt,
          dtLeaf ? cpSubconto || nomName || employeeName : '',
          ktLeaf ? cpSubconto || nomName || employeeName : '',
          draft.description,
          { isOffBalance: true }
        );
      } else {
        const dtLeaf = normalizeAccountToLeaf1C(corr.debit, 'debit', draft.description);
        const ktLeaf = normalizeAccountToLeaf1C(corr.credit, 'credit', draft.description);
        pushEntry(
          dtLeaf,
          ktLeaf,
          pairAmt,
          cpSubconto || nomName || employeeName || expenseItemName,
          cpSubconto || bankSubconto || nomName,
          draft.description
        );
      }
    }
  } else if (draft.explicitDebit && draft.explicitCredit) {
    const dtLeaf = normalizeAccountToLeaf1C(draft.explicitDebit, 'debit', draft.description);
    const ktLeaf = normalizeAccountToLeaf1C(draft.explicitCredit, 'credit', draft.description);
    pushEntry(
      dtLeaf,
      ktLeaf,
      totalWithVat,
      cpSubconto || nomName || employeeName,
      cpSubconto || bankSubconto,
      draft.description
    );
  } else if (
    (draft.explicitDebit && isOffBalanceAccountCode(draft.explicitDebit)) ||
    (draft.explicitCredit && isOffBalanceAccountCode(draft.explicitCredit))
  ) {
    pushEntry(
      draft.explicitDebit ?? '',
      draft.explicitCredit ?? '',
      totalWithVat,
      draft.explicitDebit ? cpSubconto || nomName : '',
      draft.explicitCredit ? cpSubconto || nomName : '',
      draft.description,
      { isOffBalance: true }
    );
  } else {
    switch (category) {
      case 'bank_out': {
        const isNotePurchasePayment =
          /за\s+(?:приобретен\p{L}*\s+|получен\p{L}*\s+)?(?:вексел|ценн\p{L}*\s+бумаг)/iu.test(descLower);
        const isBuyerAdvanceRefund =
          /возврат\p{L}*.*(?:аванс|предоплат|излишн)|возвращен\p{L}*.*(?:аванс|покупател|заказчик)/iu.test(
            descLower
          );
        const isExplicitAdvance = !isBuyerAdvanceRefund && /аванс|предоплат/i.test(descLower);
        let dtAcc = isNotePurchasePayment
          ? '76.09'
          : isBuyerAdvanceRefund
            ? '62.02'
            : isExplicitAdvance
              ? '60.02'
              : '60.01';

        if (!isNotePurchasePayment && !isBuyerAdvanceRefund) {
          if (unpaid6001Resolution) {
            dtAcc = '60.01';
          } else if (!isExplicitAdvance && batchContext && cpName) {
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
            if (
              !hasPriorReceipt &&
              !hasDbDebt &&
              !db1C?.rawBalances.some((b) => b.account === '60.01' && b.rawCredit > 0)
            ) {
              dtAcc = '60.02';
            }
          }
        }

        let bankOutAmt = totalWithVat;
        if (isNotePurchasePayment && bankOutAmt < 0.01) {
          const prevNoteAcq = [...priorOps]
            .reverse()
            .find(
              (o) =>
                o.includeInProcessing &&
                o.category === 'financial_investment' &&
                o.amount >= 0.01 &&
                (!draft.date || !o.date || o.date <= draft.date)
            );
          if (prevNoteAcq) {
            bankOutAmt = round2(prevNoteAcq.amount);
          } else {
            const osv7609 = calculateOsvReport({
              db1C,
              operations: priorOps,
              dateTo: draft.date || undefined,
              reportingYear: batchContext?.reportingYear,
              includeQueuedOperations: true,
            });
            const row7609 = osv7609.leafRows.find((r) => r.code === '76.09');
            if (row7609 && row7609.endCredit >= 0.01) {
              bankOutAmt = row7609.endCredit;
            }
          }
        }

        const matchedSupplierBuckets = new Map<
          string,
          { cpLabel: string; contractLabel: string; amount: number }
        >();
        if (
          unpaid6001Resolution &&
          dtAcc === '60.01' &&
          Math.abs(bankOutAmt - unpaid6001Resolution.totalUnpaidAmount) < 0.05
        ) {
          for (const s of unpaid6001Resolution.matchedSettlements) {
            const key = normalizeEntityKey(s.counterpartyName || cpName) || 'default';
            const cur = matchedSupplierBuckets.get(key) ?? {
              cpLabel: s.counterpartyName || cpName,
              contractLabel: s.contractName || contractName || 'Основной договор',
              amount: 0,
            };
            cur.amount = round2(cur.amount + s.remainingAmount);
            matchedSupplierBuckets.set(key, cur);
          }
        }

        if (matchedSupplierBuckets.size > 1) {
          for (const bucket of matchedSupplierBuckets.values()) {
            const sub = [bucket.cpLabel, bucket.contractLabel].filter(Boolean).join(' / ');
            pushEntry(
              '60.01',
              '51',
              bucket.amount,
              sub,
              bankSubconto,
              `Оплата поставщику «${bucket.cpLabel}» с расчётного счёта`
            );
          }
        } else {
          pushEntry(
            dtAcc,
            '51',
            bankOutAmt,
            cpSubconto || cpName || 'Контрагент',
            bankSubconto,
            dtAcc === '76.09'
              ? 'Оплата за приобретённые ценные бумаги (векселя)'
              : dtAcc === '62.02'
                ? 'Возврат аванса покупателю с расчётного счёта'
                : dtAcc === '60.02'
                  ? 'Перечислен аванс поставщику'
                  : 'Оплата поставщику с расчётного счёта'
          );
          if (isBuyerAdvanceRefund && isOsno && bankOutAmt >= 0.01 && cpName) {
            const hasPrior76AV = priorOps.some(
              (o) =>
                normalizeEntityKey(o.counterpartyName) === normalizeEntityKey(cpName) &&
                o.entries.some((e) => e.debit === '76.АВ')
            );
            if (hasPrior76AV) {
              pushEntry(
                '68.02',
                '76.АВ',
                round2((bankOutAmt * 20) / 120),
                'Налог (взносы): начислено / уплачено',
                cpName,
                'Принят к вычету НДС при возврате аванса покупателю (п. 5 ст. 171 НК РФ)'
              );
            }
          }
        }
        break;
      }

      case 'bank_in': {
        const isNoteInterestReceipt =
          /(?:%%|процент\p{L}*).*(?:от\s+банк|вексел|ценн\p{L}*\s+бумаг)/iu.test(descLower) ||
          /(?:от\s+банк\p{L}*|вексел|ценн\p{L}*\s+бумаг).*(?:%%|процент\p{L}*)/iu.test(descLower) ||
          /задолженност\p{L}*\s+по\s+(?:%%|процент)/iu.test(descLower);
        let isAdvance = !isNoteInterestReceipt && /аванс|предоплат/i.test(descLower);
        if (!isNoteInterestReceipt && !isAdvance && batchContext && cpName) {
          const normCpIn = normalizeEntityKey(cpName);
          const hasPriorShipment = priorOps.some(
            (o) =>
              o.includeInProcessing &&
              normalizeEntityKey(o.counterpartyName) === normCpIn &&
              o.entries.some((e) => e.debit === '62.01')
          );
          const hasDbReceivable = db1C?.postings.some(
            (p) =>
              p.debit === '62.01' &&
              normalizeEntityKey(`${p.counterpartyName ?? ''} ${p.debitSubconto.join(' ')}`).includes(
                normCpIn
              )
          );
          if (
            !hasPriorShipment &&
            !hasDbReceivable &&
            !db1C?.rawBalances.some((b) => b.account === '62.01' && b.rawDebit > 0)
          ) {
            isAdvance = true;
          }
        }
        const ktAcc = isNoteInterestReceipt ? '76.09' : isAdvance ? '62.02' : '62.01';
        let bankInAmt = totalWithVat;
        if (isNoteInterestReceipt && bankInAmt < 0.01) {
          const osv7609 = calculateOsvReport({
            db1C,
            operations: priorOps,
            dateTo: draft.date || undefined,
            reportingYear: batchContext?.reportingYear,
            includeQueuedOperations: true,
          });
          const row7609 = osv7609.leafRows.find((r) => r.code === '76.09');
          if (row7609 && row7609.endDebit >= 0.01) {
            bankInAmt = row7609.endDebit;
          }
        }
        pushEntry(
          '51',
          ktAcc,
          bankInAmt,
          bankSubconto,
          cpSubconto || cpName || 'Контрагент',
          isNoteInterestReceipt
            ? 'Поступили начисленные проценты по ценным бумагам (векселям)'
            : isAdvance
              ? 'Получен аванс от покупателя'
              : 'Поступление оплаты от покупателя'
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
        const founderSub = cpName || employeeName || 'Учредитель';
        const isAssetContribution =
          /в\s+виде\s+|бытовк|станок|станк|леса|бетоносмесител|оборудован|основн\p{L}*\s+средств|компьютер|автомобил|помещен|имуществ|ос(?=$|[^\p{L}])/iu.test(
            descLower
          ) && !/денежн|наличн|на\s+р\/с|на\s+расчетн/iu.test(descLower);
        if (isAssetContribution) {
          const inKindMatch = draft.description.match(/в\s+виде\s+([^\n(.,;]+)/iu);
          const assetLabel =
            nomName || (inKindMatch?.[1] ? inKindMatch[1].trim() : 'Внеоборотный актив (вклад в УК)');
          if (!nomName) {
            nomName = assetLabel;
          }
          pushEntry(
            '08.04.1',
            '75.01',
            totalWithVat,
            assetLabel,
            founderSub,
            draft.description || 'Получен вклад учредителя в уставный капитал основным средством'
          );
          if (/введен\p{L}*.*в\s+эксплуатац|принят\p{L}*\s+к\s+уч[её]т/iu.test(descLower)) {
            pushEntry(
              '01.01',
              '08.04.1',
              totalWithVat,
              assetLabel,
              assetLabel,
              `Введён в эксплуатацию объект ОС «${assetLabel}», внесённый в счёт вклада в УК`
            );
          }
        } else {
          const cashOrBankDt = docType1C === 'ПоступлениеНаличных' ? '50.01' : '51';
          pushEntry(
            cashOrBankDt,
            '75.01',
            totalWithVat,
            cashOrBankDt === '51' ? bankSubconto : cashFlowItemName,
            founderSub,
            draft.description || 'Взнос учредителя в уставный капитал (оплата доли)'
          );
        }
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
        const normDescPenalty = draft.description.replace(/ё/gi, 'е');
        const penaltyMatches = Array.from(
          normDescPenalty.matchAll(
            /(неуй?стойк\p{L}*|пен[ияей]\p{L}*|штраф\p{L}*)\s*(?:=|в\s+размере|на\s+сумму|в\s+сумме)?\s*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)?(?:\s*\(([^()]*)\))?/giu
          )
        );
        const hasInlineAccrual = /начислен/iu.test(normDescPenalty) && penaltyMatches.length > 0;
        const hasBankWriteoff =
          docType1C === 'СписаниеСРасчетногоСчета' ||
          /списан\p{L}*.*(?:р\/с|расчетн)|перечислен|уплачен|оплачен/iu.test(normDescPenalty);

        if (hasInlineAccrual) {
          let sumSanctions = 0;
          for (const m of penaltyMatches) {
            const kindWord = (m[1] || '').toLowerCase();
            const rawVal = Number((m[2] || '0').replace(/[\s\u00A0]/g, '').replace(',', '.'));
            const hint = (m[3] || '').toLowerCase();
            if (!Number.isFinite(rawVal) || rawVal < 0.01) continue;
            sumSanctions = round2(sumSanctions + rawVal);
            const dtSanction = /99|налогов\p{L}*\s+санкц|штраф\p{L}*\s+(?:фнс|ифнс|налог)/iu.test(
              `${hint} ${normDescPenalty}`
            )
              ? '99.02.3'
              : '91.02';
            pushEntry(
              dtSanction,
              '76.02',
              round2(rawVal),
              dtSanction.startsWith('99')
                ? 'Налоговые санкции'
                : 'Штрафы, пени и неустойки к уплате',
              cpSubconto || cpName || 'Контрагент по претензии',
              `Начислен${kindWord.startsWith('штраф') ? ' штраф' : 'а неустойка'} по исполнительному листу / договору`
            );
          }
          if (hasBankWriteoff) {
            if (sumSanctions >= 0.01) {
              pushEntry(
                '76.02',
                '51',
                sumSanctions,
                cpSubconto || cpName || 'Контрагент по претензии',
                bankSubconto,
                'Списаны с расчётного счёта начисленные штрафные санкции по исполнительному листу'
              );
            }
            const principalPayoff = round2(Math.max(0, totalWithVat - sumSanctions));
            if (principalPayoff >= 0.01 && /задолженност|основн\p{L}*\s+долг/iu.test(normDescPenalty)) {
              pushEntry(
                '60.01',
                '51',
                principalPayoff,
                cpSubconto || cpName || 'Поставщик',
                bankSubconto,
                `Погашена основная задолженность поставщику «${cpName || 'Контрагент'}» по исполнительному листу`
              );
            }
          }
        } else if (docType1C === 'СписаниеСРасчетногоСчета') {
          pushEntry(
            '76.02',
            '51',
            totalWithVat,
            cpSubconto,
            bankSubconto,
            draft.description || 'Перечисление по претензии / исполнительному листу'
          );
        } else if (
          docType1C === 'КорректировкаДолга' ||
          /корректировк\p{L}*\s+долг|по\s+иску\s+(?:ООО|АО|ПАО|ЗАО|ИП)|по\s+дог\.?\s*№?\s*\d+/iu.test(
            `${draft.description} ${draft.actionSequenceHint ?? ''}`
          ) ||
          priorVirtualState.openSettlements.some(
            (s) =>
              s.account === '60.01' &&
              s.remainingAmount > 0.01 &&
              cpName &&
              normalizeEntityKey(s.counterpartyName) === normalizeEntityKey(cpName)
          )
        ) {
          pushEntry(
            '91.02',
            '60.01',
            totalWithVat,
            'Штрафы, пени и неустойки к уплате',
            cpSubconto || cpName || 'Поставщик',
            draft.description || 'Начислена неустойка / судебные издержки (Корректировка долга на счёт 60.01)'
          );
        } else {
          const isTaxSanction =
            /99|налогов\p{L}*\s+санкц|(?:штраф|пен[ия])\p{L}*.*(?:налогов|фнс|ифнс)/iu.test(
              normDescPenalty
            );
          pushEntry(
            isTaxSanction ? '99.02.3' : '91.02',
            isTaxSanction ? '68.10' : '76.02',
            totalWithVat,
            isTaxSanction ? 'Налоговые санкции' : 'Штрафы, пени и неустойки к уплате',
            isTaxSanction ? 'Налог (взносы): начислено / уплачено' : cpSubconto,
            draft.description ||
              (isTaxSanction
                ? 'Начислена налоговая санкция (штраф ИФНС — счёт 99.02.3)'
                : 'Начислена претензия / неустойка')
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
        if (
          /и\s+(?:зачислен|внесен|сдан|перечислен)\p{L}*.*(?:на\s+р(?:асчетн\p{L}*\s+)?\/?сч|в\s+банк)/iu.test(
            descLower
          )
        ) {
          pushEntry(
            '51',
            '50.01',
            totalWithVat,
            bankSubconto,
            'Взнос наличными в банк',
            'Взнос возвращённого остатка подотчётных средств из кассы на расчётный счёт'
          );
        }
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
        if (
          /неизрасходованн\p{L}*.*(?:возвращ|внесен|сдан)\p{L}*.*в\s+касс|(?:возвращ|сдан)\p{L}*\s+остаток.*в\s+касс/iu.test(
            descLower
          )
        ) {
          const normEmp71 = normalizeEntityKey(employeeName);
          let open71 = 0;
          for (const pOp of priorOps) {
            if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
            if (draft.date && pOp.date && pOp.date > draft.date) continue;
            for (const e of pOp.entries) {
              if (
                e.debit === '71.01' &&
                (!normEmp71 ||
                  normalizeEntityKey(`${pOp.employeeName} ${e.debitSubconto}`).includes(normEmp71))
              ) {
                open71 = round2(open71 + e.amount);
              }
              if (
                e.credit === '71.01' &&
                (!normEmp71 ||
                  normalizeEntityKey(`${pOp.employeeName} ${e.creditSubconto}`).includes(normEmp71))
              ) {
                open71 = round2(open71 - e.amount);
              }
            }
          }
          const unspentReturn = round2(open71 - totalWithVat);
          if (unspentReturn >= 0.01) {
            pushEntry(
              '50.01',
              '71.01',
              unspentReturn,
              'Возврат от подотчетного лица',
              employeeName || 'Подотчётное лицо',
              'Возврат неизрасходованных подотчётных сумм в кассу по ПКО'
            );
            if (/и\s+(?:сдан|внесен|зачислен)\p{L}*.*(?:в\s+банк|на\s+р(?:асчетн\p{L}*\s+)?\/?сч)/iu.test(descLower)) {
              pushEntry(
                '51',
                '50.01',
                unspentReturn,
                bankSubconto,
                'Взнос наличными в банк',
                'Взнос возвращённого остатка подотчётных сумм из кассы на расчётный счёт'
              );
            }
          }
        }
        break;
      }

      case 'loan_received': {
        const isBankCredit = /кредит/iu.test(descLower) && !/займ|заем/iu.test(descLower);
        const isLongTerm = /долгосрочн/iu.test(descLower);
        const loanAcc = isLongTerm
          ? isBankCredit
            ? '67.01'
            : '67.03'
          : isBankCredit
            ? '66.01'
            : '66.03';
        pushEntry(
          '51',
          loanAcc,
          totalWithVat,
          bankSubconto,
          cpSubconto || cpName || (isBankCredit ? 'Банк-кредитор' : 'Заимодавец'),
          draft.description || (isBankCredit ? 'Получен кредит банка на расчётный счёт' : 'Получен заём на расчётный счёт')
        );
        break;
      }

      case 'loan_repaid': {
        const isBankCreditText = /кредит/iu.test(descLower) && !/займ|заем/iu.test(descLower);
        const hasPrior6601 = priorOps.some(
          (p) => p.includeInProcessing && p.entries.some((e) => e.credit === '66.01')
        );
        const hasPrior6701 = priorOps.some(
          (p) => p.includeInProcessing && p.entries.some((e) => e.credit === '67.01')
        );
        const isLongTerm = /долгосрочн/iu.test(descLower) || (!/краткосрочн/iu.test(descLower) && hasPrior6701);
        const isBankCredit = isBankCreditText || (hasPrior6601 && !/займ|заем/iu.test(descLower));
        const loanAcc = isLongTerm
          ? isBankCredit
            ? '67.01'
            : '67.03'
          : isBankCredit
            ? '66.01'
            : '66.03';
        const interestAcc =
          loanAcc === '67.01'
            ? '67.02'
            : loanAcc === '67.03'
              ? '67.04'
              : loanAcc === '66.01'
                ? '66.02'
                : '66.04';
        const isInterestOnlyRepayment =
          /(?:погашен|уплачен|перечислен|списан)\p{L}*\s+процент/iu.test(descLower) &&
          !/основн\p{L}*\s+долг/iu.test(descLower);
        pushEntry(
          isInterestOnlyRepayment ? interestAcc : loanAcc,
          '51',
          totalWithVat,
          cpSubconto || cpName || (isBankCredit ? 'Банк-кредитор' : 'Заимодавец'),
          bankSubconto,
          draft.description ||
            (isInterestOnlyRepayment
              ? 'Уплата начисленных процентов по кредиту / займу'
              : 'Погашение основного долга по кредиту / займу')
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
        let offsetAmt = 0;
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          offsetAmt = round2(Math.min(totalWithVat, availAdv));
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
        if (/через\s+подотчетн\p{L}*\s+лиц/iu.test(descLower)) {
          pushEntry(
            '60.01',
            '71.01',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            employeeName || 'Подотчётное лицо',
            'Оплата поставщику через подотчётное лицо (Авансовый отчёт)'
          );
        } else if (
          /(?:приобретен|приобрел|получен|поступил)\p{L}*\s+и\s+(?:оплачен|оплатил)\p{L}*|на\s+основании\s+[^\n]{0,65}произведен\p{L}*\s+оплат|произведен\p{L}*\s+оплат\p{L}*\s+на\s+основании|оплат\p{L}*\s+(?:поставщику\s+)?произведен/iu.test(
            descLower
          )
        ) {
          pushEntry(
            '60.01',
            '51',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            bankSubconto,
            'Оплата поставщику с расчётного счёта'
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
        let offsetAmt = 0;
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          offsetAmt = round2(Math.min(totalWithVat, availAdv));
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
        const paidViaAccountablePerson =
          /через\s+(?:подотчетн\p{L}*\s+лиц|[а-яё]+\s+[а-яё]\.\s*[а-яё]\.?)/iu.test(descLower) ||
          /авансов\p{L}*\s+отчет/iu.test(draft.actionSequenceHint ?? '');
        if (paidViaAccountablePerson) {
          pushEntry(
            '60.01',
            '71.01',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            employeeName || 'Подотчётное лицо',
            'Оплата поставщику через подотчётное лицо (Авансовый отчёт — вкладка «Оплата»)'
          );
        } else if (
          /(?:приобретен|приобрел|получен|поступил|купил)\p{L}*\s+и\s+(?:оплачен|оплатил)\p{L}*|на\s+основании\s+[^\n]{0,65}произведен\p{L}*\s+оплат|произведен\p{L}*\s+оплат\p{L}*\s+на\s+основании|оплат\p{L}*\s+(?:поставщику\s+)?произведен/iu.test(
            descLower
          )
        ) {
          pushEntry(
            '60.01',
            '51',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            bankSubconto,
            'Оплата поставщику с расчётного счёта'
          );
        }
        const combinedWriteoffHint = `${descLower} ${(draft.actionSequenceHint ?? '').toLowerCase()}`;
        if (
          /(?:[.;,]\s*|\s+и\s+|на\s+основании\s+ввести\s+)[^.;]*(?:переда(?:н|ч)\p{L}*|списан\p{L}*|отпущен\p{L}*).*(?:на\s+объект|в\s+производств|на\s+производств|производств\p{L}*\s+работ|для\s+благоустройств|в\s+эксплуатац)/iu.test(
            combinedWriteoffHint
          )
        ) {
          const isOfficeOrExploitation =
            matAcc === '10.09' || /в\s+эксплуатац|принтер|офисн\p{L}*\s+мебел/iu.test(combinedWriteoffHint);
          const costAcc = isOfficeOrExploitation ? '26' : resolvedCostAccount || '20.01';
          pushEntry(
            costAcc,
            matAcc,
            netWithoutVat,
            costAcc === '20.01'
              ? [nomGroup, expenseItemName || 'Материальные расходы'].filter(Boolean).join(' / ')
              : expenseItemName || 'Материальные расходы',
            matSubconto,
            `Передача материалов со счёта ${matAcc} в производство / эксплуатацию`
          );
          if (matAcc === '10.09' || matAcc === '10.10') {
            pushEntry(
              matAcc === '10.10' ? 'МЦ.02' : 'МЦ.04',
              '',
              netWithoutVat,
              `${employeeName || 'МОЛ организации'} / ${nomName || 'Инвентарь'}`,
              '',
              'Принят на забалансовый контроль малоценный инвентарь в эксплуатации',
              { isOffBalance: true, allowZeroCalculated: true }
            );
          }
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
        let offsetAmt = 0;
        if (batchContext && cpName && totalWithVat > 0) {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          offsetAmt = round2(Math.min(totalWithVat, availAdv));
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
        if (/через\s+подотчетн\p{L}*\s+лиц/iu.test(descLower)) {
          pushEntry(
            '60.01',
            '71.01',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            employeeName || 'Подотчётное лицо',
            'Оплата поставщику через подотчётное лицо'
          );
        } else if (
          /(?:приобретен|приобрел|получен|поступил)\p{L}*\s+и\s+(?:оплачен|оплатил)\p{L}*|на\s+основании\s+[^\n]{0,65}произведен\p{L}*\s+оплат|произведен\p{L}*\s+оплат\p{L}*\s+на\s+основании|оплат\p{L}*\s+(?:поставщику\s+)?произведен/iu.test(
            descLower
          )
        ) {
          pushEntry(
            '60.01',
            '51',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            bankSubconto,
            'Оплата поставщику оборудования с расчётного счёта'
          );
        }
        if (/введен\p{L}*.*в\s+эксплуатац|принят\p{L}*\s+к\s+уч[её]т\p{L}*\s+ос/iu.test(descLower)) {
          pushEntry(
            '01.01',
            equipAcc,
            netWithoutVat,
            nomName || 'Объект основных средств',
            equipSubconto,
            `Принятие к учёту и ввод в эксплуатацию объекта ОС (${nomName || 'ОС'})`
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
          costAcc === '20.01'
            ? [nomGroup, expenseItemName || 'Амортизация'].filter(Boolean).join(' / ')
            : expenseItemName || 'Амортизация',
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
          costAcc === '20.01'
            ? [nomGroup, expenseItemName || 'Страховые взносы'].filter(Boolean).join(' / ')
            : expenseItemName || 'Страховые взносы',
          'Страховые взносы по единому тарифу',
          draft.description || 'Начислены страховые взносы',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: '30% от штатного ФОТ за месяц',
          }
        );
        break;
      }

      case 'hr_hire':
      case 'writ_of_execution':
      case 'contract_event':
      case 'customer_invoice':
      case 'supplier_invoice':
      case 'policy_event': {
        // Non-posting directory/policy/HR/invoice registration events (0 balance-sheet entries)
        break;
      }

      case 'alimony_payout': {
        const runningOsv7641 = batchContext
          ? calculateOsvReport({
              db1C,
              operations: priorOps,
              dateTo: draft.date || undefined,
              reportingYear: batchContext.reportingYear,
              includeQueuedOperations: true,
            })
          : null;
        const openSubs7641 = (runningOsv7641?.subcontoRowsByAccount?.['76.41'] ?? []).filter(
          (s) => s.endCredit >= 0.01
        );
        const openSum7641 = round2(openSubs7641.reduce((acc, s) => acc + s.endCredit, 0));
        if (openSubs7641.length >= 1 && Math.abs(openSum7641 - totalWithVat) < 0.05) {
          for (const sub of openSubs7641) {
            pushEntry(
              '76.41',
              '51',
              sub.endCredit,
              sub.subcontoLabel,
              bankSubconto,
              `Перечисление удержанных алиментов по исполнительному листу (${sub.subcontoLabel})`
            );
          }
        } else {
          const matchedSub = openSubs7641.find(
            (s) =>
              Math.abs(s.endCredit - totalWithVat) < 0.05 ||
              (resolvedAlimonyRecipientName &&
                normalizeEntityKey(s.subcontoLabel) === normalizeEntityKey(resolvedAlimonyRecipientName))
          );
          const recSub =
            matchedSub?.subcontoLabel ||
            [
              resolvedAlimonyRecipientName || 'Получатель алиментов',
              resolvedAlimonyRecipientInn ? `ИНН ${resolvedAlimonyRecipientInn}` : '',
            ]
              .filter(Boolean)
              .join(' / ');
          pushEntry(
            '76.41',
            '51',
            totalWithVat,
            recSub,
            bankSubconto,
            `Перечисление удержанных алиментов по исполнительному листу (${resolvedAlimonyRecipientName || 'получателю'})`
          );
        }
        break;
      }

      case 'financial_investment': {
        const paidDirectlyFromBank =
          /с\s+р\/с|с\s+расчетн\p{L}*\s+счет|оплачен\p{L}*\s+с\s+р\/с|безналичн/iu.test(descLower) ||
          draft.explicitCredit === '51';
        const finKtAcc = paidDirectlyFromBank ? '51' : '76.09';
        const finKtSub =
          finKtAcc === '51'
            ? bankSubconto
            : cpSubconto || cpName || 'Прочие дебиторы и кредиторы (продавец ценных бумаг)';
        if (resolvedFinancialNotesList && resolvedFinancialNotesList.length > 0) {
          const existing5802Count = priorVirtualState.financialInvestments.filter(
            (f) => f.account === '58.02'
          ).length;
          resolvedFinancialNotesList.forEach((n, idx) => {
            const paperIdx = existing5802Count + idx + 1;
            const noteOfficialName =
              n.label ||
              `Вексель №${paperIdx} (${n.principal.toLocaleString('ru-RU')} ₽ под ${n.ratePercent}%)`;
            pushEntry(
              '58.02',
              finKtAcc,
              n.principal,
              noteOfficialName,
              finKtSub,
              `Приобретение долговой ценной бумаги: ${noteOfficialName} (счёт 58.02)`
            );
          });
        } else {
          const finDtSub =
            resolvedFinancialNotesSummary || nomName || 'Долговые ценные бумаги (векселя)';
          pushEntry(
            '58.02',
            finKtAcc,
            totalWithVat,
            finDtSub,
            finKtSub,
            draft.description || 'Приобретение долговых ценных бумаг (векселей) — счёт 58.02'
          );
        }
        break;
      }

      case 'financial_interest_accrual': {
        const noteItems = universalResolved.noteInterestItems ?? [];
        let interestTotal = totalWithVat;
        if (noteItems.length > 0 && !hadExplicitInputAmount) {
          interestTotal = 0;
          for (const item of noteItems) {
            interestTotal = round2(interestTotal + item.interestAmount);
            pushEntry(
              '76.09',
              '91.01',
              item.interestAmount,
              item.note.counterpartyName || cpName || item.note.name,
              'Проценты к получению по ценным бумагам (векселям)',
              `Начислены проценты по ${item.note.name}: ${item.formulaLabel}`,
              { amountRuleNote: item.formulaLabel }
            );
          }
        } else {
          pushEntry(
            '76.09',
            '91.01',
            totalWithVat,
            cpSubconto || cpName || nomName || 'Эмитент векселя (проценты)',
            'Проценты к получению по ценным бумагам (векселям)',
            draft.description || 'Начислены проценты по долговым ценным бумагам (векселям)'
          );
        }
        if (
          interestTotal >= 0.01 &&
          /и\s+(?:получен|поступил|зачислен)\p{L}*|получен\p{L}*\s+на\s+р\/с/iu.test(descLower)
        ) {
          pushEntry(
            '51',
            '76.09',
            interestTotal,
            bankSubconto,
            cpSubconto || cpName || nomName || 'Эмитент векселя (проценты)',
            'Зачислены на расчётный счёт проценты по долговым ценным бумагам'
          );
        }
        break;
      }

      case 'financial_disposal': {
        const targetNote =
          universalResolved.disposedNote ??
          matchTargetActiveFinancialNote1C(priorVirtualState, draft.description);
        if (targetNote && !resolvedDisposedNoteId) {
          resolvedDisposedNoteId = targetNote.key;
        }
        const bookCost = round2(targetNote?.principalAmount ?? totalWithVat);
        const prevAccrued = round2(targetNote?.accruedInterestAmount ?? 0);
        const remInterest = round2(universalResolved.disposedRemainingInterest ?? 0);
        const isEndorsedWithInterest =
          /с\s+уч[её]том\s*(?:начислен\p{L}*\s*)?(?:%%|процент)/iu.test(descLower);
        const isEndorsedToSupplier =
          /поставщик|подрядчик|в\s+сч[её]т\s+(?:оплат|погашен|задолженност|долг|расчет)|передан\p{L}*\s+вексел|индоссам/iu.test(
            descLower
          ) ||
          (Boolean(cpName) &&
            !/погашен\p{L}*\s+(?:банк|эмитент)|на\s+р\/с|на\s+расчетн/iu.test(descLower));

        const noteSub =
          targetNote?.name || resolvedFinancialNotesSummary || nomName || 'Вексель третьего лица';
        const issuerSub = targetNote?.counterpartyName || noteSub;
        const settlementSub = cpSubconto || cpName || noteSub;

        if (remInterest >= 0.01 && (!isEndorsedToSupplier || /начислен\p{L}*.*(?:%%|процент)/iu.test(descLower))) {
          pushEntry(
            '76.09',
            '91.01',
            remInterest,
            issuerSub,
            'Проценты к получению по ценным бумагам (векселям)',
            `Доначислены проценты по ${noteSub} на дату выбытия`
          );
        }

        const transferValue =
          hadExplicitInputAmount && totalWithVat >= 0.01
            ? totalWithVat
            : isEndorsedToSupplier && !isEndorsedWithInterest
              ? bookCost
              : round2(bookCost + prevAccrued + remInterest);

        const totalAccruedIncludedInTransfer =
          isEndorsedToSupplier && !isEndorsedWithInterest ? 0 : round2(prevAccrued + remInterest);
        const proceeds9101 = round2(transferValue - totalAccruedIncludedInTransfer);
        if (proceeds9101 >= 0.01) {
          pushEntry(
            '76.09',
            '91.01',
            proceeds9101,
            settlementSub,
            'Выбытие (передача/погашение) ценных бумаг',
            `Отражён прочий доход от выбытия ${noteSub}`
          );
        } else if (proceeds9101 <= -0.01) {
          pushEntry(
            '91.02',
            '76.09',
            Math.abs(proceeds9101),
            'Прочие расходы при выбытии ценных бумаг',
            settlementSub,
            `Списана разница при выбытии ${noteSub}`
          );
        }
        if (bookCost >= 0.01) {
          pushEntry(
            '91.02',
            '58.02',
            bookCost,
            'Списание балансовой стоимости ценных бумаг',
            noteSub,
            `Списана балансовая стоимость выбывшего ${noteSub} (ПБУ 19/02)`
          );
        }
        if (transferValue >= 0.01) {
          if (isEndorsedToSupplier) {
            pushEntry(
              '60.01',
              '76.09',
              transferValue,
              cpSubconto || cpName || 'Поставщик',
              settlementSub,
              `Зачтена стоимость переданного ${noteSub} в счёт оплаты поставщику`
            );
          } else {
            pushEntry(
              '51',
              '76.09',
              transferValue,
              bankSubconto,
              settlementSub,
              `Поступили денежные средства при погашении ${noteSub}`
            );
          }
        }

        if (
          isEndorsedToSupplier &&
          /остаток.*(?:перечислен|оплачен|списан)|доплат\p{L}*.*(?:р\/с|расчетн)/iu.test(descLower) &&
          cpName
        ) {
          const unpaidRes = resolveUnpaidSupplier6001ByKeywords(
            priorVirtualState,
            draft.description,
            cpName || undefined,
            0
          );
          const remDebt = round2((unpaidRes?.totalUnpaidAmount ?? 0) - transferValue);
          if (remDebt >= 0.01) {
            pushEntry(
              '60.01',
              '51',
              remDebt,
              cpSubconto || cpName,
              bankSubconto,
              `Перечислен с расчётного счёта остаток задолженности поставщику «${cpName}»`
            );
          }
        }
        break;
      }

      case 'loan_issued': {
        pushEntry(
          '58.03',
          '51',
          totalWithVat,
          cpSubconto || cpName || 'Заёмщик (процентный заём)',
          bankSubconto,
          draft.description || 'Предоставлен процентный заём контрагенту (счёт 58.03)'
        );
        break;
      }

      case 'loan_interest_accrual': {
        const isReceivedLoanInterest =
          !/выданн\p{L}*\s+займ/iu.test(descLower) &&
          (/по\s+(?:полученн\p{L}*\s+)?(?:краткосрочн\p{L}*\s+|долгосрочн\p{L}*\s+)?(?:займ|кредит)|за\s+пользовани\p{L}*\s+(?:займ|кредит)|кредит\p{L}*\s+банк|заимодавц/iu.test(
            descLower
          ) ||
            priorOps.some((p) => p.includeInProcessing && p.category === 'loan_received'));
        if (isReceivedLoanInterest) {
          const intKtAcc = /кредит/iu.test(descLower) ? '66.02' : '66.04';
          pushEntry(
            '91.02',
            intKtAcc,
            totalWithVat,
            'Проценты к уплате по займам и кредитам',
            cpSubconto || cpName || 'Заимодавец (банк)',
            draft.description || 'Начислены проценты по полученному кредиту (займу)'
          );
          if (
            /удержан\p{L}*|списан\p{L}*.*(?:с\s+р(?:асчетн\p{L}*\s+)?\/?сч|банк)|и\s+(?:уплачен|перечислен|оплачен)/iu.test(
              descLower
            )
          ) {
            pushEntry(
              intKtAcc,
              '51',
              totalWithVat,
              cpSubconto || cpName || 'Заимодавец (банк)',
              bankSubconto,
              'Списаны с расчётного счёта начисленные проценты по кредиту (займу)'
            );
          }
        } else {
          pushEntry(
            '76.09',
            '91.01',
            totalWithVat,
            cpSubconto || cpName || 'Заёмщик (проценты по выданному займу)',
            'Проценты к получению по предоставленным займам',
            draft.description || 'Начислены проценты к получению по выданному займу'
          );
        }
        break;
      }

      case 'os_disposal': {
        const commissionedAssets = Object.values(priorVirtualState.fixedAssets).filter(
          (fa) => fa.status === 'Введено в эксплуатацию (счёт 01.01)'
        );
        const reqStems = extractKeywordStems1C(`${nomName} ${draft.description}`);
        const matchedOs =
          commissionedAssets.find((fa) =>
            extractKeywordStems1C(fa.name).some((fs) => reqStems.some((rs) => stemsMatch1C(rs, fs)))
          ) ?? (commissionedAssets.length === 1 ? commissionedAssets[0] : undefined);
        const initialCost = round2(matchedOs?.initialCost ?? totalWithVat);
        let accumDepr = round2(matchedOs?.accumulatedDepreciation ?? 0);
        const assetSub = matchedOs?.name || nomName || 'Объект основных средств';

        // Per ФСБУ 6/2020 & 1С:БП 3.0 «ПередачаОС / СписаниеОС»: accrue depreciation for the disposal month
        // if the asset was commissioned in a prior month and disposal-month depreciation hasn't been posted yet
        const dispYm = (draft.date ?? '').slice(0, 7);
        const commYm = (matchedOs?.commissioningDate ?? '').slice(0, 7);
        if (matchedOs && dispYm && commYm && commYm < dispYm && accumDepr < initialCost - 0.01) {
          const osStems = extractKeywordStems1C(matchedOs.name);
          const alreadyHasAssetDeprInDispMonth = priorOps.some(
            (p) =>
              p.includeInProcessing &&
              !p.isDuplicateIn1C &&
              (p.date ?? '').slice(0, 7) === dispYm &&
              p.entries.some(
                (e) =>
                  e.credit === '02.01' &&
                  (osStems.length === 0 ||
                    extractKeywordStems1C(`${e.creditSubconto} ${e.description}`).some((es) =>
                      osStems.some((os) => stemsMatch1C(os, es))
                    ))
              )
          );
          if (!alreadyHasAssetDeprInDispMonth) {
            const spi =
              matchedOs.usefulLifeMonths && matchedOs.usefulLifeMonths > 0
                ? matchedOs.usefulLifeMonths
                : 60;
            const rawMDepr =
              matchedOs.monthlyDepreciation > 0
                ? matchedOs.monthlyDepreciation
                : round2(initialCost / spi);
            const mDepr = round2(Math.min(rawMDepr, Math.max(0, initialCost - accumDepr)));
            if (mDepr >= 0.01) {
              const originOsOp = matchedOs.firstSeenOpId
                ? priorOps.find((p) => p.id === matchedOs.firstSeenOpId)
                : undefined;
              const deprTargetAcc = originOsOp?.costAccount || '20.01';
              pushEntry(
                deprTargetAcc,
                '02.01',
                mDepr,
                deprTargetAcc === '20.01'
                  ? [nomGroup, 'Амортизация'].filter(Boolean).join(' / ')
                  : 'Амортизация',
                assetSub,
                `Начислена амортизация ОС «${assetSub}» за месяц выбытия (ФСБУ 6/2020)`
              );
              accumDepr = round2(accumDepr + mDepr);
            }
          }
        }

        const residualValue = round2(Math.max(0, initialCost - accumDepr));

        if (initialCost >= 0.01) {
          pushEntry(
            '01.09',
            '01.01',
            initialCost,
            assetSub,
            assetSub,
            `Списана первоначальная стоимость выбывающего ОС «${assetSub}» на субсчёт 01.09`
          );
        }
        if (accumDepr >= 0.01) {
          pushEntry(
            '02.01',
            '01.09',
            Math.min(initialCost, accumDepr),
            assetSub,
            assetSub,
            `Списана накопленная амортизация ОС «${assetSub}» в Кт 01.09`
          );
        }
        if (residualValue >= 0.01) {
          pushEntry(
            '91.02',
            '01.09',
            residualValue,
            'Списание основных средств (ФСБУ 6/2020)',
            assetSub,
            `Списана остаточная стоимость выбывшего ОС «${assetSub}» в прочие расходы`
          );
        }
        if (isOsSaleDisposal && totalWithVat >= 0.01) {
          const buyerSub =
            cpSubconto ||
            (cpName ? `${cpName} / ${contractName || 'Основной договор'}` : 'Покупатель ОС');
          pushEntry(
            '62.01',
            '91.01',
            totalWithVat,
            buyerSub,
            'Реализация основных средств',
            `Отражена выручка от продажи ОС «${assetSub}»`
          );
          if (vatAmount > 0) {
            pushEntry(
              '91.02',
              '68.02',
              vatAmount,
              'Реализация основных средств',
              'Налог (взносы): начислено / уплачено',
              'Начислен НДС при реализации основного средства'
            );
          }
          if (batchContext && cpName) {
            const availAdv6202 = computeCounterpartyAdvanceBalance(
              '62.02',
              cpName,
              cpInn,
              db1C,
              priorOps
            );
            const offsetAmt = round2(Math.min(totalWithVat, availAdv6202));
            if (offsetAmt >= 0.01) {
              pushEntry(
                '62.02',
                '62.01',
                offsetAmt,
                buyerSub,
                buyerSub,
                'Зачёт ранее полученного аванса покупателя при реализации ОС'
              );
              const hasPrior76AV = priorOps.some(
                (o) =>
                  o.includeInProcessing &&
                  normalizeEntityKey(o.counterpartyName) === normalizeEntityKey(cpName) &&
                  o.entries.some((e) => e.debit === '76.АВ')
              );
              if (hasPrior76AV && vatRate > 0) {
                const restVat = round2((offsetAmt * vatRate) / (100 + vatRate));
                if (restVat >= 0.01) {
                  pushEntry(
                    '68.02',
                    '76.АВ',
                    restVat,
                    'Налог (взносы): начислено / уплачено',
                    cpName,
                    'Принят к вычету НДС с зачтённого аванса при реализации ОС (п. 8 ст. 171 НК РФ)'
                  );
                }
              }
            }
          }
        }
        break;
      }

      case 'vat_deduction': {
        const runningOsv19 = calculateOsvReport({
          db1C,
          operations: priorOps,
          dateTo: draft.date || undefined,
          reportingYear: batchContext?.reportingYear,
          includeQueuedOperations: true,
        });
        const open19Rows = runningOsv19.leafRows
          .filter((r) => r.code.startsWith('19.') && r.endDebit >= 0.01)
          .sort((a, b) => b.endDebit - a.endDebit);

        if (totalWithVat < 0.01) {
          for (const row19 of open19Rows) {
            const subs19 = (runningOsv19.subcontoRowsByAccount?.[row19.code] ?? []).filter(
              (s) => s.endDebit >= 0.01
            );
            const sumSubs19 = round2(subs19.reduce((acc, s) => acc + s.endDebit, 0));
            if (subs19.length > 0 && Math.abs(sumSubs19 - row19.endDebit) < 0.02) {
              for (const s19 of subs19) {
                pushEntry(
                  '68.02',
                  row19.code,
                  s19.endDebit,
                  'Налог (взносы): начислено / уплачено',
                  s19.subcontoLabel === 'Без аналитики (субконто)' ? '' : s19.subcontoLabel,
                  `Принят к вычету накопленный НДС со счёта ${row19.code} (${s19.subcontoLabel})`
                );
              }
            } else {
              pushEntry(
                '68.02',
                row19.code,
                row19.endDebit,
                'Налог (взносы): начислено / уплачено',
                cpName || 'Счета-фактуры полученные',
                `Принят к вычету накопленный НДС со счёта ${row19.code}`
              );
            }
          }
        } else {
          let vatSubAcc = '19.03';
          if (/ос|основн\p{L}*\s+средств|оборудован|внеоборотн|08\.04|19\.01/iu.test(descLower)) {
            vatSubAcc = '19.01';
          } else if (/услуг|работ|аренд|связ|доставк|19\.04/iu.test(descLower)) {
            vatSubAcc = '19.04';
          } else if (open19Rows[0]) {
            vatSubAcc = open19Rows[0].code;
          }
          pushEntry(
            '68.02',
            vatSubAcc,
            totalWithVat,
            'Налог (взносы): начислено / уплачено',
            cpName || 'Счета-фактуры полученные',
            draft.description || 'Принят к вычету входной НДС в книгу покупок (ст. 171–172 НК РФ)'
          );
        }
        break;
      }

      case 'purchase_services': {
        const histAcc = findHistoricalExpenseAccount(cpName, db1C);
        const explicitCostHint =
          inlineCorr[0]?.debit && ['20.01', '25', '26', '44.01'].includes(inlineCorr[0].debit)
            ? inlineCorr[0].debit
            : undefined;
        const isDirectMaterialOrSiteDelivery =
          !/покупател|заказчик/iu.test(descLower) &&
          /(?:доставк|перевозк|транспортировк)\p{L}*\s+(?:цемент|кирпич|бетон|раствор|песк|щебн|арматур|материал|плит|доск|груз|сырь|комплектующ|на\s+объект|на\s+стройплощадк)/iu.test(
            descLower
          );
        const costAcc =
          explicitCostHint ||
          (isDirectMaterialOrSiteDelivery ? '20.01' : undefined) ||
          matchedNomAccount ||
          histAcc ||
          (/основн\w+\s+производств|субподряд|переработк\w+\s+сырь|строительн/iu.test(descLower)
            ? '20.01'
            : /доставк\w*\s+покупател|реклам|маркетинг|торгов/iu.test(descLower)
              ? '44.01'
              : '26');
        const settlementAcc =
          inlineCorr[0]?.credit?.startsWith('76') ||
          /взнос\p{L}*.*(?:саморегулируем|(?:^|[^\p{L}])сро(?=$|[^\p{L}]))/iu.test(descLower)
            ? '76.09'
            : '60.01';
        pushEntry(
          costAcc,
          settlementAcc,
          netWithoutVat,
          costAcc === '20.01'
            ? [nomGroup, expenseItemName || nomName || 'Материальные расходы'].filter(Boolean).join(' / ')
            : expenseItemName || nomName,
          cpSubconto || cpName,
          'Отражены услуги сторонних организаций'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.04',
            settlementAcc,
            vatAmount,
            cpName,
            cpSubconto || cpName,
            'Учтён входной НДС по приобретённым услугам'
          );
        }
        let offsetAmt = 0;
        if (batchContext && cpName && totalWithVat > 0 && settlementAcc === '60.01') {
          const availAdv = computeCounterpartyAdvanceBalance('60.02', cpName, cpInn, db1C, priorOps);
          offsetAmt = round2(Math.min(totalWithVat, availAdv));
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
        if (/через\s+подотчетн\p{L}*\s+лиц/iu.test(descLower)) {
          pushEntry(
            settlementAcc,
            '71.01',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            employeeName || 'Подотчётное лицо',
            'Оплата услуг через подотчётное лицо'
          );
        } else if (
          /(?:приобретен|приобрел|получен|поступил)\p{L}*\s+и\s+(?:оплачен|оплатил)\p{L}*|на\s+основании\s+[^\n]{0,65}произведен\p{L}*\s+оплат|произведен\p{L}*\s+оплат\p{L}*\s+на\s+основании|оплат\p{L}*\s+(?:поставщику\s+)?произведен|перечислен\p{L}*.*взнос/iu.test(
            descLower
          )
        ) {
          pushEntry(
            settlementAcc,
            '51',
            round2(totalWithVat - offsetAmt),
            cpSubconto || cpName,
            bankSubconto,
            'Оплата поставщику услуг / перечисление взноса с расчётного счёта'
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
          ) ||
          /отчет\p{L}*\s+производств|д\s*43\s*к\s*20/iu.test(draft.actionSequenceHint ?? '');
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
        } else if (isFinishedGoods) {
          const runningOsv20 = calculateOsvReport({
            db1C,
            operations: priorOps,
            dateTo: draft.date || undefined,
            reportingYear: batchContext?.reportingYear,
            includeQueuedOperations: true,
          });
          const row2001 = runningOsv20.leafRows.find((r) => r.code === '20.01');
          const openWipCost = round2(row2001?.endDebit ?? 0);
          if (openWipCost >= 0.01) {
            const prodSubconto = [nomName || 'Готовая продукция', warehouseName || 'Основной склад']
              .filter(Boolean)
              .join(' / ');
            pushEntry(
              '43',
              '20.01',
              openWipCost,
              prodSubconto,
              nomGroup,
              `Выпуск готовой продукции из производства (Отчёт производства за смену — ${effectiveQty ? `${effectiveQty} шт.` : 'партия'})`
            );
            pushEntry(
              '90.02.1',
              '43',
              openWipCost,
              nomGroup,
              prodSubconto,
              'Списана себестоимость реализованной готовой продукции со счёта 43'
            );
          }
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
        const fallbackWageCostAcc = resolvedCostAccount || '26';
        const empLabel =
          employeeName ||
          (payrollStaffSummary && payrollStaffSummary.length > 0
            ? payrollStaffSummary.map((s) => s.name).join(', ')
            : 'Сотрудники организации');
        const injRate = resolvedInjuryRate;
        const isSickLeaveOnly =
          Boolean(draft.semanticIntent?.employee?.isSickLeave) ||
          (/(?:больничн|временн\p{L}*\s+нетрудоспособност)/iu.test(descLower) &&
            !/заработн\p{L}*\s+плат\p{L}*\s+за\s+(?:месяц|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/iu.test(
              descLower
            ));
        const isMaterialAid = /материальн\p{L}*\s+помощ/iu.test(descLower);
        const materialAidExemptAmount = isMaterialAid ? Math.min(totalWithVat, 4000) : 0;

        const activeRosterForTax =
          payrollStaffSummary && payrollStaffSummary.some((s) => s.salary > 0)
            ? payrollStaffSummary.filter((s) => s.salary > 0)
            : [];
        const rosterSumCheck = round2(activeRosterForTax.reduce((acc, s) => acc + s.salary, 0));
        const useSplitRosterPostings =
          activeRosterForTax.length > 0 && Math.abs(rosterSumCheck - totalWithVat) < 1;

        const wageBuckets = new Map<
          string,
          {
            costAcc: '20.01' | '26' | '44.01';
            groupLabel: string;
            amount: number;
            employees: string[];
          }
        >();

        if (useSplitRosterPostings) {
          for (const staffRow of activeRosterForTax) {
            const cAcc: '20.01' | '26' | '44.01' =
              staffRow.costAccount || inferEmployeeCostAccount1C(staffRow.position);
            const gLabel =
              cAcc === '20.01'
                ? staffRow.nomenclatureGroup || nomGroup
                : '';
            const bucketKey = `${cAcc}|||${gLabel}`;
            const prev = wageBuckets.get(bucketKey);
            if (prev) {
              prev.amount = round2(prev.amount + staffRow.salary);
              prev.employees.push(staffRow.name);
            } else {
              wageBuckets.set(bucketKey, {
                costAcc: cAcc,
                groupLabel: gLabel,
                amount: round2(staffRow.salary),
                employees: [staffRow.name],
              });
            }
          }

          for (const bucket of wageBuckets.values()) {
            const effWageDt = isMaterialAid && !draft.costAccountHint ? '91.02' : bucket.costAcc;
            pushEntry(
              effWageDt,
              '70',
              bucket.amount,
              effWageDt === '91.02'
                ? 'Материальная помощь сотрудникам'
                : effWageDt === '20.01'
                  ? [bucket.groupLabel || nomGroup, expenseItemName || 'Оплата труда']
                      .filter(Boolean)
                      .join(' / ')
                  : expenseItemName || 'Оплата труда',
              bucket.employees.join(', '),
              isSickLeaveOnly
                ? `Начислено пособие по временной нетрудоспособности за счёт работодателя (${bucket.employees.join(', ')})`
                : isMaterialAid
                  ? `Начислена материальная помощь сотруднику (${bucket.employees.join(', ')})`
                  : effWageDt === '20.01'
                    ? `Начислена заработная плата производственного персонала (${bucket.groupLabel || nomGroup})`
                    : 'Начислена заработная плата административно-управленческого персонала (АУП)',
              {
                allowZeroCalculated: isCalculatedBy1C,
                amountRuleNote: 'По штатному расписанию и производственному календарю 2026 г.',
              }
            );
          }
        } else {
          const effFallbackWageDt =
            isMaterialAid && !draft.costAccountHint ? '91.02' : fallbackWageCostAcc;
          pushEntry(
            effFallbackWageDt,
            '70',
            totalWithVat,
            effFallbackWageDt === '91.02'
              ? 'Материальная помощь сотрудникам'
              : effFallbackWageDt === '20.01'
                ? [nomGroup, expenseItemName || 'Оплата труда'].filter(Boolean).join(' / ')
                : expenseItemName || 'Оплата труда',
            empLabel,
            isSickLeaveOnly
              ? 'Начислено пособие по временной нетрудоспособности (первые 3 дня за счёт работодателя)'
              : isMaterialAid
                ? 'Начислена материальная помощь сотруднику'
                : 'Начислена заработная плата за месяц',
            {
              allowZeroCalculated: isCalculatedBy1C,
              amountRuleNote: 'По штатному ФОТ за месяц (кнопка «Заполнить» в 1С)',
            }
          );
        }

        // Compute exact 2026 employee-by-employee НДФЛ 13% with standard child deductions (1400/2800/6000 up to 450k YTD, doubled for single parent),
        // property tax deduction (2 000 000 ₽), and 4 000 ₽ material aid exemption (п. 28 ст. 217 НК РФ)
        const computeMonthlyChildDeduction2026 = (children: number, singleParent: boolean): number => {
          if (!children || children <= 0) return 0;
          let base = 0;
          if (children >= 1) base += 1400;
          if (children >= 2) base += 2800;
          if (children >= 3) base += (children - 2) * 6000;
          return singleParent ? base * 2 : base;
        };

        const sumPriorYtdGrossForEmp = (personKey: string, hireDate?: string, fallbackSalary = 0): number => {
          let ytd = 0;
          for (const pOp of priorOps) {
            if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
            if (pOp.category !== 'payroll_accrual') continue;
            if (draft.date && pOp.date && pOp.date >= draft.date) continue;
            if (hireDate && pOp.date && pOp.date < hireDate) continue;
            const matchedRow = pOp.payrollStaffSummary?.find(
              (s) => normalizePersonIdentityKey1C(s.name) === personKey
            );
            if (matchedRow) {
              ytd = round2(ytd + (matchedRow.salary || 0));
            } else if (!pOp.payrollStaffSummary?.length && !pOp.employeeName) {
              ytd = round2(ytd + fallbackSalary);
            }
          }
          return ytd;
        };

        const hasPriorPayrollInSameMonthForEmp = (personKey: string): boolean => {
          const curYm = (draft.date ?? '').slice(0, 7);
          if (!curYm) return false;
            return priorOps.some(
              (pOp) =>
                pOp.includeInProcessing &&
                !pOp.isDuplicateIn1C &&
                pOp.category === 'payroll_accrual' &&
                !/материальн\p{L}*\s+помощ/iu.test(pOp.description || '') &&
                (pOp.date ?? '').slice(0, 7) === curYm &&
                (!draft.date || !pOp.date || pOp.date < draft.date) &&
                (pOp.payrollStaffSummary?.some(
                  (s) => normalizePersonIdentityKey1C(s.name) === personKey
                ) ||
                  normalizePersonIdentityKey1C(pOp.employeeName) === personKey)
            );
          };

        const ndflByPersonKey = new Map<string, number>();
        let computedTotalNdfl = 0;

        if (useSplitRosterPostings) {
          for (const staffRow of activeRosterForTax) {
            const pKey = normalizePersonIdentityKey1C(staffRow.name);
            const vEmp = priorVirtualState.employees.find(
              (e) => normalizePersonIdentityKey1C(e.fullName) === pKey || e.key === `emp:${pKey}`
            );
            const taxableRowGross =
              isMaterialAid && activeRosterForTax.length === 1
                ? Math.max(0, round2(staffRow.salary - materialAidExemptAmount))
                : staffRow.salary;
            const priorYtdGross = sumPriorYtdGrossForEmp(
              pKey,
              vEmp?.hireDate,
              staffRow.fullMonthlySalary ?? staffRow.salary
            );
            const ytdGrossIncludingCurrent = round2(priorYtdGross + taxableRowGross);

            let childDed = 0;
            // Apply monthly child deduction once per calendar month on regular payroll/sick/vacation accruals
            if (
              !isMaterialAid &&
              (vEmp?.childCount ?? 0) > 0 &&
              ytdGrossIncludingCurrent <= 450_000 &&
              !hasPriorPayrollInSameMonthForEmp(pKey)
            ) {
              childDed = computeMonthlyChildDeduction2026(
                vEmp!.childCount!,
                Boolean(vEmp?.isSingleParent)
              );
            }

            let taxableAfterChild = Math.max(0, round2(taxableRowGross - childDed));
            if (
              vEmp?.propertyTaxDeduction &&
              vEmp.propertyTaxDeduction > 0 &&
              (!vEmp.propertyTaxDeductionStartDate ||
                !draft.date ||
                vEmp.propertyTaxDeductionStartDate <= draft.date)
            ) {
              let usedPropDeduction = 0;
              for (const pOp of priorOps) {
                if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
                if (pOp.category !== 'payroll_accrual') continue;
                if (draft.date && pOp.date && pOp.date >= draft.date) continue;
                if (
                  vEmp.propertyTaxDeductionStartDate &&
                  pOp.date &&
                  pOp.date < vEmp.propertyTaxDeductionStartDate
                ) {
                  continue;
                }
                const prevRow = pOp.payrollStaffSummary?.find(
                  (s) => normalizePersonIdentityKey1C(s.name) === pKey
                );
                usedPropDeduction = round2(
                  usedPropDeduction + (prevRow ? prevRow.salary : 0)
                );
              }
              const remProp = Math.max(0, round2(vEmp.propertyTaxDeduction - usedPropDeduction));
              const appliedProp = Math.min(taxableAfterChild, remProp);
              taxableAfterChild = Math.max(0, round2(taxableAfterChild - appliedProp));
            }

            const empNdfl = Math.round(taxableAfterChild * 0.13);
            ndflByPersonKey.set(pKey, empNdfl);
            computedTotalNdfl = round2(computedTotalNdfl + empNdfl);
          }
        } else {
          const taxableTotal = Math.max(0, round2(totalWithVat - materialAidExemptAmount));
          computedTotalNdfl = Math.round(taxableTotal * 0.13);
        }

        if (computedTotalNdfl > 0 || isCalculatedBy1C) {
          pushEntry(
            '70',
            '68.01',
            computedTotalNdfl,
            empLabel,
            'НДФЛ исчисленный',
            'Удержан НДФЛ 13% (с учётом стандартных и имущественных вычетов НК РФ)',
            {
              allowZeroCalculated: isCalculatedBy1C,
              amountRuleNote: '13% от налоговой базы каждого сотрудника (ст. 217, 218, 220, 225 НК РФ)',
            }
          );
        }

        // Auto-withhold alimony / writs of execution (Дт 70 Кт 76.41) registered prior to or on payroll date
        const activeWrits = isMaterialAid
          ? []
          : resolveActiveWritsOfExecution1C(priorVirtualState, draft.date);
        if (activeWrits.length > 0) {
          const singleAccrualPersonKey =
            activeRosterForTax.length === 1
              ? normalizePersonIdentityKey1C(activeRosterForTax[0].name)
              : employeeName
                ? normalizePersonIdentityKey1C(employeeName)
                : '';
          for (const writ of activeWrits) {
            const writPersonKey = normalizePersonIdentityKey1C(writ.debtorEmployeeName);
            const writSurname = writ.debtorEmployeeName
              .toLowerCase()
              .replace(/ё/g, 'е')
              .split(/\s+/)[0];

            // On a targeted single-employee accrual, withhold alimony ONLY if this accrual belongs to the debtor
            if (
              singleAccrualPersonKey &&
              activeRosterForTax.length <= 1 &&
              singleAccrualPersonKey !== writPersonKey &&
              singleAccrualPersonKey.split(/\s+/)[0] !== writSurname
            ) {
              continue;
            }

            const matchedRosterEmp =
              payrollStaffSummary?.find(
                (r) =>
                  r.salary > 0 &&
                  (normalizePersonIdentityKey1C(r.name) === writPersonKey ||
                    r.name.toLowerCase().replace(/ё/g, 'е').split(/\s+/)[0] === writSurname)
              ) ??
              (payrollStaffSummary && payrollStaffSummary.length > 0
                ? undefined
                : priorVirtualState.employees.find(
                    (e) =>
                      (e.monthlySalary ?? 0) > 0 &&
                      (e.key === `emp:${writPersonKey}` ||
                        e.fullName.toLowerCase().replace(/ё/g, 'е').split(/\s+/)[0] === writSurname)
                  ));

            const debtorGross =
              matchedRosterEmp && 'salary' in matchedRosterEmp
                ? matchedRosterEmp.salary
                : matchedRosterEmp && 'monthlySalary' in matchedRosterEmp && matchedRosterEmp.monthlySalary
                  ? matchedRosterEmp.monthlySalary
                  : !payrollStaffSummary || payrollStaffSummary.filter((s) => s.salary > 0).length === 0
                    ? totalWithVat
                    : 0;
            if (debtorGross <= 0 && !isCalculatedBy1C) continue;

            const debtorNdfl =
              ndflByPersonKey.get(writPersonKey) ?? Math.round(debtorGross * 0.13);
            const debtorNetAfterNdfl = round2(debtorGross - debtorNdfl);
            const alimonyAmt =
              writ.fixedAmount && writ.fixedAmount > 0
                ? writ.fixedAmount
                : round2(debtorNetAfterNdfl * (writ.ratePercent / 100));

            if (alimonyAmt > 0 || isCalculatedBy1C) {
              pushEntry(
                '70',
                '76.41',
                alimonyAmt,
                writ.debtorEmployeeName,
                writ.recipientName,
                `Удержаны алименты по исполнительному листу (${writ.shareLabel || `${writ.ratePercent}%`})`,
                {
                  allowZeroCalculated: isCalculatedBy1C,
                  amountRuleNote:
                    writ.fixedAmount && writ.fixedAmount > 0
                      ? `Фиксированная сумма ${writ.fixedAmount.toLocaleString('ru-RU')} ₽/мес.`
                      : `${writ.shareLabel || `${writ.ratePercent}%`} от (Оклад − НДФЛ 13%)`,
                }
              );
            }
          }
        }

        // Per Art. 422 p. 1 subp. 1 NK RF, state temporary disability benefits (больничный, включая первые 3 дня за счёт работодателя)
        // are EXEMPT from insurance contributions (69.09 / 69.11). Material aid up to 4 000 ₽/yr is also exempt (subp. 11 p. 1 Art. 422 NK RF).
        if (!isSickLeaveOnly) {
          if (useSplitRosterPostings && wageBuckets.size > 0 && !isMaterialAid) {
            for (const bucket of wageBuckets.values()) {
              const subDt =
                bucket.costAcc === '20.01'
                  ? [bucket.groupLabel || nomGroup, 'Страховые взносы'].filter(Boolean).join(' / ')
                  : 'Страховые взносы';
              pushEntry(
                bucket.costAcc,
                '69.09',
                round2(bucket.amount * 0.3),
                subDt,
                'Страховые взносы по единому тарифу',
                bucket.costAcc === '20.01'
                  ? `Начислены страховые взносы 30% с ФОТ рабочих (${bucket.groupLabel || nomGroup})`
                  : 'Начислены страховые взносы 30% с ФОТ АУП',
                {
                  allowZeroCalculated: isCalculatedBy1C,
                  amountRuleNote: '30% от начисленного ФОТ подразделения',
                }
              );
              pushEntry(
                bucket.costAcc,
                '69.11',
                round2(bucket.amount * (injRate / 100)),
                subDt,
                'Взносы от НС и ПЗ',
                `Начислены взносы на травматизм (${injRate}%)`,
                {
                  allowZeroCalculated: isCalculatedBy1C,
                  amountRuleNote: `${injRate}% от начисленного ФОТ подразделения`,
                }
              );
            }
          } else {
            const insurableBase = Math.max(0, round2(totalWithVat - materialAidExemptAmount));
            if (insurableBase > 0 || isCalculatedBy1C) {
              const targetInsAcc =
                isMaterialAid && !draft.costAccountHint
                  ? '91.02'
                  : activeRosterForTax.length === 1 && activeRosterForTax[0].costAccount
                    ? activeRosterForTax[0].costAccount
                    : fallbackWageCostAcc;
              pushEntry(
                targetInsAcc,
                '69.09',
                round2(insurableBase * 0.3),
                targetInsAcc === '91.02'
                  ? 'Материальная помощь сотрудникам (страховые взносы)'
                  : targetInsAcc === '20.01'
                    ? [nomGroup, 'Страховые взносы'].filter(Boolean).join(' / ')
                    : 'Страховые взносы',
                'Страховые взносы по единому тарифу',
                'Начислены страховые взносы по единому тарифу (30%)',
                {
                  allowZeroCalculated: isCalculatedBy1C,
                  amountRuleNote: '30% от облагаемой базы (ст. 422, 425 НК РФ)',
                }
              );
              pushEntry(
                targetInsAcc,
                '69.11',
                round2(insurableBase * (injRate / 100)),
                targetInsAcc === '91.02'
                  ? 'Материальная помощь сотрудникам (страховые взносы)'
                  : targetInsAcc === '20.01'
                    ? [nomGroup, 'Страховые взносы'].filter(Boolean).join(' / ')
                    : 'Страховые взносы',
                'Взносы от НС и ПЗ',
                `Начислены взносы на травматизм (${injRate}%)`,
                {
                  allowZeroCalculated: isCalculatedBy1C,
                  amountRuleNote: `${injRate}% от облагаемой базы`,
                }
              );
            }
          }
        }
        break;
      }

      case 'closing': {
        // Chronological Month-End Closing (ЗакрытиеМесяца):
        // 1) Accrue monthly depreciation on commissioned OS (02.01) & НМА (05) if not already accrued in this month
        // 2) Write off monthly share of Deferred Expenses (РБП on 97.21 -> 26 / 20.01 / 44.01 via calendar_days or monthly)
        // 3) Close 25 -> 20.01 (proportionally by active project groups); close 20.01 -> 90.02.1 ONLY for completed nomenclature groups (preserving НЗП!); close 26 -> 90.08.1; close 44.01 -> 90.07.1
        // 4) Close 90 -> 90.09 -> 99.01.1 and 91 -> 91.09 -> 99.01.1
        // 5) At quarter-end (03, 06, 09, 12) on OSNO, reconcile cumulative YTD corporate income tax bidirectionally on 99.02.1 / 68.04.1
        // 6) On Dec 31 (Реформация баланса), close 90.* -> 90.09, 91.* -> 91.09, and ALL 99.* (99.01.1, 99.02.1, 99.02.3) -> 84.01 / 84.02
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
        let extraRpb44 = 0;
        if (!alreadyHasDeprInMonth && closeMonthPrefix) {
          const activeOsForMonth = Object.values(priorVirtualState.fixedAssets).filter(
            (fa) =>
              fa.status === 'Введено в эксплуатацию (счёт 01.01)' &&
              fa.initialCost >= 0.01 &&
              (fa.accumulatedDepreciation ?? 0) < fa.initialCost - 0.01 &&
              Boolean(fa.commissioningDate) &&
              (fa.commissioningDate ?? '').slice(0, 7) < closeMonthPrefix
          );
          for (const fa of activeOsForMonth) {
            const spi = fa.usefulLifeMonths && fa.usefulLifeMonths > 0 ? fa.usefulLifeMonths : 60;
            const rawMDepr =
              fa.monthlyDepreciation > 0 ? fa.monthlyDepreciation : round2(fa.initialCost / spi);
            const mDepr = round2(
              Math.min(rawMDepr, Math.max(0, fa.initialCost - (fa.accumulatedDepreciation ?? 0)))
            );
            if (mDepr >= 0.01) {
              const originOsOp = fa.firstSeenOpId
                ? priorOps.find((p) => p.id === fa.firstSeenOpId)
                : undefined;
              const targetAcc = originOsOp?.costAccount || '20.01';
              pushEntry(
                targetAcc,
                '02.01',
                mDepr,
                targetAcc === '20.01'
                  ? [nomGroup, 'Амортизация'].filter(Boolean).join(' / ')
                  : 'Амортизация',
                fa.name || 'Основные средства',
                `Регламентное начисление амортизации ОС (${fa.name || 'ОС'})`
              );
              if (targetAcc === '26') extraDepr26 = round2(extraDepr26 + mDepr);
              else extraDepr20 = round2(extraDepr20 + mDepr);
            }
          }
        }

        // 1a-2) Monthly НМА amortization (Дт 26/20.01 Кт 05) for commissioned intangible assets (04.01)
        const alreadyHasNmaAmortInMonth = priorOps.some(
          (p) =>
            p.includeInProcessing &&
            !p.isDuplicateIn1C &&
            closeMonthPrefix &&
            (p.date ?? '').startsWith(closeMonthPrefix) &&
            p.entries.some((e) => e.credit === '05')
        );
        if (!alreadyHasNmaAmortInMonth && closeMonthPrefix) {
          const commissionedNmaOps = priorOps.filter(
            (p) =>
              p.includeInProcessing &&
              !p.isDuplicateIn1C &&
              p.category === 'intangible_commissioning' &&
              p.amount >= 0.01 &&
              (p.date ?? '').slice(0, 7) < closeMonthPrefix
          );
          for (const nmaOp of commissionedNmaOps) {
            const nmaName = nmaOp.nomenclatureName || 'Нематериальный актив';
            const spi = nmaOp.usefulLifeMonths && nmaOp.usefulLifeMonths > 0 ? nmaOp.usefulLifeMonths : 36;
            const prevAmort = round2(
              priorOps
                .filter((p) => p.includeInProcessing && !p.isDuplicateIn1C && p.date <= (draft.date ?? '9999-12-31'))
                .flatMap((p) => p.entries)
                .filter((e) => e.credit === '05' && (!nmaOp.nomenclatureName || e.creditSubconto.includes(nmaName)))
                .reduce((s, e) => s + e.amount, 0)
            );
            const remNma = round2(Math.max(0, nmaOp.amount - prevAmort));
            if (remNma < 0.01) continue;
            const mAmort = round2(Math.min(remNma, nmaOp.amount / spi));
            if (mAmort < 0.01) continue;
            const nmaTargetAcc = nmaOp.costAccount === '20.01' ? '20.01' : '26';
            pushEntry(
              nmaTargetAcc,
              '05',
              mAmort,
              nmaTargetAcc === '20.01'
                ? [nomGroup, 'Амортизация НМА'].filter(Boolean).join(' / ')
                : 'Амортизация НМА',
              nmaName,
              `Регламентное начисление амортизации НМА (${nmaName})`
            );
            if (nmaTargetAcc === '26') extraDepr26 = round2(extraDepr26 + mAmort);
            else extraDepr20 = round2(extraDepr20 + mAmort);
          }
        }

        // 1b) Monthly write-off of Deferred Expenses (РБП on 97.21 — calendar_days or monthly, exact 0.00 in final month)
        const alreadyHasRpbWriteoffInMonth = priorOps.some(
          (p) =>
            p.includeInProcessing &&
            !p.isDuplicateIn1C &&
            closeMonthPrefix &&
            (p.date ?? '').startsWith(closeMonthPrefix) &&
            p.entries.some((e) => e.credit === '97.21' || e.credit === '97')
        );
        if (!alreadyHasRpbWriteoffInMonth && closeMonthPrefix) {
          for (const rpb of priorVirtualState.deferredExpenses ?? []) {
            if (rpb.remainingAmount < 0.01) continue;
            if (rpb.startMonth && rpb.startMonth > closeMonthPrefix) continue;
            const rpbAmt = computeMonthlyRpbWriteOff1C(rpb, draft.date || `${closeMonthPrefix}-28`);
            if (rpbAmt < 0.01) continue;
            pushEntry(
              rpb.writeOffAccount,
              '97.21',
              rpbAmt,
              rpb.writeOffAccount === '20.01'
                ? [nomGroup, 'Расходы будущих периодов'].filter(Boolean).join(' / ')
                : 'Расходы будущих периодов',
              rpb.name,
              `Регламентное ежемесячное списание РБП (${rpb.name})`
            );
            if (rpb.writeOffAccount === '26') extraDepr26 = round2(extraDepr26 + rpbAmt);
            else if (rpb.writeOffAccount === '44.01') extraRpb44 = round2(extraRpb44 + rpbAmt);
            else extraDepr20 = round2(extraDepr20 + rpbAmt);
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
        let added9007 = 0;
        let added9008 = 0;

        // Determine completed nomenclatureGroups in closeMonthPrefix vs WIP (НЗП) holds on 20.01
        const normalizeGroupKey = (g: string): string =>
          (g || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
        const GENERIC_20_SUBCONTOS = new Set([
          '',
          'без аналитики (субконто)',
          'основная номенклатурная группа',
          'оплата труда',
          'страховые взносы',
          'материальные расходы',
          'амортизация',
          'амортизация нма',
          'расходы будущих периодов',
          'прочие расходы',
        ]);

        // Proportional 25 -> 20.01 distribution across active 20.01 project groups (or nomGroup fallback)
        const row25Leaf = runningOsv.leafRows.find((r) => r.code.startsWith('25'));
        const bal25 = row25Leaf?.endDebit ?? 0;
        const extraFrom25ByGroup = new Map<string, number>();
        if (bal25 > 0.01) {
          const subs20For25 = (runningOsv.subcontoRowsByAccount?.['20.01'] ?? []).filter(
            (s) => s.endDebit >= 0.01
          );
          const groupWeights = new Map<string, number>();
          for (const s20 of subs20For25) {
            const head = s20.subcontoLabel.split(' / ')[0].trim();
            const gName =
              extractCanonicalProjectNomGroup1C(head) ||
              (!GENERIC_20_SUBCONTOS.has(normalizeGroupKey(head)) ? head : nomGroup);
            groupWeights.set(gName, round2((groupWeights.get(gName) ?? 0) + s20.endDebit));
          }
          const totalWeight = round2(Array.from(groupWeights.values()).reduce((a, b) => a + b, 0));
          const subs25 = (runningOsv.subcontoRowsByAccount?.['25'] ?? []).filter((s) => s.endDebit >= 0.01);
          const sumSubs25 = round2(subs25.reduce((acc, s) => acc + s.endDebit, 0));

          if (groupWeights.size > 1 && totalWeight > 0.01) {
            const groupEntries = Array.from(groupWeights.entries());
            let allocatedTotal25 = 0;
            groupEntries.forEach(([gName, weight], idx) => {
              const share25 =
                idx === groupEntries.length - 1
                  ? round2(bal25 - allocatedTotal25)
                  : round2((bal25 * weight) / totalWeight);
              allocatedTotal25 = round2(allocatedTotal25 + share25);
              if (share25 >= 0.01) {
                pushEntry(
                  '20.01',
                  '25',
                  share25,
                  gName,
                  subs25.length === 1 && subs25[0].subcontoLabel !== 'Без аналитики (субконто)'
                    ? subs25[0].subcontoLabel
                    : 'Общепроизводственные расходы',
                  `Пропорциональное распределение счёта 25 на счёт 20.01 (${gName})`
                );
                extraFrom25ByGroup.set(gName, round2((extraFrom25ByGroup.get(gName) ?? 0) + share25));
              }
            });
          } else {
            const singleTargetGroup =
              groupWeights.size === 1 ? Array.from(groupWeights.keys())[0] : nomGroup;
            if (subs25.length > 0 && Math.abs(sumSubs25 - bal25) < 0.02) {
              for (const s25 of subs25) {
                pushEntry(
                  '20.01',
                  '25',
                  s25.endDebit,
                  singleTargetGroup,
                  s25.subcontoLabel === 'Без аналитики (субконто)' ? '' : s25.subcontoLabel,
                  'Распределение счёта 25 на счёт 20.01'
                );
              }
            } else {
              pushEntry(
                '20.01',
                '25',
                bal25,
                singleTargetGroup,
                'Общепроизводственные расходы',
                'Распределение счёта 25 на счёт 20.01'
              );
            }
            extraFrom25ByGroup.set(singleTargetGroup, bal25);
          }
        }

        const completedGroupsInMonth = new Set<string>();
        const explicitWipGroupsInMonth = new Set<string>();
        let explicitAllWipInMonth = false;
        let monthHasProductOrWorkHandover = false;

        for (const pOp of priorOps) {
          if (!pOp.includeInProcessing || pOp.isDuplicateIn1C) continue;
          if (closeMonthPrefix && !(pOp.date ?? '').startsWith(closeMonthPrefix)) continue;

          if (/незавер[шщ][её]нн\p{L}*\s+производств|(?:^|[^\p{L}])инвентаризаци\p{L}*\s+нзп/iu.test(pOp.description)) {
            const wipProj =
              extractCanonicalProjectNomGroup1C(pOp.description) ||
              (pOp.nomenclatureGroupName &&
              !GENERIC_20_SUBCONTOS.has(normalizeGroupKey(pOp.nomenclatureGroupName))
                ? pOp.nomenclatureGroupName
                : undefined);
            if (wipProj) {
              explicitWipGroupsInMonth.add(normalizeGroupKey(wipProj));
            } else {
              explicitAllWipInMonth = true;
            }
          }

          const has9001Or43 = pOp.entries.some(
            (e) => e.credit === '90.01.1' || e.debit === '43' || e.debit === '40'
          );
          if (has9001Or43) {
            const isPureRent =
              /аренд\p{L}*\s+(?:лесов|помещен|оборудован)/iu.test(pOp.description) &&
              !extractCanonicalProjectNomGroup1C(pOp.description);
            if (!isPureRent) {
              monthHasProductOrWorkHandover = true;
            }
            if (pOp.nomenclatureGroupName) {
              completedGroupsInMonth.add(normalizeGroupKey(pOp.nomenclatureGroupName));
            }
            const pProj = extractCanonicalProjectNomGroup1C(pOp.description);
            if (pProj) {
              completedGroupsInMonth.add(normalizeGroupKey(pProj));
            }
            for (const e of pOp.entries) {
              if (e.credit === '90.01.1' && e.creditSubconto) {
                const subHead = e.creditSubconto.split(' / ')[0].trim();
                if (subHead) completedGroupsInMonth.add(normalizeGroupKey(subHead));
              }
            }
          }
        }
        // If no month-scoped priorOps exist (e.g. closing against db1C balances directly), check runningOsv 90.01.1
        if (
          !monthHasProductOrWorkHandover &&
          !explicitAllWipInMonth &&
          priorOps.filter((p) => closeMonthPrefix && (p.date ?? '').startsWith(closeMonthPrefix)).length === 0
        ) {
          const rev9001 = runningOsv.leafRows.find((r) => r.code === '90.01.1')?.endCredit ?? 0;
          if (rev9001 > 0.01) monthHasProductOrWorkHandover = true;
        }

        const matchesCompletedGroupByStems = (groupKey: string): boolean => {
          if (completedGroupsInMonth.has(groupKey)) return true;
          const gStems = extractKeywordStems1C(groupKey);
          if (gStems.length === 0) return false;
          for (const compKey of completedGroupsInMonth) {
            if (GENERIC_20_SUBCONTOS.has(compKey)) continue;
            const cStems = extractKeywordStems1C(compKey);
            if (cStems.length > 0 && gStems.every((gs) => cStems.some((cs) => stemsMatch1C(gs, cs)))) {
              return true;
            }
          }
          return false;
        };

        const shouldClose20Group = (rawSubcontoLabel: string): boolean => {
          const head = (rawSubcontoLabel || '').split(' / ')[0].trim();
          const normHead = normalizeGroupKey(head);
          const canonicalHead = extractCanonicalProjectNomGroup1C(head);
          const effectiveKey = canonicalHead ? normalizeGroupKey(canonicalHead) : normHead;

          if (!GENERIC_20_SUBCONTOS.has(effectiveKey)) {
            if (matchesCompletedGroupByStems(effectiveKey)) return true;
            return false; // Named project without handover in this month stays as WIP (НЗП) on 20.01!
          }
          // Generic 20.01 subconto: stays open if explicit blanket WIP instruction is present and no work/product handover occurred
          if (explicitAllWipInMonth && !monthHasProductOrWorkHandover) {
            return false;
          }
          return monthHasProductOrWorkHandover || (!explicitAllWipInMonth && explicitWipGroupsInMonth.size === 0);
        };

        const leafEnd20 = runningOsv.leafRows.find((r) => r.code === '20.01')?.endDebit ?? 0;
        const totalExtra25 = round2(
          Array.from(extraFrom25ByGroup.values()).reduce((a, b) => a + b, 0)
        );
        const bal20 = round2(leafEnd20 + extraDepr20 + totalExtra25);
        if (bal20 > 0.01) {
          const subs20 = (runningOsv.subcontoRowsByAccount?.['20.01'] ?? []).filter(
            (s) => s.endDebit >= 0.01
          );
          const sumSubs20 = round2(subs20.reduce((acc, s) => acc + s.endDebit, 0));
          if (subs20.length > 0 && Math.abs(sumSubs20 - leafEnd20) < 0.02) {
            for (const s20 of subs20) {
              if (!shouldClose20Group(s20.subcontoLabel)) continue;
              const s20Head = s20.subcontoLabel.split(' / ')[0].trim();
              const targetNomGroup =
                extractCanonicalProjectNomGroup1C(s20Head) ||
                (!GENERIC_20_SUBCONTOS.has(normalizeGroupKey(s20Head)) ? s20Head : nomGroup);
              pushEntry(
                '90.02.1',
                '20.01',
                s20.endDebit,
                targetNomGroup,
                s20.subcontoLabel === 'Без аналитики (субконто)' ? '' : s20.subcontoLabel,
                `Закрытие счёта 20.01 в себестоимость продаж (${s20.subcontoLabel})`
              );
              added9002 = round2(added9002 + s20.endDebit);
            }
            for (const [g25, amt25] of extraFrom25ByGroup.entries()) {
              if (amt25 > 0.01 && shouldClose20Group(g25)) {
                pushEntry(
                  '90.02.1',
                  '20.01',
                  amt25,
                  g25,
                  g25,
                  `Закрытие распределённых ОПР (сч. 25 → 20.01) в себестоимость продаж (${g25})`
                );
                added9002 = round2(added9002 + amt25);
              }
            }
            if (extraDepr20 > 0.01 && shouldClose20Group(nomGroup)) {
              pushEntry(
                '90.02.1',
                '20.01',
                extraDepr20,
                nomGroup,
                [nomGroup, 'Амортизация'].filter(Boolean).join(' / '),
                'Закрытие регламентных расходов 20.01 в себестоимость продаж'
              );
              added9002 = round2(added9002 + extraDepr20);
            }
          } else if (shouldClose20Group(nomGroup)) {
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
        }

        const leafEnd26 = runningOsv.leafRows.find((r) => r.code === '26')?.endDebit ?? 0;
        const bal26 = round2(leafEnd26 + extraDepr26);
        if (bal26 > 0.01) {
          const target26 = directCosting ? '90.08.1' : '90.02.1';
          const subs26 = (runningOsv.subcontoRowsByAccount?.['26'] ?? []).filter(
            (s) => s.endDebit >= 0.01
          );
          const sumSubs26 = round2(subs26.reduce((acc, s) => acc + s.endDebit, 0));
          if (subs26.length > 0 && Math.abs(sumSubs26 - leafEnd26) < 0.02) {
            for (const s26 of subs26) {
              pushEntry(
                target26,
                '26',
                s26.endDebit,
                nomGroup,
                s26.subcontoLabel === 'Без аналитики (субконто)' ? '' : s26.subcontoLabel,
                `Закрытие счёта 26 («Директ-костинг»: ${s26.subcontoLabel})`
              );
            }
            if (extraDepr26 > 0.01) {
              const hasRpb26 = entries.some((e) => e.debit === '26' && e.credit === '97.21');
              for (const regEntry of entries.filter(
                (e) => e.debit === '26' && (e.credit === '02.01' || e.credit === '05' || e.credit === '97.21')
              )) {
                pushEntry(
                  target26,
                  '26',
                  regEntry.amount,
                  nomGroup,
                  regEntry.debitSubconto || (hasRpb26 ? 'Расходы будущих периодов' : 'Амортизация'),
                  `Закрытие регламентных расходов со счёта 26 («Директ-костинг»)`
                );
              }
            }
          } else {
            pushEntry(
              target26,
              '26',
              bal26,
              nomGroup,
              'Общехозяйственные расходы',
              'Закрытие счёта 26 («Директ-костинг»)'
            );
          }
          if (directCosting) added9008 = round2(added9008 + bal26);
          else added9002 = round2(added9002 + bal26);
        }

        // Selling / commercial expenses on 44.01 close strictly to 90.07.1 «Расходы на продажу»
        const leafEnd44 = runningOsv.leafRows.find((r) => r.code === '44.01')?.endDebit ?? 0;
        const bal44 = round2(leafEnd44 + extraRpb44);
        if (bal44 > 0.01) {
          const subs44 = (runningOsv.subcontoRowsByAccount?.['44.01'] ?? []).filter(
            (s) => s.endDebit >= 0.01
          );
          const sumSubs44 = round2(subs44.reduce((acc, s) => acc + s.endDebit, 0));
          if (subs44.length > 0 && Math.abs(sumSubs44 - leafEnd44) < 0.02) {
            for (const s44 of subs44) {
              pushEntry(
                '90.07.1',
                '44.01',
                s44.endDebit,
                nomGroup,
                s44.subcontoLabel === 'Без аналитики (субконто)' ? '' : s44.subcontoLabel,
                `Закрытие счёта 44.01 в расходы на продажу (${s44.subcontoLabel})`
              );
            }
            if (extraRpb44 > 0.01) {
              pushEntry(
                '90.07.1',
                '44.01',
                extraRpb44,
                nomGroup,
                'Расходы будущих периодов',
                'Закрытие РБП со счёта 44.01 в расходы на продажу'
              );
            }
          } else {
            pushEntry(
              '90.07.1',
              '44.01',
              bal44,
              nomGroup,
              'Издержки обращения',
              'Закрытие счёта 44.01 в расходы на продажу'
            );
          }
          added9007 = round2(added9007 + bal44);
        }

        const children90 = runningOsv.leafRows.filter((r) => r.code.startsWith('90.'));
        const net90 = round2(
          children90.reduce((s, r) => s + (r.endDebit - r.endCredit), 0) +
            added9002 +
            added9007 +
            added9008
        );
        let profitDeltaTo9901 = 0;
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
            profitDeltaTo9901 = round2(profitDeltaTo9901 + p90);
          } else {
            pushEntry(
              '99.01.1',
              '90.09',
              net90,
              'Прибыль (убыток) от продаж',
              nomGroup,
              'Финансовый результат (убыток от продаж)'
            );
            profitDeltaTo9901 = round2(profitDeltaTo9901 - net90);
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
            profitDeltaTo9901 = round2(profitDeltaTo9901 + p91);
          } else {
            pushEntry(
              '99.01.1',
              '91.09',
              net91,
              'Прочие доходы и расходы',
              '',
              'Закрытие счёта 91 (сальдо прочих расходов)'
            );
            profitDeltaTo9901 = round2(profitDeltaTo9901 - net91);
          }
        }

        // Quarter-end (03, 06, 09, 12) cumulative YTD corporate income tax on OSNO (99.02.1 <-> 68.04.1)
        // Tax sanctions on 99.02.3 are NOT included in 99.01.1 and never reduce taxable profit (ст. 270 п. 2 НК РФ).
        const closeMonth = (draft.date ?? '').slice(5, 7);
        const children99 = runningOsv.leafRows.filter((r) => r.code.startsWith('99.'));
        const row9901 = runningOsv.leafRows.find((r) => r.code === '99.01.1');
        const profitTaxRate = db1C?.accountingPolicy.profitTaxRate ?? 20;
        const closeYearPrefix = (draft.date ?? '').slice(0, 4);

        const priorTaxEntries = [
          ...(db1C?.postings ?? [])
            .filter(
              (p) =>
                (!closeYearPrefix || (p.date ?? '').startsWith(closeYearPrefix)) &&
                (!draft.date || !p.date || p.date <= draft.date)
            )
            .map((p) => ({ debit: p.debit, credit: p.credit, amount: p.amount })),
          ...priorOps
            .filter(
              (p) =>
                p.includeInProcessing &&
                !p.isDuplicateIn1C &&
                (!closeYearPrefix || !p.date || p.date.startsWith(closeYearPrefix)) &&
                (!draft.date || !p.date || p.date <= draft.date)
            )
            .flatMap((p) => p.entries),
        ];

        const alreadyAccruedTax = round2(
          priorTaxEntries.reduce((s, e) => {
            if ((e.debit === '99.02.1' || e.debit === '99.01.1') && e.credit.startsWith('68.04')) {
              return s + e.amount;
            }
            if (e.debit.startsWith('68.04') && (e.credit === '99.02.1' || e.credit === '99.01.1')) {
              return s - e.amount;
            }
            return s;
          }, 0)
        );
        const legacyTaxOn9901 = round2(
          priorTaxEntries
            .filter((e) => e.debit === '99.01.1' && e.credit.startsWith('68.04'))
            .reduce((s, e) => s + e.amount, 0)
        );
        const reformedOutOf9901 = round2(
          priorTaxEntries.reduce((s, e) => {
            if (
              e.debit === '99.01.1' &&
              (e.credit.startsWith('84') || e.credit.startsWith('99.02'))
            ) {
              return s + e.amount;
            }
            if (
              (e.debit.startsWith('84') || e.debit.startsWith('99.02')) &&
              e.credit === '99.01.1'
            ) {
              return s - e.amount;
            }
            return s;
          }, 0)
        );

        const preTaxCumulativeProfit = round2(
          ((row9901?.endCredit ?? 0) - (row9901?.endDebit ?? 0)) +
            profitDeltaTo9901 +
            legacyTaxOn9901 +
            reformedOutOf9901
        );

        if (isOsno && ['03', '06', '09', '12'].includes(closeMonth) && profitTaxRate > 0) {
          const targetTaxTotal =
            preTaxCumulativeProfit > 0.01
              ? round2(preTaxCumulativeProfit * (profitTaxRate / 100))
              : 0;
          const taxDelta = round2(targetTaxTotal - alreadyAccruedTax);
          if (taxDelta > 0.01) {
            pushEntry(
              '99.02.1',
              '68.04.1',
              taxDelta,
              'Текущий налог на прибыль',
              `Налог на прибыль организаций (${profitTaxRate}%)`,
              `Регламентный расчёт налога на прибыль организаций (${profitTaxRate}%) за отчётный период`
            );
          } else if (taxDelta < -0.01) {
            pushEntry(
              '68.04.1',
              '99.02.1',
              Math.abs(taxDelta),
              `Налог на прибыль организаций (${profitTaxRate}%)`,
              'Текущий налог на прибыль',
              `Уменьшение (пересчёт нарастающим итогом с начала года) налога на прибыль (${profitTaxRate}%) при снижении налоговой базы`
            );
          }
        }

        // Year-end Реформация баланса (31.12 or explicit «реформация баланса»):
        // Closes 90.* -> 90.09, 91.* -> 91.09, and ALL 99.* subaccounts (99.01.1, 99.02.1, 99.02.3) -> 84.01 / 84.02
        if ((draft.date ?? '').endsWith('-12-31') || /реформация\s+баланса/iu.test(descLower)) {
          const codes90 = new Set<string>([
            ...children90.map((r) => r.code),
            ...entries
              .flatMap((e) => [e.debit, e.credit])
              .filter((c) => c.startsWith('90.')),
          ]);
          for (const code90 of codes90) {
            if (code90 === '90.09') continue;
            const baseRow = children90.find((r) => r.code === code90);
            const extraDt = entries
              .filter((e) => e.debit === code90)
              .reduce((s, e) => s + e.amount, 0);
            const extraKt = entries
              .filter((e) => e.credit === code90)
              .reduce((s, e) => s + e.amount, 0);
            const balCr = round2(
              ((baseRow?.endCredit ?? 0) + extraKt) - ((baseRow?.endDebit ?? 0) + extraDt)
            );
            if (balCr > 0.01) {
              pushEntry(code90, '90.09', balCr, nomGroup, nomGroup, `Реформация баланса: закрытие субсчёта ${code90}`);
            } else if (balCr < -0.01) {
              pushEntry('90.09', code90, Math.abs(balCr), nomGroup, nomGroup, `Реформация баланса: закрытие субсчёта ${code90}`);
            }
          }

          const codes91 = new Set<string>([
            ...children91.map((r) => r.code),
            ...entries
              .flatMap((e) => [e.debit, e.credit])
              .filter((c) => c.startsWith('91.')),
          ]);
          for (const code91 of codes91) {
            if (code91 === '91.09') continue;
            const baseRow = children91.find((r) => r.code === code91);
            const extraDt = entries
              .filter((e) => e.debit === code91)
              .reduce((s, e) => s + e.amount, 0);
            const extraKt = entries
              .filter((e) => e.credit === code91)
              .reduce((s, e) => s + e.amount, 0);
            const balCr = round2(
              ((baseRow?.endCredit ?? 0) + extraKt) - ((baseRow?.endDebit ?? 0) + extraDt)
            );
            if (balCr > 0.01) {
              pushEntry(code91, '91.09', balCr, 'Прочие доходы и расходы', 'Прочие доходы и расходы', `Реформация баланса: закрытие субсчёта ${code91}`);
            } else if (balCr < -0.01) {
              pushEntry('91.09', code91, Math.abs(balCr), 'Прочие доходы и расходы', 'Прочие доходы и расходы', `Реформация баланса: закрытие субсчёта ${code91}`);
            }
          }

          const codes99 = new Set<string>([
            ...children99.map((r) => r.code),
            ...entries
              .flatMap((e) => [e.debit, e.credit])
              .filter((c) => c.startsWith('99.')),
          ]);
          const netByCode99 = new Map<string, number>();
          let totalNetCreditAll99 = 0;
          for (const code99 of codes99) {
            const baseRow = children99.find((r) => r.code === code99);
            const extraDt = entries
              .filter((e) => e.debit === code99)
              .reduce((s, e) => s + e.amount, 0);
            const extraKt = entries
              .filter((e) => e.credit === code99)
              .reduce((s, e) => s + e.amount, 0);
            const netCr = round2(
              ((baseRow?.endCredit ?? 0) + extraKt) - ((baseRow?.endDebit ?? 0) + extraDt)
            );
            if (Math.abs(netCr) > 0.01) {
              netByCode99.set(code99, netCr);
              totalNetCreditAll99 = round2(totalNetCreditAll99 + netCr);
            }
          }
          const target84 = totalNetCreditAll99 >= 0 ? '84.01' : '84.02';
          const target84Sub =
            target84 === '84.01'
              ? 'Прибыль, подлежащая распределению'
              : 'Убыток, подлежащий покрытию';
          for (const [code99, netCr] of netByCode99.entries()) {
            const sub99 =
              code99 === '99.02.1'
                ? 'Текущий налог на прибыль'
                : code99 === '99.02.3'
                  ? 'Налоговые санкции'
                  : 'Прибыль (убыток) от продаж';
            if (netCr > 0.01) {
              pushEntry(
                code99,
                target84,
                netCr,
                sub99,
                target84Sub,
                `Реформация баланса: перенос кредитового сальдо ${code99} на счёт ${target84}`
              );
            } else if (netCr < -0.01) {
              pushEntry(
                target84,
                code99,
                Math.abs(netCr),
                target84Sub,
                sub99,
                `Реформация баланса: списание дебетового сальдо ${code99} на счёт ${target84}`
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

      case 'charter_capital': {
        if (resolvedFounderShares && resolvedFounderShares.length > 0 && totalWithVat >= 0.01) {
          let allocatedSum = 0;
          resolvedFounderShares.forEach((fs, idx) => {
            const shareAmt =
              idx === resolvedFounderShares.length - 1 &&
              fs.sharePercent !== undefined &&
              resolvedFounderShares.every((s) => s.sharePercent !== undefined)
                ? round2(totalWithVat - allocatedSum)
                : fs.amount && fs.amount >= 0.01
                  ? round2(fs.amount)
                  : fs.sharePercent
                    ? round2((totalWithVat * fs.sharePercent) / 100)
                    : round2(totalWithVat / resolvedFounderShares.length);
            allocatedSum = round2(allocatedSum + shareAmt);
            pushEntry(
              '75.01',
              '80.09',
              shareAmt,
              fs.founderName,
              fs.founderName,
              `Отражена задолженность учредителя «${fs.founderName}» по вкладу в уставный капитал${fs.sharePercent ? ` (${fs.sharePercent}%)` : ''}`
            );
          });
        } else {
          const founderSub = cpName || employeeName || 'Учредители организации';
          pushEntry(
            '75.01',
            '80.09',
            totalWithVat,
            founderSub,
            founderSub,
            'Отражена задолженность учредителей по вкладам в уставный капитал'
          );
        }
        // Composite single-row check: e.g. "Сформирован уставный капитал и внесен на расчетный счет / в кассу"
        if (/и\s+(?:внесен|оплачен|поступил|зачислен)/iu.test(descLower)) {
          const founderSub = cpName || employeeName || 'Учредители организации';
          const cashOrBankDt = /в\s+касс/iu.test(descLower) ? '50.01' : '51';
          pushEntry(
            cashOrBankDt,
            '75.01',
            totalWithVat,
            cashOrBankDt === '51' ? bankSubconto : 'Вклад в уставный капитал',
            founderSub,
            'Внесён вклад учредителя в оплату уставного капитала'
          );
        }
        break;
      }

      case 'dividends_accrual': {
        const founderSub = cpName || 'Участники (учредители)';
        pushEntry(
          '84.01',
          '75.02',
          totalWithVat,
          founderSub,
          founderSub,
          'Начислены дивиденды участникам за счёт нераспределённой прибыли'
        );
        const isPhysFounder =
          !/^\s*(?:ооо|ао|пао|зао)(?=$|[^\p{L}])/iu.test(cpName) || /ндфл/iu.test(descLower);
        if (isPhysFounder && totalWithVat >= 0.01) {
          const ndfl13 = round2(totalWithVat * 0.13);
          pushEntry(
            '75.02',
            '68.01',
            ndfl13,
            founderSub,
            'НДФЛ с дивидендов (13%)',
            'Удержан НДФЛ 13% при начислении дивидендов физическому лицу'
          );
        }
        break;
      }

      case 'dividends_payout': {
        const founderSub = cpName || 'Участники (учредители)';
        const creditMoneyAcc = /из\s+касс/iu.test(descLower) ? '50.01' : '51';
        pushEntry(
          '75.02',
          creditMoneyAcc,
          totalWithVat,
          founderSub,
          creditMoneyAcc === '51' ? bankSubconto : 'Выплата дивидендов',
          'Выплачены дивиденды участникам (за вычетом удержанного налога)'
        );
        if (/перечислен\p{L}*\s+ндфл|одновременн.*ндфл/iu.test(descLower) && totalWithVat >= 0.01) {
          const grossFromNet = round2(totalWithVat / 0.87);
          const ndflAmt = round2(grossFromNet - totalWithVat);
          if (ndflAmt >= 0.01) {
            pushEntry(
              '68.01',
              '51',
              ndflAmt,
              'НДФЛ с дивидендов (13%)',
              bankSubconto,
              'Перечислен в бюджет НДФЛ с выплаченных дивидендов'
            );
          }
        }
        break;
      }

      case 'intangible_acquisition': {
        const nmaSub = nomName || 'Нематериальный актив';
        pushEntry(
          '08.05',
          '60.01',
          netWithoutVat,
          nmaSub,
          cpSubconto,
          `Поступление нематериального актива (${nmaSub})`
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.02',
            '60.01',
            vatAmount,
            cpSubconto,
            cpSubconto,
            'Отражён входной НДС по приобретённому НМА'
          );
          if (hasInvoiceSF) {
            pushEntry(
              '68.02',
              '19.02',
              vatAmount,
              'Налог (взносы): к вычету',
              cpSubconto,
              'Принят к вычету входной НДС по НМА (СФ полученный)'
            );
          }
        }
        break;
      }

      case 'intangible_commissioning': {
        const nmaSub = nomName || 'Нематериальный актив';
        pushEntry(
          '04.01',
          '08.05',
          totalWithVat,
          nmaSub,
          nmaSub,
          `Принят к учёту нематериальный актив (${nmaSub})`,
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: isCalculatedBy1C
              ? 'Первоначальная стоимость НМА формируется по накопленным затратам счёта 08.05'
              : undefined,
          }
        );
        break;
      }

      case 'intangible_amortization': {
        const costAcc = draft.costAccountHint || resolvedCostAccount || '26';
        pushEntry(
          costAcc,
          '05',
          totalWithVat,
          expenseItemName || 'Амортизация',
          nomName || 'Нематериальные активы',
          'Начислена амортизация нематериальных активов за месяц (ФСБУ 14/2022)',
          {
            allowZeroCalculated: isCalculatedBy1C,
            amountRuleNote: isCalculatedBy1C
              ? 'Рассчитывается регламентной операцией «Амортизация НМА и списание расходов по НИОКР»'
              : undefined,
          }
        );
        break;
      }

      case 'inventory_result': {
        const isShortage =
          !/излиш|оприходован\p{L}*\s+излиш/iu.test(descLower) ||
          /недостач|порч/iu.test(descLower);
        const stockAcc = /товар/iu.test(descLower)
          ? '41.01'
          : /готов\p{L}*\s+продукц/iu.test(descLower)
            ? '43'
            : resolvedMaterialAccount || '10.01';
        const stockSub = [nomName || 'МПЗ', warehouseName || 'Основной склад'].filter(Boolean).join(' / ');
        if (!isShortage) {
          pushEntry(
            stockAcc,
            '91.01',
            totalWithVat,
            stockSub,
            'Излишки ТМЦ по инвентаризации',
            'Оприходованы излишки ТМЦ, выявленные при инвентаризации'
          );
        } else {
          pushEntry(
            '94',
            stockAcc,
            totalWithVat,
            'Недостачи и потери от порчи ценностей',
            stockSub,
            'Отражена недостача ТМЦ по результатам инвентаризации'
          );
          if (/виновн\p{L}*\s+лиц|на\s+работник|на\s+сотрудник|материальн\p{L}*.*\s+ответственн/iu.test(descLower)) {
            pushEntry(
              '73.02',
              '94',
              totalWithVat,
              employeeName || 'Материально ответственное лицо',
              'Недостачи и потери от порчи ценностей',
              'Недостача сверх норм отнесена на виновное лицо (счёт 73.02)'
            );
          } else if (/естественн\p{L}*\s+убыл|в\s+пределах\s+норм/iu.test(descLower)) {
            const normCostAcc = draft.costAccountHint || (/торгов/iu.test(descLower) ? '44.01' : '20.01');
            pushEntry(
              normCostAcc,
              '94',
              totalWithVat,
              expenseItemName || 'Потери от недостачи в пределах норм естественной убыли',
              'Недостачи и потери от порчи ценностей',
              'Списана недостача ТМЦ в пределах норм естественной убыли'
            );
          } else if (/отсутств\p{L}*.*виновн|виновн\p{L}*.*не\s+установлен|на\s+проч\p{L}*\s+расход/iu.test(descLower)) {
            pushEntry(
              '91.02',
              '94',
              totalWithVat,
              'Недостачи сверх норм при отсутствии виновных лиц',
              'Недостачи и потери от порчи ценностей',
              'Списана недостача ТМЦ на прочие расходы при отсутствии виновных лиц'
            );
          }
        }
        break;
      }

      case 'acquiring_receipt': {
        if (docType1C === 'ПоступлениеНаРасчетныйСчет') {
          const feeMatch =
            draft.description.match(/комисси\p{L}*\s+(?:банк\p{L}*\s+)?(\d[\d\s\u00A0]*(?:[.,]\d{1,2})?)\s*(?:руб|₽)/iu) ||
            draft.description.match(/удержан\p{L}*\s+комисси\p{L}*\s+(\d[\d\s\u00A0]*(?:[.,]\d{1,2})?)/iu);
          const feePctMatch = draft.description.match(/комисси\p{L}*\s+(?:банк\p{L}*\s+)?(\d+(?:[.,]\d+)?)\s*%/iu);
          let feeAmt = 0;
          if (feeMatch?.[1]) {
            feeAmt = round2(Number(feeMatch[1].replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0);
          } else if (feePctMatch?.[1] && totalWithVat > 0) {
            const pct = Number(feePctMatch[1].replace(',', '.')) || 0;
            // If bank credited net amount after pct% fee or gross amount with pct% fee:
            if (/за\s+вычетом\s+комисси/iu.test(descLower) && pct > 0 && pct < 50) {
              const gross = round2(totalWithVat / (1 - pct / 100));
              feeAmt = round2(gross - totalWithVat);
            } else {
              feeAmt = round2((totalWithVat * pct) / 100);
            }
          }
          const bankNetAmt =
            feeAmt > 0 && !/за\s+вычетом\s+комисси/iu.test(descLower) && feeAmt < totalWithVat
              ? round2(totalWithVat - feeAmt)
              : totalWithVat;
          pushEntry(
            '51',
            '57.03',
            bankNetAmt,
            bankSubconto,
            cpName || 'Эквайринг',
            'Зачислена на расчётный счёт выручка по платёжным картам (эквайринг)'
          );
          if (feeAmt >= 0.01) {
            pushEntry(
              '91.02',
              '57.03',
              feeAmt,
              'Расходы на услуги банков (комиссия эквайринга)',
              cpName || 'Эквайринг',
              'Удержана комиссия банка-эквайера'
            );
          }
        } else {
          if (/розничн|выручк/iu.test(descLower)) {
            pushEntry(
              '57.03',
              '90.01.1',
              totalWithVat,
              cpName || 'Розничный покупатель (эквайринг)',
              nomGroup,
              'Отражена розничная выручка при оплате платёжной картой'
            );
            if (isOsno && vatAmount > 0) {
              pushEntry(
                '90.03',
                '68.02',
                vatAmount,
                nomGroup,
                'НДС начисленный',
                'Начислен НДС с розничной выручки по эквайрингу'
              );
            }
          } else {
            pushEntry(
              '57.03',
              '62.01',
              totalWithVat,
              cpName || 'Эквайринг',
              cpSubconto || 'Покупатель по платёжной карте',
              'Оплата от покупателя банковской платёжной картой'
            );
          }
        }
        break;
      }

      case 'special_bank_55': {
        const specAcc = /аккредитив/iu.test(descLower) ? '55.01' : /депозит/iu.test(descLower) ? '55.03' : '55.04';
        if (docType1C === 'ПоступлениеНаРасчетныйСчет') {
          pushEntry(
            '51',
            specAcc,
            totalWithVat,
            bankSubconto,
            bankLabel,
            `Возврат средств со специального счёта ${specAcc} на расчётный счёт`
          );
        } else if (/оплат\p{L}*.*поставщик.*аккредитив|с\s+аккредитив.*поставщик/iu.test(descLower)) {
          pushEntry(
            '60.01',
            '55.01',
            totalWithVat,
            cpSubconto || 'Поставщик',
            bankLabel,
            'Исполнен аккредитив в пользу поставщика'
          );
        } else {
          pushEntry(
            specAcc,
            '51',
            totalWithVat,
            bankLabel,
            bankSubconto,
            `Перечислены денежные средства на специальный счёт ${specAcc} (аккредитив / депозит)`
          );
        }
        break;
      }

      case 'employee_settlement_73': {
        const empSub = employeeName || 'Сотрудники организации';
        const isGift73 = /подар[ока]|безвозмездн\p{L}*\s+передач\p{L}*.*сотрудник/iu.test(descLower);
        const isMaterialAid73 = /материальн\p{L}*\s+помощ/iu.test(descLower);
        const isDamage73 = /недостач|ущерб|брак/iu.test(descLower);
        const acc73 = isGift73 || isMaterialAid73 ? '73.03' : isDamage73 ? '73.02' : '73.01';

        if (isGift73) {
          const giftStock = resolveStockBatchCost({
            itemText: nomName || 'подарок',
            preferredAccount: '41.01',
            accountPrefixFilter: ['41', '10'],
            requestedQty: effectiveQty,
            opDate: draft.date,
            db1C,
            priorOperations: priorOps,
          });
          const giftCost = round2(giftStock?.amount ?? (netWithoutVat > 0 ? netWithoutVat : totalWithVat));
          const giftStockAcc = giftStock?.account || '41.01';
          if (giftCost >= 0.01) {
            pushEntry(
              '73.03',
              giftStockAcc,
              giftCost,
              empSub,
              nomName || 'Подарки сотрудникам',
              'Вручены подарки сотрудникам организации'
            );
            pushEntry(
              '91.02',
              '73.03',
              giftCost,
              'Расходы на подарки сотрудникам (безвозмездная передача)',
              empSub,
              'Списана стоимость подарков сотрудникам в прочие расходы'
            );
            if (isOsno) {
              pushEntry(
                '91.02',
                '68.02',
                round2(giftCost * 0.2),
                'НДС при безвозмездной передаче подарков сотрудникам',
                'Налог (взносы): начислено / уплачено',
                'Начислен НДС при безвозмездной передаче подарков (пп. 1 п. 1 ст. 146 НК РФ)'
              );
            }
          }
        } else if (isMaterialAid73) {
          const aidGross = totalWithVat;
          const ndflTaxable = Math.max(0, round2(aidGross - 4000));
          const aidNdfl = ndflTaxable > 0 ? round2(ndflTaxable * 0.13) : 0;
          pushEntry(
            '91.02',
            '73.03',
            aidGross,
            'Материальная помощь сотрудникам',
            empSub,
            'Начислена материальная помощь сотруднику'
          );
          if (aidNdfl >= 0.01) {
            pushEntry(
              '73.03',
              '68.01',
              aidNdfl,
              empSub,
              'НДФЛ исчисленный',
              'Удержан НДФЛ 13% с суммы материальной помощи свыше 4 000 ₽ (п. 28 ст. 217 НК РФ)'
            );
          }
          if (ndflTaxable >= 0.01) {
            pushEntry(
              '91.02',
              '69.09',
              round2(ndflTaxable * 0.3),
              'Материальная помощь сотрудникам (страховые взносы)',
              'Страховые взносы по единому тарифу',
              'Начислены страховые взносы 30% с материальной помощи свыше 4 000 ₽ (пп. 11 п. 1 ст. 422 НК РФ)'
            );
            pushEntry(
              '91.02',
              '69.11',
              round2(ndflTaxable * (resolvedInjuryRate / 100)),
              'Материальная помощь сотрудникам (страховые взносы)',
              'Взносы от НС и ПЗ',
              `Начислены взносы на травматизм (${resolvedInjuryRate}%) с материальной помощи свыше 4 000 ₽`
            );
          }
          if (/выплачен|выдан|из\s+касс|через\s+касс|с\s+р\/с|на\s+карт|перечислен/iu.test(descLower)) {
            const moneyKt =
              docType1C === 'ВыдачаНаличных' || /из\s+касс|через\s+касс|наличн/iu.test(descLower) ? '50.01' : '51';
            const netPayout = round2(aidGross - aidNdfl);
            if (netPayout >= 0.01) {
              pushEntry(
                '73.03',
                moneyKt,
                netPayout,
                empSub,
                moneyKt === '51' ? bankSubconto : 'Выплата материальной помощи',
                'Выплачена материальная помощь сотруднику (за вычетом НДФЛ)'
              );
            }
          }
        } else if (/выдан|предоставлен/iu.test(descLower)) {
          const moneyKt = docType1C === 'ВыдачаНаличных' ? '50.01' : '51';
          pushEntry(
            '73.01',
            moneyKt,
            totalWithVat,
            empSub,
            moneyKt === '51' ? bankSubconto : 'Выдача займа работнику',
            'Выдан заём сотруднику организации'
          );
        } else if (/удержан.*из\s+зарплат|удержан.*заработн/iu.test(descLower)) {
          pushEntry(
            '70',
            acc73,
            totalWithVat,
            empSub,
            empSub,
            `Удержано из заработной платы сотрудника в погашение расчётов (${acc73})`
          );
        } else if (/внесен|возвращ|погашен|возмещен/iu.test(descLower)) {
          const moneyDt = docType1C === 'ПоступлениеНаличных' || /в\s+касс/iu.test(descLower) ? '50.01' : '51';
          pushEntry(
            moneyDt,
            acc73,
            totalWithVat,
            moneyDt === '51' ? bankSubconto : 'Погашение расчётов работником',
            empSub,
            `Погашена задолженность сотрудником по счёту ${acc73}`
          );
        } else {
          pushEntry(
            acc73,
            isDamage73 ? '94' : '51',
            totalWithVat,
            empSub,
            isDamage73 ? 'Недостачи и потери от порчи ценностей' : bankSubconto,
            draft.description
          );
        }
        break;
      }

      case 'deferred_expense_97': {
        const isSroEntrance = /вступительн\p{L}*\s+взнос.*(?:сро|саморегулируем)/iu.test(descLower);
        const rbpSub =
          nomName ||
          (isSroEntrance ? 'Вступительный взнос в СРО' : 'Расходы будущих периодов');
        if (docType1C === 'ЗакрытиеМесяца' || /списан\p{L}*.*(?:рбп|расход\p{L}*\s+будущ)/iu.test(descLower)) {
          const costAcc = draft.costAccountHint || (isSroEntrance ? '26' : resolvedCostAccount || '26');
          pushEntry(
            costAcc,
            '97.21',
            totalWithVat,
            costAcc === '20.01'
              ? [nomGroup, expenseItemName || 'Расходы будущих периодов'].filter(Boolean).join(' / ')
              : expenseItemName || 'Расходы будущих периодов',
            rbpSub,
            'Ежемесячное списание расходов будущих периодов'
          );
        } else {
          const actionLow = (draft.actionSequenceHint ?? '').toLowerCase();
          const settlementAcc: '76.09' | '60.01' =
            draft.rpbSettlementAccount ||
            (isSroEntrance ||
            draft.explicitCorrespondences?.some(
              (c) => c.debit.startsWith('76') || c.credit.startsWith('76')
            ) ||
            /д\s*97(?:\.\d+)?\s*к\s*76|страхов\p{L}*|полис/iu.test(`${descLower} ${actionLow}`)
              ? '76.09'
              : '60.01');
          const paidVia: 'bank_51' | 'cash_50' | 'accountable_71' | undefined =
            draft.paidImmediatelyVia ||
            (/д\s*(?:76|60)(?:\.\d+)?\s*к\s*51|(?:^|[^\p{L}])(?:перечислен|оплачен|уплачен|списан\p{L}*\s+с\s+р\/с)/iu.test(
              `${descLower} ${actionLow}`
            )
              ? 'bank_51'
              : /из\s+касс|наличн/iu.test(descLower)
                ? 'cash_50'
                : undefined);
          const cpLabel = cpSubconto || cpName || (settlementAcc === '76.09' ? 'Контрагент (сч. 76.09)' : 'Поставщик');

          if (paidVia === 'bank_51') {
            pushEntry(
              settlementAcc,
              '51',
              totalWithVat,
              cpLabel,
              bankSubconto,
              `Перечисление средств с расчётного счёта (${rbpSub})`
            );
          } else if (paidVia === 'cash_50') {
            pushEntry(
              settlementAcc,
              '50.01',
              totalWithVat,
              cpLabel,
              cashFlowItemName || 'Оплата поставщику',
              `Оплата наличными из кассы (${rbpSub})`
            );
          } else if (paidVia === 'accountable_71') {
            pushEntry(
              settlementAcc,
              '71.01',
              totalWithVat,
              cpLabel,
              employeeName || 'Подотчётное лицо',
              `Оплата через подотчётное лицо (${rbpSub})`
            );
          }

          pushEntry(
            '97.21',
            settlementAcc,
            netWithoutVat,
            rbpSub,
            cpLabel,
            `Приняты к учёту расходы будущих периодов (${rbpSub})`
          );
          if (vatAmount > 0) {
            pushEntry(
              '19.04',
              settlementAcc,
              vatAmount,
              cpLabel,
              cpLabel,
              'Входной НДС по расходам будущих периодов'
            );
            if (hasInvoiceSF) {
              pushEntry(
                '68.02',
                '19.04',
                vatAmount,
                'Налог (взносы): к вычету',
                cpLabel,
                'Принят к вычету НДС по РБП'
              );
            }
          }
        }
        break;
      }

      case 'reserve_doubtful_63': {
        const debtSub = cpSubconto || cpName || 'Дебиторская задолженность';
        if (/списан.*за\s+счет\s+резерв|безнадежн\p{L}*\s+долг/iu.test(descLower)) {
          pushEntry(
            '63',
            '62.01',
            totalWithVat,
            debtSub,
            debtSub,
            'Списана безнадёжная дебиторская задолженность за счёт резерва по сомнительным долгам'
          );
          pushEntry(
            '007',
            '',
            totalWithVat,
            debtSub,
            '',
            'Забалансовый учёт списанной в убыток задолженности неплатёжеспособного дебитора (5 лет)',
            { isOffBalance: true }
          );
        } else if (/восстановлен\p{L}*\s+резерв/iu.test(descLower)) {
          pushEntry(
            '63',
            '91.01',
            totalWithVat,
            debtSub,
            'Восстановление резерва по сомнительным долгам',
            'Восстановлен неиспользованный резерв по сомнительным долгам'
          );
        } else {
          pushEntry(
            '91.02',
            '63',
            totalWithVat,
            'Отчисления в резервы по сомнительным долгам',
            debtSub,
            'Создан резерв по сомнительным долгам по результатам инвентаризации расчётов'
          );
        }
        break;
      }

      case 'off_balance_op': {
        const offAcc =
          /арендованн\p{L}*\s+основн/iu.test(descLower)
            ? '001'
            : /ответственн\p{L}*\s+хранен/iu.test(descLower)
              ? '002'
              : /давальческ|переработк/iu.test(descLower)
                ? '003.01'
                : /комисси\p{L}*\s+товар/iu.test(descLower)
                  ? '004.01'
                  : /обеспечен.*полученн/iu.test(descLower)
                    ? '008'
                    : /обеспечен.*выданн/iu.test(descLower)
                      ? '009'
                      : '001';
        const isWriteoffOff = /списан|возвращ|выбыл/iu.test(descLower);
        const offSub = [cpName, nomName].filter(Boolean).join(' / ') || 'Объект забалансового учёта';
        pushEntry(
          isWriteoffOff ? '' : offAcc,
          isWriteoffOff ? offAcc : '',
          totalWithVat,
          isWriteoffOff ? '' : offSub,
          isWriteoffOff ? offSub : '',
          isWriteoffOff
            ? `Списание с забалансового счёта ${offAcc}`
            : `Принятие к забалансовому учёту на счёт ${offAcc}`,
          { isOffBalance: true }
        );
        break;
      }

      case 'manual':
      default: {
        // Safe neutral ОперацияБух: never fabricate Дт 26 Кт 60.01 on unrecognized or blank operations
        break;
      }
    }
  }

  // --- 7b. Active Account & Subconto Non-Negative Ledger Guard (10.*, 41.*, 43, 08.04.1, 01.01, 50.01) ---
  if (
    batchContext &&
    entries.some(
      (e) =>
        !e.isOffBalance &&
        (e.credit.startsWith('10.') ||
          e.credit.startsWith('41.') ||
          e.credit === '43' ||
          e.credit === '08.04.1' ||
          e.credit === '01.01' ||
          e.credit === '50.01')
    )
  ) {
    const guardOsv = calculateOsvReport({
      db1C,
      operations: priorOps,
      dateTo: draft.date || undefined,
      reportingYear: batchContext.reportingYear,
      includeQueuedOperations: true,
    });
    const availByAcc = new Map<string, number>();
    for (const r of guardOsv.leafRows) {
      availByAcc.set(r.code, round2(r.endDebit - r.endCredit));
    }
    const availSubcontosByAcc = new Map<string, Array<{ label: string; bal: number }>>();
    for (const [acc, subs] of Object.entries(guardOsv.subcontoRowsByAccount ?? {})) {
      const list = subs
        .map((s) => ({ label: s.subcontoLabel, bal: round2(s.endDebit - s.endCredit) }))
        .filter((s) => s.bal >= 0.01);
      if (list.length > 0) availSubcontosByAcc.set(acc, list);
    }

    for (const e of entries) {
      if (!e.isOffBalance && e.debit) {
        availByAcc.set(e.debit, round2((availByAcc.get(e.debit) ?? 0) + e.amount));
        const rawDtSub = e.debitSubconto || cpName || nomName || employeeName || '';
        const normDtSub = normalizeSubcontoLabel(rawDtSub, e.debit);
        const list = availSubcontosByAcc.get(e.debit) ?? [];
        const existingSub = list.find((s) => s.label === normDtSub);
        if (existingSub) {
          existingSub.bal = round2(existingSub.bal + e.amount);
        } else {
          list.push({ label: normDtSub, bal: e.amount });
        }
        availSubcontosByAcc.set(e.debit, list);
      }
    }

    // 1) Cash register 50.01: if payout exceeds cash on hand, replenish from 51 by check
    const cashCredits = round2(
      entries
        .filter((e) => !e.isOffBalance && e.credit === '50.01')
        .reduce((s, e) => s + e.amount, 0)
    );
    const cashAvail = availByAcc.get('50.01') ?? 0;
    if (cashCredits - cashAvail >= 0.01) {
      const cashShortfall = round2(cashCredits - Math.max(0, cashAvail));
      entries.unshift({
        id: `${opId}-cash-replenish`,
        debit: '50.01',
        credit: '51',
        debitSubconto: 'Получение наличных в банке',
        creditSubconto: bankSubconto,
        amount: cashShortfall,
        description: 'Получены наличные в банке по чеку для обеспечения кассовой выплаты',
      });
      availByAcc.set('50.01', round2(cashAvail + cashShortfall));
    }

    // Helper to allocate a credit on an active inventory/asset account across open positive subcontos (FIFO / stem match)
    const allocateAcrossSubcontos = (
      baseEntry: AccountingEntry,
      accCode: string,
      amtToAllocate: number
    ): AccountingEntry[] => {
      const subs = (availSubcontosByAcc.get(accCode) ?? []).filter((s) => s.bal >= 0.01);
      if (subs.length === 0) {
        return [{ ...baseEntry, credit: accCode, amount: amtToAllocate }];
      }
      const normReq = normalizeSubcontoLabel(baseEntry.creditSubconto, accCode);
      const reqStems = extractKeywordStems1C(`${baseEntry.creditSubconto} ${draft.description}`);
      const sorted = [...subs].sort((a, b) => {
        const aExact = a.label === normReq ? 1 : 0;
        const bExact = b.label === normReq ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aStemHits = extractKeywordStems1C(a.label).filter((ls) =>
          reqStems.some((rs) => stemsMatch1C(rs, ls))
        ).length;
        const bStemHits = extractKeywordStems1C(b.label).filter((ls) =>
          reqStems.some((rs) => stemsMatch1C(rs, ls))
        ).length;
        if (aStemHits !== bStemHits) return bStemHits - aStemHits;
        const aExactAmt = Math.abs(a.bal - amtToAllocate) < 0.02 ? 1 : 0;
        const bExactAmt = Math.abs(b.bal - amtToAllocate) < 0.02 ? 1 : 0;
        if (aExactAmt !== bExactAmt) return bExactAmt - aExactAmt;
        return 0;
      });

      const out: AccountingEntry[] = [];
      let rem = amtToAllocate;
      let partIdx = 0;
      for (const s of sorted) {
        if (rem < 0.01) break;
        if (s.bal < 0.01) continue;
        const take = round2(Math.min(rem, s.bal));
        s.bal = round2(s.bal - take);
        rem = round2(rem - take);
        partIdx++;
        const nextDtSub =
          baseEntry.debit === '01.01' && accCode === '08.04.1'
            ? s.label
            : baseEntry.debitSubconto;
        out.push({
          ...baseEntry,
          id: partIdx === 1 ? baseEntry.id : `${baseEntry.id}-sub${partIdx}`,
          credit: accCode,
          debitSubconto: nextDtSub,
          creditSubconto: s.label === 'Без аналитики (субконто)' ? baseEntry.creditSubconto : s.label,
          amount: take,
        });
      }
      if (rem >= 0.01) {
        if (out.length > 0) {
          out[out.length - 1].amount = round2(out[out.length - 1].amount + rem);
        } else {
          out.push({ ...baseEntry, credit: accCode, amount: rem });
        }
      }
      return out;
    };

    // 2) Inventory & OS (10.*, 41.*, 43, 08.04.1, 01.01): align subcontos and reroute/split across positive sibling subaccounts if needed
    const rewrittenEntries: AccountingEntry[] = [];
    for (const e of entries) {
      if (
        !e.isOffBalance &&
        (e.credit.startsWith('10.') ||
          e.credit.startsWith('41.') ||
          e.credit === '43' ||
          e.credit === '08.04.1' ||
          e.credit === '01.01')
      ) {
        const rootPrefix = e.credit.startsWith('10.')
          ? '10.'
          : e.credit.startsWith('41.')
            ? '41.'
            : e.credit;
        const curAvail = Math.max(0, availByAcc.get(e.credit) ?? 0);
        if (curAvail >= e.amount - 0.01) {
          availByAcc.set(e.credit, round2(curAvail - e.amount));
          rewrittenEntries.push(...allocateAcrossSubcontos(e, e.credit, e.amount));
        } else {
          let remToCover = e.amount;
          if (curAvail >= 0.01) {
            const takeOwn = round2(Math.min(remToCover, curAvail));
            availByAcc.set(e.credit, round2(curAvail - takeOwn));
            remToCover = round2(remToCover - takeOwn);
            rewrittenEntries.push(...allocateAcrossSubcontos(e, e.credit, takeOwn));
          }
          if (remToCover >= 0.01 && (rootPrefix === '10.' || rootPrefix === '41.')) {
            const siblingCandidates = Array.from(availByAcc.entries())
              .filter(([code, bal]) => code.startsWith(rootPrefix) && code !== e.credit && bal >= 0.01)
              .sort((a, b) => b[1] - a[1]);
            for (const [sibAcc, sibBal] of siblingCandidates) {
              if (remToCover < 0.01) break;
              const takeSib = round2(Math.min(remToCover, sibBal));
              availByAcc.set(sibAcc, round2(sibBal - takeSib));
              remToCover = round2(remToCover - takeSib);
              rewrittenEntries.push(
                ...allocateAcrossSubcontos({ ...e, id: `${e.id}-${sibAcc}` }, sibAcc, takeSib)
              );
            }
          }
          if (remToCover >= 0.01) {
            rewrittenEntries.push(...allocateAcrossSubcontos(e, e.credit, remToCover));
          }
        }
      } else {
        rewrittenEntries.push(e);
      }
    }
    entries.length = 0;
    entries.push(...rewrittenEntries);
  }

  const nonOffBalEntriesSum = round2(
    entries.filter((e) => !e.isOffBalance).reduce((s, e) => s + e.amount, 0)
  );
  const offBalEntriesSum = round2(
    entries.filter((e) => e.isOffBalance).reduce((s, e) => s + e.amount, 0)
  );

  const finalOpAmount =
    category === 'closing' && entries.length > 0
      ? round2(entries.reduce((s, e) => s + e.amount, 0))
      : category === 'financial_disposal' && totalWithVat < 0.01 && entries.length > 0
        ? round2(
            entries.find((e) => e.credit === '76.09')?.amount ??
              entries.find((e) => e.credit === '58.02')?.amount ??
              0
          )
        : category === 'os_disposal' && totalWithVat < 0.01 && entries.length > 0
          ? round2(
              entries.find((e) => e.debit === '91.02' && e.credit === '01.09')?.amount ??
                entries.find((e) => e.debit === '01.09')?.amount ??
                0
            )
          : totalWithVat < 0.01 && (nonOffBalEntriesSum >= 0.01 || offBalEntriesSum >= 0.01)
            ? nonOffBalEntriesSum >= 0.01
              ? nonOffBalEntriesSum
              : offBalEntriesSum
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
  } else if (category === 'writ_of_execution') {
    readinessStatus = 'ready';
    readinessNote = `Исполнительный лист учтён (${resolvedAlimonyShareLabel || '1/4 (25%)'} с ${employeeName || 'сотрудника'} в пользу ${resolvedAlimonyRecipientName || 'получателя'})`;
  } else if (category === 'contract_event') {
    readinessStatus = 'ready';
    readinessNote = resolvedPeriodicPaymentAmount
      ? `Договор зарегистрирован (ставка ${resolvedPeriodicPaymentAmount.toLocaleString('ru-RU')} ₽/период, без проводок при подписании)`
      : 'Договор зарегистрирован в справочнике 1С (без проводок при подписании)';
  } else if (category === 'customer_invoice' || category === 'supplier_invoice') {
    readinessStatus = 'ready';
    readinessNote =
      finalOpAmount >= 0.01
        ? `Счёт на оплату учтён (${finalOpAmount.toLocaleString('ru-RU')} ₽, 0 проводок — заказ сохранён)`
        : 'Счёт на оплату зарегистрирован в 1С:БП 3.0 (0 проводок)';
  } else if (category === 'policy_event') {
    readinessStatus = 'ready';
    readinessNote = 'Параметр учётной политики / вычета 1С:БП 3.0 учтён (без проводок)';
  } else if (category === 'vat_deduction' && finalOpAmount < 0.01) {
    amountMode = 'calculated_by_1c';
    readinessStatus = 'ready';
    readinessNote =
      'Записи книги покупок сформированы (входной НДС принят к вычету при поступлении по СФ)';
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
  } else if ((needsAmount || amountMode === 'required_missing') && finalOpAmount < 0.01) {
    readinessStatus = 'critical_error';
    readinessNote =
      resolverStep01Trace?.summaryFormula ||
      amountCalculationNote ||
      'Сумма не найдена в колонках файла и открытых регистрах учёта';
  } else if (needsCounterparty && cpBinding.status === 'missing') {
    readinessStatus = 'critical_error';
    readinessNote =
      category === 'sale_goods' || category === 'sale_services'
        ? 'Не указан покупатель для счёта 62'
        : 'Не указан контрагент для счёта расчётов';
  } else if (entries.length === 0 && !doesSpecAllowZeroPostings(category)) {
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
    rawExcelAmount: resolvedRawExcelAmount,
    orderTotalAmount: resolvedOrderTotalAmount,
    amountMode: category === 'closing' && finalOpAmount >= 0.01 ? 'from_account_balance' : amountMode,
    readinessStatus: category === 'closing' && finalOpAmount >= 0.01 ? 'ready' : readinessStatus,
    readinessNote:
      category === 'closing' && finalOpAmount >= 0.01
        ? `Готово (${entries.length} регламентных проводок закрытия периода)`
        : readinessNote,
    stockSourceNote,
    calculationProvenance: calculationProvenance || amountCalculationNote,
    needsAmount: (needsAmount && finalOpAmount < 0.01) || undefined,
    amountCalculationNote,
    monthlySalary: resolvedMonthlySalary,
    employeeHireStartDate: draft.employeeHireStartDate,
    employeeTerminationDate: draft.employeeTerminationDate,
    employeePosition: resolvedEmployeePosition,
    employeeChildCount: resolvedEmployeeChildCount,
    employeeIsSingleParent: resolvedEmployeeIsSingleParent,
    employeePropertyDeduction: resolvedEmployeePropertyDeduction,
    founderShares: resolvedFounderShares,
    ownOrganization: resolvedOwnOrganization,
    injuryInsuranceRate:
      category === 'payroll_accrual' || category === 'insurance_accrual'
        ? resolvedInjuryRate
        : undefined,
    payrollStaffSummary,
    usefulLifeMonths: resolvedUsefulLifeMonths,
    depreciationBaseAmount: resolvedDeprBaseAmount,
    isOsModernization: draft.isOsModernization,
    rpbTermMonths:
      category === 'deferred_expense_97'
        ? draft.rpbTermMonths || resolvedUsefulLifeMonths || 12
        : draft.rpbTermMonths,
    rpbWriteOffMethod: draft.rpbWriteOffMethod,
    rpbStartDate: draft.rpbStartDate,
    rpbEndDate: draft.rpbEndDate,
    rpbSettlementAccount: draft.rpbSettlementAccount,
    paidImmediatelyVia: draft.paidImmediatelyVia,
    customPostings: draft.customPostings,
    semanticIntent: draft.semanticIntent,
    studentExplanation: draft.studentExplanation || draft.semanticIntent?.studentExplanation,
    alimonyRecipientName: resolvedAlimonyRecipientName || undefined,
    alimonyRecipientInn: resolvedAlimonyRecipientInn || undefined,
    alimonyRatePercent: resolvedAlimonyRatePercent,
    alimonyFixedAmount: draft.alimonyFixedAmount,
    alimonyShareLabel: resolvedAlimonyShareLabel,
    writStartDate: draft.writStartDate,
    financialNotesSummary: resolvedFinancialNotesSummary || undefined,
    financialNotesList: resolvedFinancialNotesList,
    disposedFinancialNoteId: resolvedDisposedNoteId,
    periodicPaymentAmount: resolvedPeriodicPaymentAmount,
    interestRatePercent: resolvedInterestRatePercent,
    actionSequenceHint: draft.actionSequenceHint,
    explicitCorrespondences: inlineCorr.length > 0 ? inlineCorr : undefined,
    resolverTrace: resolverStep01Trace,
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
      draft.counterpartyKindHint ??
      matchedCpKind ??
      (['founder_contribution', 'charter_capital', 'dividends_accrual', 'dividends_payout'].includes(
        category
      ) && !/^\s*(ооо|ао|пао|зао|гуп|муп)(?=$|[^\p{L}])/iu.test(cpName)
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
    employeeName:
      ['charter_capital', 'founder_contribution', 'dividends_accrual', 'dividends_payout'].includes(
        category
      ) || /^(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ИП)(?:\s|[«"'])/iu.test(employeeName)
        ? ''
        : employeeName,
    nomenclatureGroupName: nomGroup,
    costAccount: [
      'materials_writeoff',
      'workwear_issue',
      'production_output',
      'os_commissioning',
      'depreciation_accrual',
      'intangible_amortization',
      'deferred_expense_97',
      'hr_hire',
      'payroll_accrual',
      'insurance_accrual',
    ].includes(category)
      ? category === 'deferred_expense_97'
        ? draft.costAccountHint ||
          (/вступительн\p{L}*\s+взнос.*(?:сро|саморегулируем)/iu.test(descLower) ? '26' : resolvedCostAccount || '26')
        : resolvedCostAccount
      : undefined,
    materialAccount: [
      'purchase_materials',
      'purchase_equipment',
      'materials_writeoff',
      'workwear_issue',
      'os_commissioning',
      'warehouse_transfer',
      'inventory_result',
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

  const syncedTrace = synchronizeStep01ResolverTraceWithFinalOp(
    builtOp,
    doesSpecAllowZeroPostings(category)
  );
  builtOp.resolverTrace = syncedTrace;

  const baseGuide = buildOperationMentorGuide1C(builtOp, db1C);
  builtOp.mentorGuide1C = {
    ...baseGuide,
    step00Prep: buildStep00DirectoryPrepSteps(priorVirtualState, builtOp),
    step01CalculationBreakdown: syncedTrace,
  };
  return builtOp;
}

/**
 * Attaches chronological Step 00 directory preparation instructions (`step00Prep`),
 * synchronizes `resolverTrace` with final operation fields (zero VAT on VAT-free ops,
 * zero Level 8 on resolved ops), and syncs `#1..#N` source operation numbers.
 */
export function attachVirtualStateStep00ToOperations(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  if (operations.length === 0) return operations;
  const { stateBeforeByOpId, displayNumberByOpId } = buildVirtual1CStateTimeline(db1C, operations);
  return operations.map((op) => {
    const stateBefore = stateBeforeByOpId[op.id] ?? createInitialVirtual1CState(db1C);
    const guide = op.mentorGuide1C ?? buildOperationMentorGuide1C(op, db1C);
    const baseSynced = synchronizeStep01ResolverTraceWithFinalOp(
      { ...op, resolverTrace: op.resolverTrace ?? guide.step01CalculationBreakdown },
      doesSpecAllowZeroPostings(op.category)
    );
    const syncedStep01: Step01CalculationBreakdown1C = {
      ...baseSynced,
      sourceLinks: baseSynced.sourceLinks.map((lnk) => ({
        ...lnk,
        opNumber:
          lnk.opId && displayNumberByOpId[lnk.opId]
            ? displayNumberByOpId[lnk.opId]
            : lnk.opNumber,
      })),
    };
    return {
      ...op,
      resolverTrace: syncedStep01,
      mentorGuide1C: {
        ...guide,
        step00Prep: buildStep00DirectoryPrepSteps(stateBefore, op),
        step01CalculationBreakdown: syncedStep01,
      },
    };
  });
}

/**
 * Chronologically recalculates dependent operations in the ledger whenever an upstream
 * operation (e.g. ПриемНаРаботу salary, ИсполнительныйЛист 76.41, OS commissioning СПИ,
 * recurring contract, promissory note, advance, or supplier receipt) is updated.
 */
export function recalculateOperationsChronologically(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null,
  options?: { reportingYear?: number; defaultBik?: string }
): QueuedOperation[] {
  const manualAndImported = operations.filter(
    (o) => !o.autoGeneratedKind && !o.id.startsWith('op-cash-cover')
  );
  const autoGenerated = operations.filter((o) => Boolean(o.autoGeneratedKind));

  const indexed = manualAndImported.map((op, idx) => ({ op, idx }));
  indexed.sort((a, b) => {
    const dA = a.op.date || '9999-12-31';
    const dB = b.op.date || '9999-12-31';
    if (dA !== dB) return dA.localeCompare(dB);
    return a.idx - b.idx;
  });

  const canonicalCounterpartyMap = buildCanonicalCounterpartyRegistry1C(
    db1C,
    indexed.map((x) => x.op)
  );

  const runSinglePass = (
    inputOps: QueuedOperation[],
    lookaheadOps?: QueuedOperation[]
  ): QueuedOperation[] => {
    let runningState = createInitialVirtual1CState(db1C);
    const out: QueuedOperation[] = [];
    for (let pos = 0; pos < inputOps.length; pos++) {
      const op = inputOps[pos];
      const shouldResetClass = isMisclassifiedLegacyOperation(op);
      const keepExplicitAmount =
        op.amountMode === 'explicit'
          ? op.vatRule === 'on_top' && op.vatAmount > 0 && !shouldResetClass
            ? round2(op.amount - op.vatAmount)
            : op.amount
          : op.category === 'customer_invoice' || op.category === 'supplier_invoice'
            ? op.rawExcelAmount ?? op.amount
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
          rawExcelAmount: op.rawExcelAmount,
          orderTotalAmount: op.orderTotalAmount,
          monthlySalary:
            op.category === 'hr_hire'
              ? op.monthlySalary || op.rawExcelAmount || undefined
              : op.amountMode === 'explicit'
                ? op.monthlySalary
                : undefined,
          employeeHireStartDate: op.employeeHireStartDate,
          employeeTerminationDate: op.employeeTerminationDate,
          employeePosition: op.employeePosition,
          employeeChildCount: op.employeeChildCount,
          employeeIsSingleParent: op.employeeIsSingleParent,
          employeePropertyDeduction: op.employeePropertyDeduction,
          founderShares: op.founderShares,
          ownOrganization: op.ownOrganization,
          injuryInsuranceRate: op.injuryInsuranceRate,
          usefulLifeMonths: op.usefulLifeMonths,
          depreciationBaseAmount:
            op.amountMode === 'explicit' ? op.depreciationBaseAmount : undefined,
          rpbTermMonths: op.rpbTermMonths,
          rpbSettlementAccount: op.rpbSettlementAccount,
          paidImmediatelyVia: op.paidImmediatelyVia,
          semanticIntent: op.semanticIntent,
          studentExplanation: op.studentExplanation,
          alimonyRecipientName: op.alimonyRecipientName,
          alimonyRecipientInn: op.alimonyRecipientInn,
          alimonyRatePercent: op.alimonyRatePercent,
          alimonyFixedAmount: op.alimonyFixedAmount,
          alimonyShareLabel: op.alimonyShareLabel,
          writStartDate: op.writStartDate,
          financialNotesSummary: op.financialNotesSummary,
          financialNotesList: op.financialNotesList,
          disposedFinancialNoteId: op.disposedFinancialNoteId,
          periodicPaymentAmount: op.periodicPaymentAmount,
          interestRatePercent: op.interestRatePercent,
          actionSequenceHint: op.actionSequenceHint,
          explicitCorrespondences: op.explicitCorrespondences,
          vatRate: shouldResetClass ? undefined : op.vatRate,
          vatRule: shouldResetClass ? undefined : op.vatRule,
          vatAmount:
            !shouldResetClass && op.amountMode === 'explicit' ? op.vatAmount : undefined,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          hasInvoiceSF: shouldResetClass ? undefined : op.hasInvoiceSF,
          counterpartyName:
            op.category === 'bank_out' && op.counterpartyName.includes(';')
              ? ''
              : op.counterpartyName,
          counterpartyInn:
            op.category === 'bank_out' && op.counterpartyName.includes(';')
              ? ''
              : op.counterpartyInn,
          counterpartyKpp:
            op.category === 'bank_out' && op.counterpartyName.includes(';')
              ? ''
              : op.counterpartyKpp,
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
          contractName: shouldResetClass ? '' : op.contractName,
          contractNumber: shouldResetClass ? '' : op.contractNumber,
          contractDate: shouldResetClass ? '' : op.contractDate,
          nomenclatureName: op.nomenclatureName,
          nomenclatureGroupHint: op.nomenclatureGroupName,
          warehouseName: op.warehouseName,
          warehouseToHint: op.warehouseToName,
          expenseItemName: op.expenseItemName,
          cashFlowItemName: shouldResetClass ? '' : op.cashFlowItemName,
          employeeName: op.employeeName,
          costAccountHint: op.costAccount,
          materialAccountHint: shouldResetClass ? undefined : op.materialAccount,
          docTypeHint: shouldResetClass ? undefined : op.docType1C,
          categoryHint: shouldResetClass ? undefined : op.category,
        },
        db1C,
        op.id,
        {
          priorOperations: out,
          futureOperations: lookaheadOps ? lookaheadOps.slice(pos + 1) : undefined,
          currentOpNumber: pos + 1,
          virtualStateBefore: runningState,
          canonicalCounterpartyMap,
          reportingYear: options?.reportingYear,
          defaultBik: options?.defaultBik ?? DEFAULT_SBERBANK_BIK,
          defaultBankName: DEFAULT_SBERBANK_NAME,
          assumeInvoiceOnVatPurchase: true,
        }
      );

      const preservedManualEntries =
        op.category === 'manual' &&
        !op.explicitCorrespondences?.length &&
        rebuilt.entries.length === 0 &&
        op.entries.length > 0
          ? op.entries
          : rebuilt.entries;

      const finalItem: QueuedOperation = {
        ...rebuilt,
        entries: preservedManualEntries,
        includeInProcessing: op.includeInProcessing,
      };
      out.push(finalItem);
      runningState = advanceVirtual1CStateWithOperation(runningState, finalItem, pos + 1);
    }
    return out;
  };

  // Pass 1: forward chronological resolution
  const sortedOps = indexed.map((x) => x.op);
  const pass1Ops = runSinglePass(sortedOps);
  // Pass 2: bidirectional resolution with full forward lookahead across Pass 1 state
  const recomputedChrono = runSinglePass(pass1Ops, pass1Ops);

  return attachVirtualStateStep00ToOperations([...recomputedChrono, ...autoGenerated], db1C);
}

export function isMisclassifiedLegacyOperation(op: QueuedOperation): boolean {
  if (op.semanticIntent) {
    return false;
  }
  const natural = detectOperationClassification({
    description: op.description,
    nomenclatureName: op.nomenclatureName,
    counterpartyName: op.counterpartyName,
    actionSequenceHint: op.actionSequenceHint,
    explicitCorrespondences: op.explicitCorrespondences,
  });
  if (
    op.category === 'manual' &&
    op.docType1C === 'ОперацияБух' &&
    op.entries.length > 0 &&
    (Boolean(op.explicitCorrespondences?.length) || natural.category === 'manual')
  ) {
    return false;
  }
  if (op.category !== natural.category || op.docType1C !== natural.docType1C) {
    if (
      op.docType1C === 'ПоступлениеТоваровУслуг' ||
      op.category === 'penalty_claim' ||
      [
        'materials_writeoff',
        'workwear_issue',
        'os_commissioning',
        'os_disposal',
        'production_output',
        'warehouse_transfer',
        'cash_bank_internal',
        'accountable_issue',
        'expense_report',
        'accountable_return',
        'loan_received',
        'loan_repaid',
        'loan_issued',
        'loan_interest_accrual',
        'sale_goods',
        'sale_services',
        'depreciation_accrual',
        'insurance_accrual',
        'hr_hire',
        'writ_of_execution',
        'contract_event',
        'customer_invoice',
        'supplier_invoice',
        'policy_event',
        'closing',
        'alimony_payout',
        'financial_investment',
        'financial_interest_accrual',
        'financial_disposal',
        'vat_deduction',
        'bank_out',
        'bank_in',
        'payroll_accrual',
        'payroll_payout',
        'tax_payment',
        'bank_fee',
        'purchase_equipment',
        'purchase_materials',
        'purchase_goods',
        'purchase_services',
        'founder_contribution',
        'charter_capital',
        'dividends_accrual',
        'dividends_payout',
        'intangible_acquisition',
        'intangible_commissioning',
        'intangible_amortization',
        'inventory_result',
        'acquiring_receipt',
        'special_bank_55',
        'employee_settlement_73',
        'deferred_expense_97',
        'reserve_doubtful_63',
        'off_balance_op',
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
  const filteredOps = operations.filter((o) => !o.id.startsWith('op-cash-cover'));
  const canonicalCounterpartyMap = buildCanonicalCounterpartyRegistry1C(db1C, filteredOps);
  let runningState = createInitialVirtual1CState(db1C);
  const result: QueuedOperation[] = [];
  for (let idx = 0; idx < filteredOps.length; idx++) {
    const op = filteredOps[idx];
    if (op.autoGeneratedKind) {
      const autoOp: QueuedOperation = {
        ...op,
        mentorGuide1C: op.mentorGuide1C ?? buildOperationMentorGuide1C(op, db1C),
      };
      result.push(autoOp);
      runningState = advanceVirtual1CStateWithOperation(runningState, autoOp, idx + 1);
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
        rawExcelAmount: op.rawExcelAmount,
        orderTotalAmount: op.orderTotalAmount,
        monthlySalary: op.monthlySalary,
        employeeHireStartDate: op.employeeHireStartDate,
        employeeTerminationDate: op.employeeTerminationDate,
        employeePosition: op.employeePosition,
        employeeChildCount: op.employeeChildCount,
        employeeIsSingleParent: op.employeeIsSingleParent,
        employeePropertyDeduction: op.employeePropertyDeduction,
        founderShares: op.founderShares,
        injuryInsuranceRate: op.injuryInsuranceRate,
        usefulLifeMonths: op.usefulLifeMonths,
        depreciationBaseAmount: op.depreciationBaseAmount,
        rpbTermMonths: op.rpbTermMonths,
        rpbSettlementAccount: op.rpbSettlementAccount,
        paidImmediatelyVia: op.paidImmediatelyVia,
        semanticIntent: op.semanticIntent,
        studentExplanation: op.studentExplanation,
        alimonyRecipientName: op.alimonyRecipientName,
        alimonyRecipientInn: op.alimonyRecipientInn,
        alimonyRatePercent: op.alimonyRatePercent,
        alimonyFixedAmount: op.alimonyFixedAmount,
        alimonyShareLabel: op.alimonyShareLabel,
        writStartDate: op.writStartDate,
        financialNotesSummary: op.financialNotesSummary,
        financialNotesList: op.financialNotesList,
        disposedFinancialNoteId: op.disposedFinancialNoteId,
        periodicPaymentAmount: op.periodicPaymentAmount,
        interestRatePercent: op.interestRatePercent,
        actionSequenceHint: op.actionSequenceHint,
        explicitCorrespondences: op.explicitCorrespondences,
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
      {
        priorOperations: result,
        futureOperations: filteredOps.slice(idx + 1),
        currentOpNumber: idx + 1,
        virtualStateBefore: runningState,
        canonicalCounterpartyMap,
        assumeInvoiceOnVatPurchase: true,
      }
    );

    const merged: QueuedOperation = {
      ...rebound,
      includeInProcessing: op.includeInProcessing,
    };
    result.push(merged);
    runningState = advanceVirtual1CStateWithOperation(runningState, merged, idx + 1);
  }
  return attachVirtualStateStep00ToOperations(result, db1C);
}

/**
 * Cleans up legacy hydrated snapshots (strips fake `op-cash-cover`, zombie `26/60.01` on `vat_deduction`,
 * INN-as-principal on promissory notes, desynced INNs, and stale `resolverTrace`), then runs full
 * chronological recalculation so any loaded snapshot self-heals immediately.
 */
export function sanitizeHydratedOperations(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  const withoutSynthetic = operations.filter(
    (op) => !op.id.startsWith('op-cash-cover') && !op.autoGeneratedKind
  );
  const allDescriptions = withoutSynthetic.map((o) => o.description).join('\n');
  const dbInns = new Set((db1C?.counterparties ?? []).map((c) => c.inn).filter(Boolean));

  const preCleaned = withoutSynthetic.map((op) => {
    const rawTrimmed = (op.counterpartyName ?? '').trim();
    const extractedFromDesc = extractCounterpartyFromText1C(op.description);
    const isCharterOp =
      op.category === 'charter_capital' ||
      /(?:сформирован|образован|зарегистрирован)\p{L}*\s+уставн\p{L}*\s+капитал/iu.test(
        op.description
      );
    const hasSwappedCounterparty =
      !isCharterOp &&
      Boolean(extractedFromDesc) &&
      Boolean(rawTrimmed) &&
      normalizeEntityKey(extractedFromDesc) !== normalizeEntityKey(rawTrimmed);
    const hadCorruptedShortName = rawTrimmed.length > 0 && rawTrimmed.length < 2;
    const hasOutOfRegionNonExplicitInn =
      Boolean(op.counterpartyInn) &&
      !op.counterpartyInn.startsWith('78') &&
      !op.counterpartyInn.startsWith('47') &&
      !dbInns.has(op.counterpartyInn) &&
      !allDescriptions.includes(op.counterpartyInn);

    const hasBillionInnAmountBug =
      op.amount >= 500_000_000 && !/(?:млрд|миллиард)/iu.test(op.description);
    const isPureCalculatedStockWriteoffWithoutDigits =
      op.rawExcelAmount === undefined &&
      op.amountMode === 'explicit' &&
      !(/\d/.test(op.description)) &&
      ['materials_writeoff', 'workwear_issue', 'production_output', 'os_commissioning'].includes(
        op.category
      );
    const shouldClearExplicitAmount =
      hasBillionInnAmountBug || isPureCalculatedStockWriteoffWithoutDigits;

    const cleanedNotes = op.financialNotesList?.filter(
      (n) => n.principal > 0 && n.principal <= 100_000_000
    );
    const natural = detectOperationClassification({
      description: op.description,
      explicitCorrespondences: op.explicitCorrespondences,
    });
    const isLegacyManualMisclassified =
      op.category === 'manual' &&
      !op.explicitCorrespondences?.length &&
      natural.category !== 'manual';

    const cleanedEntries =
      op.category === 'vat_deduction' || natural.category === 'vat_deduction'
        ? op.entries.filter((e) => e.debit === '68.02' && e.credit.startsWith('19'))
        : isLegacyManualMisclassified
          ? []
          : op.entries.filter(
              (e) => !(e.debit === '26' && e.credit === '60.01' && e.amount === 0)
            );

    const resetCp = hadCorruptedShortName || hasSwappedCounterparty || isCharterOp;

    return {
      ...op,
      category: isLegacyManualMisclassified ? natural.category : op.category,
      docType1C: isLegacyManualMisclassified ? natural.docType1C : op.docType1C,
      amount: shouldClearExplicitAmount ? 0 : op.amount,
      amountMode: shouldClearExplicitAmount
        ? isPureCalculatedStockWriteoffWithoutDigits
          ? ('calculated_by_1c' as const)
          : ('required_missing' as const)
        : op.amountMode,
      counterpartyName: resetCp ? (hasSwappedCounterparty ? extractedFromDesc : '') : rawTrimmed,
      counterpartyInn: resetCp || hasOutOfRegionNonExplicitInn ? '' : op.counterpartyInn,
      counterpartyKpp: resetCp || hasOutOfRegionNonExplicitInn ? '' : op.counterpartyKpp,
      counterpartySource:
        resetCp || hasOutOfRegionNonExplicitInn ? undefined : op.counterpartySource,
      egrulCandidates:
        resetCp || hasOutOfRegionNonExplicitInn ? undefined : op.egrulCandidates,
      employeeName: /^(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ИП)(?:\s|[«"'])/iu.test(
        op.employeeName ?? ''
      )
        ? ''
        : op.employeeName,
      financialNotesList: cleanedNotes && cleanedNotes.length > 0 ? cleanedNotes : undefined,
      entries: shouldClearExplicitAmount ? [] : cleanedEntries,
    };
  });

  return recalculateOperationsChronologically(preCleaned, db1C);
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


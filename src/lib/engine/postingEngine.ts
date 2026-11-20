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
  OperationCategory,
  QueuedOperation,
} from '@/types/accounting';
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
  return /поступлен\p{L}*\s+(?:на\s+расч[её]тн\p{L}+\s+сч[её]т\s+|на\s+р\/с\s+)?доли(?=$|[^\p{L}])|оплат\p{L}*\s+доли(?=$|[^\p{L}])|внесени\p{L}*\s+доли(?=$|[^\p{L}])|взнос\p{L}*\s+в\s+уставн\p{L}+\s+капитал|вклад\p{L}*\s+в\s+уставн\p{L}+\s+капитал|формирован\p{L}*\s+уставн\p{L}+\s+капитал|взнос\p{L}*\s+учредител/iu.test(
    text
  );
}

export function extractFounderFioFromDescription(text: string): string {
  const cleaned = text.replace(/[«»"'„“”()]/g, ' ').replace(/\s+/g, ' ').trim();
  const re =
    /(?:доли(?:\s+в\s+уставн\p{L}+\s+капитал\p{L}*)?(?:\s+учредителя|\s+участника|\s+от)?|взнос\p{L}*\s+в\s+уставн\p{L}+\s+капитал\p{L}*\s+(?:от\s+)?(?:учредителя\s+|участника\s+)?|вклад\p{L}*\s+в\s+уставн\p{L}+\s+капитал\p{L}*\s+(?:от\s+)?(?:учредителя\s+|участника\s+)?|(?:от\s+)?(?:учредителя|участника))\s+([А-ЯЁ][а-яё]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.|[А-ЯЁ]\.|[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?))?)/u;
  const m = cleaned.match(re);
  if (m && m[1]) {
    const candidate = m[1]
      .replace(/\s+(?:Сумма|НДС|Без|По|Договор|Счет|Счёт|В|На).*$/u, '')
      .trim();
    if (candidate.length >= 2) {
      return candidate;
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
  warehouseName?: string;
  expenseItemName?: string;
  cashFlowItemName?: string;
  employeeName?: string;
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

function detectCategoryAndDocType(
  draft: RawDraftOperationInput,
  matchedNomKind?: string
): { category: OperationCategory; docType1C: DocType1CBP30 } {
  if (draft.categoryHint && draft.docTypeHint) {
    return { category: draft.categoryHint, docType1C: draft.docTypeHint };
  }

  const itemAndDescText = `${draft.description} ${draft.nomenclatureName ?? ''}`.toLowerCase();
  const fullText = `${itemAndDescText} ${draft.counterpartyName ?? ''}`.toLowerCase();

  // Closing
  if (/закрытие месяца|закрытие счета 26|закрытие счетов 90|реформация баланса/i.test(itemAndDescText)) {
    return { category: 'closing', docType1C: 'ЗакрытиеМесяца' };
  }

  // Advance offset
  if (/зачет аванс|зачёт аванс|корректировка долга/i.test(itemAndDescText)) {
    return { category: 'advance_offset', docType1C: 'КорректировкаДолга' };
  }

  // Payroll accrual
  if (
    /начислен[аоы]?\s+(заработн|зарплат|оплата труда)|расчетная ведомость|начисление зарплаты/i.test(
      itemAndDescText
    ) &&
    draft.directionHint !== 'out'
  ) {
    return { category: 'payroll_accrual', docType1C: 'НачислениеЗарплаты' };
  }

  // Cash operations
  if (/(?:^|[^\p{L}])пко(?=$|[^\p{L}])|приходный кассовый|поступление наличных|в кассу/iu.test(itemAndDescText)) {
    return { category: 'cash_in', docType1C: 'ПоступлениеНаличных' };
  }
  if (/(?:^|[^\p{L}])рко(?=$|[^\p{L}]).*касс|расходный кассовый|выдача наличных|из кассы|под отчет наличн/iu.test(itemAndDescText)) {
    return { category: 'cash_out', docType1C: 'ВыдачаНаличных' };
  }

  // Bank fee
  if (
    /комиссия банка|за ведение счета|расчетно-кассовое обслуж|услуги банка/i.test(
      itemAndDescText
    )
  ) {
    return { category: 'bank_fee', docType1C: 'СписаниеСРасчетногоСчета' };
  }

  // Tax / social contribution payments (including combined debt payoff to МИ ФНС / УФК / СФР)
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
      return { category: 'tax_payment', docType1C: 'СписаниеСРасчетногоСчета' };
    }
  }

  // Penalty / writ of execution
  if (/исполнительн\w*\s+лист|штраф по договор|неустойк|претензи|судебн\w*\s+взыскан/iu.test(itemAndDescText)) {
    return {
      category: 'penalty_claim',
      docType1C:
        draft.directionHint === 'out' || /оплат|списан|перечислен/i.test(itemAndDescText)
          ? 'СписаниеСРасчетногоСчета'
          : 'ОперацияБух',
    };
  }

  // Payroll payout
  if (/выплат\p{L}*\s+(?:заработн|зарплат)|перечислен\p{L}*\s+(?:заработн|зарплат)|зарплата по ведомости|аванс за первую половину/iu.test(itemAndDescText)) {
    return { category: 'payroll_payout', docType1C: 'СписаниеСРасчетногоСчета' };
  }

  // Founder contribution to charter capital (счёт 75.01 — взнос в УК / оплата доли учредителя)
  if (
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(itemAndDescText)
  ) {
    const isCash = /(?:^|[^\p{L}])пко(?=$|[^\p{L}])|в кассу|наличн/iu.test(itemAndDescText);
    return {
      category: 'founder_contribution',
      docType1C: isCash ? 'ПоступлениеНаличных' : 'ПоступлениеНаРасчетныйСчет',
    };
  }

  // Explicit bank IN hints (payment / advance from buyer — does NOT match "Поступили товары/материалы")
  if (
    draft.directionHint === 'in' ||
    /поступил\p{L}*\s+(?:на\s+р\/с(?:ч)?|на\s+расч[её]тн\p{L}*\s+сч[её]т\s*)?(?:\d+\s*%\s*)?(?:оплат|аванс|предоплат|выручк|денежн\p{L}*\s+средств)|поступление\s+на\s+(?:р\/с|расч[её]тн)|оплата\s+от\s+(?:покупател|заказчик)|платежное\s+поручение\s+входящ|выручка\s+на\s+расчетный\s+счет|получен\p{L}*\s+(?:\d+\s*%\s*)?(?:аванс|предоплат|оплат)\s+от|зачислен\p{L}*\s+на\s+(?:р\/с|расч[её]тн)/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'bank_in', docType1C: 'ПоступлениеНаРасчетныйСчет' };
  }

  // Explicit bank OUT hints (payment / 100% advance to supplier)
  if (
    draft.directionHint === 'out' ||
    /перечислен\p{L}*\s+(?:с\s+р\/с(?:ч)?\s+|с\s+расч[её]тн\p{L}*\s+сч[её]та\s+)?(?:\d+\s*%\s*)?(?:аванс|предоплат|оплат|задолженност|сумма|денежн|по\s+сч[её]ту|поставщик|подрядчик|арендодател)|оплачен\p{L}*\s+(?:поставщик|сч[её]т|аванс|с\s+р\/с|с\s+расч[её]тн)|списание\s+с\s+(?:р\/с|расч[её]тн)|платежное\s+поручение\s+исходящ|оплата\s+по\s+счету/iu.test(
      itemAndDescText
    )
  ) {
    return { category: 'bank_out', docType1C: 'СписаниеСРасчетногоСчета' };
  }

  // Sales (Реализация / Отгрузка покупателю)
  if (
    /реализован|отгружен\p{L}*\s+(?:покупател|заказчик|товар|продукц)|прода[нж]\p{L}*\s+(?:покупател|товар|продукц)|оказаны услуги заказчику|оказаны услуги покупателю|акт оказанных услуг покупателю|реализация товаров|реализация услуг|выручка от реализации/iu.test(
      itemAndDescText
    )
  ) {
    if (matchedNomKind === 'Товар' || matchedNomKind === 'Продукция') {
      return { category: 'sale_goods', docType1C: 'РеализацияТоваровУслуг' };
    }
    if (
      matchedNomKind === 'Услуга' ||
      /оказан\w*\s+услуг|реализация услуг|акт выполненных работ|консультац|разработк|проектирован/iu.test(
        itemAndDescText
      )
    ) {
      return { category: 'sale_services', docType1C: 'РеализацияТоваровУслуг' };
    }
    return { category: 'sale_goods', docType1C: 'РеализацияТоваровУслуг' };
  }

  // Purchases (Поступление товаров / материалов / услуг)
  if (matchedNomKind === 'Товар') {
    return { category: 'purchase_goods', docType1C: 'ПоступлениеТоваровУслуг' };
  }
  if (matchedNomKind === 'Материал') {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг' };
  }
  if (
    matchedNomKind === 'Услуга' ||
    /аренд|услуг|связ|интернет|телефон|электроэнерг|коммунальн|доставк|реклам|консультац|обслуживан/i.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_services', docType1C: 'ПоступлениеТоваровУслуг' };
  }

  if (/материал|сырь[её]|канцтовар|бумаг|топлив|гсм|запчаст|инвентар|хозтовар/i.test(itemAndDescText)) {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг' };
  }

  return { category: 'purchase_goods', docType1C: 'ПоступлениеТоваровУслуг' };
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

export function bindAndGenerateOperation(
  draft: RawDraftOperationInput,
  db1C: Database1CSnapshot | null,
  existingId?: string,
  batchContext?: BatchSequentialContext
): QueuedOperation {
  const opId = existingId ?? `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  let expenseItemName = (draft.expenseItemName ?? '').trim();
  let cashFlowItemName = (draft.cashFlowItemName ?? '').trim();
  const employeeName = (draft.employeeName ?? '').trim();

  const descNormForLookup = normalizeEntityKey(draft.description);
  const founderShareOp =
    draft.categoryHint === 'founder_contribution' ||
    draft.explicitCredit === '75.01' ||
    draft.explicitCredit === '75' ||
    isFounderContributionText(draft.description);

  // Extract founder FIO for charter capital share contributions ("Поступление на расчетный счет доли <ФИО>")
  if (!cpName && founderShareOp) {
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
  if (!cpName && !cpInn && db1C && descNormForLookup) {
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
  const { category, docType1C } = detectCategoryAndDocType(draft, matchedNomKind);

  const needsCounterparty = ![
    'closing',
    'payroll_accrual',
    'payroll_payout',
    'bank_fee',
    'tax_payment',
  ].includes(category);

  if (needsCounterparty && !cpName && !cpInn) {
    cpBinding = { status: 'missing', note: 'Не указан контрагент' };
  }

  // --- 4. Bind Contract against 1C DB ---
  const needsContract = [
    'bank_out',
    'bank_in',
    'purchase_goods',
    'purchase_materials',
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
  const needsWarehouse = ['purchase_goods', 'purchase_materials', 'sale_goods'].includes(category);
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
    } else if (db1C && db1C.warehouses.length === 1) {
      warehouseName = db1C.warehouses[0].name;
      warehouseBinding = {
        status: 'matched_1c',
        matchedName: db1C.warehouses[0].name,
        matchedCode1C: db1C.warehouses[0].code1C,
      };
    } else {
      warehouseBinding = { status: 'missing', note: 'Не выбран склад учёта МПЗ' };
    }
  }

  const needsExpenseItem = ['purchase_services', 'payroll_accrual'].includes(category);
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
      // Try exact match by service description keywords in db1C.expenseItems
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
      // Match standard 1C cash flow item if present in DB
      const targetPattern =
        category === 'founder_contribution'
          ? /вклад\p{L}*\s+собственник|уставн\p{L}+\s+капитал|учредител/iu
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

  // --- 6. Automatic Calculation of Empty Amount + VAT strictly by 1C policy and document text ---
  const descLower = draft.description.toLowerCase();
  const priorOps = batchContext?.priorOperations ?? [];
  let effectiveDraftAmount = round2(Math.abs(draft.amount));
  let amountCalculationNote = draft.amountCalculationNote;
  let effectiveQty = draft.quantity;
  let effectiveUnitPrice = draft.unitPrice;
  let inheritedVatRule = draft.vatRule;
  let inheritedVatRate = draft.vatRate;
  let taxBreakdownFromBalances: Array<{ account: string; amount: number; name: string }> = [];

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
  }

  // 6b. Compute tax/social contribution debt payoff from current credit balances on 68.* / 69.*
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
        amountCalculationNote = `Рассчитано из кредитового сальдо счетов 68/69: ${candidateTaxRows
          .map((r) => `${r.code} (${r.endCredit.toFixed(2)} ₽)`)
          .join(' + ')} = ${sumCreditBalances.toFixed(2)} ₽`;
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
  if (effectiveDraftAmount < 0.01 && priorOps.length > 0) {
    const normCp = normalizeEntityKey(cpName);
    const normNom = normalizeEntityKey(nomName);

    for (let i = priorOps.length - 1; i >= 0; i--) {
      const prev = priorOps[i];
      if (!prev.includeInProcessing || prev.amount <= 0) continue;
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
        break;
      }

      // Check available advance on 60.02 / 62.02 for this counterparty
      if (
        ['purchase_goods', 'purchase_materials', 'purchase_services'].includes(category) &&
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
        amountCalculationNote = `Сумма определена по связанному авансу поставщику «${cpName}» (счёт 60.02): ${effectiveDraftAmount.toFixed(2)} ₽`;
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
        amountCalculationNote = `Сумма определена по связанному авансу покупателя «${cpName}» (счёт 62.02): ${effectiveDraftAmount.toFixed(2)} ₽`;
        break;
      }

      if (
        category === 'bank_out' &&
        ['purchase_goods', 'purchase_materials', 'purchase_services'].includes(prev.category)
      ) {
        effectiveDraftAmount = prev.amount;
        amountCalculationNote = `Сумма оплаты определена по связанному поступлению от «${cpName}»: ${effectiveDraftAmount.toFixed(2)} ₽`;
        break;
      }

      if (
        category === 'bank_in' &&
        ['sale_goods', 'sale_services'].includes(prev.category)
      ) {
        effectiveDraftAmount = prev.amount;
        amountCalculationNote = `Сумма поступления определена по связанной реализации «${cpName}»: ${effectiveDraftAmount.toFixed(2)} ₽`;
        break;
      }
    }
  }

  // 6d. Compute payroll payout from credit balance of account 70 if empty
  if (effectiveDraftAmount < 0.01 && category === 'payroll_payout') {
    const runningOsv = calculateOsvReport({
      db1C,
      operations: priorOps,
      reportingYear: batchContext?.reportingYear,
      includeQueuedOperations: true,
    });
    const row70 = runningOsv.leafRows.find((r) => r.code === '70');
    if (row70 && row70.endCredit > 0.01) {
      effectiveDraftAmount = row70.endCredit;
      amountCalculationNote = `Сумма выплаты определена по кредитовому сальдо счёта 70: ${effectiveDraftAmount.toFixed(2)} ₽`;
    }
  }

  const nonVatCategories: OperationCategory[] = [
    'tax_payment',
    'bank_fee',
    'founder_contribution',
    'payroll_accrual',
    'payroll_payout',
    'closing',
    'advance_offset',
  ];

  let vatRule: 'included' | 'on_top' | 'none' = inheritedVatRule ?? 'included';
  let vatRate = inheritedVatRate !== undefined ? inheritedVatRate : isOsno ? policyVatRate : 0;

  if (
    nonVatCategories.includes(category) ||
    /без ндс|ндс не облагается|не облагается ндс/i.test(descLower) ||
    !isOsno
  ) {
    vatRule = 'none';
    vatRate = 0;
  } else if (/сверху\s*ндс|плюс\s*ндс|\+\s*ндс/i.test(descLower)) {
    vatRule = 'on_top';
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

  const needsAmount =
    draft.needsAmount === true && totalWithVat < 0.01
      ? true
      : totalWithVat < 0.01 && category !== 'closing';

  if (needsAmount && !amountCalculationNote) {
    amountCalculationNote = 'Требуется указать сумму первичного документа';
  }

  const explicitlyNoSF =
    /без\s+сч[её]та?-фактур|сч[её]т-фактур\p{L}*\s+не\s+(?:получен|предоставлен|выставлен)|отсутств\p{L}*\s+сч[её]т-фактур/iu.test(
      descLower
    );

  const hasInvoiceSF =
    draft.hasInvoiceSF !== undefined
      ? draft.hasInvoiceSF
      : explicitlyNoSF
        ? false
        : /счет-фактур|счёт-фактур|сч-ф|с\/ф|(?:^|[^\p{L}])упд(?=$|[^\p{L}])/iu.test(descLower) ||
          Boolean(
            batchContext?.assumeInvoiceOnVatPurchase &&
              isOsno &&
              vatAmount > 0 &&
              ['purchase_goods', 'purchase_materials', 'purchase_services'].includes(category)
          );

  const nomGroup =
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
    description: string
  ) => {
    const cleanAmt = round2(amount);
    if (cleanAmt <= 0) return;
    entries.push({
      id: `${opId}-e${entries.length + 1}`,
      debit,
      credit,
      debitSubconto,
      creditSubconto,
      amount: cleanAmt,
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
        pushEntry(
          '70',
          '51',
          totalWithVat,
          employeeName || 'Сотрудники организации',
          bankSubconto,
          draft.description || 'Выплата заработной платы на банковские карты'
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
        const matAcc = matchedNomAccount || '10.01';
        const matSubconto = [nomName || 'Материалы', warehouseName].filter(Boolean).join(' / ');
        pushEntry(
          matAcc,
          '60.01',
          netWithoutVat,
          matSubconto,
          cpSubconto || cpName,
          'Поступление сырья и материалов'
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
        // Check deterministic COGS strictly from 1C stock balances/receipts (or prior receipts in batch!) if quantity is known
        const stockAcc = matchedNomKind === 'Продукция' ? '43' : matchedNomAccount || '41.01';
        if (effectiveQty && effectiveQty > 0) {
          let unitCost = estimateUnitCostFrom1C(nomName, stockAcc, db1C);
          if (!unitCost && priorOps.length > 0) {
            const normNom = normalizeEntityKey(nomName);
            for (const pOp of priorOps) {
              if (
                pOp.includeInProcessing &&
                pOp.quantity &&
                pOp.quantity > 0 &&
                (!normNom || normalizeEntityKey(pOp.nomenclatureName) === normNom)
              ) {
                const stockEntry = pOp.entries.find((e) => e.debit === stockAcc);
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
              stockAcc,
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
        const wageCostAcc =
          db1C?.postings.find((p) => p.credit === '70' && ['20.01', '26', '44.01'].includes(p.debit))
            ?.debit ?? '26';
        pushEntry(
          wageCostAcc,
          '70',
          totalWithVat,
          expenseItemName || 'Оплата труда',
          employeeName || 'Сотрудники организации',
          'Начислена заработная плата за месяц'
        );
        pushEntry(
          '70',
          '68.01',
          round2(totalWithVat * 0.13),
          employeeName || 'Сотрудники организации',
          'НДФЛ исчисленный',
          'Удержан НДФЛ 13%'
        );
        pushEntry(
          wageCostAcc,
          '69.09',
          round2(totalWithVat * 0.3),
          'Страховые взносы',
          'Страховые взносы по единому тарифу',
          'Начислены страховые взносы по единому тарифу (30%)'
        );
        pushEntry(
          wageCostAcc,
          '69.11',
          round2(totalWithVat * 0.002),
          'Страховые взносы',
          'Взносы от НС и ПЗ',
          'Начислены взносы на травматизм (0,2%)'
        );
        break;
      }

      default: {
        pushEntry('26', '60.01', totalWithVat, expenseItemName, cpSubconto, draft.description);
        break;
      }
    }
  }

  // --- 8. Deduplication check against 1C DB (never deduplicates between imported Excel rows!) ---
  const dupCheck = checkDuplicateIn1CDb(
    {
      date: draft.date,
      amount: totalWithVat,
      docNumber: draft.docNumber ?? '',
      counterpartyName: cpName,
      counterpartyInn: cpInn,
    },
    db1C
  );

  return {
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
    amount: totalWithVat,
    needsAmount: needsAmount || undefined,
    amountCalculationNote,
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
    expenseItemName,
    cashFlowItemName,
    employeeName,
    nomenclatureGroupName: nomGroup,
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
}

export function rebindOperationsAgainst1CDb(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  return operations.map((op) => {
    if (op.autoGeneratedKind) return op;

    const cleanCpName = op.counterpartyName.trim().length >= 2 ? op.counterpartyName.trim() : '';
    const shouldUpgradeFounderShare =
      op.category !== 'founder_contribution' && isFounderContributionText(op.description);

    // Re-check bindings and deduplication while preserving user-edited entries unless upgrading founder share
    const rebound = bindAndGenerateOperation(
      {
        sourceFileName: op.sourceFileName,
        date: op.date,
        docNumber: op.docNumber,
        incomingDocNumber: op.incomingDocNumber,
        incomingDocDate: op.incomingDocDate,
        description: op.description,
        amount: op.amount,
        vatRate: op.vatRate,
        vatRule: op.vatRule,
        vatAmount: op.vatAmount,
        quantity: op.quantity,
        unitPrice: op.unitPrice,
        hasInvoiceSF: op.hasInvoiceSF,
        counterpartyName: cleanCpName,
        counterpartyInn: cleanCpName ? op.counterpartyInn : '',
        counterpartyKpp: cleanCpName ? op.counterpartyKpp : '',
        contractName: op.contractName,
        contractNumber: op.contractNumber,
        contractDate: op.contractDate,
        nomenclatureName: op.nomenclatureName,
        warehouseName: op.warehouseName,
        expenseItemName: op.expenseItemName,
        cashFlowItemName: op.cashFlowItemName,
        employeeName: op.employeeName,
        docTypeHint: shouldUpgradeFounderShare ? undefined : op.docType1C,
        categoryHint: shouldUpgradeFounderShare ? undefined : op.category,
      },
      db1C,
      op.id
    );

    return {
      ...rebound,
      includeInProcessing: op.includeInProcessing,
      entries:
        !shouldUpgradeFounderShare && op.entries.length > 0 ? op.entries : rebound.entries,
    };
  });
}

/**
 * Cleans up corrupted single-character (`length < 2`) or orphaned manually entered
 * counterparties upon hydrating state from `localStorage`, and rebinds founder contributions.
 */
export function sanitizeHydratedOperations(
  operations: QueuedOperation[],
  db1C: Database1CSnapshot | null
): QueuedOperation[] {
  return operations.map((op) => {
    if (op.autoGeneratedKind) return op;

    const rawTrimmed = (op.counterpartyName ?? '').trim();
    const hadCorruptedShortName = rawTrimmed.length > 0 && rawTrimmed.length < 2;
    const isFounderOp = isFounderContributionText(op.description);

    if (hadCorruptedShortName || (isFounderOp && (op.category !== 'founder_contribution' || !rawTrimmed))) {
      const rebuilt = bindAndGenerateOperation(
        {
          sourceFileName: op.sourceFileName,
          date: op.date,
          docNumber: op.docNumber,
          incomingDocNumber: op.incomingDocNumber,
          incomingDocDate: op.incomingDocDate,
          description: op.description,
          amount: op.amount,
          vatRate: isFounderOp ? 0 : op.vatRate,
          vatRule: isFounderOp ? 'none' : op.vatRule,
          vatAmount: isFounderOp ? 0 : op.vatAmount,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          hasInvoiceSF: op.hasInvoiceSF,
          counterpartyName: hadCorruptedShortName ? '' : rawTrimmed,
          counterpartyInn: hadCorruptedShortName ? '' : op.counterpartyInn,
          counterpartyKpp: hadCorruptedShortName ? '' : op.counterpartyKpp,
          contractName: isFounderOp ? '' : op.contractName,
          contractNumber: isFounderOp ? '' : op.contractNumber,
          contractDate: isFounderOp ? '' : op.contractDate,
          nomenclatureName: op.nomenclatureName,
          warehouseName: op.warehouseName,
          expenseItemName: op.expenseItemName,
          cashFlowItemName: isFounderOp ? '' : op.cashFlowItemName,
          employeeName: op.employeeName,
          docTypeHint: isFounderOp ? undefined : op.docType1C,
          categoryHint: isFounderOp ? undefined : op.category,
        },
        db1C,
        op.id
      );
      return {
        ...rebuilt,
        includeInProcessing: op.includeInProcessing,
      };
    }

    // Also re-verify if an existing named counterparty actually matches 1C Контрагенты / ФизическиеЛица
    if (rawTrimmed.length >= 2 && db1C && op.bindings.counterparty.status !== 'matched_1c') {
      const matched = matchPersonOrCounterpartyIn1C(rawTrimmed, op.counterpartyInn, db1C);
      if (matched) {
        return {
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
      }
    }

    return op;
  });
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
      ['purchase_goods', 'purchase_materials', 'purchase_services'].includes(op.category) &&
      op.vatAmount > 0 &&
      op.hasInvoiceSF
    ) {
      actions.push({
        id: `acc-sf-in-${op.id}`,
        kind: 'register_sf_incoming',
        title: `Зарегистрировать Счёт-фактуру полученный от «${op.counterpartyName || 'поставщика'}»`,
        details: `Вычет НДС Дт 68.02 Кт ${op.category === 'purchase_services' ? '19.04' : '19.03'} на сумму ${op.vatAmount.toFixed(2)} ₽ (флаг «Отразить вычет НДС в книге покупок датой получения»)`,
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


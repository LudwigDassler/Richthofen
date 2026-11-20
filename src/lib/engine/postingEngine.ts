import {
  AccountingEntry,
  Database1CSnapshot,
  DirectoryAutocompleteOption1C,
  DocType1CBP30,
  EntityBindingStatus,
  OperationCategory,
  QueuedOperation,
} from '@/types/accounting';

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
  sourceFileName: string;
  date: string;
  docNumber?: string;
  incomingDocNumber?: string;
  incomingDocDate?: string;
  description: string;
  amount: number;
  vatRate?: number;
  vatRule?: 'included' | 'on_top' | 'none';
  vatAmount?: number;
  quantity?: number;
  unitPrice?: number;
  hasInvoiceSF?: boolean;
  counterpartyName?: string;
  counterpartyInn?: string;
  counterpartyKpp?: string;
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
  if (/зачет аванс|корректировка долга/i.test(itemAndDescText)) {
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

  // Tax / social contribution payments
  if (
    draft.directionHint === 'out' ||
    /уплата налога|перечислен[оы]?\s+(ндс|ндфл|налог|страховые взносы|енп)|в бюджет|единый налоговый платеж/i.test(
      fullText
    )
  ) {
    if (
      /(?:^|[^\p{L}])(ндс в бюджет|уплата ндс|ндфл|налог на прибыль|страховые взносы|единый налоговый платеж|енп|ифнс|уфк|сфр|фнс)(?=$|[^\p{L}])/iu.test(
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
  if (/выплата зарплат|перечисление заработной|зарплата по ведомости|аванс за первую половину/i.test(itemAndDescText)) {
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

  // Explicit bank hints
  if (
    draft.directionHint === 'in' ||
    /поступила оплата|поступление на р\/с|оплата от покупателя|платежное поручение входящ|выручка на расчетный счет|получен аванс от покупател/i.test(
      itemAndDescText
    )
  ) {
    return { category: 'bank_in', docType1C: 'ПоступлениеНаРасчетныйСчет' };
  }

  if (
    draft.directionHint === 'out' ||
    /оплачено поставщику|списание с р\/с|перечислена оплата|перечислен аванс поставщик|платежное поручение исходящ|оплата по счету/i.test(
      itemAndDescText
    )
  ) {
    return { category: 'bank_out', docType1C: 'СписаниеСРасчетногоСчета' };
  }

  // Sales (Реализация)
  if (
    /реализован|отгружен\w*\s+покупател|оказаны услуги заказчику|акт оказанных услуг покупателю|реализация товаров|реализация услуг|выручка от реализации/iu.test(
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

  // Purchases (Поступление)
  if (matchedNomKind === 'Товар') {
    return { category: 'purchase_goods', docType1C: 'ПоступлениеТоваровУслуг' };
  }
  if (matchedNomKind === 'Материал') {
    return { category: 'purchase_materials', docType1C: 'ПоступлениеТоваровУслуг' };
  }
  if (
    matchedNomKind === 'Услуга' ||
    /аренд|услуг|связ|интернет|электроэнерг|коммунальн|доставк|реклам|консультац|обслуживан/i.test(
      itemAndDescText
    )
  ) {
    return { category: 'purchase_services', docType1C: 'ПоступлениеТоваровУслуг' };
  }

  if (/материал|сырь[её]|канцтовар|топлив|гсм|запчаст|инвентар|хозтовар/i.test(itemAndDescText)) {
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

export function bindAndGenerateOperation(
  draft: RawDraftOperationInput,
  db1C: Database1CSnapshot | null,
  existingId?: string
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
      } else {
        cpName = normalizeGenitiveFioToNominative(extractedFounderFio);
      }
    } else if (db1C) {
      const mentionedPerson = findPersonMentionedInDescription1C(draft.description, db1C);
      if (mentionedPerson) {
        cpName = mentionedPerson.name;
        cpInn = mentionedPerson.inn || cpInn;
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
    } else {
      const foundPerson = findPersonMentionedInDescription1C(draft.description, db1C);
      if (foundPerson) {
        cpName = foundPerson.name;
        cpInn = foundPerson.inn || '';
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

  // --- 1. Bind Counterparty / Individual strictly against 1C DB (Контрагенты + ФизическиеЛица) ---
  let cpBinding: EntityBindingStatus = { status: 'not_required' };
  let matchedCpIdName = '';
  let matchedCpKind: DirectoryAutocompleteOption1C['kind'] | undefined;

  if (cpName || cpInn) {
    const matched1C = matchPersonOrCounterpartyIn1C(cpName, cpInn, db1C);

    if (matched1C) {
      cpName = matched1C.name;
      cpInn = matched1C.inn || cpInn;
      cpKpp = matched1C.kpp || cpKpp;
      matchedCpIdName = matched1C.name;
      matchedCpKind = matched1C.kind;
      if (!contractName && matched1C.defaultContract && !founderShareOp) {
        contractName = matched1C.defaultContract;
      }
      cpBinding = {
        status: 'matched_1c',
        matchedName: matched1C.name,
        matchedCode1C: matched1C.code1C,
        matchedInn: matched1C.inn,
        note:
          matched1C.source === 'ФизическиеЛица'
            ? 'Привязано к справочнику 1С «ФизическиеЛица»'
            : undefined,
      };
    } else if (db1C) {
      cpBinding = {
        status: 'new_for_1c',
        note: 'Новый элемент (будет создан при экспорте в 1С)',
      };
    } else {
      cpBinding = {
        status: 'new_for_1c',
        note: 'База 1С не подключена — элемент будет создан при экспорте',
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

  // --- 6. VAT calculation strictly by 1C policy and document text ---
  const descLower = draft.description.toLowerCase();
  const nonVatCategories: OperationCategory[] = [
    'tax_payment',
    'bank_fee',
    'founder_contribution',
    'payroll_accrual',
    'payroll_payout',
    'closing',
    'advance_offset',
  ];

  let vatRule: 'included' | 'on_top' | 'none' = draft.vatRule ?? 'included';
  let vatRate = draft.vatRate !== undefined ? draft.vatRate : isOsno ? policyVatRate : 0;

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

  const grossOrBaseAmount = round2(Math.abs(draft.amount));
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

  const hasInvoiceSF =
    draft.hasInvoiceSF !== undefined
      ? draft.hasInvoiceSF
      : /счет-фактур|счёт-фактур|сч-ф|с\/ф|(?:^|[^\p{L}])упд(?=$|[^\p{L}])/iu.test(descLower);

  const nomGroup =
    matchedNomGroup ||
    db1C?.nomenclatureGroups[0]?.name ||
    'Основная номенклатурная группа';

  // --- 7. Build deterministic RSBU entries ---
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
  const bankSubconto = [db1C?.organization.bankAccount, cashFlowItemName]
    .filter(Boolean)
    .join(' / ');

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
        const isAdvance = /аванс|предоплат/i.test(descLower);
        const dtAcc = isAdvance ? '60.02' : '60.01';
        pushEntry(
          dtAcc,
          '51',
          totalWithVat,
          cpSubconto,
          bankSubconto,
          isAdvance ? 'Перечислен аванс поставщику' : 'Оплата поставщику с расчётного счёта'
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
          cpSubconto,
          isAdvance ? 'Получен аванс от покупателя' : 'Поступление оплаты от покупателя'
        );
        if (isAdvance && vatAmount > 0 && hasInvoiceSF) {
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
        let taxAcc = '68.02';
        if (/ндфл/i.test(descLower)) taxAcc = '68.01';
        else if (/прибыл/i.test(descLower)) taxAcc = '68.04.1';
        else if (/травматизм|нс и пз/i.test(descLower)) taxAcc = '69.11';
        else if (/страховые взносы|единый тариф|сфр|пфр|фсс/i.test(descLower)) taxAcc = '69.09';
        else if (/штраф|пен[ия]/i.test(descLower)) taxAcc = '68.10';

        pushEntry(
          taxAcc,
          '51',
          totalWithVat,
          'Налог (взносы): начислено / уплачено',
          bankSubconto,
          draft.description || `Перечисление налога/взносов (${taxAcc})`
        );
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
          cpSubconto,
          'Поступление товаров от поставщика'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.03',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto,
            'Учтён входной НДС по приобретённым товарам'
          );
          if (hasInvoiceSF) {
            pushEntry(
              '68.02',
              '19.03',
              vatAmount,
              'Налог (взносы): начислено / уплачено',
              cpName,
              'Принят к вычету НДС по счёту-фактуре поставщика'
            );
          }
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
          cpSubconto,
          'Поступление сырья и материалов'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.03',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto,
            'Учтён входной НДС по приобретённым материалам'
          );
          if (hasInvoiceSF) {
            pushEntry(
              '68.02',
              '19.03',
              vatAmount,
              'Налог (взносы): начислено / уплачено',
              cpName,
              'Принят к вычету НДС по счёту-фактуре поставщика'
            );
          }
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
          cpSubconto,
          'Отражены услуги сторонних организаций'
        );
        if (vatAmount > 0) {
          pushEntry(
            '19.04',
            '60.01',
            vatAmount,
            cpName,
            cpSubconto,
            'Учтён входной НДС по приобретённым услугам'
          );
          if (hasInvoiceSF) {
            pushEntry(
              '68.02',
              '19.04',
              vatAmount,
              'Налог (взносы): начислено / уплачено',
              cpName,
              'Принят к вычету НДС по услугам (СФ / УПД)'
            );
          }
        }
        break;
      }

      case 'sale_goods': {
        pushEntry(
          '62.01',
          '90.01.1',
          totalWithVat,
          cpSubconto,
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
        // Check deterministic COGS strictly from 1C stock balances/receipts if quantity is known
        const stockAcc = matchedNomKind === 'Продукция' ? '43' : matchedNomAccount || '41.01';
        if (draft.quantity && draft.quantity > 0) {
          const unitCost = estimateUnitCostFrom1C(nomName, stockAcc, db1C);
          if (unitCost && unitCost > 0) {
            pushEntry(
              '90.02.1',
              stockAcc,
              round2(unitCost * draft.quantity),
              nomGroup,
              [nomName, warehouseName].filter(Boolean).join(' / '),
              'Списана себестоимость реализованных ТМЦ по данным БД 1С'
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
          cpSubconto,
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

  // --- 8. Deduplication check against 1C DB ---
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
    vatRate,
    vatRule,
    vatAmount,
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    hasInvoiceSF,
    counterpartyName: cpName,
    counterpartyInn: cpInn,
    counterpartyKpp: cpKpp,
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

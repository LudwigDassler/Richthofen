import {
  Database1CSnapshot,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_NAME,
  DirectoryPrepStep1C,
  ParsedFinancialNoteItem1C,
  QueuedOperation,
  Virtual1CStateSnapshot,
  VirtualContract1C,
  VirtualCounterparty1C,
  VirtualEmployee1C,
  VirtualEntityUsageRef1C,
  VirtualFinancialInvestment1C,
  VirtualFixedAsset1C,
  VirtualNomenclature1C,
  VirtualOpenOrder1C,
  VirtualOpenSettlement1C,
  VirtualWritOfExecution1C,
} from '@/types/accounting';
import {
  cleanNomenclatureName1C,
  extractCharterCapitalInfo1C,
  extractEmployeeTaxDeductions1C,
  extractUsefulLifeMonths1C,
  normalizeEmployeeOrFounderName1C,
  normalizeLegalEntityName1C,
  normalizeRussianFioToNominative1C,
} from './entityNormalizer1C';
import { sanitizePrepSteps1C } from './textHygiene1C';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatRuDateShort(iso?: string): string {
  if (!iso) return 'ранее';
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function normalizeCounterpartyKey1C(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”]/g, ' ')
    .replace(
      /\b(общество с ограниченной ответственностью|акционерное общество|публичное акционерное общество|закрытое акционерное общество|индивидуальный предприниматель|ооо|пао|зао|оао|ао|ип|нко|фгуп|муп)\b/giu,
      ' '
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSimpleEntityKey1C(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”]/g, ' ')
    .replace(/[^\p{L}\p{N}.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a Russian person name for matching staff employees:
 * e.g. "Валеев В.В." -> "валеев в.в", "Валеева А.С." -> "валеева а.с"
 * Preserves gender ending of surname + initials so "Валеев В.В." and "Валеева..." never collide!
 */
export function normalizePersonIdentityKey1C(raw: string): string {
  const preClean = (raw ?? '')
    .replace(/\(\s*фио\s+студента\s*\)/giu, '')
    .replace(/\b(сотрудник|работник|физлицо|физическое лицо|получатель|должник|мо[л])\b/giu, ' ')
    .replace(/[«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!preClean) return '';

  if (/(?:^|\s)(?:главн\p{L}*|глан\p{L}*)\s+бухгалтер\p{L}*$/iu.test(preClean)) {
    return 'главный бухгалтер';
  }

  const nom = normalizeEmployeeOrFounderName1C(preClean);
  const cleaned = nom.toLowerCase().replace(/ё/g, 'е').trim();
  if (!cleaned) return '';

  // Match "Фамилия И.О." or "Фамилия И. О." or "Фамилия Имя Отчество"
  const mInitials = cleaned.match(/^([а-яa-z-]{2,})\s+([а-яa-z])\.\s*([а-яa-z])\.?/i);
  if (mInitials) {
    return `${mInitials[1]} ${mInitials[2]}.${mInitials[3]}`;
  }
  const mSingleInit = cleaned.match(/^([а-яa-z-]{2,})\s+([а-яa-z])\.$/i);
  if (mSingleInit) {
    return `${mSingleInit[1]} ${mSingleInit[2]}`;
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1][0]}.${parts[2][0]}`;
  }
  return cleaned;
}

const RUSSIAN_STOP_WORDS = new Set([
  'перечислен',
  'перечислена',
  'перечислено',
  'перечислены',
  'оплачен',
  'оплачена',
  'оплачено',
  'оплачены',
  'оплата',
  'платеж',
  'платежи',
  'платежное',
  'поручение',
  'поступил',
  'поступила',
  'поступило',
  'поступили',
  'поступление',
  'приобретен',
  'приобретена',
  'приобретено',
  'приобретены',
  'куплен',
  'куплена',
  'куплено',
  'получен',
  'получена',
  'получено',
  'получены',
  'оказаны',
  'оказана',
  'выполнены',
  'принят',
  'приняты',
  'принято',
  'услуги',
  'услуга',
  'товары',
  'товар',
  'материалы',
  'материал',
  'работы',
  'работа',
  'счет',
  'счету',
  'счета',
  'расчетного',
  'расчетный',
  'поставщику',
  'поставщика',
  'поставщик',
  'подрядчику',
  'подрядчика',
  'покупателю',
  'покупателя',
  'контрагенту',
  'контрагента',
  'договору',
  'договор',
  'накладной',
  'накладная',
  'акту',
  'акт',
  'сумму',
  'сумма',
  'сумме',
  'включая',
  'числе',
  'ндс',
  'руб',
  'рублей',
  'коп',
  'ооо',
  'пао',
  'зао',
  'оао',
  'инн',
  'кпп',
  'бик',
  'для',
  'при',
  'под',
  'над',
  'или',
  'как',
  'что',
  'без',
  'задолженность',
  'задолженности',
  'долг',
  'долга',
  'аванс',
  'предоплата',
]);

export function stemRussianWord1C(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е').trim();
  if (w.length <= 3) return w;

  const suffixes = [
    'иями',
    'ями',
    'ами',
    'ого',
    'его',
    'ому',
    'ему',
    'иях',
    'иям',
    'ией',
    'ием',
    'ью',
    'ию',
    'ия',
    'ие',
    'ии',
    'ов',
    'ев',
    'ей',
    'ам',
    'ям',
    'ах',
    'ях',
    'ом',
    'ем',
    'ой',
    'ую',
    'юю',
    'ый',
    'ий',
    'ая',
    'яя',
    'ое',
    'ее',
    'ые',
    'ие',
    'а',
    'я',
    'у',
    'ю',
    'е',
    'и',
    'ы',
    'ь',
  ];

  for (const sfx of suffixes) {
    if (w.endsWith(sfx) && w.length - sfx.length >= 3) {
      return w.slice(0, w.length - sfx.length);
    }
  }
  return w;
}

export function extractKeywordStems1C(text: string): string[] {
  const tokens = (text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}]+/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !RUSSIAN_STOP_WORDS.has(t));

  const stems = new Set<string>();
  for (const tok of tokens) {
    const stem = stemRussianWord1C(tok);
    if (stem.length >= 3 && !RUSSIAN_STOP_WORDS.has(stem)) {
      stems.add(stem);
    }
  }
  return Array.from(stems);
}

export function stemsMatch1C(stemA: string, stemB: string): boolean {
  if (stemA === stemB) return true;
  const minLen = Math.min(stemA.length, stemB.length);
  if (minLen >= 4 && (stemA.startsWith(stemB) || stemB.startsWith(stemA))) {
    return true;
  }
  return false;
}

const stemsMatch = stemsMatch1C;

function parseFlexRuNumber(raw: string): number {
  const cleaned = raw.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  const val = Number(cleaned);
  return Number.isFinite(val) ? round2(val) : 0;
}

/**
 * Extracts multiple securities / promissory notes from a single row description:
 * e.g. "Куплены ценные бумаги: первый вексель стоимостью 280 000 руб. под 13% годовых, второй — 540 000 руб. под 11% годовых"
 */
export function extractFinancialNotesFromText1C(
  text: string,
  explicitAmount?: number
): ParsedFinancialNoteItem1C[] {
  const clean = (text ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\b\d{10,12}\s*\/\s*\d{9}\b/g, ' ')
    .replace(/(?:инн|кпп|огрн|бик|р\/сч?|к\/сч?)[\s.:№-]*\d{6,20}/giu, ' ')
    .replace(/\b\d{9,20}\b/g, ' ');
  if (!/вексел|облигац|ценн\p{L}*\s+бумаг/iu.test(clean)) return [];

  const notes: ParsedFinancialNoteItem1C[] = [];
  // Match pair patterns: "<amount> (руб)? ... под/по ставке <rate>%"
  const pairRe =
    /((?:\d{1,3}(?:[\s\u202F]\d{3})+|\d{4,8})(?:[.,]\d{1,2})?)\s*(?:руб\.?|₽|р\.?)?[^%.;\n]{0,45}?(?:под|ставк\p{L}*|доходност\p{L}*)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/giu;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(clean)) !== null) {
    const principal = parseFlexRuNumber(m[1]);
    const ratePercent = parseFlexRuNumber(m[2]);
    if (principal >= 1000 && ratePercent > 0 && ratePercent <= 100) {
      notes.push({
        index: notes.length + 1,
        label: `Вексель №${notes.length + 1}`,
        principal,
        ratePercent,
      });
    }
  }

  if (notes.length > 0) return notes;

  // Fallback: single amount + single rate in note/bond text OR explicit column amount
  const rateMatch = clean.match(/(?:под|ставк\p{L}*)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/iu);
  const rate = rateMatch ? parseFlexRuNumber(rateMatch[1]) : 0;
  const amtMatches = Array.from(
    clean.matchAll(/((?:\d{1,3}(?:[\s\u202F]\d{3})+|\d{4,8})(?:[.,]\d{1,2})?)\s*(?:руб\.?|₽|р\.?)/giu)
  );
  if (amtMatches.length >= 1) {
    amtMatches.forEach((am, idx) => {
      const principal = parseFlexRuNumber(am[1]);
      if (principal >= 1000) {
        notes.push({
          index: idx + 1,
          label: `Вексель №${idx + 1}`,
          principal,
          ratePercent: rate,
        });
      }
    });
  } else if ((explicitAmount ?? 0) >= 1000 && rate > 0) {
    notes.push({
      index: 1,
      label: 'Вексель №1',
      principal: round2(explicitAmount!),
      ratePercent: rate,
    });
  }

  return notes;
}

/**
 * Extracts recurring periodic fee from a contract signing / multi-month invoice row:
 * e.g. "Заключен договор аренды с ООО БизнесЦентр с ежемесячной платой 60 000 руб., в т.ч. НДС 20%"
 * or "Получен счет №23 на сумму 1 380 000 руб ... за аренду ... на 2 месяца" -> 690 000 ₽/мес.
 */
export function extractRecurringContractTerms1C(
  text: string,
  explicitAmount?: number
): {
  periodicAmount: number;
  periodicity: 'monthly' | 'quarterly' | 'once';
  vatRule: 'included' | 'on_top' | 'none';
  vatRate: number;
} | null {
  const clean = (text ?? '').replace(/\u00A0/g, ' ');
  const m = clean.match(
    /(?:ежемесячн\p{L}*|абонентск\p{L}*|арендн\p{L}*\s+плат\p{L}*|в\s+месяц|ежеквартальн\p{L}*)[^0-9]{0,35}?((?:\d{1,3}(?:[\s\u202F]\d{3})+|\d{3,})(?:[.,]\d{1,2})?)\s*(?:руб\.?|₽|р\.?)?/iu
  );
  const fallbackM = !m
    ? clean.match(
        /(?:плат\p{L}*|сумм\p{L}*|стоимост\p{L}*)[^0-9]{0,25}?((?:\d{1,3}(?:[\s\u202F]\d{3})+|\d{4,})(?:[.,]\d{1,2})?)\s*(?:руб\.?|₽|р\.?)/iu
      )
    : null;
  const chosen = m || fallbackM;
  let amt = chosen ? parseFlexRuNumber(chosen[1]) : round2(explicitAmount ?? 0);
  if (amt < 100) return null;

  // If invoice/contract states total for N months ("на 2 месяца", "за 3 мес"), divide into monthly rate
  const monthsSpanM = !m ? clean.match(/(?:на|за)\s+(\d{1,2})\s*мес\p{L}*/iu) : null;
  if (monthsSpanM) {
    const months = Number(monthsSpanM[1]);
    if (months >= 2 && months <= 24) {
      amt = round2(amt / months);
    }
  }

  const isQuarterly = /ежеквартальн|в\s+квартал/iu.test(clean);
  const isNoVat = /без\s+ндс|ндс\s+не\s+облаг/iu.test(clean);
  const isOnTop = /(?:плюс|\+)\s*ндс|по\s+цене\s+без\s+ндс|сверх\p{L}*\s+ндс/iu.test(clean);
  return {
    periodicAmount: amt,
    periodicity: isQuarterly ? 'quarterly' : 'monthly',
    vatRule: isNoVat ? 'none' : isOnTop ? 'on_top' : 'included',
    vatRate: isNoVat ? 0 : 20,
  };
}

/**
 * Finds which active promissory note is being disposed/endorsed/redeemed in `text`.
 */
export function matchTargetActiveFinancialNote1C(
  state: Virtual1CStateSnapshot,
  text: string
): VirtualFinancialInvestment1C | null {
  const activeNotes = state.financialInvestments.filter(
    (f) => f.account === '58.02' && f.status !== 'disposed' && (f.principalAmount ?? f.totalAmount) >= 0.01
  );
  if (activeNotes.length === 0) return null;

  const lower = (text ?? '').toLowerCase().replace(/ё/g, 'е');
  if (/перв\p{L}*\s+вексел|вексел\p{L}*\s*№?\s*1\b/iu.test(lower)) {
    return activeNotes.find((n) => n.paperIndex === 1) || activeNotes[0];
  }
  if (/втор\p{L}*\s+вексел|вексел\p{L}*\s*№?\s*2\b/iu.test(lower)) {
    return activeNotes.find((n) => n.paperIndex === 2) || activeNotes[1] || activeNotes[0];
  }
  if (/трет\p{L}*\s+вексел|вексел\p{L}*\s*№?\s*3\b/iu.test(lower)) {
    return activeNotes.find((n) => n.paperIndex === 3) || activeNotes[2] || activeNotes[0];
  }

  // Match by nominal amount or rate mentioned in text
  for (const note of activeNotes) {
    const nominal = note.principalAmount ?? note.totalAmount;
    const rate = note.interestRatePercent ?? 0;
    const nominalSpaced = Math.round(nominal).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
    if (
      lower.includes(String(Math.round(nominal))) ||
      lower.includes(nominalSpaced) ||
      (rate > 0 && new RegExp(`\\b${rate}\\s*%`).test(lower))
    ) {
      return note;
    }
  }

  return activeNotes[0];
}

function addUsageRef(
  usages: VirtualEntityUsageRef1C[],
  ref: VirtualEntityUsageRef1C | undefined
): VirtualEntityUsageRef1C[] {
  if (!ref) return usages;
  if (usages.some((u) => u.opId === ref.opId)) return usages;
  return [...usages, ref];
}

export function inferNomenclatureCatalogMeta1C(
  name: string,
  category?: QueuedOperation['category'],
  explicitMaterialAccount?: string
): {
  itemKind: VirtualNomenclature1C['itemKind'];
  defaultAccount: string;
  unit: string;
} {
  const lower = (name ?? '').toLowerCase().replace(/ё/g, 'е');

  if (
    category === 'purchase_equipment' ||
    category === 'os_commissioning' ||
    explicitMaterialAccount?.startsWith('08.04') ||
    /бетоносмесител|бетономешалк|оборудован|станок|станк|компрессор|генератор|трансформатор|кран|погрузчик|экскаватор|минитрактор|трактор|плоттер|вагон-бытовк|бытовк|леса\s+строительн|строительн\p{L}*\s+леса|производственн\p{L}*\s+лини|сервер/iu.test(
      lower
    )
  ) {
    return {
      itemKind: 'Оборудование (компоненты ОС)',
      defaultAccount: '08.04.1',
      unit: 'шт',
    };
  }

  if (
    category === 'purchase_services' ||
    category === 'sale_services' ||
    /услуг|аренд|доставк|перевозк|ремонт|связ|интернет|консультац|формирован\p{L}*\s+сет|настройк|монтаж/iu.test(
      lower
    )
  ) {
    return {
      itemKind: 'Услуги',
      defaultAccount: '26',
      unit: 'усл',
    };
  }

  if (category === 'production_output' || explicitMaterialAccount === '43') {
    return {
      itemKind: 'Продукция',
      defaultAccount: '43',
      unit: 'шт',
    };
  }

  if (
    explicitMaterialAccount === '10.03' ||
    /бензин|дизель|дт\b|топлив|гсм|смазк|автомасл|моторн\p{L}*\s+масл|машинн\p{L}*\s+масл|керосин|антифриз|тосол/iu.test(
      lower
    )
  ) {
    return {
      itemKind: 'Топливо и ГСМ',
      defaultAccount: '10.03',
      unit: /смазк|масл|бензин|топлив|антифриз|тосол/iu.test(lower) ? 'л / шт' : 'л',
    };
  }

  if (
    explicitMaterialAccount === '10.10' ||
    explicitMaterialAccount === '10.09' ||
    category === 'workwear_issue' ||
    /спецодежд|спецобув|костюм|комбинезон|халат|каск|перчатк|рукавиц|жилет|ботинк|сапог|куртк|инвентар|хозпринадлежност|принтер|оргтехник|офисн\p{L}*\s+мебел|стул|стол(?=$|[^\p{L}])|кресл|шкаф|стеллаж/iu.test(
      lower
    )
  ) {
    const isInv =
      explicitMaterialAccount === '10.09' ||
      /инвентар|хозпринадлежност|принтер|оргтехник|офисн\p{L}*\s+мебел|стул|стол(?=$|[^\p{L}])|кресл|шкаф|стеллаж/iu.test(
        lower
      );
    return {
      itemKind: 'Спецодежда и инвентарь',
      defaultAccount: isInv ? '10.09' : '10.10',
      unit: 'шт / компл',
    };
  }

  if (
    explicitMaterialAccount === '10.08' ||
    /кирпич|цемент|бетон|раствор|песок|щебен|гравий|арматур|доск|брус|плитк|потолочн\p{L}*\s+плит|керамогранит|металлопрофил|утеплител|обо[ий]|паркет|рейк|плинтус|газонн\p{L}*\s+трав|гипсокартон|штукатурк|шпатлевк|рубероид|шифер|профнастил|труб\p{L}*\s+(?:стальн|пвх|полипропилен)/iu.test(
      lower
    )
  ) {
    return {
      itemKind: 'Материалы',
      defaultAccount: '10.08',
      unit: 'шт / т',
    };
  }

  if (
    category === 'purchase_materials' ||
    category === 'materials_writeoff' ||
    explicitMaterialAccount?.startsWith('10') ||
    /сырь|материал|запчаст|детал|краск|лак|гвозд|саморез|электрод|проволок|бумаг|картридж|канцтовар/iu.test(
      lower
    )
  ) {
    return {
      itemKind: 'Материалы',
      defaultAccount: explicitMaterialAccount?.startsWith('10')
        ? explicitMaterialAccount
        : '10.01',
      unit: 'шт',
    };
  }

  return {
    itemKind: 'Товары',
    defaultAccount: explicitMaterialAccount || '41.01',
    unit: 'шт',
  };
}

export function cloneVirtual1CState(state: Virtual1CStateSnapshot): Virtual1CStateSnapshot {
  return {
    ownOrganization: state.ownOrganization ? { ...state.ownOrganization } : undefined,
    counterparties: state.counterparties.map((c) => ({ ...c, usages: [...c.usages] })),
    contracts: state.contracts.map((c) => ({
      ...c,
      keywordStems: c.keywordStems ? [...c.keywordStems] : undefined,
      usages: [...c.usages],
    })),
    nomenclature: state.nomenclature.map((n) => ({ ...n, usages: [...n.usages] })),
    employees: state.employees.map((e) => ({ ...e, usages: [...e.usages] })),
    fixedAssets: state.fixedAssets.map((a) => ({ ...a, usages: [...a.usages] })),
    writsOfExecution: state.writsOfExecution.map((w) => ({ ...w, usages: [...w.usages] })),
    financialInvestments: state.financialInvestments.map((f) => ({ ...f, usages: [...f.usages] })),
    openSettlements: state.openSettlements.map((s) => ({
      ...s,
      keywordStems: [...s.keywordStems],
    })),
    openOrders: (state.openOrders ?? []).map((o) => ({
      ...o,
      keywordStems: [...o.keywordStems],
    })),
  };
}

export function createInitialVirtual1CState(
  db1C: Database1CSnapshot | null
): Virtual1CStateSnapshot {
  const state: Virtual1CStateSnapshot = {
    ownOrganization:
      db1C?.organization?.name || db1C?.organization?.inn
        ? {
            name: db1C.organization.name || '',
            inn: (db1C.organization.inn || '').replace(/\D/g, ''),
            kpp: (db1C.organization.kpp || '').replace(/\D/g, '') || undefined,
          }
        : undefined,
    counterparties: [],
    contracts: [],
    nomenclature: [],
    employees: [],
    fixedAssets: [],
    writsOfExecution: [],
    financialInvestments: [],
    openSettlements: [],
    openOrders: [],
  };

  if (!db1C) return state;

  // 1. Counterparties
  for (const cp of db1C.counterparties) {
    const name = (cp.name || cp.fullName || '').trim();
    if (!name) continue;
    const key = cp.inn?.trim()
      ? `inn:${cp.inn.trim()}`
      : `cp:${normalizeCounterpartyKey1C(name)}`;
    if (state.counterparties.some((x) => x.key === key)) continue;
    const kind =
      cp.kind === 'ФизическоеЛицо'
        ? 'ФизическоеЛицо'
        : cp.kind === 'ИндивидуальныйПредприниматель' || /^ип\b/iu.test(name)
        ? 'ИндивидуальныйПредприниматель'
        : 'ЮридическоеЛицо';
    state.counterparties.push({
      key,
      name,
      fullName: cp.fullName || name,
      kind,
      inn: (cp.inn || '').trim(),
      kpp: (cp.kpp || '').trim(),
      bik: cp.bik || DEFAULT_SBERBANK_BIK,
      bankName: cp.bankName || DEFAULT_SBERBANK_NAME,
      bankAccount: cp.bankAccount || '',
      source: 'from_1c_base',
      usages: [],
    });
  }

  // 2. Contracts
  for (const ctr of db1C.contracts) {
    const cpName = (ctr.counterpartyName || '').trim();
    const name = (ctr.name || ctr.number || 'Основной договор').trim();
    if (!cpName && !name) continue;
    const contractKind: VirtualContract1C['contractKind'] =
      ctr.contractKind === 'СПокупателем'
        ? 'СПокупателем'
        : ctr.contractKind === 'Прочее'
        ? 'Прочее'
        : 'СПоставщиком';
    const key = `ctr:${normalizeCounterpartyKey1C(cpName)}:${contractKind}:${normalizeSimpleEntityKey1C(name)}`;
    if (state.contracts.some((x) => x.key === key)) continue;
    state.contracts.push({
      key,
      name,
      number: ctr.number || '',
      date: ctr.date || db1C.periodStart || '',
      counterpartyName: cpName,
      contractKind,
      source: 'from_1c_base',
      usages: [],
    });
  }

  // 3. Nomenclature
  for (const nom of db1C.nomenclature) {
    const name = (nom.name || nom.fullName || '').trim();
    if (!name) continue;
    const key = `nom:${normalizeSimpleEntityKey1C(name)}`;
    if (state.nomenclature.some((x) => x.key === key)) continue;
    const inferred = inferNomenclatureCatalogMeta1C(name, undefined, nom.defaultAccount);
    state.nomenclature.push({
      key,
      name,
      itemKind: inferred.itemKind,
      unit: nom.unit || inferred.unit,
      defaultAccount: nom.defaultAccount || inferred.defaultAccount,
      vatRateLabel: nom.vatRate || '20%',
      source: 'from_1c_base',
      usages: [],
    });
  }

  // 4. Employees & Individuals
  const pushDbPerson = (
    item: Database1CSnapshot['employees'][number],
    isStaff: boolean
  ) => {
    const fullName = (item.name || '').trim();
    if (!fullName) return;
    const key = `emp:${normalizePersonIdentityKey1C(fullName)}`;
    if (!key || state.employees.some((x) => x.key === key)) return;
    const rawSalary = Number(
      item.extra?.Оклад ||
        item.extra?.оклад ||
        item.extra?.ТарифнаяСтавка ||
        item.extra?.salary ||
        0
    );
    state.employees.push({
      key,
      fullName,
      position: item.extra?.Должность || item.extra?.должность || item.kind || 'Сотрудник штата',
      monthlySalary: Number.isFinite(rawSalary) && rawSalary > 0 ? round2(rawSalary) : 0,
      subdivision: item.extra?.Подразделение || 'Основное подразделение',
      hireDate: item.extra?.ДатаПриема || db1C.periodStart || '',
      inn: item.extra?.ИНН || '',
      isStaffEmployee: isStaff,
      source: 'from_1c_base',
      usages: [],
    });
  };
  for (const emp of db1C.employees) pushDbPerson(emp, true);
  for (const ind of db1C.individuals) pushDbPerson(ind, false);

  // 5. Seed Fixed Assets, Financial Investments & Open Settlements from db1C rawBalances + postings
  for (const b of db1C.rawBalances) {
    const acc = (b.account || '').trim();
    const sub = (b.subconto || '').trim();
    const debitBal = round2(Math.max(0, b.endDebit || b.startDebit || b.rawDebit || 0));
    const creditBal = round2(Math.max(0, b.endCredit || b.startCredit || b.rawCredit || 0));

    if ((acc === '01.01' || acc === '01' || acc.startsWith('08.04')) && debitBal >= 0.01 && sub) {
      const key = `os:${normalizeSimpleEntityKey1C(sub)}`;
      if (!state.fixedAssets.some((a) => a.key === key)) {
        state.fixedAssets.push({
          key,
          name: sub,
          initialCost: debitBal,
          status: acc.startsWith('08')
            ? 'На счёте 08.04.1 (к вводу)'
            : 'Введено в эксплуатацию (счёт 01.01)',
          usefulLifeMonths: 37,
          monthlyDepreciation: acc.startsWith('08') ? 0 : round2(debitBal / 37),
          source: 'from_1c_base',
          usages: [],
        });
      }
    }

    if (acc.startsWith('58') && debitBal >= 0.01) {
      const label = sub || 'Финансовое вложение из базы 1С';
      const key = `fin:${normalizeSimpleEntityKey1C(label)}`;
      if (!state.financialInvestments.some((f) => f.key === key)) {
        state.financialInvestments.push({
          key,
          name: label,
          account: acc === '58' ? '58.02' : acc,
          paperIndex: state.financialInvestments.length + 1,
          principalAmount: debitBal,
          totalAmount: debitBal,
          status: 'active',
          accruedInterestAmount: 0,
          lastInterestDate: db1C.periodStart || '',
          notesBreakdown: `${label}: ${debitBal.toLocaleString('ru-RU')} ₽`,
          acquisitionDate: db1C.periodStart || '',
          source: 'from_1c_base',
          usages: [],
        });
      }
    }

    if ((acc === '60.01' || acc === '62.02') && creditBal >= 0.01 && sub) {
      const matchedCp = state.counterparties.find(
        (c) => normalizeCounterpartyKey1C(c.name) === normalizeCounterpartyKey1C(sub)
      );
      state.openSettlements.push({
        id: `db-${acc}-${state.openSettlements.length + 1}`,
        account: acc,
        counterpartyName: matchedCp?.name || sub,
        counterpartyInn: matchedCp?.inn || '',
        counterpartyKpp: matchedCp?.kpp || '',
        contractName: 'Основной договор',
        originalAmount: creditBal,
        remainingAmount: creditBal,
        subjectSummary: `Входящий остаток ${acc} из базы 1С (${sub})`,
        keywordStems: extractKeywordStems1C(sub),
        source: 'from_1c_base',
        originDate: db1C.periodStart || '',
      });
    }

    if ((acc === '60.02' || acc === '62.01') && debitBal >= 0.01 && sub) {
      const matchedCp = state.counterparties.find(
        (c) => normalizeCounterpartyKey1C(c.name) === normalizeCounterpartyKey1C(sub)
      );
      state.openSettlements.push({
        id: `db-${acc}-${state.openSettlements.length + 1}`,
        account: acc,
        counterpartyName: matchedCp?.name || sub,
        counterpartyInn: matchedCp?.inn || '',
        counterpartyKpp: matchedCp?.kpp || '',
        contractName: 'Основной договор',
        originalAmount: debitBal,
        remainingAmount: debitBal,
        subjectSummary: `Входящий остаток ${acc} из базы 1С (${sub})`,
        keywordStems: extractKeywordStems1C(sub),
        source: 'from_1c_base',
        originDate: db1C.periodStart || '',
      });
    }

    if (acc === '76.41' && creditBal >= 0.01) {
      state.openSettlements.push({
        id: `db-7641-${state.openSettlements.length + 1}`,
        account: '76.41',
        counterpartyName: sub || 'Получатель по исполнительному листу',
        counterpartyInn: '',
        counterpartyKpp: '',
        contractName: 'Исполнительный лист',
        originalAmount: creditBal,
        remainingAmount: creditBal,
        subjectSummary: `Входящий остаток по алиментам / удержаниям 76.41`,
        keywordStems: ['алимент', 'исполнительн'],
        source: 'from_1c_base',
        originDate: db1C.periodStart || '',
      });
    }
  }

  // Also inspect db1C postings on 60.01 for item/service descriptions
  for (const p of db1C.postings) {
    if (p.credit === '60.01' && p.amount >= 0.01) {
      const cpName = (p.counterpartyName || p.creditSubconto?.[0] || '').trim();
      const desc = `${p.description || ''} ${(p.debitSubconto || []).join(' ')}`.trim();
      const stems = extractKeywordStems1C(desc);
      if (cpName && stems.length > 0) {
        const existing = state.openSettlements.find(
          (s) =>
            s.account === '60.01' &&
            normalizeCounterpartyKey1C(s.counterpartyName) === normalizeCounterpartyKey1C(cpName)
        );
        if (existing) {
          existing.keywordStems = Array.from(new Set([...existing.keywordStems, ...stems]));
          if (desc) existing.subjectSummary = desc;
        }
      }
    }
  }

  return state;
}

export interface UnpaidSupplierResolution1C {
  counterpartyName: string;
  counterpartyInn: string;
  counterpartyKpp: string;
  contractName: string;
  totalUnpaidAmount: number;
  matchedSettlements: VirtualOpenSettlement1C[];
  provenanceNote: string;
}

/**
 * Looks back across open 60.01 supplier receipts in `state` and matches by Russian word stems
 * (e.g. "Перечислен платеж за принтер и услуги по формированию сети" -> matches "принтер", "формирован", "сет").
 */
export function resolveUnpaidSupplier6001ByKeywords(
  state: Virtual1CStateSnapshot,
  paymentText: string,
  explicitCounterpartyName?: string,
  explicitAmount?: number
): UnpaidSupplierResolution1C | null {
  const open6001 = state.openSettlements.filter(
    (s) => s.account === '60.01' && s.remainingAmount >= 0.01
  );
  if (open6001.length === 0) return null;

  // Case A: Counterparty is already known, but amount is missing -> sum open 60.01 for that supplier (filtered by stems if stems match)
  if (explicitCounterpartyName && explicitCounterpartyName.trim()) {
    const cpKey = normalizeCounterpartyKey1C(explicitCounterpartyName);
    const forSupplier = open6001.filter(
      (s) => normalizeCounterpartyKey1C(s.counterpartyName) === cpKey
    );
    if (forSupplier.length > 0) {
      const queryStems = extractKeywordStems1C(paymentText);
      const stemFiltered =
        queryStems.length > 0
          ? forSupplier.filter((s) =>
              s.keywordStems.some((ks) => queryStems.some((qs) => stemsMatch(ks, qs)))
            )
          : [];
      const chosen = stemFiltered.length > 0 ? stemFiltered : forSupplier;
      const total = round2(chosen.reduce((acc, s) => acc + s.remainingAmount, 0));
      const refs = chosen
        .map((s) =>
          s.originOpNumber
            ? `#${s.originOpNumber} от ${formatRuDateShort(s.originDate)}`
            : `база 1С`
        )
        .join(', ');
      return {
        counterpartyName: chosen[0].counterpartyName,
        counterpartyInn: chosen[0].counterpartyInn,
        counterpartyKpp: chosen[0].counterpartyKpp,
        contractName: chosen[0].contractName || 'Основной договор',
        totalUnpaidAmount: total,
        matchedSettlements: chosen,
        provenanceNote: `Подтянуто из неоплаченного поступления ${refs} (остаток по Кт 60.01: ${total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`,
      };
    }
  }

  // Case B: Match by keyword stems from payment description ("за принтер и услуги по формированию сети")
  const queryStems = extractKeywordStems1C(paymentText);
  if (queryStems.length === 0) {
    // Only if explicitAmount > 0 and there is a UNIQUE open 60.01 with that exact remaining amount
    if (explicitAmount && explicitAmount >= 0.01) {
      const exactAmtMatches = open6001.filter(
        (s) => Math.abs(s.remainingAmount - explicitAmount) < 0.05 && s.counterpartyName
      );
      if (exactAmtMatches.length === 1) {
        const s = exactAmtMatches[0];
        const ref = s.originOpNumber
          ? `#${s.originOpNumber} от ${formatRuDateShort(s.originDate)}`
          : 'базы 1С';
        return {
          counterpartyName: s.counterpartyName,
          counterpartyInn: s.counterpartyInn,
          counterpartyKpp: s.counterpartyKpp,
          contractName: s.contractName || 'Основной договор',
          totalUnpaidAmount: s.remainingAmount,
          matchedSettlements: [s],
          provenanceNote: `Контрагент определён по точному совпадению суммы неоплаченного долга 60.01 из операции ${ref}`,
        };
      }
    }
    return null;
  }

  const scored = open6001
    .map((s) => {
      const matchedQueryStems = queryStems.filter((qs) =>
        s.keywordStems.some((ks) => stemsMatch(ks, qs))
      );
      return { settlement: s, matchedQueryStems };
    })
    .filter((x) => x.matchedQueryStems.length > 0);

  if (scored.length === 0) return null;

  // Group by supplier (so if printer was #12 and network formation service was #15 from the same supplier, both sum up!)
  const groups = new Map<
    string,
    {
      items: VirtualOpenSettlement1C[];
      coveredQueryStems: Set<string>;
      totalScore: number;
    }
  >();

  for (const item of scored) {
    const groupKey =
      normalizeCounterpartyKey1C(item.settlement.counterpartyName) || item.settlement.id;
    const existing = groups.get(groupKey) ?? {
      items: [],
      coveredQueryStems: new Set<string>(),
      totalScore: 0,
    };
    existing.items.push(item.settlement);
    for (const st of item.matchedQueryStems) existing.coveredQueryStems.add(st);
    existing.totalScore += item.matchedQueryStems.length;
    groups.set(groupKey, existing);
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (b.coveredQueryStems.size !== a.coveredQueryStems.size) {
      return b.coveredQueryStems.size - a.coveredQueryStems.size;
    }
    if (exactAmountMatch(b.items, explicitAmount) !== exactAmountMatch(a.items, explicitAmount)) {
      return exactAmountMatch(b.items, explicitAmount) ? 1 : -1;
    }
    return b.totalScore - a.totalScore;
  });

  const winner = sortedGroups[0];
  if (!winner || winner.items.length === 0) return null;

  // Include complementary settlements that uniquely cover remaining query stems (e.g. "за принтер и услуги по формированию сети")
  const combinedItems: VirtualOpenSettlement1C[] = [...winner.items];
  const coveredStems = new Set<string>(winner.coveredQueryStems);
  if (!explicitCounterpartyName && coveredStems.size < queryStems.length && sortedGroups.length > 1) {
    for (let gIdx = 1; gIdx < sortedGroups.length; gIdx++) {
      const candGroup = sortedGroups[gIdx];
      const newlyCovered = Array.from(candGroup.coveredQueryStems).filter(
        (st) => !coveredStems.has(st)
      );
      if (newlyCovered.length > 0) {
        // Only merge if explicitAmount is empty OR merging brings us closer/equal to explicitAmount
        const curSum = round2(combinedItems.reduce((a, b) => a + b.remainingAmount, 0));
        const nextSum = round2(
          curSum + candGroup.items.reduce((a, b) => a + b.remainingAmount, 0)
        );
        if (
          !explicitAmount ||
          explicitAmount < 0.01 ||
          Math.abs(nextSum - explicitAmount) < Math.abs(curSum - explicitAmount)
        ) {
          combinedItems.push(...candGroup.items);
          for (const st of newlyCovered) coveredStems.add(st);
        }
      }
    }
  }

  const total = round2(combinedItems.reduce((acc, s) => acc + s.remainingAmount, 0));
  const primary = combinedItems.find((s) => s.counterpartyName) || combinedItems[0];
  const distinctSuppliers = Array.from(
    new Set(combinedItems.map((s) => s.counterpartyName.trim()).filter(Boolean))
  );
  const refs = combinedItems
    .map((s) =>
      s.originOpNumber
        ? `#${s.originOpNumber} от ${formatRuDateShort(s.originDate)}`
        : 'базы 1С'
    )
    .join(', ');

  return {
    counterpartyName:
      distinctSuppliers.length > 1 ? distinctSuppliers.join('; ') : primary.counterpartyName,
    counterpartyInn: distinctSuppliers.length > 1 ? '' : primary.counterpartyInn,
    counterpartyKpp: distinctSuppliers.length > 1 ? '' : primary.counterpartyKpp,
    contractName: primary.contractName || 'Основной договор',
    totalUnpaidAmount: total,
    matchedSettlements: combinedItems,
    provenanceNote: `Подтянуто из неоплаченного поступления ${refs} по предмету оплаты (остаток Кт 60.01: ${total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`,
  };
}

function exactAmountMatch(
  items: VirtualOpenSettlement1C[],
  explicitAmount?: number
): boolean {
  if (!explicitAmount || explicitAmount < 0.01) return false;
  const sum = round2(items.reduce((a, b) => a + b.remainingAmount, 0));
  return Math.abs(sum - explicitAmount) < 0.05;
}

export function resolveActiveWritsOfExecution1C(
  state: Virtual1CStateSnapshot,
  opDate?: string
): VirtualWritOfExecution1C[] {
  return state.writsOfExecution.filter((w) => {
    if (opDate && w.startDate && w.startDate > opDate) return false;
    return w.ratePercent > 0 || (w.fixedAmount ?? 0) > 0;
  });
}

export function resolveAlimonyPayable7641(
  state: Virtual1CStateSnapshot,
  recipientHint?: string,
  innHint?: string
): {
  recipientName: string;
  recipientInn: string;
  debtorEmployeeName: string;
  accumulatedBalance: number;
  writ?: VirtualWritOfExecution1C;
  provenanceNote: string;
} | null {
  const cleanInn = (innHint || '').replace(/\D/g, '');
  const normHint = normalizeSimpleEntityKey1C(recipientHint || '');

  // Match writ first
  let matchedWrit: VirtualWritOfExecution1C | undefined;
  if (cleanInn) {
    matchedWrit = state.writsOfExecution.find((w) => w.recipientInn === cleanInn);
  }
  if (!matchedWrit && normHint) {
    matchedWrit = state.writsOfExecution.find((w) => {
      const wRec = normalizeSimpleEntityKey1C(w.recipientName);
      const wDebtorSurname = w.debtorEmployeeName
        .toLowerCase()
        .replace(/ё/g, 'е')
        .split(/\s+/)[0];
      return (
        (wRec && (normHint.includes(wRec) || wRec.includes(normHint))) ||
        (wDebtorSurname && wDebtorSurname.length >= 3 && normHint.includes(wDebtorSurname))
      );
    });
  }
  if (!matchedWrit && state.writsOfExecution.length === 1) {
    matchedWrit = state.writsOfExecution[0];
  }

  // Sum open 76.41 settlements if any
  const open7641 = state.openSettlements.filter(
    (s) => s.account === '76.41' && s.remainingAmount >= 0.01
  );
  const openSum = round2(open7641.reduce((acc, s) => acc + s.remainingAmount, 0));

  const balance =
    matchedWrit && matchedWrit.balance7641 >= 0.01
      ? matchedWrit.balance7641
      : openSum;

  if (!matchedWrit && balance < 0.01 && !recipientHint && !cleanInn) {
    return null;
  }

  const recipientName =
    (recipientHint && recipientHint.trim()) ||
    matchedWrit?.recipientName ||
    open7641[0]?.counterpartyName ||
    'Получатель алиментов';

  const recipientInn = cleanInn || matchedWrit?.recipientInn || open7641[0]?.counterpartyInn || '';
  const writOrigin = matchedWrit?.firstSeenOpNumber
    ? `исполнительному листу #${matchedWrit.firstSeenOpNumber} от ${formatRuDateShort(matchedWrit.firstSeenDate)}`
    : 'счёту 76.41';

  return {
    recipientName,
    recipientInn,
    debtorEmployeeName: matchedWrit?.debtorEmployeeName || '',
    accumulatedBalance: balance,
    writ: matchedWrit,
    provenanceNote:
      balance >= 0.01
        ? `Сумма удержанных алиментов подтянута по ${writOrigin} (остаток Кт 76.41: ${balance.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`
        : `Получатель связан по ${writOrigin} (ожидает начисления зарплаты по счёту 76.41)`,
  };
}

/**
 * Advances `Virtual1CStateSnapshot` chronologically with one operation `#opNumber` (1-based).
 */
export function advanceVirtual1CStateWithOperation(
  prevState: Virtual1CStateSnapshot,
  op: QueuedOperation,
  opNumber: number
): Virtual1CStateSnapshot {
  const state = cloneVirtual1CState(prevState);
  if (op.includeInProcessing === false) return state;

  const usageRef: VirtualEntityUsageRef1C = {
    opId: op.id,
    opNumber,
    date: op.date,
  };

  // 0. Register ownOrganization on charter_capital formation (never register own organization as a counterparty!)
  if (op.category === 'charter_capital') {
    const charterInfo = extractCharterCapitalInfo1C(
      op.description,
      op.amount || op.rawExcelAmount
    );
    if (charterInfo.ownOrganization) {
      state.ownOrganization = {
        name: charterInfo.ownOrganization.name,
        inn: charterInfo.ownOrganization.inn,
        kpp: charterInfo.ownOrganization.kpp,
      };
    }
  }

  // 1. Register / update Alimony Recipient or Commercial Counterparty
  const isAlimonyOp =
    op.category === 'writ_of_execution' ||
    op.category === 'alimony_payout' ||
    op.docType1C === 'ИсполнительныйЛист';

  const ownOrgKey = state.ownOrganization?.name
    ? normalizeCounterpartyKey1C(state.ownOrganization.name)
    : '';
  const ownOrgInn = state.ownOrganization?.inn || '';

  if (isAlimonyOp) {
    const recName = (op.alimonyRecipientName || op.counterpartyName || '').trim();
    const recInn = (op.alimonyRecipientInn || op.counterpartyInn || '').replace(/\D/g, '');
    if (recName) {
      const existingRec = state.counterparties.find(
        (c) =>
          (recInn && c.inn === recInn) ||
          normalizeSimpleEntityKey1C(c.name) === normalizeSimpleEntityKey1C(recName) ||
          (state.writsOfExecution.length === 1 && c.roleHint?.includes('76.41'))
      );
      if (existingRec) {
        if (recInn && !existingRec.inn) existingRec.inn = recInn;
        existingRec.usages = addUsageRef(existingRec.usages, usageRef);
      } else {
        state.counterparties.push({
          key: recInn ? `inn:${recInn}` : `cp:${normalizeSimpleEntityKey1C(recName)}`,
          name: recName,
          fullName: recName,
          kind: 'ФизическоеЛицо',
          roleHint: 'Получатель по исполнительному листу (счёт 76.41)',
          inn: recInn,
          kpp: '',
          bik: op.counterpartyBik || DEFAULT_SBERBANK_BIK,
          bankName: op.counterpartyBankName || DEFAULT_SBERBANK_NAME,
          bankAccount: op.counterpartyBankAccount || '',
          source: 'created_in_operation',
          firstSeenOpId: op.id,
          firstSeenOpNumber: opNumber,
          firstSeenDate: op.date,
          usages: [usageRef],
        });
      }
    }
  } else if (
    op.counterpartyName &&
    op.counterpartyName.trim() &&
    op.category !== 'charter_capital'
  ) {
    const cpParts = op.counterpartyName
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => {
        const k = normalizeCounterpartyKey1C(s);
        return !(ownOrgKey && k === ownOrgKey);
      });
    const isMultiCp = cpParts.length > 1;
    const roleHint =
      op.category.startsWith('purchase_') ||
      op.category === 'bank_out' ||
      op.category === 'supplier_invoice'
        ? 'Поставщик / подрядчик'
        : op.category.startsWith('sale_') ||
            op.category === 'bank_in' ||
            op.category === 'customer_invoice'
        ? 'Покупатель / заказчик'
        : op.category === 'founder_contribution' ||
            op.category === 'dividends_accrual' ||
            op.category === 'dividends_payout'
          ? 'Учредитель / участник (счёт 75)'
          : 'Контрагент';

    for (const rawCpPart of cpParts) {
      const cpName =
        op.counterpartyKind === 'ФизическоеЛицо'
          ? normalizeEmployeeOrFounderName1C(rawCpPart, { obliqueContext: true })
          : normalizeLegalEntityName1C(rawCpPart);
      const rawCpInn = isMultiCp ? '' : (op.counterpartyInn || '').replace(/\D/g, '');
      const cpInn = ownOrgInn && rawCpInn === ownOrgInn ? '' : rawCpInn;
      const cpNorm = normalizeCounterpartyKey1C(cpName);
      const existingCp = state.counterparties.find(
        (c) =>
          (cpInn && c.inn === cpInn) ||
          (cpNorm && normalizeCounterpartyKey1C(c.name) === cpNorm)
      );

      if (existingCp) {
        if (cpInn && (!existingCp.inn || existingCp.isFormalAutoFilled)) {
          existingCp.inn = cpInn;
          if (op.counterpartySource !== 'educational_generated') {
            existingCp.isFormalAutoFilled = false;
          }
        }
        if (!isMultiCp && op.counterpartyKpp && !existingCp.kpp) {
          existingCp.kpp = op.counterpartyKpp;
        }
        if (op.counterpartyBik && !existingCp.bik) existingCp.bik = op.counterpartyBik;
        if (!isMultiCp && op.counterpartyBankAccount && !existingCp.bankAccount) {
          existingCp.bankAccount = op.counterpartyBankAccount;
        }
        if (!existingCp.roleHint) existingCp.roleHint = roleHint;
        if (op.counterpartySource === 'educational_generated') {
          existingCp.isFormalAutoFilled = true;
        }
        existingCp.usages = addUsageRef(existingCp.usages, usageRef);
      } else {
        state.counterparties.push({
          key: cpInn ? `inn:${cpInn}` : `cp:${cpNorm || normalizeSimpleEntityKey1C(cpName)}`,
          name: cpName,
          fullName: cpName,
          kind: op.counterpartyKind || 'ЮридическоеЛицо',
          roleHint,
          inn: cpInn,
          kpp: isMultiCp ? '' : (op.counterpartyKpp || '').trim(),
          bik: op.counterpartyBik || DEFAULT_SBERBANK_BIK,
          bankName: op.counterpartyBankName || DEFAULT_SBERBANK_NAME,
          bankAccount: isMultiCp ? '' : op.counterpartyBankAccount || '',
          isFormalAutoFilled: op.counterpartySource === 'educational_generated',
          source: 'created_in_operation',
          firstSeenOpId: op.id,
          firstSeenOpNumber: opNumber,
          firstSeenDate: op.date,
          usages: [usageRef],
        });
      }
    }

    const cpNorm = normalizeCounterpartyKey1C(cpParts[0] || op.counterpartyName.trim());
    const cpName = cpParts[0] || op.counterpartyName.trim();

    // 2. Register / update Contract for commercial counterparty (including contract_event & multi-month invoices!)
    if (
      (op.contractName && op.contractName.trim()) ||
      op.category === 'contract_event' ||
      op.category === 'customer_invoice' ||
      op.category === 'supplier_invoice'
    ) {
      if (
        ![
          'founder_contribution',
          'tax_payment',
          'bank_fee',
          'cash_bank_internal',
          'accountable_issue',
          'expense_report',
          'accountable_return',
        ].includes(op.category)
      ) {
        const ctrKind: VirtualContract1C['contractKind'] =
          op.category.startsWith('sale_') ||
          op.category === 'bank_in' ||
          op.category === 'customer_invoice' ||
          (op.category === 'contract_event' && /покупател|заказчик|сдач\p{L}*\s+.*в\s+аренд/iu.test(op.description))
            ? 'СПокупателем'
            : op.category.startsWith('purchase_') ||
                op.category === 'bank_out' ||
                op.category === 'supplier_invoice' ||
                op.category === 'contract_event'
              ? 'СПоставщиком'
              : 'Прочее';
        const ctrName = (op.contractName || 'Основной договор').trim();
        const ctrKey = `ctr:${cpNorm}:${ctrKind}:${normalizeSimpleEntityKey1C(ctrName)}`;
        const recurring =
          op.category === 'contract_event' ||
          op.category === 'customer_invoice' ||
          op.category === 'supplier_invoice' ||
          op.periodicPaymentAmount
            ? extractRecurringContractTerms1C(op.description, op.amount)
            : null;
        const multiMonthsMatch =
          (op.category === 'customer_invoice' ||
            op.category === 'supplier_invoice' ||
            op.category === 'contract_event') &&
          op.amount >= 0.01
            ? op.description.match(/\bна\s+(\d{1,2})\s*мес/iu)
            : null;
        const derivedMonthlyFromInvoice =
          multiMonthsMatch && Number(multiMonthsMatch[1]) >= 2
            ? round2(op.amount / Number(multiMonthsMatch[1]))
            : undefined;
        const periodicAmt =
          op.periodicPaymentAmount || recurring?.periodicAmount || derivedMonthlyFromInvoice;
        const existingCtr = state.contracts.find((c) => c.key === ctrKey);
        if (existingCtr) {
          if (op.contractNumber && !existingCtr.number) existingCtr.number = op.contractNumber;
          if (periodicAmt && periodicAmt > 0) existingCtr.periodicAmount = periodicAmt;
          if (recurring?.periodicity) {
            existingCtr.periodicity = recurring.periodicity;
          } else if (derivedMonthlyFromInvoice) {
            existingCtr.periodicity = 'monthly';
          }
          if (recurring?.vatRule) existingCtr.vatRule = recurring.vatRule;
          if (recurring?.vatRate !== undefined) existingCtr.vatRate = recurring.vatRate;
          existingCtr.usages = addUsageRef(existingCtr.usages, usageRef);
        } else {
          state.contracts.push({
            key: ctrKey,
            name: ctrName,
            number: op.contractNumber || '',
            date: op.contractDate || op.date,
            counterpartyName: cpName,
            contractKind: ctrKind,
            periodicAmount: periodicAmt && periodicAmt > 0 ? periodicAmt : undefined,
            periodicity: recurring?.periodicity,
            subjectSummary: op.description,
            keywordStems: extractKeywordStems1C(op.description),
            vatRule: recurring?.vatRule ?? op.vatRule,
            vatRate: recurring?.vatRate ?? op.vatRate,
            source: 'created_in_operation',
            firstSeenOpId: op.id,
            firstSeenOpNumber: opNumber,
            firstSeenDate: op.date,
            usages: [usageRef],
          });
        }
      }
    }
  }

  // 3. Register / update Nomenclature
  if (
    op.nomenclatureName &&
    op.nomenclatureName.trim() &&
    ![
      'hr_hire',
      'payroll_accrual',
      'payroll_payout',
      'writ_of_execution',
      'alimony_payout',
      'financial_investment',
      'tax_payment',
      'bank_fee',
      'cash_bank_internal',
      'closing',
      'depreciation_accrual',
      'insurance_accrual',
    ].includes(op.category)
  ) {
    const nomName = op.nomenclatureName.trim();
    const nomKey = `nom:${normalizeSimpleEntityKey1C(nomName)}`;
    const meta = inferNomenclatureCatalogMeta1C(nomName, op.category, op.materialAccount);
    const existingNom = state.nomenclature.find(
      (n) =>
        n.key === nomKey ||
        (nomName.length >= 5 &&
          normalizeSimpleEntityKey1C(n.name) === normalizeSimpleEntityKey1C(nomName))
    );
    if (existingNom) {
      existingNom.usages = addUsageRef(existingNom.usages, usageRef);
    } else {
      state.nomenclature.push({
        key: nomKey,
        name: nomName,
        itemKind: meta.itemKind,
        unit: meta.unit,
        defaultAccount: meta.defaultAccount,
        vatRateLabel: op.vatRule === 'none' || op.vatRate === 0 ? 'Без НДС' : `${op.vatRate}%`,
        source: 'created_in_operation',
        firstSeenOpId: op.id,
        firstSeenOpNumber: opNumber,
        firstSeenDate: op.date,
        usages: [usageRef],
      });
    }
  }

  // 4. Register / update Employees (including monthlySalary from rawExcelAmount, child & property tax deductions, and HR transfers)
  const isFounderOnlyOp =
    op.category === 'charter_capital' ||
    op.category === 'founder_contribution' ||
    op.category === 'dividends_accrual' ||
    op.category === 'dividends_payout';
  const rawEmpCandidate = isFounderOnlyOp ? '' : (op.employeeName || '').trim();
  if (
    rawEmpCandidate &&
    !/^(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ИП)(?:\s|[«"'])/iu.test(rawEmpCandidate)
  ) {
    const empName = normalizeEmployeeOrFounderName1C(rawEmpCandidate);
    const empKey = `emp:${normalizePersonIdentityKey1C(empName)}`;
    const taxDed = extractEmployeeTaxDeductions1C(op.description);
    const isTaxDedNotice = /уведомлени\p{L}*.*(?:имущественн\p{L}*|налогов\p{L}*)\s+вычет/iu.test(
      op.description
    );
    const isSalaryUnchanged = /оклад\s+не\s+изменил/iu.test(op.description);
    const effectiveSalary =
      !isTaxDedNotice && !isSalaryUnchanged
        ? op.monthlySalary && op.monthlySalary > 0
          ? round2(op.monthlySalary)
          : op.category === 'hr_hire' && op.rawExcelAmount && op.rawExcelAmount > 0 && op.rawExcelAmount < 50_000_000
            ? round2(op.rawExcelAmount)
            : 0
        : 0;
    const childCount = op.employeeChildCount ?? taxDed.childCount;
    const isSingleParent = op.employeeIsSingleParent ?? taxDed.isSingleParent;
    const propDeduction =
      op.employeePropertyDeduction ??
      taxDed.propertyTaxDeduction ??
      (isTaxDedNotice && op.rawExcelAmount && op.rawExcelAmount >= 10_000
        ? round2(op.rawExcelAmount)
        : undefined);

    const bareSurnameStem = empName
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/(?:ова|ева|ина|ына|ской|цкой|ская|цкая|ов|ев|ин|ын|ский|цкий|у|ю|ом|ем|ой|ей)$/u, '');

    const existingEmp =
      state.employees.find((e) => e.key === empKey) ||
      (!empName.includes('.') && bareSurnameStem.length >= 4
        ? state.employees.find((e) => {
            const eSur = e.fullName.split(/\s+/)[0].toLowerCase().replace(/ё/g, 'е');
            return eSur.startsWith(bareSurnameStem);
          })
        : undefined);
    if (existingEmp) {
      if (effectiveSalary > 0) {
        existingEmp.monthlySalary = effectiveSalary;
      }
      if (op.employeePosition) {
        existingEmp.position = op.employeePosition;
      }
      if (childCount !== undefined && childCount > 0) {
        existingEmp.childCount = childCount;
      }
      if (isSingleParent) {
        existingEmp.isSingleParent = true;
      }
      if (propDeduction && propDeduction > 0) {
        existingEmp.propertyTaxDeduction = propDeduction;
        existingEmp.propertyTaxDeductionStartDate = op.date
          ? `${op.date.slice(0, 7)}-01`
          : existingEmp.hireDate;
      }
      if (op.category === 'hr_hire' && /принят\p{L}*\s+на\s+работу|при[её]м\s+на\s+работу/iu.test(op.description)) {
        existingEmp.isStaffEmployee = true;
        existingEmp.hireDate = op.date;
      }
      existingEmp.usages = addUsageRef(existingEmp.usages, usageRef);
    } else if (empKey) {
      const isHireRow =
        op.category === 'hr_hire' ||
        /принят\p{L}*\s+на\s+работу|при[её]м\s+на\s+работу/iu.test(op.description);
      if (isHireRow || effectiveSalary > 0 || Boolean(propDeduction && propDeduction > 0)) {
        state.employees.push({
          key: empKey,
          fullName: empName,
          position: op.employeePosition || (empName === 'Главный бухгалтер' ? 'Главный бухгалтер' : 'Сотрудник штата'),
          monthlySalary: effectiveSalary,
          subdivision: 'Основное подразделение',
          hireDate: op.date,
          childCount: childCount && childCount > 0 ? childCount : undefined,
          isSingleParent: isSingleParent || undefined,
          propertyTaxDeduction: propDeduction && propDeduction > 0 ? propDeduction : undefined,
          propertyTaxDeductionStartDate:
            propDeduction && propDeduction > 0 && op.date ? `${op.date.slice(0, 7)}-01` : undefined,
          isStaffEmployee: isHireRow || effectiveSalary > 0,
          source: 'created_in_operation',
          firstSeenOpId: op.id,
          firstSeenOpNumber: opNumber,
          firstSeenDate: op.date,
          usages: [usageRef],
        });
      }
    }
  }

  // Also register staff from payrollStaffSummary if present
  if (op.payrollStaffSummary && op.payrollStaffSummary.length > 0) {
    for (const staff of op.payrollStaffSummary) {
      if (!staff.name) continue;
      const empKey = `emp:${normalizePersonIdentityKey1C(staff.name)}`;
      const existingEmp = state.employees.find((e) => e.key === empKey);
      if (existingEmp) {
        if (staff.salary > 0 && existingEmp.monthlySalary <= 0) {
          existingEmp.monthlySalary = round2(staff.salary);
        }
        existingEmp.usages = addUsageRef(existingEmp.usages, usageRef);
      }
    }
  }

  // 5. Register / update Fixed Assets (08.04.1 -> 01.01 -> 01.09)
  if (op.category === 'purchase_equipment') {
    const osName = (op.nomenclatureName || 'Объект основных средств').trim();
    const osKey = `os:${normalizeSimpleEntityKey1C(osName)}`;
    const targetStems = extractKeywordStems1C(`${osName} ${op.description}`);
    const netCost = round2(Math.max(0, op.amount - (op.vatAmount || 0)));
    // Check if this is additional delivery/mounting cost for an existing object on 08.04.1
    const pendingOn08 = state.fixedAssets.filter(
      (a) => a.status === 'На счёте 08.04.1 (к вводу)'
    );
    const existingOs =
      state.fixedAssets.find((a) => a.key === osKey) ||
      pendingOn08.find((a) => {
        const aStems = extractKeywordStems1C(a.name);
        return targetStems.some((ts) => aStems.some((as) => stemsMatch(ts, as)));
      }) ||
      (/доставк|монтаж|пусконалад|сборк|подключен|настройк|поступление\s+доп/iu.test(op.description) &&
      pendingOn08.length >= 1
        ? pendingOn08[pendingOn08.length - 1]
        : undefined);

    if (existingOs) {
      if (netCost > 0) existingOs.initialCost = round2(existingOs.initialCost + netCost);
      existingOs.usages = addUsageRef(existingOs.usages, usageRef);
    } else {
      state.fixedAssets.push({
        key: osKey,
        name: osName,
        initialCost: netCost,
        accumulatedDepreciation: 0,
        status: 'На счёте 08.04.1 (к вводу)',
        usefulLifeMonths: op.usefulLifeMonths || 0,
        monthlyDepreciation: 0,
        receiptDate: op.date,
        source: 'created_in_operation',
        firstSeenOpId: op.id,
        firstSeenOpNumber: opNumber,
        firstSeenDate: op.date,
        usages: [usageRef],
      });
    }
  }

  if (
    op.category === 'os_commissioning' ||
    op.docType1C === 'ПринятиеКУчетуОС' ||
    op.entries.some((e) => e.debit === '01.01' && e.amount >= 0.01)
  ) {
    const osName = (op.nomenclatureName || 'Объект основных средств').trim();
    const osKey = `os:${normalizeSimpleEntityKey1C(osName)}`;
    const targetStems = extractKeywordStems1C(osName);
    const existingOs =
      state.fixedAssets.find((a) => a.key === osKey) ||
      state.fixedAssets.find((a) => {
        const aStems = extractKeywordStems1C(a.name);
        return targetStems.some((ts) => aStems.some((as) => stemsMatch(ts, as)));
      }) ||
      (op.category === 'os_commissioning'
        ? state.fixedAssets.find((a) => a.status === 'На счёте 08.04.1 (к вводу)')
        : undefined);

    const parsedSpi =
      op.usefulLifeMonths && op.usefulLifeMonths > 0
        ? op.usefulLifeMonths
        : extractUsefulLifeMonths1C(op.description) || existingOs?.usefulLifeMonths || 37;
    const spi = parsedSpi > 0 ? parsedSpi : 37;
    const entry0101 = round2(
      op.entries.filter((e) => e.debit === '01.01').reduce((s, e) => s + e.amount, 0)
    );
    const cost = entry0101 > 0 ? entry0101 : op.amount > 0 ? op.amount : existingOs?.initialCost || 0;
    const monthlyDep = spi > 0 && cost > 0 ? round2(cost / spi) : 0;

    if (existingOs) {
      existingOs.status = 'Введено в эксплуатацию (счёт 01.01)';
      if (cost > 0) existingOs.initialCost = cost;
      existingOs.usefulLifeMonths = spi;
      existingOs.monthlyDepreciation = monthlyDep;
      existingOs.commissioningDate = op.date;
      existingOs.usages = addUsageRef(existingOs.usages, usageRef);
    } else if (cost > 0) {
      state.fixedAssets.push({
        key: osKey,
        name: cleanNomenclatureName1C(osName) || osName,
        initialCost: cost,
        accumulatedDepreciation: 0,
        status: 'Введено в эксплуатацию (счёт 01.01)',
        usefulLifeMonths: spi,
        monthlyDepreciation: monthlyDep,
        commissioningDate: op.date,
        source: 'created_in_operation',
        firstSeenOpId: op.id,
        firstSeenOpNumber: opNumber,
        firstSeenDate: op.date,
        usages: [usageRef],
      });
    }
  }

  if (op.category === 'depreciation_accrual') {
    const depAmt = round2(
      op.entries
        .filter((e) => e.credit === '02.01')
        .reduce((s, e) => s + e.amount, 0) || op.amount
    );
    const activeOs = state.fixedAssets.filter(
      (a) => a.status === 'Введено в эксплуатацию (счёт 01.01)'
    );
    if (activeOs.length === 1 && depAmt > 0) {
      activeOs[0].accumulatedDepreciation = round2(
        (activeOs[0].accumulatedDepreciation || 0) + depAmt
      );
      activeOs[0].usages = addUsageRef(activeOs[0].usages, usageRef);
    } else if (activeOs.length > 1) {
      for (const a of activeOs) {
        if (a.monthlyDepreciation > 0) {
          a.accumulatedDepreciation = round2(
            (a.accumulatedDepreciation || 0) + a.monthlyDepreciation
          );
          a.usages = addUsageRef(a.usages, usageRef);
        }
      }
    }
  }

  if (op.category === 'os_disposal') {
    const targetStems = extractKeywordStems1C(`${op.nomenclatureName || ''} ${op.description}`);
    const targetOs =
      state.fixedAssets.find(
        (a) =>
          a.status === 'Введено в эксплуатацию (счёт 01.01)' &&
          targetStems.some((ts) =>
            extractKeywordStems1C(a.name).some((as) => stemsMatch(ts, as))
          )
      ) ||
      state.fixedAssets.find((a) => a.status === 'Введено в эксплуатацию (счёт 01.01)');
    if (targetOs) {
      targetOs.status = 'Выбыло / списано (счёт 01.09)';
      targetOs.disposalDate = op.date;
      targetOs.usages = addUsageRef(targetOs.usages, usageRef);
    }
  }

  // 6. Register / update Writs of Execution (ИсполнительныйЛист)
  if (op.category === 'writ_of_execution' || op.docType1C === 'ИсполнительныйЛист') {
    const debtor = (op.employeeName || 'Сотрудник по исполнительному листу').trim();
    const recipient = (op.alimonyRecipientName || op.counterpartyName || 'Получатель алиментов').trim();
    const recInn = (op.alimonyRecipientInn || op.counterpartyInn || '').replace(/\D/g, '');
    const fixedAmt =
      op.alimonyFixedAmount && op.alimonyFixedAmount > 0 ? round2(op.alimonyFixedAmount) : undefined;
    const rate = fixedAmt
      ? 0
      : op.alimonyRatePercent && op.alimonyRatePercent > 0
        ? op.alimonyRatePercent
        : 25;
    const shareLabel =
      op.alimonyShareLabel || (fixedAmt ? `${fixedAmt.toLocaleString('ru-RU')} ₽ / мес.` : `${rate}%`);
    const debtorKey = normalizePersonIdentityKey1C(debtor);
    const writKey = `writ:${debtorKey}`;
    const existingWrit = state.writsOfExecution.find(
      (w) => w.key === writKey || normalizePersonIdentityKey1C(w.debtorEmployeeName) === debtorKey
    );
    if (existingWrit) {
      if (recInn && !existingWrit.recipientInn) existingWrit.recipientInn = recInn;
      if (recipient && existingWrit.recipientName.startsWith('Получатель алиментов')) {
        existingWrit.recipientName = recipient;
      }
      existingWrit.ratePercent = rate;
      existingWrit.shareLabel = shareLabel;
      if (fixedAmt) existingWrit.fixedAmount = fixedAmt;
      if (op.writStartDate) existingWrit.startDate = op.writStartDate;
      existingWrit.usages = addUsageRef(existingWrit.usages, usageRef);
    } else {
      state.writsOfExecution.push({
        key: writKey,
        debtorEmployeeName: debtor,
        recipientName: recipient,
        recipientInn: recInn,
        ratePercent: rate,
        shareLabel,
        fixedAmount: fixedAmt,
        startDate: op.writStartDate || op.date,
        accumulatedAccrued7641: 0,
        accumulatedPaid7641: 0,
        balance7641: 0,
        source: 'created_in_operation',
        firstSeenOpId: op.id,
        firstSeenOpNumber: opNumber,
        firstSeenDate: op.date,
        usages: [usageRef],
      });
    }
  }

  // 7. Register Financial Investments (58.02 individual promissory notes & 58.03 loans issued)
  if (op.category === 'financial_investment' || op.docType1C === 'ФинансовыеВложения') {
    const parsedNotes =
      op.financialNotesList && op.financialNotesList.length > 0
        ? op.financialNotesList
        : extractFinancialNotesFromText1C(op.description, op.amount);

    if (parsedNotes.length > 0) {
      const existing5802Count = state.financialInvestments.filter(
        (f) => f.account === '58.02'
      ).length;
      parsedNotes.forEach((n, idx) => {
        const paperIdx = existing5802Count + idx + 1;
        state.financialInvestments.push({
          key: `fin:${op.id}:${paperIdx}`,
          name: n.label || `Вексель №${paperIdx} (${n.principal.toLocaleString('ru-RU')} ₽ под ${n.ratePercent}%)`,
          account: '58.02',
          paperIndex: paperIdx,
          principalAmount: n.principal,
          totalAmount: n.principal,
          notesBreakdown: `${n.principal.toLocaleString('ru-RU')} ₽ под ${n.ratePercent}% годовых`,
          interestRatePercent: n.ratePercent,
          status: 'active',
          accruedInterestAmount: 0,
          lastInterestDate: op.date,
          counterpartyName: op.counterpartyName || undefined,
          acquisitionDate: op.date,
          source: 'created_in_operation',
          firstSeenOpId: op.id,
          firstSeenOpNumber: opNumber,
          firstSeenDate: op.date,
          usages: [usageRef],
        });
      });
    } else {
      const finName = (
        op.nomenclatureName ||
        op.financialNotesSummary ||
        'Векселя (долговые ценные бумаги)'
      ).trim();
      const finKey = `fin:${op.id}`;
      const pctMatch = op.description.match(/(\d+(?:[.,]\d+)?)\s*%/);
      const pct = pctMatch ? Number(pctMatch[1].replace(',', '.')) : undefined;
      const paperIdx = state.financialInvestments.filter((f) => f.account === '58.02').length + 1;
      state.financialInvestments.push({
        key: finKey,
        name: finName,
        account: '58.02',
        paperIndex: paperIdx,
        principalAmount: op.amount,
        totalAmount: op.amount,
        notesBreakdown: op.financialNotesSummary || op.description,
        interestRatePercent: Number.isFinite(pct) ? pct : undefined,
        status: 'active',
        accruedInterestAmount: 0,
        lastInterestDate: op.date,
        counterpartyName: op.counterpartyName || undefined,
        acquisitionDate: op.date,
        source: 'created_in_operation',
        firstSeenOpId: op.id,
        firstSeenOpNumber: opNumber,
        firstSeenDate: op.date,
        usages: [usageRef],
      });
    }
  }

  if (op.category === 'loan_issued') {
    const pctMatch = op.description.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const pct =
      op.interestRatePercent ??
      (pctMatch ? Number(pctMatch[1].replace(',', '.')) : undefined);
    state.financialInvestments.push({
      key: `loan5803:${op.id}`,
      name: `Выданный заём (${op.counterpartyName || 'заёмщик'})`,
      account: '58.03',
      principalAmount: op.amount,
      totalAmount: op.amount,
      notesBreakdown: op.description,
      interestRatePercent: Number.isFinite(pct) ? pct : undefined,
      status: 'active',
      accruedInterestAmount: 0,
      lastInterestDate: op.date,
      counterpartyName: op.counterpartyName || undefined,
      acquisitionDate: op.date,
      source: 'created_in_operation',
      firstSeenOpId: op.id,
      firstSeenOpNumber: opNumber,
      firstSeenDate: op.date,
      usages: [usageRef],
    });
  }

  if (op.category === 'financial_interest_accrual') {
    const activeNotes = state.financialInvestments.filter(
      (f) => f.status !== 'disposed' && (f.interestRatePercent ?? 0) > 0
    );
    const totalWeight = activeNotes.reduce(
      (s, n) => s + (n.principalAmount ?? n.totalAmount) * ((n.interestRatePercent ?? 0) / 100),
      0
    );
    for (const note of activeNotes) {
      const weight =
        (note.principalAmount ?? note.totalAmount) * ((note.interestRatePercent ?? 0) / 100);
      const share =
        totalWeight > 0 ? round2((op.amount * weight) / totalWeight) : 0;
      note.accruedInterestAmount = round2((note.accruedInterestAmount || 0) + share);
      note.lastInterestDate = op.date;
      note.usages = addUsageRef(note.usages, usageRef);
    }
  }

  if (op.category === 'financial_disposal') {
    const targetNote = matchTargetActiveFinancialNote1C(state, op.description);
    if (targetNote) {
      targetNote.status = 'disposed';
      targetNote.disposedDate = op.date;
      targetNote.disposedOpId = op.id;
      targetNote.disposedOpNumber = opNumber;
      targetNote.usages = addUsageRef(targetNote.usages, usageRef);
    }
  }

  // 7b. Register / update Open Orders (СчетПокупателю / СчетОтПоставщика / composite invoice + advance / power of attorney)
  const mentionsInvoiceIssued =
    /(?:выписан|выписал|выставлен)\p{L}*\s+счет(?!-фактур)/iu.test(op.description);
  const mentionsInvoiceReceived =
    /(?:получен|поступил)\p{L}*\s+счет(?!-фактур)|по\s+счету/iu.test(op.description);
  const isSupplierPowerOfAttorney =
    /выдана\s+доверенность/iu.test(op.description) && Boolean(op.counterpartyName);

  const qtyPriceProduct =
    op.orderTotalAmount && op.orderTotalAmount >= 0.01
      ? round2(
          op.vatRule === 'on_top' && op.vatRate > 0
            ? op.orderTotalAmount * (1 + op.vatRate / 100)
            : op.orderTotalAmount
        )
      : op.quantity && op.quantity > 0 && op.unitPrice && op.unitPrice > 0
        ? round2(
            op.quantity *
              op.unitPrice *
              (op.vatRule === 'on_top' && op.vatRate > 0 ? 1 + op.vatRate / 100 : 1)
          )
        : 0;

  const pctAdvMatch = op.description.match(
    /(?:аванс|предоплат\p{L}*)\s*(\d{1,2}(?:[.,]\d+)?)\s*%/iu
  );
  const pctAdvVal = pctAdvMatch ? Number(pctAdvMatch[1].replace(',', '.')) : 0;

  const baseCandidateAmount = round2(op.amount || op.rawExcelAmount || 0);
  const hasPartialAdvanceOrder =
    (op.category === 'bank_in' || op.category === 'bank_out') &&
    ((qtyPriceProduct > baseCandidateAmount + 0.05 && baseCandidateAmount >= 0.01) ||
      (pctAdvVal > 0 && pctAdvVal < 100 && baseCandidateAmount >= 0.01) ||
      (mentionsInvoiceIssued && baseCandidateAmount >= 0.01) ||
      (mentionsInvoiceReceived && qtyPriceProduct >= 0.01));

  if (
    op.category === 'customer_invoice' ||
    op.category === 'supplier_invoice' ||
    hasPartialAdvanceOrder ||
    (isSupplierPowerOfAttorney && (qtyPriceProduct >= 0.01 || baseCandidateAmount >= 0.01))
  ) {
    const direction: VirtualOpenOrder1C['direction'] =
      op.category === 'supplier_invoice' ||
      op.category === 'bank_out' ||
      isSupplierPowerOfAttorney
        ? 'supplier'
        : 'buyer';

    let orderTotal = baseCandidateAmount;
    if (qtyPriceProduct >= 0.01 && (qtyPriceProduct > baseCandidateAmount + 0.05 || orderTotal < 0.01)) {
      orderTotal = qtyPriceProduct;
    } else if (
      (op.category === 'bank_in' || op.category === 'bank_out') &&
      pctAdvVal > 0 &&
      pctAdvVal < 100 &&
      baseCandidateAmount >= 0.01
    ) {
      orderTotal = round2((baseCandidateAmount * 100) / pctAdvVal);
    }

    if (orderTotal >= 0.01) {
      const multiMonthsMatch = op.description.match(/\b(?:на|за)\s+(\d{1,2})\s*мес/iu);
      const durationMonths =
        multiMonthsMatch && Number(multiMonthsMatch[1]) >= 2
          ? Number(multiMonthsMatch[1])
          : undefined;
      const periodicAmount =
        op.periodicPaymentAmount ||
        (durationMonths ? round2(orderTotal / durationMonths) : undefined);

      const subjectText = `${op.nomenclatureName || ''} ${op.description || ''}`.trim();
      const existingSameOrder = state.openOrders.find((o) => o.originOpId === op.id);
      if (!existingSameOrder) {
        state.openOrders.push({
          key: `ord-${direction}-${op.id}`,
          direction,
          docType1C:
            direction === 'supplier'
              ? op.category === 'supplier_invoice'
                ? 'СчетОтПоставщика'
                : 'ОперацияБух'
              : op.category === 'customer_invoice'
                ? 'СчетПокупателю'
                : 'ОперацияБух',
          counterpartyName: op.counterpartyName || '',
          counterpartyInn: op.counterpartyInn || '',
          contractName: op.contractName || 'Основной договор',
          contractNumber: op.contractNumber || undefined,
          totalAmount: orderTotal,
          remainingAmount: orderTotal,
          quantity: op.quantity,
          unitPrice: op.unitPrice,
          periodicAmount,
          durationMonths,
          vatRate: op.vatRate,
          vatRule: op.vatRule,
          subjectSummary: op.nomenclatureName || op.description,
          keywordStems: extractKeywordStems1C(subjectText),
          status: 'open',
          originOpId: op.id,
          originOpNumber: opNumber,
          originDate: op.date,
        });
      }
    }
  }

  // Cancel matching openOrders upon buyer/supplier advance refund ("возврат аванса")
  if (
    (op.category === 'bank_out' || op.category === 'bank_in') &&
    /возврат\p{L}*.*(?:аванс|предоплат)|возвращ\p{L}*.*(?:аванс|предоплат)/iu.test(op.description)
  ) {
    const cancelDirection: VirtualOpenOrder1C['direction'] =
      op.category === 'bank_out' ? 'buyer' : 'supplier';
    const cpNormCancel = normalizeCounterpartyKey1C(op.counterpartyName || '');
    for (const ord of state.openOrders) {
      if (ord.direction !== cancelDirection || ord.status !== 'open') continue;
      if (cpNormCancel && normalizeCounterpartyKey1C(ord.counterpartyName) !== cpNormCancel) {
        continue;
      }
      ord.status = 'cancelled';
      ord.remainingAmount = 0;
    }
  }

  // Fulfill / reduce openOrders upon sale_goods / sale_services / purchase_* / expense_report
  if (
    (op.category === 'sale_goods' ||
      op.category === 'sale_services' ||
      op.category.startsWith('purchase_') ||
      op.category === 'expense_report') &&
    op.amount >= 0.01
  ) {
    const targetDirection: VirtualOpenOrder1C['direction'] =
      op.category.startsWith('purchase_') || op.category === 'expense_report'
        ? 'supplier'
        : 'buyer';
    const cpNormFulfill = normalizeCounterpartyKey1C(op.counterpartyName || '');
    const opStems = extractKeywordStems1C(`${op.nomenclatureName || ''} ${op.description || ''}`);
    const candidates = state.openOrders
      .filter((o) => o.direction === targetDirection && o.status === 'open' && o.remainingAmount >= 0.01)
      .filter(
        (o) =>
          !cpNormFulfill ||
          !o.counterpartyName ||
          normalizeCounterpartyKey1C(o.counterpartyName) === cpNormFulfill
      )
      .sort((a, b) => {
        const aHit = a.keywordStems.some((ks) => opStems.some((os) => stemsMatch(ks, os)));
        const bHit = b.keywordStems.some((ks) => opStems.some((os) => stemsMatch(ks, os)));
        if (aHit !== bHit) return bHit ? 1 : -1;
        return (a.originDate || '').localeCompare(b.originDate || '');
      });
    let remFulfill = op.amount;
    for (const ord of candidates) {
      if (remFulfill < 0.01) break;
      const used = Math.min(ord.remainingAmount, remFulfill);
      ord.remainingAmount = round2(ord.remainingAmount - used);
      remFulfill = round2(remFulfill - used);
      if (ord.remainingAmount < 0.01) {
        ord.status = 'fulfilled';
      }
    }
  }

  // 8. Update Open Settlements (60.01, 60.02, 62.01, 62.02, 76.41) in TWO PASSES:
  // Pass 1: register all newly created debts / advances on op.entries FIRST
  // Pass 2: pay down / offset open debts / advances SECOND (so composite same-op settlements never cannibalize older open settlements)
  const pushOpenSettlement = (
    account: VirtualOpenSettlement1C['account'],
    amountVal: number,
    cpOverride?: string
  ) => {
    const existingSameOp = state.openSettlements.find(
      (s) => s.originOpId === op.id && s.account === account
    );
    if (existingSameOp) {
      existingSameOp.originalAmount = round2(existingSameOp.originalAmount + amountVal);
      existingSameOp.remainingAmount = round2(existingSameOp.remainingAmount + amountVal);
    } else {
      const subjectText = `${op.nomenclatureName || ''} ${op.description || ''}`.trim();
      state.openSettlements.push({
        id: `op-${account}-${op.id}`,
        account,
        counterpartyName: cpOverride || op.counterpartyName || '',
        counterpartyInn: op.counterpartyInn || '',
        counterpartyKpp: op.counterpartyKpp || '',
        contractName: op.contractName || 'Основной договор',
        originalAmount: amountVal,
        remainingAmount: amountVal,
        subjectSummary: op.nomenclatureName || op.description,
        keywordStems: extractKeywordStems1C(subjectText),
        source: 'created_in_operation',
        originOpId: op.id,
        originOpNumber: opNumber,
        originDate: op.date,
      });
    }
  };

  const paydownOpenSettlement = (
    account: VirtualOpenSettlement1C['account'],
    amountVal: number,
    subcontoRaw: string
  ) => {
    let toPay = amountVal;
    const entryCpRaw = (subcontoRaw || '').split('/')[0].trim();
    const cpNorm = normalizeCounterpartyKey1C(entryCpRaw || op.counterpartyName || '');
    const payStems = extractKeywordStems1C(op.description);

    const candidates = state.openSettlements
      .filter((s) => s.account === account && s.remainingAmount >= 0.01)
      .filter(
        (s) =>
          !cpNorm ||
          !s.counterpartyName ||
          normalizeCounterpartyKey1C(s.counterpartyName) === cpNorm
      )
      .sort((a, b) => {
        const aSameOp = a.originOpId === op.id;
        const bSameOp = b.originOpId === op.id;
        if (aSameOp !== bSameOp) return bSameOp ? 1 : -1;
        const aStemHit = a.keywordStems.some((ks) =>
          payStems.some((ps) => stemsMatch(ks, ps))
        );
        const bStemHit = b.keywordStems.some((ks) =>
          payStems.some((ps) => stemsMatch(ks, ps))
        );
        if (aStemHit !== bStemHit) return bStemHit ? 1 : -1;
        return (a.originDate || '').localeCompare(b.originDate || '');
      });

    for (const s of candidates) {
      if (toPay < 0.01) break;
      const used = Math.min(s.remainingAmount, toPay);
      s.remainingAmount = round2(s.remainingAmount - used);
      toPay = round2(toPay - used);
    }
  };

  // PASS 1: Push new open settlements
  for (const entry of op.entries) {
    if (entry.isOffBalance || entry.amount < 0.01) continue;
    if (entry.credit === '60.01') pushOpenSettlement('60.01', entry.amount);
    if (entry.debit === '60.02') pushOpenSettlement('60.02', entry.amount);
    if (entry.debit === '62.01' && entry.credit !== '62.02') {
      pushOpenSettlement('62.01', entry.amount);
    }
    if (entry.credit === '62.02') pushOpenSettlement('62.02', entry.amount);

    if (entry.credit === '76.41') {
      const recSub = (entry.creditSubconto || op.alimonyRecipientName || '').trim();
      const recNorm = normalizeSimpleEntityKey1C(recSub);
      const matchedWrit =
        state.writsOfExecution.find((w) => {
          const wRec = normalizeSimpleEntityKey1C(w.recipientName);
          const wSurname = w.debtorEmployeeName.toLowerCase().replace(/ё/g, 'е').split(/\s+/)[0];
          return (
            (recNorm && wRec && (recNorm.includes(wRec) || wRec.includes(recNorm))) ||
            (recNorm && wSurname && wSurname.length >= 3 && recNorm.includes(wSurname))
          );
        }) || state.writsOfExecution[0];
      if (matchedWrit) {
        matchedWrit.accumulatedAccrued7641 = round2(
          matchedWrit.accumulatedAccrued7641 + entry.amount
        );
        matchedWrit.balance7641 = round2(matchedWrit.balance7641 + entry.amount);
        matchedWrit.usages = addUsageRef(matchedWrit.usages, usageRef);
      }
      state.openSettlements.push({
        id: `op-7641-${op.id}-${entry.id}`,
        account: '76.41',
        counterpartyName: recSub || matchedWrit?.recipientName || 'Получатель алиментов',
        counterpartyInn: matchedWrit?.recipientInn || '',
        counterpartyKpp: '',
        contractName: 'Исполнительный лист',
        originalAmount: entry.amount,
        remainingAmount: entry.amount,
        subjectSummary: entry.description,
        keywordStems: ['алимент', 'исполнительн'],
        source: 'created_in_operation',
        originOpId: op.id,
        originOpNumber: opNumber,
        originDate: op.date,
      });
    }
  }

  // PASS 2: Pay down / offset open settlements
  for (const entry of op.entries) {
    if (entry.isOffBalance || entry.amount < 0.01) continue;
    if (entry.debit === '60.01') paydownOpenSettlement('60.01', entry.amount, entry.debitSubconto);
    if (entry.credit === '60.02') paydownOpenSettlement('60.02', entry.amount, entry.creditSubconto);
    if (entry.credit === '62.01') paydownOpenSettlement('62.01', entry.amount, entry.creditSubconto);
    if (entry.debit === '62.02') paydownOpenSettlement('62.02', entry.amount, entry.debitSubconto);

    // 51 <- 76.09: Receipt of accrued promissory note / security interest reduces unpaid accruedInterestAmount
    if (entry.debit === '51' && entry.credit === '76.09') {
      const notesWithInterest = state.financialInvestments.filter(
        (f) => (f.accruedInterestAmount ?? 0) >= 0.01
      );
      let remReceived = entry.amount;
      for (const n of notesWithInterest) {
        if (remReceived < 0.01) break;
        const curAcc = n.accruedInterestAmount || 0;
        const clearAmt = Math.min(curAcc, remReceived);
        n.accruedInterestAmount = round2(Math.max(0, curAcc - clearAmt));
        remReceived = round2(remReceived - clearAmt);
      }
    }

    // Debit 76.41 -> alimony paid out!
    if (entry.debit === '76.41') {
      let toPay = entry.amount;
      const debSub = (entry.debitSubconto || op.alimonyRecipientName || op.counterpartyName || '').trim();
      const debNorm = normalizeSimpleEntityKey1C(debSub);
      const cleanInn = (op.alimonyRecipientInn || op.counterpartyInn || '').replace(/\D/g, '');
      const matchedWrit =
        (cleanInn ? state.writsOfExecution.find((w) => w.recipientInn === cleanInn) : undefined) ||
        state.writsOfExecution.find((w) => {
          const wRec = normalizeSimpleEntityKey1C(w.recipientName);
          const wSurname = w.debtorEmployeeName.toLowerCase().replace(/ё/g, 'е').split(/\s+/)[0];
          return (
            (debNorm && wRec && (debNorm.includes(wRec) || wRec.includes(debNorm))) ||
            (debNorm && wSurname && wSurname.length >= 3 && debNorm.includes(wSurname))
          );
        }) ||
        state.writsOfExecution[0];
      if (matchedWrit) {
        if (cleanInn && !matchedWrit.recipientInn) matchedWrit.recipientInn = cleanInn;
        matchedWrit.accumulatedPaid7641 = round2(matchedWrit.accumulatedPaid7641 + entry.amount);
        matchedWrit.balance7641 = round2(Math.max(0, matchedWrit.balance7641 - entry.amount));
        matchedWrit.usages = addUsageRef(matchedWrit.usages, usageRef);
      }
      for (const s of state.openSettlements) {
        if (s.account !== '76.41' || s.remainingAmount < 0.01 || toPay < 0.01) continue;
        const sNorm = normalizeSimpleEntityKey1C(s.counterpartyName);
        if (debNorm && sNorm && !debNorm.includes(sNorm) && !sNorm.includes(debNorm)) {
          const wSurname = matchedWrit?.debtorEmployeeName
            .toLowerCase()
            .replace(/ё/g, 'е')
            .split(/\s+/)[0];
          if (!wSurname || !sNorm.includes(wSurname)) continue;
        }
        const used = Math.min(s.remainingAmount, toPay);
        s.remainingAmount = round2(s.remainingAmount - used);
        toPay = round2(toPay - used);
      }
    }
  }

  return state;
}

/**
 * Builds Step 00: "Подготовка справочников (что нужно создать в базе 1С перед проведением)"
 * comparing operation `op` strictly against `stateBefore` (all data known PRIOR to `op`).
 */
export function buildStep00DirectoryPrepSteps(
  stateBefore: Virtual1CStateSnapshot,
  op: QueuedOperation
): DirectoryPrepStep1C[] {
  const steps: DirectoryPrepStep1C[] = [];

  const formatOrigin = (
    source: 'from_1c_base' | 'created_in_operation',
    firstNum?: number,
    firstDate?: string
  ) =>
    source === 'from_1c_base'
      ? 'Уже есть в базе (загружен из выгрузки 1С) — повторно создавать не нужно, выберите из списка'
      : `Уже есть в базе (создан в операции #${firstNum ?? '?'} от ${formatRuDateShort(firstDate)}) — повторно создавать не нужно, выберите из списка`;

  // 1. Writ of Execution / Alimony special Step 00
  if (op.category === 'writ_of_execution' || op.docType1C === 'ИсполнительныйЛист') {
    const debtor = (op.employeeName || 'Сотрудник (должник)').trim();
    const empKey = `emp:${normalizePersonIdentityKey1C(debtor)}`;
    const existingEmp = stateBefore.employees.find((e) => e.key === empKey);
    steps.push({
      id: `prep-emp-${op.id}`,
      entityKind: 'employee',
      entityLabel: 'Сотрудник (плательщик алиментов)',
      entityName: debtor,
      status: existingEmp ? 'already_exists' : 'create_new',
      originSummary: existingEmp
        ? formatOrigin(existingEmp.source, existingEmp.firstSeenOpNumber, existingEmp.firstSeenDate)
        : 'Новый сотрудник — сначала создайте карточку в справочнике «Сотрудники»',
      firstSeenOpNumber: existingEmp?.firstSeenOpNumber,
      firstSeenOpId: existingEmp?.firstSeenOpId,
      firstSeenDate: existingEmp?.firstSeenDate,
      menuPath1C: 'Раздел «Зарплата и кадры» → «Кадровый учёт» → «Сотрудники» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'ФИО', value: debtor },
        { field: 'Подразделение', value: 'Основное подразделение' },
      ],
    });

    const recName = (op.alimonyRecipientName || op.counterpartyName || 'Получатель алиментов').trim();
    const recInn = (op.alimonyRecipientInn || op.counterpartyInn || '').replace(/\D/g, '');
    const existingRec = stateBefore.counterparties.find(
      (c) =>
        (recInn && c.inn === recInn) ||
        normalizeSimpleEntityKey1C(c.name) === normalizeSimpleEntityKey1C(recName)
    );
    steps.push({
      id: `prep-rec-${op.id}`,
      entityKind: 'counterparty',
      entityLabel: 'Получатель удержаний (счёт 76.41)',
      entityName: recName,
      status: existingRec ? 'already_exists' : 'create_new',
      originSummary: existingRec
        ? formatOrigin(existingRec.source, existingRec.firstSeenOpNumber, existingRec.firstSeenDate)
        : 'Новое физлицо-получатель — создайте в справочнике «Контрагенты» (для аналитики счёта 76.41)',
      firstSeenOpNumber: existingRec?.firstSeenOpNumber,
      firstSeenOpId: existingRec?.firstSeenOpId,
      firstSeenDate: existingRec?.firstSeenDate,
      menuPath1C: 'Раздел «Справочники» → «Покупки и продажи» → «Контрагенты» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'Вид контрагента', value: 'Физическое лицо' },
        { field: 'Наименование / ФИО', value: recName },
        { field: 'ИНН', value: recInn || 'укажите при наличии (например, при перечислении)' },
      ],
    });

    const rate = op.alimonyRatePercent && op.alimonyRatePercent > 0 ? op.alimonyRatePercent : 25;
    steps.push({
      id: `prep-writ-${op.id}`,
      entityKind: 'writ_of_execution',
      entityLabel: 'Документ удержания',
      entityName: `Исполнительный лист (${debtor} → ${recName})`,
      status: 'create_new',
      originSummary:
        'Зарегистрируйте документ «Исполнительный лист» — он не делает проводок сам, но включает автоудержание Дт 70 Кт 76.41 при начислении ЗП',
      menuPath1C:
        'Раздел «Зарплата и кадры» → «Зарплата» → «Исполнительные листы» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'Сотрудник', value: debtor },
        { field: 'Получатель', value: recName },
        { field: 'Удерживать с', value: formatRuDateShort(op.date) },
        {
          field: 'Способ расчёта',
          value: `Процентом (долей) от заработка — ${op.alimonyShareLabel || `${rate}%`} (от дохода за вычетом НДФЛ 13%)`,
        },
      ],
    });
    return steps;
  }

  if (op.category === 'alimony_payout') {
    const recName = (op.alimonyRecipientName || op.counterpartyName || 'Получатель алиментов').trim();
    const recInn = (op.alimonyRecipientInn || op.counterpartyInn || '').replace(/\D/g, '');
    const existingRec = stateBefore.counterparties.find(
      (c) =>
        (recInn && c.inn === recInn) ||
        normalizeSimpleEntityKey1C(c.name) === normalizeSimpleEntityKey1C(recName) ||
        c.roleHint?.includes('76.41')
    );
    steps.push({
      id: `prep-alimony-rec-${op.id}`,
      entityKind: 'counterparty',
      entityLabel: 'Получатель алиментов (счёт 76.41)',
      entityName: recName,
      status: existingRec ? 'already_exists' : 'create_new',
      originSummary: existingRec
        ? `${formatOrigin(existingRec.source, existingRec.firstSeenOpNumber, existingRec.firstSeenDate)}${recInn && !existingRec.inn ? ` · дозаполните ИНН ${recInn} в карточке` : ''}`
        : 'Создайте карточку получателя в справочнике «Контрагенты» (Вид: Физическое лицо)',
      firstSeenOpNumber: existingRec?.firstSeenOpNumber,
      firstSeenOpId: existingRec?.firstSeenOpId,
      firstSeenDate: existingRec?.firstSeenDate,
      menuPath1C: 'Раздел «Справочники» → «Контрагенты» → карточка получателя',
      fieldsToFill: [
        { field: 'Вид контрагента', value: 'Физическое лицо' },
        { field: 'Наименование', value: recName },
        ...(recInn ? [{ field: 'ИНН получателя', value: recInn }] : []),
        { field: 'Банковский счёт (БИК)', value: op.counterpartyBik || DEFAULT_SBERBANK_BIK },
      ],
    });
    return steps;
  }

  // 2. Commercial Counterparty & Contract
  if (op.counterpartyName && op.counterpartyName.trim()) {
    const cpParts = op.counterpartyName
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    const isMultiCp = cpParts.length > 1;

    for (let cIdx = 0; cIdx < cpParts.length; cIdx++) {
      const cpName = cpParts[cIdx];
      const cpInn = isMultiCp ? '' : (op.counterpartyInn || '').replace(/\D/g, '');
      const cpNorm = normalizeCounterpartyKey1C(cpName);
      const existingCp = stateBefore.counterparties.find(
        (c) =>
          (cpInn && c.inn === cpInn) ||
          (cpNorm && normalizeCounterpartyKey1C(c.name) === cpNorm)
      );

      const isFormalAutoCp =
        op.counterpartySource === 'educational_generated' || Boolean(existingCp?.isFormalAutoFilled);

      steps.push({
        id: `prep-cp-${op.id}-${cIdx}`,
        entityKind: 'counterparty',
        entityLabel: 'Контрагент',
        entityName: cpName,
        status: existingCp ? 'already_exists' : 'create_new',
        originSummary: existingCp
          ? formatOrigin(existingCp.source, existingCp.firstSeenOpNumber, existingCp.firstSeenDate)
          : 'Новый контрагент — нажмите «Создать» в справочнике «Контрагенты» перед проведением',
        firstSeenOpNumber: existingCp?.firstSeenOpNumber,
        firstSeenOpId: existingCp?.firstSeenOpId,
        firstSeenDate: existingCp?.firstSeenDate,
        isFormalAutoFilled: isFormalAutoCp,
        formalAutoFillNote: isFormalAutoCp
          ? 'Формальный реквизит, подобран автоматически (на ОСВ не влияет)'
          : undefined,
        menuPath1C:
          'Раздел «Справочники» → «Покупки и продажи» → «Контрагенты» → кнопка «Создать»',
        fieldsToFill: [
          {
            field: 'Вид контрагента',
            value:
              op.counterpartyKind === 'ФизическоеЛицо'
                ? 'Физическое лицо'
                : op.counterpartyKind === 'ИндивидуальныйПредприниматель'
                  ? 'Индивидуальный предприниматель'
                  : 'Юридическое лицо',
          },
          { field: 'Наименование', value: cpName },
          {
            field: 'ИНН / КПП',
            value: cpInn
              ? `${cpInn}${op.counterpartyKpp ? ` / ${op.counterpartyKpp}` : ''}${isFormalAutoCp ? ' (учебные реквизиты — авто)' : ''}`
              : 'Заполните по кнопке «Заполнить» по ИНН или учебным реквизитам',
          },
          {
            field: 'Банковский счёт (БИК)',
            value: `${op.counterpartyBik || DEFAULT_SBERBANK_BIK} (${op.counterpartyBankName || DEFAULT_SBERBANK_NAME})`,
          },
        ],
      });
    }

    const cpName = cpParts[0] || op.counterpartyName.trim();
    const cpNorm = normalizeCounterpartyKey1C(cpName);

    if (
      ((op.contractName && op.contractName.trim()) || op.category === 'contract_event') &&
      ![
        'founder_contribution',
        'tax_payment',
        'bank_fee',
        'cash_bank_internal',
      ].includes(op.category)
    ) {
      const ctrKind: VirtualContract1C['contractKind'] =
        op.category.startsWith('sale_') ||
        op.category === 'bank_in' ||
        (op.category === 'contract_event' && /покупател|заказчик/iu.test(op.description))
          ? 'СПокупателем'
          : op.category.startsWith('purchase_') ||
              op.category === 'bank_out' ||
              op.category === 'contract_event'
            ? 'СПоставщиком'
            : 'Прочее';
      const ctrName = (op.contractName || 'Основной договор').trim();
      const ctrKey = `ctr:${cpNorm}:${ctrKind}:${normalizeSimpleEntityKey1C(ctrName)}`;
      const existingCtr = stateBefore.contracts.find((c) => c.key === ctrKey);
      const isDefaultAutoCtr = ctrName === 'Основной договор' && !op.contractNumber;

      steps.push({
        id: `prep-ctr-${op.id}`,
        entityKind: 'contract',
        entityLabel: 'Договор контрагента',
        entityName: ctrName,
        status: existingCtr ? 'already_exists' : 'create_new',
        originSummary: existingCtr
          ? formatOrigin(existingCtr.source, existingCtr.firstSeenOpNumber, existingCtr.firstSeenDate)
          : 'Новый договор — создайте из карточки контрагента или прямо из поля «Договор» по кнопке «Создать»',
        firstSeenOpNumber: existingCtr?.firstSeenOpNumber,
        firstSeenOpId: existingCtr?.firstSeenOpId,
        firstSeenDate: existingCtr?.firstSeenDate,
        isFormalAutoFilled: isDefaultAutoCtr,
        formalAutoFillNote: isDefaultAutoCtr
          ? 'Формальный реквизит, подобран автоматически (на ОСВ не влияет)'
          : undefined,
        menuPath1C: `Карточка «${cpName}» → ссылка «Договоры» → кнопка «Создать»`,
        fieldsToFill: [
          {
            field: 'Вид договора',
            value:
              ctrKind === 'СПокупателем'
                ? 'С покупателем'
                : ctrKind === 'СПоставщиком'
                  ? 'С поставщиком'
                  : 'Прочее',
          },
          { field: 'Наименование / №', value: ctrName },
          { field: 'Дата договора', value: formatRuDateShort(op.contractDate || op.date) },
          ...(op.periodicPaymentAmount && op.periodicPaymentAmount > 0
            ? [
                {
                  field: 'Периодический платёж по договору',
                  value: `${op.periodicPaymentAmount.toLocaleString('ru-RU')} ₽ / мес.`,
                },
              ]
            : []),
        ],
      });
    }
  }

  // 3. Nomenclature (Materials, Fuel 10.03, Goods, Equipment, Workwear, Products)
  if (
    op.nomenclatureName &&
    op.nomenclatureName.trim() &&
    ![
      'hr_hire',
      'payroll_accrual',
      'payroll_payout',
      'financial_investment',
      'tax_payment',
      'bank_fee',
      'cash_bank_internal',
      'closing',
      'depreciation_accrual',
      'insurance_accrual',
    ].includes(op.category)
  ) {
    const nomName = op.nomenclatureName.trim();
    const nomKey = `nom:${normalizeSimpleEntityKey1C(nomName)}`;
    const meta = inferNomenclatureCatalogMeta1C(nomName, op.category, op.materialAccount);
    const existingNom = stateBefore.nomenclature.find(
      (n) =>
        n.key === nomKey ||
        normalizeSimpleEntityKey1C(n.name) === normalizeSimpleEntityKey1C(nomName)
    );

    steps.push({
      id: `prep-nom-${op.id}`,
      entityKind: 'nomenclature',
      entityLabel: 'Номенклатура',
      entityName: nomName,
      status: existingNom ? 'already_exists' : 'create_new',
      originSummary: existingNom
        ? formatOrigin(existingNom.source, existingNom.firstSeenOpNumber, existingNom.firstSeenDate)
        : `Новая позиция — создайте в справочнике «Номенклатура» перед добавлением строки в документ`,
      firstSeenOpNumber: existingNom?.firstSeenOpNumber,
      firstSeenOpId: existingNom?.firstSeenOpId,
      firstSeenDate: existingNom?.firstSeenDate,
      menuPath1C:
        'Раздел «Справочники» → «Товары и услуги» → «Номенклатура» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'Вид номенклатуры', value: meta.itemKind },
        { field: 'Наименование', value: nomName },
        { field: 'Единица измерения', value: meta.unit },
        {
          field: 'Счёт учёта в 1С',
          value: `${existingNom?.defaultAccount || meta.defaultAccount}`,
        },
        {
          field: '% НДС по умолчанию',
          value: op.vatRule === 'none' || op.vatRate === 0 ? 'Без НДС' : `${op.vatRate}%`,
        },
      ],
    });
  }

  // 4. Fixed Asset Card on ПринятиеКУчетуОС (01.01)
  if (op.category === 'os_commissioning' || op.docType1C === 'ПринятиеКУчетуОС') {
    const osName = (op.nomenclatureName || 'Объект основных средств').trim();
    const targetStems = extractKeywordStems1C(osName);
    const existingOsOn01 = stateBefore.fixedAssets.find(
      (a) =>
        a.status === 'Введено в эксплуатацию (счёт 01.01)' &&
        (normalizeSimpleEntityKey1C(a.name) === normalizeSimpleEntityKey1C(osName) ||
          targetStems.some((ts) =>
            extractKeywordStems1C(a.name).some((as) => stemsMatch(ts, as))
          ))
    );
    const receiptOn08 = stateBefore.fixedAssets.find(
      (a) =>
        a.status === 'На счёте 08.04.1 (к вводу)' &&
        (normalizeSimpleEntityKey1C(a.name) === normalizeSimpleEntityKey1C(osName) ||
          targetStems.some((ts) =>
            extractKeywordStems1C(a.name).some((as) => stemsMatch(ts, as))
          ))
    );
    const spi = op.usefulLifeMonths && op.usefulLifeMonths > 0 ? op.usefulLifeMonths : 37;

    steps.push({
      id: `prep-os-${op.id}`,
      entityKind: 'fixed_asset',
      entityLabel: 'Карточка основного средства (счёт 01.01)',
      entityName: osName,
      status: existingOsOn01 ? 'already_exists' : 'create_new',
      originSummary: existingOsOn01
        ? formatOrigin(existingOsOn01.source, existingOsOn01.firstSeenOpNumber, existingOsOn01.firstSeenDate)
        : receiptOn08?.firstSeenOpNumber
        ? `Оборудование учтено на 08.04.1 в #${receiptOn08.firstSeenOpNumber} от ${formatRuDateShort(receiptOn08.firstSeenDate)} — теперь создайте карточку в справочнике «Основные средства»!`
        : 'Создайте карточку объекта в справочнике «Основные средства» (на вкладке «Основные средства» по кнопке «Создать»)',
      firstSeenOpNumber: existingOsOn01?.firstSeenOpNumber ?? receiptOn08?.firstSeenOpNumber,
      firstSeenOpId: existingOsOn01?.firstSeenOpId ?? receiptOn08?.firstSeenOpId,
      firstSeenDate: existingOsOn01?.firstSeenDate ?? receiptOn08?.firstSeenDate,
      menuPath1C:
        'Раздел «Справочники» → «ОС и НМА» → «Основные средства» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'Наименование ОС', value: osName },
        { field: 'Группа учёта ОС', value: 'Машины и оборудование (производственное)' },
        { field: 'СПИ (срок полезного использования)', value: `${spi} мес. (линейный способ)` },
      ],
    });
  }

  // 5. Employee on HR / Payroll / Accountable 71 / Workwear
  if (op.employeeName && op.employeeName.trim()) {
    const empName = op.employeeName.trim();
    const empKey = `emp:${normalizePersonIdentityKey1C(empName)}`;
    const existingEmp = stateBefore.employees.find((e) => e.key === empKey);
    steps.push({
      id: `prep-emp-${op.id}`,
      entityKind: 'employee',
      entityLabel: 'Сотрудник / физлицо',
      entityName: empName,
      status: existingEmp ? 'already_exists' : 'create_new',
      originSummary: existingEmp
        ? formatOrigin(existingEmp.source, existingEmp.firstSeenOpNumber, existingEmp.firstSeenDate)
        : 'Новый сотрудник — создайте карточку в справочнике «Сотрудники» перед проведением документа',
      firstSeenOpNumber: existingEmp?.firstSeenOpNumber,
      firstSeenOpId: existingEmp?.firstSeenOpId,
      firstSeenDate: existingEmp?.firstSeenDate,
      menuPath1C: 'Раздел «Зарплата и кадры» → «Кадровый учёт» → «Сотрудники» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'ФИО', value: empName },
        { field: 'Должность', value: op.employeePosition || 'По штатному расписанию' },
        ...(op.monthlySalary && op.monthlySalary > 0
          ? [
              {
                field: 'Оклад',
                value: `${op.monthlySalary.toLocaleString('ru-RU')} ₽ / мес.`,
              },
            ]
          : []),
      ],
    });
  }

  // 6. Financial Investments (Ценные бумаги / Векселя on 58.02)
  if (op.category === 'financial_investment' || op.docType1C === 'ФинансовыеВложения') {
    const finLabel =
      op.financialNotesSummary || op.nomenclatureName || 'Долговые ценные бумаги (векселя)';
    steps.push({
      id: `prep-fin-${op.id}`,
      entityKind: 'financial_investment',
      entityLabel: 'Ценные бумаги (субконто счёта 58.02)',
      entityName: finLabel,
      status: 'create_new',
      originSummary:
        'Создайте карточки приобретённых векселей в справочнике «Ценные бумаги» (по каждому векселю отдельно для аналитики счёта 58.02)',
      menuPath1C: 'Субконто счёта 58.02 → справочник «Ценные бумаги» → кнопка «Создать»',
      fieldsToFill: [
        { field: 'Вид ценной бумаги', value: 'Вексель третьего лица (долговая ценная бумага)' },
        { field: 'Состав и номиналы', value: finLabel },
        {
          field: 'Общая стоимость вложения (58.02)',
          value: `${op.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽ (без НДС, ст. 149 НК РФ)`,
        },
      ],
    });
  }

  return sanitizePrepSteps1C(steps) ?? steps;
}

/**
 * Builds the full chronological Virtual 1C State across `db1C` and all `operations`.
 * Preserves 1-based UI display numbering `#1..#N` (`index + 1` in `operations`).
 */
export function buildVirtual1CStateTimeline(
  db1C: Database1CSnapshot | null,
  operations: QueuedOperation[]
): {
  finalState: Virtual1CStateSnapshot;
  stateBeforeByOpId: Record<string, Virtual1CStateSnapshot>;
  displayNumberByOpId: Record<string, number>;
} {
  const displayNumberByOpId: Record<string, number> = {};
  operations.forEach((op, idx) => {
    displayNumberByOpId[op.id] = idx + 1;
  });

  // Sort chronologically by date, keeping original array index as tie-breaker
  const indexed = operations.map((op, idx) => ({ op, idx, displayNum: idx + 1 }));
  indexed.sort((a, b) => {
    const cmp = (a.op.date || '').localeCompare(b.op.date || '');
    if (cmp !== 0) return cmp;
    return a.idx - b.idx;
  });

  let current = createInitialVirtual1CState(db1C);
  const stateBeforeByOpId: Record<string, Virtual1CStateSnapshot> = {};

  for (const item of indexed) {
    stateBeforeByOpId[item.op.id] = current;
    current = advanceVirtual1CStateWithOperation(current, item.op, item.displayNum);
  }

  return {
    finalState: current,
    stateBeforeByOpId,
    displayNumberByOpId,
  };
}

export interface CanonicalCounterpartyRecord1C {
  canonicalName: string;
  inn: string;
  kpp: string;
  bik?: string;
  bankName?: string;
  bankAccount?: string;
  source: 'db_1c' | 'excel_explicit';
}

/**
 * Builds a session-wide canonical counterparty registry ("1 company = 1 canonical INN")
 * from `db1C` + all operations/drafts that explicitly carry a valid 10/12-digit INN in the task files.
 * Prevents `KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES`, EGRUL, or synthetic generators from assigning
 * a second conflicting INN to the same company on rows without an inline INN.
 */
export function buildCanonicalCounterpartyRegistry1C(
  db1C: Database1CSnapshot | null,
  items: Array<{
    description?: string;
    counterpartyName?: string;
    counterpartyInn?: string;
    counterpartyKpp?: string;
    counterpartyBik?: string;
    counterpartyBankName?: string;
    counterpartyBankAccount?: string;
    counterpartySource?: string;
    category?: string;
  }>
): Map<string, CanonicalCounterpartyRecord1C> {
  const registry = new Map<string, CanonicalCounterpartyRecord1C>();

  // Detect own organization INN/name so it never pollutes commercial counterparties
  let ownOrgInn = (db1C?.organization?.inn || '').replace(/\D/g, '');
  let ownOrgKey = db1C?.organization?.name
    ? normalizeCounterpartyKey1C(db1C.organization.name)
    : '';
  for (const it of items) {
    if (it.description) {
      const ch = extractCharterCapitalInfo1C(it.description);
      if (ch.ownOrganization) {
        if (ch.ownOrganization.inn && !ownOrgInn) ownOrgInn = ch.ownOrganization.inn;
        if (ch.ownOrganization.name && !ownOrgKey) {
          ownOrgKey = normalizeCounterpartyKey1C(ch.ownOrganization.name);
        }
      }
    }
  }

  for (const cp of db1C?.counterparties ?? []) {
    const name = normalizeLegalEntityName1C(cp.name || cp.fullName || '');
    const key = normalizeCounterpartyKey1C(name);
    const inn = (cp.inn || '').replace(/\D/g, '');
    if (!key || (ownOrgKey && key === ownOrgKey) || (ownOrgInn && inn === ownOrgInn)) continue;
    if (inn.length === 10 || inn.length === 12) {
      registry.set(key, {
        canonicalName: name,
        inn,
        kpp: (cp.kpp || '').replace(/\D/g, ''),
        bik: cp.bik || undefined,
        bankName: cp.bankName || undefined,
        bankAccount: cp.bankAccount || undefined,
        source: 'db_1c',
      });
    }
  }

  for (const it of items) {
    if (it.category === 'charter_capital') continue;
    const rawName = (it.counterpartyName || '').trim();
    if (!rawName || rawName.includes(';')) continue;
    const name = normalizeLegalEntityName1C(rawName);
    const key = normalizeCounterpartyKey1C(name);
    if (!key || (ownOrgKey && key === ownOrgKey)) continue;

    // Prefer explicit INN extracted directly from the row's own description/cell over educational_generated INNs
    const descInnMatch = (it.description || '').match(/ИНН[\s.:№-]*(\d{10}|\d{12})\b/i);
    const descKppMatch = (it.description || '').match(/КПП[\s.:№-]*(\d{9})\b/i);
    const isExplicitSource =
      Boolean(descInnMatch) ||
      it.counterpartySource === 'excel_explicit' ||
      it.counterpartySource === 'db_1c';
    const inn = (descInnMatch?.[1] || (isExplicitSource ? it.counterpartyInn : '') || '').replace(
      /\D/g,
      ''
    );
    if ((inn.length !== 10 && inn.length !== 12) || (ownOrgInn && inn === ownOrgInn)) continue;

    const kpp = (descKppMatch?.[1] || it.counterpartyKpp || '').replace(/\D/g, '');
    const existing = registry.get(key);
    if (!existing) {
      registry.set(key, {
        canonicalName: name,
        inn,
        kpp: kpp || (inn.length === 10 ? `${inn.slice(0, 4)}01001` : ''),
        bik: it.counterpartyBik || undefined,
        bankName: it.counterpartyBankName || undefined,
        bankAccount: it.counterpartyBankAccount || undefined,
        source: 'excel_explicit',
      });
    } else {
      if (!existing.kpp && kpp) existing.kpp = kpp;
      if (!existing.bik && it.counterpartyBik) existing.bik = it.counterpartyBik;
      if (!existing.bankName && it.counterpartyBankName) existing.bankName = it.counterpartyBankName;
      if (!existing.bankAccount && it.counterpartyBankAccount) {
        existing.bankAccount = it.counterpartyBankAccount;
      }
    }
  }

  return registry;
}


import {
  CounterpartyResolutionSource,
  Database1CSnapshot,
  DEFAULT_SBERBANK_BIK,
  DEFAULT_SBERBANK_CORR,
  DEFAULT_SBERBANK_NAME,
  EgrulCandidate,
} from '@/types/accounting';
import {
  matchPersonOrCounterpartyIn1C,
  normalizeEntityKey,
} from '@/lib/engine/postingEngine';

export interface KnownBankInfo {
  bik: string;
  bankName: string;
  corrAccount: string;
  city?: string;
}

const KNOWN_CBR_BANKS_BY_BIK: Record<string, KnownBankInfo> = {
  '044030653': {
    bik: DEFAULT_SBERBANK_BIK,
    bankName: DEFAULT_SBERBANK_NAME,
    corrAccount: DEFAULT_SBERBANK_CORR,
    city: 'Санкт-Петербург',
  },
  '044525225': {
    bik: '044525225',
    bankName: 'ПАО СБЕРБАНК (Г. МОСКВА)',
    corrAccount: '30101810400000000225',
    city: 'Москва',
  },
  '044030001': {
    bik: '044030001',
    bankName: 'СЕВЕРО-ЗАПАДНОЕ ГУ БАНКА РОССИИ // УФК по г. Санкт-Петербургу',
    corrAccount: '40102810945370000005',
    city: 'Санкт-Петербург',
  },
  '044525988': {
    bik: '044525988',
    bankName: 'ГУ БАНКА РОССИИ ПО ЦФО // УФК по г. Москве',
    corrAccount: '40102810545370000003',
    city: 'Москва',
  },
  '044030786': {
    bik: '044030786',
    bankName: 'ФИЛИАЛ «САНКТ-ПЕТЕРБУРГСКИЙ» АО «АЛЬФА-БАНК»',
    corrAccount: '30101810600000000786',
    city: 'Санкт-Петербург',
  },
  '044525593': {
    bik: '044525593',
    bankName: 'АО «АЛЬФА-БАНК»',
    corrAccount: '30101810200000000593',
    city: 'Москва',
  },
  '044525187': {
    bik: '044525187',
    bankName: 'БАНК ВТБ (ПАО)',
    corrAccount: '30101810700000000187',
    city: 'Москва',
  },
  '044030707': {
    bik: '044030707',
    bankName: 'ФИЛИАЛ СЕВЕРО-ЗАПАДНЫЙ ПАО БАНК «ФК ОТКРЫТИЕ» / ВТБ СЗ',
    corrAccount: '30101810540300000707',
    city: 'Санкт-Петербург',
  },
  '044525974': {
    bik: '044525974',
    bankName: 'АО «ТБАНК»',
    corrAccount: '30101810145250000974',
    city: 'Москва',
  },
};

export function resolveBankInfoByBik(bik: string, fallbackName = ''): KnownBankInfo {
  const cleanBik = (bik || '').replace(/\D/g, '');
  if (cleanBik.length === 9 && KNOWN_CBR_BANKS_BY_BIK[cleanBik]) {
    return KNOWN_CBR_BANKS_BY_BIK[cleanBik];
  }
  if (cleanBik.length === 9) {
    return {
      bik: cleanBik,
      bankName: fallbackName.trim() || `Банк (БИК ${cleanBik})`,
      corrAccount: '',
    };
  }
  return KNOWN_CBR_BANKS_BY_BIK[DEFAULT_SBERBANK_BIK];
}

const INN10_WEIGHTS = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_WEIGHTS_11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_WEIGHTS_12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

export function validateRussianInnChecksum(rawInn: string): {
  valid: boolean;
  cleanInn: string;
  expectedCheckDigits?: string;
  reason?: string;
} {
  const cleanInn = (rawInn ?? '').replace(/\D/g, '');
  if (!cleanInn) {
    return { valid: false, cleanInn, reason: 'ИНН не указан' };
  }
  if (cleanInn.length !== 10 && cleanInn.length !== 12) {
    return {
      valid: false,
      cleanInn,
      reason: `ИНН должен содержать 10 цифр (юрлицо) или 12 цифр (ИП/физлицо), сейчас: ${cleanInn.length}`,
    };
  }
  if (/^0+$/.test(cleanInn)) {
    return { valid: false, cleanInn, reason: 'ИНН не может состоять только из нулей' };
  }

  const digits = cleanInn.split('').map((c) => Number(c));
  if (cleanInn.length === 10) {
    const sum = INN10_WEIGHTS.reduce((acc, w, idx) => acc + w * digits[idx], 0);
    const check10 = (sum % 11) % 10;
    const valid = digits[9] === check10;
    return {
      valid,
      cleanInn,
      expectedCheckDigits: String(check10),
      reason: valid
        ? undefined
        : `Контрольная цифра ИНН не совпадает по алгоритму ФНС (ожидается «${check10}» на конце вместо «${digits[9]}»)`,
    };
  }

  const sum11 = INN12_WEIGHTS_11.reduce((acc, w, idx) => acc + w * digits[idx], 0);
  const check11 = (sum11 % 11) % 10;
  const digitsWithExpected11 = [...digits.slice(0, 10), check11];
  const sum12 = INN12_WEIGHTS_12.reduce(
    (acc, w, idx) => acc + w * digitsWithExpected11[idx],
    0
  );
  const check12 = (sum12 % 11) % 10;
  const valid = digits[10] === check11 && digits[11] === check12;
  return {
    valid,
    cleanInn,
    expectedCheckDigits: `${check11}${check12}`,
    reason: valid
      ? undefined
      : `Контрольные цифры 12-значного ИНН не совпадают по алгоритму ФНС (ожидается «${check11}${check12}» на конце)`,
  };
}

function deterministicHash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Generates a deterministic, valid educational INN/KPP passing official FNS modulo-11 checksums.
 * Used ONLY when the user clicks «Подставить учебные валидные ИНН/КПП» for textbook counterparties
 * (such as ООО «Конкурент», ООО «Ромашка», etc.).
 */
export function generateEducationalInnKpp(
  name: string,
  kind?: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо',
  regionCode = '78'
): { inn: string; kpp: string; ogrn: string } {
  const norm = normalizeEntityKey(name || 'учебныйконтрагент') || 'учебныйконтрагент';
  const hash = deterministicHash(norm);
  const reg = /^\d{2}$/.test(regionCode) ? regionCode : '78';
  const taxInspections = ['10', '11', '13', '14', '16', '38', '39', '40', '41', '42'];
  const ifns = taxInspections[hash % taxInspections.length];
  const isIpOrPerson =
    kind === 'ИндивидуальныйПредприниматель' ||
    kind === 'ФизическоеЛицо' ||
    /^ип\s/i.test((name || '').trim());

  if (isIpOrPerson) {
    const serial6 = String(100000 + ((hash >>> 3) % 899999)).padStart(6, '0');
    const prefix10 = `${reg}${ifns}${serial6}`;
    const d = prefix10.split('').map((c) => Number(c));
    const c11 = (INN12_WEIGHTS_11.reduce((acc, w, idx) => acc + w * d[idx], 0) % 11) % 10;
    const d11 = [...d, c11];
    const c12 = (INN12_WEIGHTS_12.reduce((acc, w, idx) => acc + w * d11[idx], 0) % 11) % 10;
    const inn = `${prefix10}${c11}${c12}`;
    const ogrnipBase = `324${reg}${String(100000000 + (hash % 899999999)).slice(0, 9)}`;
    const ogrnipCheck = Number(BigInt(ogrnipBase) % BigInt(13)) % 10;
    return {
      inn,
      kpp: '',
      ogrn: `${ogrnipBase}${ogrnipCheck}`,
    };
  }

  const serial5 = String(10000 + ((hash >>> 4) % 89999)).padStart(5, '0');
  const prefix9 = `${reg}${ifns}${serial5}`;
  const d = prefix9.split('').map((c) => Number(c));
  const c10 = (INN10_WEIGHTS.reduce((acc, w, idx) => acc + w * d[idx], 0) % 11) % 10;
  const inn = `${prefix9}${c10}`;
  const kpp = `${reg}${ifns}01001`;
  const ogrnBase = `124${reg}${String(1000000 + (hash % 8999999)).slice(0, 7)}`;
  const ogrnCheck = Number(BigInt(ogrnBase) % BigInt(11)) % 10;

  return {
    inn,
    kpp,
    ogrn: `${ogrnBase}${ogrnCheck}`,
  };
}

const KNOWN_RUSSIAN_COMPANIES_FALLBACK: EgrulCandidate[] = [
  {
    inn: '7707083893',
    kpp: '784243001',
    ogrn: '1027700132195',
    name: 'ПАО СБЕРБАНК',
    fullName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО «СБЕРБАНК РОССИИ»',
    kind: 'ЮридическоеЛицо',
    region: '78',
    isActive: true,
    source: 'egrul_fns',
  },
  {
    inn: '7812014560',
    kpp: '781201001',
    ogrn: '1027809169585',
    name: 'ПАО «МЕГАФОН»',
    fullName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО «МЕГАФОН»',
    kind: 'ЮридическоеЛицо',
    region: '78',
    isActive: true,
    source: 'egrul_fns',
  },
  {
    inn: '7707049388',
    kpp: '784001001',
    ogrn: '1027700198767',
    name: 'ПАО «РОСТЕЛЕКОМ»',
    fullName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО «РОСТЕЛЕКОМ»',
    kind: 'ЮридическоеЛицо',
    region: '78',
    isActive: true,
    source: 'egrul_fns',
  },
  {
    inn: '7721617096',
    kpp: '772101001',
    ogrn: '5087746123450',
    name: 'ООО «КОМУС»',
    fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «КОМУС»',
    kind: 'ЮридическоеЛицо',
    region: '77',
    isActive: true,
    source: 'egrul_fns',
  },
  {
    inn: '7803002209',
    kpp: '781001001',
    ogrn: '1027809170300',
    name: 'ПАО «РОССЕТИ ЛЕНЭНЕРГО»',
    fullName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО «РОССЕТИ ЛЕНЭНЕРГО»',
    kind: 'ЮридическоеЛицо',
    region: '78',
    isActive: true,
    source: 'egrul_fns',
  },
];

export const KNOWN_MAJOR_RUSSIAN_COUNTERPARTIES: Array<{
  aliases: string[];
  name: string;
  inn: string;
  kpp: string;
  ogrn: string;
}> = [
  {
    aliases: ['сбербанк', 'пао сбербанк', 'сбербанк россии', 'северо западный банк пао сбербанк'],
    name: 'ПАО СБЕРБАНК',
    inn: '7707083893',
    kpp: '784243001',
    ogrn: '1027700132195',
  },
  {
    aliases: ['мегафон', 'пао мегафон'],
    name: 'ПАО «МЕГАФОН»',
    inn: '7812014560',
    kpp: '781201001',
    ogrn: '1027809169585',
  },
  {
    aliases: ['ростелеком', 'пао ростелеком'],
    name: 'ПАО «РОСТЕЛЕКОМ»',
    inn: '7707049388',
    kpp: '784001001',
    ogrn: '1027700198767',
  },
  {
    aliases: ['комус', 'ооо комус'],
    name: 'ООО «КОМУС»',
    inn: '7721617096',
    kpp: '772101001',
    ogrn: '5087746123450',
  },
  {
    aliases: ['ленэнерго', 'россети ленэнерго', 'пао россети ленэнерго'],
    name: 'ПАО «РОССЕТИ ЛЕНЭНЕРГО»',
    inn: '7803002209',
    kpp: '781001001',
    ogrn: '1027809170300',
  },
  {
    aliases: ['петроэлектросбыт', 'ао петроэлектросбыт'],
    name: 'АО «ПЕТРОЭЛЕКТРОСБЫТ»',
    inn: '7841322249',
    kpp: '784101001',
    ogrn: '1057812496818',
  },
  {
    aliases: ['водоканал', 'водоканал санкт петербурга', 'гуп водоканал спб'],
    name: 'ГУП «ВОДОКАНАЛ САНКТ-ПЕТЕРБУРГА»',
    inn: '7830000426',
    kpp: '784201001',
    ogrn: '1027809256254',
  },
  {
    aliases: ['мтс', 'пао мтс'],
    name: 'ПАО «МТС»',
    inn: '7740000076',
    kpp: '784043001',
    ogrn: '1027700149124',
  },
  {
    aliases: ['деловые линии', 'ооо деловые линии'],
    name: 'ООО «ДЕЛОВЫЕ ЛИНИИ»',
    inn: '7826156685',
    kpp: '781001001',
    ogrn: '1027810306259',
  },
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const egrulMemoryCache = new Map<
  string,
  { expiresAt: number; candidates: EgrulCandidate[] }
>();

export function clearEgrulCache(): void {
  egrulMemoryCache.clear();
}

export function cleanSearchQueryForEgrul(rawName: string, rawInn = ''): string {
  const cleanInn = rawInn.replace(/\D/g, '');
  if (cleanInn.length === 10 || cleanInn.length === 12) {
    return cleanInn;
  }
  return rawName
    .replace(/[«»"'„“”`]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NEIGHBOR_REGIONS_MAP: Record<string, string[]> = {
  '78': ['47'],
  '47': ['78'],
  '77': ['50'],
  '50': ['77'],
  '66': ['74', '72'],
  '23': ['01', '61'],
};

export interface OrganizationRegionInput {
  organizationInn?: string;
  organizationBik?: string;
  organizationAddress?: string;
}

export function inferOrganizationRegionCode(
  dbOrOrg?: Database1CSnapshot | OrganizationRegionInput | null,
  defaultBik = DEFAULT_SBERBANK_BIK
): string {
  const isSnapshot = Boolean(dbOrOrg && 'organization' in dbOrOrg);
  const rawInn = isSnapshot
    ? (dbOrOrg as Database1CSnapshot).organization?.inn
    : (dbOrOrg as OrganizationRegionInput | null | undefined)?.organizationInn;
  const rawAddr = isSnapshot
    ? (dbOrOrg as Database1CSnapshot).organization?.address
    : (dbOrOrg as OrganizationRegionInput | null | undefined)?.organizationAddress;
  const rawBik = isSnapshot
    ? (dbOrOrg as Database1CSnapshot).organization?.bik
    : (dbOrOrg as OrganizationRegionInput | null | undefined)?.organizationBik;

  const orgInn = (rawInn ?? '').replace(/\D/g, '');
  if (orgInn.length >= 10 && /^\d{2}$/.test(orgInn.slice(0, 2))) {
    return orgInn.slice(0, 2);
  }
  const orgAddr = (rawAddr ?? '').toLowerCase();
  if (orgAddr.includes('петербург') || orgAddr.includes('спб')) return '78';
  if (orgAddr.includes('москв')) return '77';

  const cleanBik = (rawBik || defaultBik || '').replace(/\D/g, '');
  if (cleanBik.startsWith('0440')) return '78';
  if (cleanBik.startsWith('0445')) return '77';
  if (cleanBik.startsWith('0465')) return '66';
  return '78';
}

export function rankEgrulCandidate(
  candidate: EgrulCandidate,
  cleanQueryNorm: string,
  regionPrefixHint = '78'
): number {
  let score = 0;
  // Strongly prefer active companies over liquidated / inactive entities
  if (candidate.isActive) {
    score += 200;
  } else {
    score -= 200;
  }

  const candShortNorm = normalizeEntityKey(candidate.name);
  const candFullNorm = normalizeEntityKey(candidate.fullName);

  if (cleanQueryNorm && (candShortNorm === cleanQueryNorm || candFullNorm === cleanQueryNorm)) {
    score += 80;
  } else if (
    cleanQueryNorm &&
    (candShortNorm.startsWith(cleanQueryNorm) || cleanQueryNorm.startsWith(candShortNorm))
  ) {
    score += 35;
  }

  // Prefer headquarters KPP (...01001)
  if (candidate.kpp.endsWith('01001')) {
    score += 20;
  }

  // Strong home-region priority (e.g. St. Petersburg 78... beats Samara 63... on identical names)
  const candReg = candidate.region || candidate.inn.slice(0, 2);
  const kppReg = candidate.kpp.slice(0, 2);
  if (regionPrefixHint && (candReg === regionPrefixHint || kppReg === regionPrefixHint)) {
    score += 65;
  } else if (
    regionPrefixHint &&
    (NEIGHBOR_REGIONS_MAP[regionPrefixHint]?.includes(candReg) ||
      NEIGHBOR_REGIONS_MAP[regionPrefixHint]?.includes(kppReg))
  ) {
    score += 28;
  }

  return score;
}

export function sortEgrulCandidatesByRank(
  candidates: EgrulCandidate[],
  rawQueryName: string,
  regionPrefixHint = '78'
): EgrulCandidate[] {
  const queryNorm = normalizeEntityKey(rawQueryName);
  return [...candidates].sort(
    (a, b) =>
      rankEgrulCandidate(b, queryNorm, regionPrefixHint) -
      rankEgrulCandidate(a, queryNorm, regionPrefixHint)
  );
}

export function selectBestEgrulCandidate(
  candidates: EgrulCandidate[],
  rawQueryOrOpts?: string | { targetName?: string; homeRegionCode?: string },
  regionPrefixHint = '78'
): EgrulCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  const rawName =
    typeof rawQueryOrOpts === 'string'
      ? rawQueryOrOpts
      : (rawQueryOrOpts?.targetName ?? '');
  const effRegion =
    typeof rawQueryOrOpts === 'object' && rawQueryOrOpts?.homeRegionCode
      ? rawQueryOrOpts.homeRegionCode
      : regionPrefixHint;
  const sorted = sortEgrulCandidatesByRank(candidates, rawName, effRegion);
  return sorted[0] ?? null;
}

export interface EgrulLookupOptions {
  dadataApiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  regionPrefixHint?: string;
  skipCache?: boolean;
}

export interface EgrulLookupResponse {
  ok: boolean;
  found: boolean;
  query: string;
  candidates: EgrulCandidate[];
  source?: 'egrul_fns' | 'dadata' | 'cache';
  error?: string;
}

async function queryDaDataParty(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<EgrulCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isInn = /^\d{10}(\d{2})?$/.test(query);
    const endpoint = isInn
      ? 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party'
      : 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party';

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify({ query, count: 8 }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      suggestions?: Array<{
        value?: string;
        data?: {
          inn?: string;
          kpp?: string;
          ogrn?: string;
          type?: 'LEGAL' | 'INDIVIDUAL';
          name?: { short_with_opf?: string; full_with_opf?: string };
          address?: { value?: string };
          management?: { name?: string };
          state?: { status?: string };
        };
      }>;
    };

    const out: EgrulCandidate[] = [];
    for (const s of json.suggestions ?? []) {
      const d = s.data;
      const inn = (d?.inn ?? '').replace(/\D/g, '');
      if (inn.length !== 10 && inn.length !== 12) continue;
      const shortName = d?.name?.short_with_opf || s.value || '';
      const fullName = d?.name?.full_with_opf || shortName;
      out.push({
        inn,
        kpp: (d?.kpp ?? '').replace(/\D/g, ''),
        ogrn: (d?.ogrn ?? '').replace(/\D/g, ''),
        name: shortName.trim(),
        fullName: fullName.trim(),
        address: d?.address?.value,
        leaderName: d?.management?.name,
        kind:
          d?.type === 'INDIVIDUAL' || inn.length === 12
            ? 'ИндивидуальныйПредприниматель'
            : 'ЮридическоеЛицо',
        region: inn.slice(0, 2),
        isActive: d?.state?.status ? d.state.status === 'ACTIVE' : true,
        source: 'dadata',
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

interface FnsEgrulRow {
  c?: string; // short name
  n?: string; // full name / FIO for IP
  i?: string; // INN
  p?: string; // KPP
  o?: string; // OGRN / OGRNIP
  a?: string; // address
  g?: string; // director
  k?: string; // 'ul' | 'fl'
  e?: string; // termination / liquidation date if inactive
}

async function queryOfficialFnsEgrul(
  query: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<EgrulCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({
      vyp3CaptchaToken: '',
      page: '',
      query,
      region: '',
      PreventChromeAutocomplete: '',
    }).toString();

    const step1 = await fetchImpl('https://egrul.nalog.ru/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
      body,
      signal: controller.signal,
    });

    if (!step1.ok) {
      throw new Error(`ФНС ЕГРЮЛ HTTP ${step1.status}`);
    }

    const tokenJson = (await step1.json()) as { t?: string; captchaRequired?: boolean };
    if (tokenJson.captchaRequired || !tokenJson.t) {
      return [];
    }

    const token = tokenJson.t;
    let rows: FnsEgrulRow[] = [];

    for (let attempt = 0; attempt < 5; attempt++) {
      const ts = Date.now();
      const step2 = await fetchImpl(
        `https://egrul.nalog.ru/search-result/${encodeURIComponent(token)}?r=${ts}&_=${ts}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          },
          signal: controller.signal,
        }
      );

      if (!step2.ok) break;
      const resultJson = (await step2.json()) as {
        status?: string;
        rows?: FnsEgrulRow[];
      };

      if (resultJson.status === 'wait') {
        await sleepMs(300);
        continue;
      }

      if (Array.isArray(resultJson.rows)) {
        rows = resultJson.rows;
      }
      break;
    }

    const candidates: EgrulCandidate[] = [];
    for (const r of rows) {
      const inn = (r.i ?? '').replace(/\D/g, '');
      if (inn.length !== 10 && inn.length !== 12) continue;
      const isIp = r.k === 'fl' || inn.length === 12;
      const rawShort = (r.c || r.n || '').trim();
      const rawFull = (r.n || r.c || '').trim();
      const displayName =
        isIp && !/^ИП\s/i.test(rawShort) ? `ИП ${rawShort}` : rawShort;

      candidates.push({
        inn,
        kpp: isIp ? '' : (r.p ?? '').replace(/\D/g, ''),
        ogrn: (r.o ?? '').replace(/\D/g, ''),
        name: displayName,
        fullName: rawFull || displayName,
        address: r.a?.trim(),
        leaderName: r.g?.trim(),
        kind: isIp ? 'ИндивидуальныйПредприниматель' : 'ЮридическоеЛицо',
        region: inn.slice(0, 2),
        isActive: !r.e,
        source: 'egrul_fns',
      });
    }

    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupCounterpartyInEgrul(
  rawName: string,
  rawInnOrOptions?: string | EgrulLookupOptions,
  maybeOptions?: EgrulLookupOptions
): Promise<EgrulLookupResponse> {
  const rawInn = typeof rawInnOrOptions === 'string' ? rawInnOrOptions : '';
  const options: EgrulLookupOptions =
    typeof rawInnOrOptions === 'object' && rawInnOrOptions !== null
      ? rawInnOrOptions
      : maybeOptions ?? {};
  const query = cleanSearchQueryForEgrul(rawName, rawInn);
  if (query.length < 2) {
    return { ok: true, found: false, query, candidates: [] };
  }

  const regionHint = options.regionPrefixHint ?? '78';
  const cacheKey = `${query.toLowerCase()}::${regionHint}`;

  if (!options.skipCache) {
    const cached = egrulMemoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ok: true,
        found: cached.candidates.length > 0,
        query,
        candidates: cached.candidates,
        source: 'cache',
      };
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2200;
  const dadataKey = (options.dadataApiKey ?? process.env.DADATA_API_KEY ?? '').trim();
  const queryNorm = normalizeEntityKey(rawName);

  try {
    let rawCandidates: EgrulCandidate[] = [];
    let usedSource: 'dadata' | 'egrul_fns' = 'egrul_fns';

    if (dadataKey) {
      rawCandidates = await queryDaDataParty(query, dadataKey, fetchImpl, timeoutMs);
      if (rawCandidates.length > 0) {
        usedSource = 'dadata';
      }
    }

    if (rawCandidates.length === 0) {
      rawCandidates = await queryOfficialFnsEgrul(query, fetchImpl, timeoutMs);
      usedSource = 'egrul_fns';
    }

    const sorted = [...rawCandidates]
      .sort(
        (a, b) =>
          rankEgrulCandidate(b, queryNorm, regionHint) -
          rankEgrulCandidate(a, queryNorm, regionHint)
      )
      .slice(0, 8);

    egrulMemoryCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      candidates: sorted,
    });

    return {
      ok: true,
      found: sorted.length > 0,
      query,
      candidates: sorted,
      source: usedSource,
    };
  } catch (err) {
    if (!options.fetchImpl && queryNorm.length >= 3) {
      const offlineHits = KNOWN_RUSSIAN_COMPANIES_FALLBACK.filter((c) => {
        const cn = normalizeEntityKey(c.name);
        return cn === queryNorm || cn.includes(queryNorm) || queryNorm.includes(cn) || c.inn === query;
      });
      if (offlineHits.length > 0) {
        return {
          ok: true,
          found: true,
          query,
          candidates: offlineHits,
          source: 'egrul_fns',
        };
      }
    }
    return {
      ok: true,
      found: false,
      query,
      candidates: [],
      error: err instanceof Error ? err.message : 'Сервис ЕГРЮЛ временно недоступен',
    };
  }
}

export interface CounterpartyPriorityResolutionInput {
  name: string;
  explicitInn?: string;
  explicitKpp?: string;
  explicitBankAccount?: string;
  explicitBik?: string;
  db1C: Database1CSnapshot | null;
  egrulCandidates?: EgrulCandidate[];
  regionPrefixHint?: string;
  autoFillFormalIfUnfound?: boolean;
}

export interface CounterpartyPriorityResolutionResult {
  name: string;
  fullName?: string;
  inn: string;
  kpp: string;
  ogrn?: string;
  bankAccount?: string;
  bik?: string;
  bankName?: string;
  corrAccount?: string;
  kind: 'ЮридическоеЛицо' | 'ИндивидуальныйПредприниматель' | 'ФизическоеЛицо';
  source: CounterpartyResolutionSource;
  egrulCandidates: EgrulCandidate[];
  matchedCode1C?: string;
}

/**
 * Enforces strict 4-tier counterparty resolution priority:
 * 1. Explicit INN/KPP/bank requisites in Excel operation text
 * 2. Match in loaded 1C directories (ВсеСправочники.Контрагенты / ФизическиеЛица)
 * 3. Server lookup in official FNS EGRUL / DaData (ranked by home region + active status)
 * 4. Honest fallback: 'educational_unverified' by default, or deterministic valid FNS-checksum
 *    'educational_generated' when `autoFillFormalIfUnfound` is requested by autofix.
 */
export function resolveCounterpartyByStrictPriority(
  input: CounterpartyPriorityResolutionInput
): CounterpartyPriorityResolutionResult {
  const trimmedName = input.name.trim();
  const explicitInn = (input.explicitInn ?? '').replace(/\D/g, '');
  const explicitKpp = (input.explicitKpp ?? '').replace(/\D/g, '');
  const explicitBik = (input.explicitBik ?? '').replace(/\D/g, '');
  const explicitBankAccount = (input.explicitBankAccount ?? '').replace(/\D/g, '');
  const regionHint =
    input.regionPrefixHint || inferOrganizationRegionCode(input.db1C, explicitBik || DEFAULT_SBERBANK_BIK);

  const bankFromExplicit = explicitBik ? resolveBankInfoByBik(explicitBik) : undefined;

  // Priority 1: Explicit INN in the Excel operation text
  if (explicitInn.length === 10 || explicitInn.length === 12) {
    const matched1C = matchPersonOrCounterpartyIn1C(trimmedName, explicitInn, input.db1C);
    return {
      name: matched1C?.name || trimmedName,
      fullName: matched1C?.fullName || trimmedName,
      inn: explicitInn,
      kpp: explicitKpp || matched1C?.kpp || '',
      bankAccount: explicitBankAccount || undefined,
      bik: explicitBik || undefined,
      bankName: bankFromExplicit?.bankName,
      corrAccount: bankFromExplicit?.corrAccount || undefined,
      kind:
        matched1C?.kind ??
        (explicitInn.length === 12 ? 'ИндивидуальныйПредприниматель' : 'ЮридическоеЛицо'),
      source: 'excel_explicit',
      egrulCandidates: input.egrulCandidates ?? [],
      matchedCode1C: matched1C?.code1C,
    };
  }

  // Priority 2: Loaded 1C Database (Контрагенты / ФизическиеЛица)
  const matched1C = matchPersonOrCounterpartyIn1C(trimmedName, '', input.db1C);
  if (matched1C) {
    const cpDirEntry = input.db1C?.counterparties.find((c) => c.id === matched1C.id);
    const effBik = explicitBik || cpDirEntry?.bik || '';
    const effBank = effBik ? resolveBankInfoByBik(effBik, cpDirEntry?.bankName) : undefined;
    return {
      name: matched1C.name,
      fullName: matched1C.fullName || matched1C.name,
      inn: matched1C.inn,
      kpp: explicitKpp || matched1C.kpp,
      bankAccount: explicitBankAccount || cpDirEntry?.bankAccount,
      bik: effBik || undefined,
      bankName: effBank?.bankName || cpDirEntry?.bankName,
      corrAccount: effBank?.corrAccount || undefined,
      kind: matched1C.kind,
      source: 'db_1c',
      egrulCandidates: input.egrulCandidates ?? [],
      matchedCode1C: matched1C.code1C,
    };
  }

  // Priority 3: Real FNS EGRUL / DaData lookup result (region-ranked)
  const rawCandidates = input.egrulCandidates ?? [];
  if (rawCandidates.length > 0) {
    const sorted = sortEgrulCandidatesByRank(rawCandidates, trimmedName, regionHint);
    const best = sorted[0];
    return {
      name: trimmedName || best.name,
      fullName: best.fullName || best.name,
      inn: best.inn,
      kpp: explicitKpp || best.kpp,
      ogrn: best.ogrn,
      bankAccount: explicitBankAccount || undefined,
      bik: explicitBik || undefined,
      bankName: bankFromExplicit?.bankName,
      corrAccount: bankFromExplicit?.corrAccount || undefined,
      kind: best.kind,
      source: 'egrul_verified',
      egrulCandidates: sorted,
    };
  }

  const inferredKind: CounterpartyPriorityResolutionResult['kind'] = /^ИП\s/i.test(trimmedName)
    ? 'ИндивидуальныйПредприниматель'
    : 'ЮридическоеЛицо';

  if (input.autoFillFormalIfUnfound && trimmedName.length >= 2) {
    const generated = generateEducationalInnKpp(trimmedName, inferredKind, regionHint);
    return {
      name: trimmedName,
      inn: generated.inn,
      kpp: explicitKpp || generated.kpp,
      ogrn: generated.ogrn,
      bankAccount: explicitBankAccount || undefined,
      bik: explicitBik || DEFAULT_SBERBANK_BIK,
      bankName: bankFromExplicit?.bankName || DEFAULT_SBERBANK_NAME,
      corrAccount: bankFromExplicit?.corrAccount || DEFAULT_SBERBANK_CORR,
      kind: inferredKind,
      source: 'educational_generated',
      egrulCandidates: [],
    };
  }

  // Priority 4: Not found in text, 1C DB, or EGRUL -> honest educational/manual marker without fake INN
  return {
    name: trimmedName,
    inn: '',
    kpp: explicitKpp,
    bankAccount: explicitBankAccount || undefined,
    bik: explicitBik || undefined,
    bankName: bankFromExplicit?.bankName,
    corrAccount: bankFromExplicit?.corrAccount || undefined,
    kind: inferredKind,
    source: trimmedName.length >= 2 ? 'educational_unverified' : 'unresolved',
    egrulCandidates: [],
  };
}

import { normalizeAccountToLeaf1C } from '@/data/chartOfAccounts';

export interface ExplicitCorrespondenceHint1C {
  debit: string;
  credit: string;
  amount?: number;
  description?: string;
  isOffBalance?: boolean;
  rawMatch?: string;
}

const FULL_OPF_TO_SHORT: Array<{ re: RegExp; shortOpf: string }> = [
  { re: /публичн\p{L}*\s+акционерн\p{L}*\s+обществ\p{L}*/giu, shortOpf: 'ПАО' },
  { re: /непубличн\p{L}*\s+акционерн\p{L}*\s+обществ\p{L}*/giu, shortOpf: 'НАО' },
  { re: /закрыт\p{L}*\s+акционерн\p{L}*\s+обществ\p{L}*/giu, shortOpf: 'ЗАО' },
  { re: /открыт\p{L}*\s+акционерн\p{L}*\s+обществ\p{L}*/giu, shortOpf: 'ОАО' },
  { re: /акционерн\p{L}*\s+обществ\p{L}*/giu, shortOpf: 'АО' },
  { re: /обществ\p{L}*\s+с\s+ограниченн\p{L}*\s+ответственност\p{L}*/giu, shortOpf: 'ООО' },
  { re: /индивидуальн\p{L}*\s+предпринимател\p{L}*/giu, shortOpf: 'ИП' },
  { re: /государственн\p{L}*\s+унитарн\p{L}*\s+предприят\p{L}*/giu, shortOpf: 'ГУП' },
  { re: /муниципальн\p{L}*\s+унитарн\p{L}*\s+предприят\p{L}*/giu, shortOpf: 'МУП' },
];

const INDECLINABLE_SURNAME_SUFFIX_RE = /(?:енко|ко|дзе|швили|иа|уа|ых|их|о|е|и|у|ю)$/iu;

function capitalizeRuWord(w: string): string {
  if (!w) return '';
  return w
    .split('-')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join('-');
}

/**
 * Inflects a single Russian surname (masculine or feminine) from Genitive / Dative /
 * Accusative / Instrumental into Nominative singular.
 * Preserves indeclinable surnames (-енко, -ко, -дзе, -швили, -ских/-цких when plural/indeclinable).
 */
export function inflectRussianSurnameToNominative(
  rawSurname: string,
  genderHint?: 'M' | 'F'
): string {
  const s = rawSurname.trim();
  if (s.length < 3) return s;

  // Already nominative or indeclinable (-енко, -ко, -дзе, -швили, etc.)
  if (/(?:енко|ко|дзе|швили|иа|уа)$/iu.test(s)) {
    return capitalizeRuWord(s);
  }

  // Adjectival surnames (-ский / -цкий / -ской / -цкой)
  if (/(?:ского|скому|ским|ском)$/iu.test(s)) {
    return capitalizeRuWord(s.replace(/(?:ского|скому|ским|ском)$/iu, 'ский'));
  }
  if (/(?:цкого|цкому|цким|цком)$/iu.test(s)) {
    return capitalizeRuWord(s.replace(/(?:цкого|цкому|цким|цком)$/iu, 'цкий'));
  }
  if (/(?:ской|скую)$/iu.test(s) && genderHint !== 'M') {
    return capitalizeRuWord(s.replace(/(?:ской|скую)$/iu, 'ская'));
  }
  if (/(?:цкой|цкую)$/iu.test(s) && genderHint !== 'M') {
    return capitalizeRuWord(s.replace(/(?:цкой|цкую)$/iu, 'цкая'));
  }

  // Feminine oblique endings: -овой/-евой/-ёвой/-иной/-ыной, -ову/-еву/-ину (when F), -овую? no, -ову is acc. F or dat. M!
  if (/(?:овой|евой|ёвой|иной|ыной)$/iu.test(s)) {
    return capitalizeRuWord(`${s.slice(0, -2)}а`);
  }

  // Masculine instrumental: -овым/-евым/-ёвым/-иным/-ыным
  if (/(?:овым|евым|ёвым|иным|ыным)$/iu.test(s)) {
    return capitalizeRuWord(s.slice(0, -2));
  }

  // Ambiguous -ову / -еву / -ёву / -ину / -ыну:
  // If genderHint === 'F' -> feminine accusative ("приняли Иванову Е.А.") -> -а
  // Otherwise -> masculine dative ("выдано Федорову Ф.Ф.") -> strip -у
  if (/(?:ову|еву|ёву|ину|ыну)$/iu.test(s)) {
    if (genderHint === 'F') {
      return capitalizeRuWord(`${s.slice(0, -1)}а`);
    }
    return capitalizeRuWord(s.slice(0, -1));
  }

  // Ambiguous -ова / -ева / -ёва / -ина / -ына:
  // If genderHint === 'M' -> masculine genitive/accusative ("доля Иванова Ивана Ивановича", "с сотрудника Валеева В.В.") -> strip -а
  // If genderHint === 'F' -> already feminine nominative ("Иванова Елена")
  if (/(?:ова|ева|ёва|ина|ына)$/iu.test(s)) {
    if (genderHint === 'M') {
      return capitalizeRuWord(s.slice(0, -1));
    }
    return capitalizeRuWord(s);
  }

  // Generic consonant masculine instrumental (-ом / -ем) when stem >= 4 chars (e.g. "Морозом И.И." -> "Мороз")
  if (genderHint === 'M' && /(?:ом|ем)$/iu.test(s) && s.length >= 6 && !INDECLINABLE_SURNAME_SUFFIX_RE.test(s)) {
    return capitalizeRuWord(s.slice(0, -2));
  }

  return capitalizeRuWord(s);
}

function inflectRussianGivenNameToNominative(rawGiven: string, gender: 'M' | 'F'): string {
  const g = rawGiven.trim();
  if (!g || g.includes('.')) return g;
  const lower = g.toLowerCase();

  const exactMap: Record<string, string> = {
    павла: 'Павел',
    павлу: 'Павел',
    павлом: 'Павел',
    льва: 'Лев',
    льву: 'Лев',
    львом: 'Лев',
    петра: 'Петр',
    петру: 'Петр',
    петром: 'Петр',
    игоря: 'Игорь',
    игорю: 'Игорь',
    игорем: 'Игорь',
    андрея: 'Андрей',
    андрею: 'Андрей',
    андреем: 'Андрей',
    сергея: 'Сергей',
    сергею: 'Сергей',
    сергеем: 'Сергей',
    алексея: 'Алексей',
    алексею: 'Алексей',
    алексеем: 'Алексей',
    дмитрия: 'Дмитрий',
    дмитрию: 'Дмитрий',
    дмитрием: 'Дмитрий',
    евгения: 'Евгений',
    евгению: 'Евгений',
    евгением: 'Евгений',
    николая: 'Николай',
    николаю: 'Николай',
    николаем: 'Николай',
    василия: 'Василий',
    василию: 'Василий',
    василием: 'Василий',
    юрия: 'Юрий',
    юрию: 'Юрий',
    юрием: 'Юрий',
    виталия: 'Виталий',
    виталию: 'Виталий',
    виталием: 'Виталий',
    анатолия: 'Анатолий',
    анатолию: 'Анатолий',
    анатолием: 'Анатолий',
    валерия: 'Валерий',
    валерию: 'Валерий',
    валерием: 'Валерий',
    григория: 'Григорий',
    григорию: 'Григорий',
    григорием: 'Григорий',
    ильи: 'Илья',
    илье: 'Илья',
    ильей: 'Илья',
    ильёй: 'Илья',
    никиты: 'Никита',
    никите: 'Никита',
    никитой: 'Никита',
    любви: 'Любовь',
    любовью: 'Любовь',
  };
  if (exactMap[lower]) return exactMap[lower];

  if (gender === 'M') {
    if (/(?:ием|яем)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -2)}й`);
    if (/(?:ем)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -2)}й`);
    if (/(?:ом)$/iu.test(g)) return capitalizeRuWord(g.slice(0, -2));
    if (/(?:ия|ию)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -1)}й`);
    if (/(?:я|ю)$/iu.test(g) && g.length >= 5) return capitalizeRuWord(`${g.slice(0, -1)}й`);
    if (/(?:а|у)$/iu.test(g) && g.length >= 4) return capitalizeRuWord(g.slice(0, -1));
    return capitalizeRuWord(g);
  }

  // Feminine
  if (/(?:ией)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -2)}я`);
  if (/(?:ей|ой|ою|ею)$/iu.test(g)) {
    return capitalizeRuWord(`${g.slice(0, -2)}а`);
  }
  if (/(?:ии|ию)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -1)}я`);
  if (/(?:у|е|ы)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -1)}а`);
  if (/(?:ю)$/iu.test(g)) return capitalizeRuWord(`${g.slice(0, -1)}я`);
  return capitalizeRuWord(g);
}

function inflectRussianPatronymicToNominative(
  rawPatr: string
): { nominative: string; gender?: 'M' | 'F' } {
  const p = rawPatr.trim();
  if (!p || p.includes('.')) return { nominative: p };

  // Masculine patronymics: -ович / -евич / -ич
  if (/(?:ович|евич|ич)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(p), gender: 'M' };
  }
  if (/(?:овича|евича|ича|овичу|евичу|ичу)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(p.slice(0, -1)), gender: 'M' };
  }
  if (/(?:овичем|евичем|ичом|ичем)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(p.slice(0, -2)), gender: 'M' };
  }

  // Feminine patronymics: -овна / -евна / -ична / -инична
  if (/(?:овна|евна|ична)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(p), gender: 'F' };
  }
  if (/(?:овны|евны|ичны|овне|евне|ичне|овну|евну|ичну)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(`${p.slice(0, -1)}а`), gender: 'F' };
  }
  if (/(?:овной|евной|ичной)$/iu.test(p)) {
    return { nominative: capitalizeRuWord(`${p.slice(0, -2)}а`), gender: 'F' };
  }

  return { nominative: capitalizeRuWord(p) };
}

/**
 * Invariant 2: Normalizes any Russian FIO (with initials or full 3-part FIO) from
 * Genitive / Dative / Accusative / Instrumental into clean Nominative case.
 * Examples:
 * - "Сидоровым П.П." -> "Сидоров П.П."
 * - "Ивановой Е.А." -> "Иванова Е.А."
 * - "Сидоровым Петром Ильичом" -> "Сидоров Петр Ильич"
 * - "Морозовой Еленой Сергеевной" -> "Морозова Елена Сергеевна"
 * - "Валеева В.В." (in genitive context) -> "Валеев В.В." when `obliqueContext` is true
 */
export function normalizeRussianFioToNominative1C(
  rawFio: string,
  options?: { obliqueContext?: boolean; genderHint?: 'M' | 'F' }
): string {
  const cleaned = (rawFio ?? '')
    .replace(/[«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  // 1. Surname + Initials ("Сидоровым П.П.", "Ивановой Е. А.", "Валеева В.В")
  const initMatch = cleaned.match(
    /^([А-ЯЁа-яё][А-ЯЁа-яё-]{1,35})\s+([А-ЯЁ])\.?\s*([А-ЯЁ])\.?$/u
  );
  if (initMatch) {
    const rawSur = initMatch[1];
    const i1 = initMatch[2].toUpperCase();
    const i2 = initMatch[3].toUpperCase();
    // Determine genderHint if unambiguous or if obliqueContext indicates masculine genitive ("у ИП Соколова И.П.", "доля Соколова А.В.")
    let gender: 'M' | 'F' | undefined = options?.genderHint;
    if (!gender) {
      if (/(?:овой|евой|ёвой|иной|ыной|ской|цкой|ская|цкая)$/iu.test(rawSur)) {
        gender = 'F';
      } else if (
        /(?:овым|евым|ёвым|иным|ыным|скому|цкому|ским|цким|ского|цкого|ский|цкий)$/iu.test(rawSur)
      ) {
        gender = 'M';
      } else if (options?.obliqueContext && /(?:ова|ева|ёва|ина|ына)$/iu.test(rawSur)) {
        gender = 'M';
      }
    }
    const surNom = inflectRussianSurnameToNominative(rawSur, gender);
    return `${surNom} ${i1}.${i2}.`;
  }

  // 2. Surname + single initial ("Сидорову П.")
  const singleInitMatch = cleaned.match(/^([А-ЯЁа-яё][А-ЯЁа-яё-]{1,35})\s+([А-ЯЁ])\.$/u);
  if (singleInitMatch) {
    const rawSur = singleInitMatch[1];
    const gender: 'M' | 'F' | undefined =
      options?.genderHint ??
      (/(?:овой|евой|ёвой|иной|ыной|ской|цкой)$/iu.test(rawSur)
        ? 'F'
        : options?.obliqueContext && /(?:ова|ева|ёва|ина|ына)$/iu.test(rawSur)
          ? 'M'
          : undefined);
    const surNom = inflectRussianSurnameToNominative(rawSur, gender);
    return `${surNom} ${singleInitMatch[2].toUpperCase()}.`;
  }

  // 3. Full 3-word FIO ("Сидоровым Петром Ильичом", "Иванова Ивана Ивановича")
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 3 && parts.every((p) => /^[А-ЯЁа-яё-]+$/u.test(p))) {
    const [rawSur, rawGiven, rawPatr] = parts;
    const patrInfo = inflectRussianPatronymicToNominative(rawPatr);
    if (patrInfo.gender) {
      const surNom = inflectRussianSurnameToNominative(rawSur, patrInfo.gender);
      const givenNom = inflectRussianGivenNameToNominative(rawGiven, patrInfo.gender);
      return `${surNom} ${givenNom} ${patrInfo.nominative}`;
    }
  }

  return cleaned;
}

/**
 * Normalizes any legal entity or IP string to canonical 1C format:
 * - `«ООО Вектор»` / `"ООО Вектор"` / `'Вектор' ООО` / `Общество с ограниченной ответственностью "Вектор"` -> `ООО «Вектор»`
 * - `ИП Соколова И.П.` (from oblique phrase) -> `ИП Соколов И.П.`
 */
export function normalizeLegalEntityName1C(
  raw: string,
  options?: { obliqueContext?: boolean }
): string {
  let s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Replace full OPF names with short OPF
  for (const item of FULL_OPF_TO_SHORT) {
    s = s.replace(item.re, item.shortOpf);
  }
  s = s.replace(/\s+/g, ' ').trim();

  // Case 1: Quotes wrap BOTH OPF and name: «ООО Вектор», "ПАО МегаФон"
  const wrappedOpf = s.match(
    /^[«"'„“”]\s*(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ФГУП|АНО|НКО)\s+([^»"'”]{2,80}?)\s*[»"'”]$/iu
  );
  if (wrappedOpf) {
    return `${wrappedOpf[1].toUpperCase()} «${wrappedOpf[2].replace(/[«»"'„“”]/g, '').trim()}»`;
  }

  // Case 2: Trailing OPF: «Вектор» ООО or "Вектор" ООО
  const trailingOpf = s.match(
    /^[«"'„“”]\s*([^»"'”]{2,80}?)\s*[»"'”]\s+(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ФГУП)$/iu
  );
  if (trailingOpf) {
    return `${trailingOpf[2].toUpperCase()} «${trailingOpf[1].trim()}»`;
  }

  // Case 3: Standard OPF + quoted or unquoted name
  const leadingOpf = s.match(
    /^(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ФГУП|АНО|НКО)\s+[«"'„“”]?([^»"'”]{2,80}?)[»"'”]?$/iu
  );
  if (leadingOpf) {
    const opf = leadingOpf[1].toUpperCase();
    const body = leadingOpf[2].replace(/[«»"'„“”]/g, '').trim();
    if (/^сбербанк$/iu.test(body) && opf === 'ПАО') {
      return 'ПАО СБЕРБАНК';
    }
    return `${opf} «${body}»`;
  }

  // Case 4: Individual Entrepreneur (ИП + FIO)
  const ipMatch = s.match(/^ИП\s+[«"'„“”]?(.+?)[»"'”]?$/iu);
  if (ipMatch) {
    const fioNorm = normalizeRussianFioToNominative1C(ipMatch[1], {
      obliqueContext: options?.obliqueContext,
    });
    return `ИП ${fioNorm}`;
  }

  return s;
}

/**
 * Extracts a legal entity, government fund/IFNS, IP, or role-anchored quoted counterparty
 * from free-text operation descriptions.
 */
export function extractCounterpartyFromText1C(text: string): string {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return '';

  // Pre-normalize full OPF phrases in a working copy for matching
  let work = clean;
  for (const item of FULL_OPF_TO_SHORT) {
    work = work.replace(item.re, item.shortOpf);
  }

  // 1. OPF outside quotes: ООО «Вектор», АО "ТехноСнаб", ПАО 'Север'
  const legalQuoted = work.match(
    /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ФГУП|АНО|НКО)\s*[«"'„“]([^»"'”]{2,80})[»"'”]/iu
  );
  if (legalQuoted) {
    return normalizeLegalEntityName1C(`${legalQuoted[1]} «${legalQuoted[2]}»`);
  }

  // 2. OPF inside quotes: «ООО Вектор», "ООО ТехноСнаб"
  const insideQuoted = work.match(
    /[«"'„“]\s*(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ФГУП|АНО|НКО)\s+([^»"'”]{2,80}?)\s*[»"'”]/iu
  );
  if (insideQuoted) {
    return normalizeLegalEntityName1C(`${insideQuoted[1]} «${insideQuoted[2]}»`);
  }

  // 3. Quoted name followed by OPF: «Вектор» ООО
  const trailingOpfQuoted = work.match(
    /[«"'„“]\s*([^»"'”]{2,60}?)\s*[»"'”]\s+(ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП)\b/iu
  );
  if (trailingOpfQuoted) {
    return normalizeLegalEntityName1C(`${trailingOpfQuoted[2]} «${trailingOpfQuoted[1]}»`);
  }

  // 4. Tax / Treasury / Social Fund agency
  const govMatch = work.match(
    /(?:^|[^\p{L}\p{N}])((?:МИ\s*ФНС|Межрайонн\p{L}+\s+ИФНС|ИФНС|УФНС|УФК|ОСФР|СФР|ФНС)(?:\s+России)?(?:\s*№\s*\d+)?(?:\s+по\s+(?:г\.\s*)?[А-Яа-яЁё.-]+(?:\s+[А-Яа-яЁё.-]+)?)?)(?=\s*[,(;]|$|\s+ИНН|\s+КПП|\s+р\/с)/iu
  );
  if (govMatch) {
    return govMatch[1].replace(/\s+/g, ' ').trim();
  }

  // 5. Individual entrepreneur (supports oblique: "у ИП Соколова И.П.", "оплачено ИП Петровой А.С.")
  const ipMatch = work.match(
    /(?:^|[^\p{L}\p{N}])((?:у|от|для|поставщик\p{L}*|покупател\p{L}*|подрядчик\p{L}*|арендодател\p{L}*)?\s*ИП\s+[А-ЯЁ][а-яё-]+(?:\s+(?:[А-ЯЁ]\.\s*[А-ЯЁ]\.?|[А-ЯЁ][а-яё.]+)){1,2})/u
  );
  if (ipMatch) {
    const rawPhrase = ipMatch[1].trim();
    const hasObliquePrep =
      /^(?:у|от|для|поставщик\p{L}*|покупател\p{L}*|подрядчик\p{L}*|арендодател\p{L}*)\s+/iu.test(
        rawPhrase
      ) || /(?:оплачен|перечислен|выплачен|поступил\p{L}*\s+от)/iu.test(work);
    const ipBody = rawPhrase.replace(
      /^(?:у|от|для|поставщик\p{L}*|покупател\p{L}*|подрядчик\p{L}*|арендодател\p{L}*)\s+/iu,
      ''
    );
    return normalizeLegalEntityName1C(ipBody, { obliqueContext: hasObliquePrep });
  }

  // 6. Unquoted legal entity: "ПАО МегаФон", "ООО БизнесЦентр", "АО Ростелеком"
  const legalUnquoted = work.match(
    /(?:^|[^\p{L}\p{N}])(ООО|АО|ПАО|ЗАО|ОАО|ГУП|МУП)\s+([А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9-]{2,40}(?:\s+[А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9-]{2,30})?)(?=\s*(?:[,.;()]|$|\s+(?:по|за|на|в|с|инн|кпп|бик|счет|договор|сумма|акт|упд|накладн|\d)))/u
  );
  if (legalUnquoted) {
    return normalizeLegalEntityName1C(`${legalUnquoted[1]} «${legalUnquoted[2].trim()}»`);
  }

  // 7. Role-anchored quoted company name WITHOUT explicit OPF:
  // e.g. 'от поставщика «ТехноМир»', 'покупателю "Орион"', 'арендодателю «Балтика»', 'фирме «СтройИнвест»'
  const roleQuoted = work.match(
    /(?:поставщик\p{L}*|покупател\p{L}*|заказчик\p{L}*|подрядчик\p{L}*|арендодател\p{L}*|арендатор\p{L}*|контрагент\p{L}*|компани\p{L}*|фирм\p{L}*|организаци\p{L}*|заемщик\p{L}*|займодавц\p{L}*|кредитор\p{L}*)\s*[«"'„“]([А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9\s-]{1,60}?)[»"'”]/u
  );
  if (roleQuoted) {
    const inner = roleQuoted[1].trim();
    if (!/^(?:основной\s+договор|основной\s+склад|упд|торг-12)$/iu.test(inner)) {
      return `ООО «${inner}»`;
    }
  }

  // 8. Named commercial banks (e.g., "в банке Санкт-Петербург", "в Банке ВТБ", "в Сбербанке")
  const bankMatch = work.match(
    /(?:^|[^\p{L}])(?:в\s+|от\s+|из\s+|у\s+)?Банк[ауеом]?\s+(?:[«"'„“]([^»"'”]{2,60})[»"'”]|([А-ЯЁ][А-Яа-яЁё0-9-]{1,35}))(?=$|[^\p{L}])/u
  );
  if (bankMatch) {
    const bankTitle = (bankMatch[1] || bankMatch[2] || '').trim();
    if (bankTitle && !/^(?:РФ|России|клиент)$/iu.test(bankTitle)) {
      return `Банк «${bankTitle}»`;
    }
  }
  if (/(?:^|[^\p{L}])(?:в\s+|от\s+)?Сбербанк[ауеом]?(?=$|[^\p{L}])/iu.test(work)) {
    return 'ПАО СБЕРБАНК';
  }

  // 9. Public security agencies & self-regulatory associations (ОВО МВД РФ, Союз строителей, СРО)
  const instMatch = work.match(
    /(?:^|[^\p{L}])(ОВО\s+МВД(?:\s+РФ|\s+России)?|УВО\s+(?:ВНГ|МВД)(?:\s+РФ|\s+России)?|Союз\s+[а-яёА-ЯЁ-]{4,35}(?:\s+[«"'„“][^»"'”]+[»"'”])?|СРО(?:\s+[«"'„“][^»"'”]+[»"'”])?)(?=$|[^\p{L}])/iu
  );
  if (instMatch) {
    return instMatch[1].replace(/\s+/g, ' ').trim();
  }

  return '';
}

/**
 * Extracts person FIO in any Russian grammatical case when anchored by accounting context
 * (accountable person, employee, founder, shareholder, writ debtor, material custodian, etc.).
 */
export function extractPersonFioFromText1C(text: string): string {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return '';

  // 1. Instrumental / Genitive / Dative with initials: "Сидоровым П.П.", "Федорову Ф.Ф.", "Ивановой Е.А."
  const anchoredInit = clean.match(
    /(?:сотрудник\p{L}*|работник\p{L}*|подотч[её]тн\p{L}*\s+лиц\p{L}*|учредител\p{L}*|участник\p{L}*|акционер\p{L}*|директор\p{L}*|бухгалтер\p{L}*|кладовщик\p{L}*|кассир\p{L}*|выда(?:но|н[аы]?|ли)|перечислен\p{L}*|возвращ[её]н\p{L}*|внес[её]н\p{L}*|авансов\p{L}*\s+отч[её]т(?:\s*№\s*\S+)?|принят\p{L}*\s+на\s+работу|доля|вклад)\s+(?:в\s+кассу\s+|на\s+р\/с\s+)?([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/u
  );
  if (anchoredInit) {
    return normalizeRussianFioToNominative1C(anchoredInit[1], { obliqueContext: true });
  }

  // 2. Any standalone Surname + I.O. in sentence (excluding ИП which is a counterparty)
  const allInitials = Array.from(
    clean.matchAll(/(?:^|[^\p{L}])(?<!ИП\s)([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/gu)
  );
  if (allInitials.length > 0) {
    const cand = allInitials[0][1].trim();
    const isOblique = /(?:выда|перечисл|авансов|подотчет|под\s+отчет|возврат|возвращ|удерж|взыск|доля|вклад|дивиденд|учредител)/iu.test(
      clean
    );
    return normalizeRussianFioToNominative1C(cand, { obliqueContext: isOblique });
  }

  // 3. Full 3-word Russian FIO with patronymic (-ович/-евич/-овна/-евна in any case)
  const full3Match = clean.match(
    /(?:^|[^\p{L}])(?<!ИП\s)([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ][а-яё]{2,25}\s+[А-ЯЁ][а-яё]{3,30}(?:ович[ауем]?|овичем|евич[ауем]?|евичем|ич[ауом]?|ичом|ичем|овн[аыеу]|овной|евн[аыеу]|евной|ичн[аыеу]|ичной))(?=$|[^\p{L}])/u
  );
  if (full3Match) {
    return normalizeRussianFioToNominative1C(full3Match[1], { obliqueContext: true });
  }

  return '';
}

function parseOptionalCorrespondenceAmount(fragment: string): number | undefined {
  const m = fragment.match(
    /(?:—|-|:|=|на\s+сумму|сумма)\s*(\d{1,3}(?:[\s\u00A0]\d{3})+(?:[.,]\d{1,2})?|\d{3,}(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)?/iu
  );
  if (!m) return undefined;
  const val = Number(m[1].replace(/[\s\u00A0]/g, '').replace(',', '.'));
  return Number.isFinite(val) && val > 0 ? Math.round((val + Number.EPSILON) * 100) / 100 : undefined;
}

/**
 * Invariant 3: Extracts explicit accounting correspondences written directly in operation text:
 * - `Дт 91.02 Кт 76.09`
 * - `Д 75.01 К 80.09`
 * - `Дебет 26 Кредит 60.01`
 * - `проводка 94 - 10.01` / `корреспонденция 84.01 / 75.02`
 * - Single-sided off-balance entries: `Дт 001`, `Кт 001`, `Дт 002`, `Дт МЦ.04`
 * Normalizes group accounts (`10` -> `10.01`, `01` -> `01.01`, `90.01` -> `90.01.1`, etc.) to 1C:BP 3.0 leaf subaccounts.
 */
export function extractExplicitCorrespondencesFromText1C(
  text: string
): ExplicitCorrespondenceHint1C[] {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return [];

  const results: ExplicitCorrespondenceHint1C[] = [];
  const acctPattern = '(?:МЦ(?:\\.0[234])?|00\\d(?:\\.\\d{1,2})?|\\d{2}(?:\\.[0-9А-ЯЁA-Z]{1,3}){0,2})';

  // 1. Explicit Debit + Credit pair: Дт X Кт Y / Д X К Y / Дебет X Кредит Y / Д-т X К-т Y
  const pairRegex = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:дебет|д-?т|д)\\s*:?\\s*(?:сч\\.?\\s*)?(${acctPattern})\\s*[,;/—–-]?\\s*(?:кредит|к-?т|к)\\s*:?\\s*(?:сч\\.?\\s*)?(${acctPattern})([^;\\n]{0,45})`,
    'giu'
  );

  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(clean)) !== null) {
    const rawDr = m[1].toUpperCase();
    const rawCr = m[2].toUpperCase();
    const tail = m[3] || '';
    const prefixStart = Math.max(0, m.index - 32);
    const prefix = clean.slice(prefixStart, m.index);
    const debit = normalizeAccountToLeaf1C(rawDr, 'debit', clean);
    const credit = normalizeAccountToLeaf1C(rawCr, 'credit', clean);
    if (debit && credit) {
      const isOff =
        /^00\d|^МЦ/i.test(debit) || /^00\d|^МЦ/i.test(credit);
      results.push({
        debit,
        credit,
        amount:
          parseOptionalCorrespondenceAmount(tail) ??
          parseOptionalCorrespondenceAmount(prefix),
        isOffBalance: isOff,
        rawMatch: m[0].trim(),
      });
    }
  }

  if (results.length > 0) return results;

  // 2. "проводка X - Y" / "корреспонденция счетов X и Y"
  const provodkaRegex = new RegExp(
    `(?:проводк\\p{L}*|корреспонденци\\p{L}*(?:\\s+счетов)?)\\s*:?\\s*(${acctPattern})\\s*(?:—|–|-|/|и)\\s*(${acctPattern})`,
    'giu'
  );
  while ((m = provodkaRegex.exec(clean)) !== null) {
    const debit = normalizeAccountToLeaf1C(m[1].toUpperCase(), 'debit', clean);
    const credit = normalizeAccountToLeaf1C(m[2].toUpperCase(), 'credit', clean);
    if (debit && credit) {
      results.push({
        debit,
        credit,
        isOffBalance: /^00\d|^МЦ/i.test(debit) || /^00\d|^МЦ/i.test(credit),
        rawMatch: m[0].trim(),
      });
    }
  }

  if (results.length > 0) return results;

  // 3. Single-sided off-balance entries ("принято на забалансовый счет 001", "Дт 001", "Кт 002")
  const offDrMatch = clean.match(
    /(?:дебет|д-?т|(?:принят|оприходован|учтен|поставлен)\p{L}*\s+(?:на\s+)?(?:забалансов\p{L}*\s+)?сч[её]т\p{L}*)\s*(00[1-9](?:\.\d{1,2})?|МЦ(?:\.0[234])?)\b/iu
  );
  if (offDrMatch) {
    const acc = normalizeAccountToLeaf1C(offDrMatch[1].toUpperCase(), 'debit', clean);
    results.push({
      debit: acc,
      credit: '',
      isOffBalance: true,
      rawMatch: offDrMatch[0].trim(),
    });
    return results;
  }

  const offCrMatch = clean.match(
    /(?:кредит|к-?т|(?:списан|возвращ[её]н|снят)\p{L}*\s+с\s+(?:забалансов\p{L}*\s+)?сч[её]т\p{L}*)\s*(00[1-9](?:\.\d{1,2})?|МЦ(?:\.0[234])?)\b/iu
  );
  if (offCrMatch) {
    const acc = normalizeAccountToLeaf1C(offCrMatch[1].toUpperCase(), 'credit', clean);
    results.push({
      debit: '',
      credit: acc,
      isOffBalance: true,
      rawMatch: offCrMatch[0].trim(),
    });
  }

  return results;
}

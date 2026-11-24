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
 * Normalizes employee / founder / accountable person display name to canonical nominative 1C form.
 * Handles role-based placeholders like "Главный бухгалтер (ФИО студента)", "Главному бухгалтеру",
 * "Гланому бухгалтеру" -> "Главный бухгалтер", as well as oblique Russian FIOs ("Сидорова С.С." -> "Сидоров С.С.").
 */
export function normalizeEmployeeOrFounderName1C(
  raw: string,
  options?: { obliqueContext?: boolean; genderHint?: 'M' | 'F' }
): string {
  const cleaned = (raw ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\(\s*фио\s+студента\s*\)/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  if (/(?:^|\s)(?:главн\p{L}*|глан\p{L}*)\s+бухгалтер\p{L}*$/iu.test(cleaned)) {
    return 'Главный бухгалтер';
  }

  // Strip leading job title or preposition if accidentally included ("ген.директор Федоров Ф.Ф.", "через Федорова Ф.Ф.", "каменщику Фадееву Ф.Ф.")
  const strippedRole = cleaned.replace(
    /^(?:через|от|у|для|сотрудник\p{L}*|работник\p{L}*|ген\.?\s*директор\p{L}*|генеральн\p{L}*\s+директор\p{L}*|главн\p{L}*\s+бухгалтер\p{L}*|директор\p{L}*|бухгалтер\p{L}*|каменщик\p{L}*|менеджер\p{L}*|инженер\p{L}*|кладовщик\p{L}*|кассир\p{L}*|водител\p{L}*|учредител\p{L}*|участник\p{L}*)\s+/iu,
    ''
  );

  return normalizeRussianFioToNominative1C(strippedRole, options);
}

/**
 * Extracts person FIO in any Russian grammatical case when anchored by accounting context
 * (accountable person, employee, founder, shareholder, writ debtor, material custodian, etc.).
 */
export function extractPersonFioFromText1C(text: string): string {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return '';

  const isCharterDeclaration =
    /(?:сформирован|образован|зарегистрирован)\p{L}*\s+уставн\p{L}*\s+капитал/iu.test(clean);
  if (isCharterDeclaration) {
    // Multi-founder charter capital declaration should not Collapse to a single employeeName
    return '';
  }

  // 1. Explicit "через <FIO>" (e.g. "через Федорова Ф.Ф." in accountable material purchase)
  const throughMatch = clean.match(
    /(?:^|[^\p{L}])через\s+(?:подотч[её]тн\p{L}*\s+лиц\p{L}*\s+|сотрудник\p{L}*\s+)?([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/iu
  );
  if (throughMatch) {
    return normalizeRussianFioToNominative1C(throughMatch[1], { obliqueContext: true });
  }

  // 2. Instrumental / Genitive / Dative with initials: "ген.директор Федоров Ф.Ф.", "каменщику Фадееву Ф.Ф.", "от Сидорова С.С."
  const anchoredInit = clean.match(
    /(?:сотрудник\p{L}*|работник\p{L}*|подотч[её]тн\p{L}*\s+лиц\p{L}*|учредител\p{L}*|участник\p{L}*|акционер\p{L}*|(?:ген\.?\s*|генеральн\p{L}*\s+)?директор\p{L}*|(?:главн\p{L}*\s+)?бухгалтер\p{L}*|каменщик\p{L}*|менеджер\p{L}*|инженер\p{L}*|мастер\p{L}*|слесар\p{L}*|сварщик\p{L}*|водител\p{L}*|кладовщик\p{L}*|кассир\p{L}*|выда(?:но|н[аы]?|ли)|перечислен\p{L}*|возвращ[её]н\p{L}*|внес[её]н\p{L}*|поступил\p{L}*|авансов\p{L}*\s+отч[её]т(?:\s*№\s*\S+)?|принят\p{L}*\s+на\s+работу|переведен\p{L}*|доля|вклад(?:\s+в\s+УК)?(?:\s+от)?|от)\s+(?:в\s+кассу\s+|на\s+р\/с\s+|третьего\s+лица\s*[-—–]?\s*(?:генерального\s+директора\s+|ген\.?\s*директора\s+)?)?([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/iu
  );
  if (anchoredInit) {
    const isHireNominative =
      /принят\p{L}*\s+на\s+работу/iu.test(anchoredInit[0]) &&
      !/(?:от|выда|перечисл|через|доля|вклад\s+от|лица)/iu.test(anchoredInit[0]);
    return normalizeRussianFioToNominative1C(anchoredInit[1], {
      obliqueContext: !isHireNominative,
    });
  }

  // 3. Any standalone Surname + I.O. in sentence (excluding ИП which is a counterparty)
  const allInitials = Array.from(
    clean.matchAll(/(?:^|[^\p{L}])(?<!ИП\s)([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/gu)
  );
  if (allInitials.length > 0) {
    const cand = allInitials[0][1].trim();
    const isOblique =
      /(?:выда|перечисл|авансов|подотчет|под\s+отчет|возврат|возвращ|удерж|взыск|доля|вклад|дивиденд|учредител|через\s+|от\s+|пользу)/iu.test(
        clean
      ) && !/^([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)\s+(?:переведен|принят|свою\s+долю|принес|уволен)/u.test(clean);
    return normalizeRussianFioToNominative1C(cand, { obliqueContext: isOblique });
  }

  // 4. Full 3-word Russian FIO with patronymic (-ович/-евич/-овна/-евна in any case)
  const full3Match = clean.match(
    /(?:^|[^\p{L}])(?<!ИП\s)([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ][а-яё]{2,25}\s+[А-ЯЁ][а-яё]{3,30}(?:ович[ауем]?|овичем|евич[ауем]?|евичем|ич[ауом]?|ичом|ичем|овн[аыеу]|овной|евн[аыеу]|евной|ичн[аыеу]|ичной))(?=$|[^\p{L}])/u
  );
  if (full3Match) {
    return normalizeRussianFioToNominative1C(full3Match[1], { obliqueContext: true });
  }

  // 5. Role-based Chief Accountant employee ("Принят на работу Главный бухгалтер (ФИО студента)",
  // "Главный бухгалтер принес уведомление...", "в подотчет Главному бухгалтеру" / "Гланому бухгалтеру")
  if (/(?:^|[^\p{L}])(?:главн\p{L}*|глан\p{L}*)\s+бухгалтер\p{L}*(?=$|[^\p{L}])/iu.test(clean)) {
    return 'Главный бухгалтер';
  }

  return '';
}

/**
 * Extracts Fixed Asset / Intangible Useful Life (СПИ) in months:
 * - "СПИ 6 лет 11 мес." -> 83
 * - "(СПИ 72 мес = 6 лет = 4 амортиз.группа)" -> 72
 * - "(СПИ 6 лет)" -> 72
 */
export function extractUsefulLifeMonths1C(text: string): number | undefined {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  if (!clean) return undefined;

  // 1. Combined "X лет Y мес" (without '=' between them)
  const yearsAndMonths = clean.match(
    /(?:спи|срок\p{L}*\s+полезн\p{L}*\s+использован\p{L}*)?[^.;=\n]{0,20}?(\d{1,2})\s*(?:лет|год[ао]?)\s*(?:и\s*)?(\d{1,2})\s*мес/iu
  );
  if (yearsAndMonths) {
    const yrs = Number(yearsAndMonths[1]);
    const mos = Number(yearsAndMonths[2]);
    if (yrs > 0 && yrs <= 50 && mos >= 0 && mos < 12) {
      return yrs * 12 + mos;
    }
  }

  // 2. Explicit months right after СПИ / срок полезного использования: "СПИ 72 мес = 6 лет"
  const monthsFirst = clean.match(
    /(?:спи|срок\p{L}*\s+полезн\p{L}*\s+использован\p{L}*)\s*[:=-]?\s*(\d{1,3})\s*мес/iu
  );
  if (monthsFirst) {
    const mos = Number(monthsFirst[1]);
    if (mos > 0 && mos <= 600) return mos;
  }

  // 3. Explicit years after СПИ / срок полезного использования: "СПИ 6 лет"
  const yearsOnly = clean.match(
    /(?:спи|срок\p{L}*\s+полезн\p{L}*\s+использован\p{L}*)\s*[:=-]?\s*(\d{1,2})\s*(?:лет|год[ао]?)(?=$|[^\p{L}])/iu
  );
  if (yearsOnly) {
    const yrs = Number(yearsOnly[1]);
    if (yrs > 0 && yrs <= 50) return yrs * 12;
  }

  // 4. Fallback standalone "X мес" inside СПИ parentheses
  const fallbackMos = clean.match(/\(\s*[^)]*?(\d{2,3})\s*мес[^)]*\)/iu);
  if (fallbackMos && /спи|амортиз/iu.test(fallbackMos[0])) {
    const mos = Number(fallbackMos[1]);
    if (mos >= 12 && mos <= 600) return mos;
  }

  return undefined;
}

export interface ExtractedCharterCapitalInfo1C {
  ownOrganization?: {
    name: string;
    inn: string;
    kpp?: string;
  };
  founders: Array<{
    founderName: string;
    sharePercent?: number;
    amount?: number;
  }>;
}

/**
 * Parses Charter Capital formation / increase descriptions:
 * - "#1 Сформирован Уставный капитал ООО "Завод" (ИНН 7810119529, КПП 781001001) - Иванов И.И. 30%, Сидоров С.С. 70%"
 * - "Q3 #60 Увеличен уставный капитал за счет вклада третьего лица - генерального директора Федорова Ф.Ф."
 */
export function extractCharterCapitalInfo1C(
  text: string,
  totalAmount?: number
): ExtractedCharterCapitalInfo1C {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  const result: ExtractedCharterCapitalInfo1C = { founders: [] };
  if (!clean) return result;

  // Own organization in charter capital declaration
  if (/(?:сформирован|образован|зарегистрирован|увеличен)\p{L}*\s+уставн\p{L}*\s+капитал/iu.test(clean)) {
    const orgMatch = clean.match(
      /уставн\p{L}*\s+капитал\s+((?:ООО|АО|ПАО|ЗАО|ОАО)\s*[«"'„“][^»"'”]{2,80}[»"'”])/iu
    );
    if (orgMatch) {
      const orgName = normalizeLegalEntityName1C(orgMatch[1]);
      const innMatch = clean.match(/ИНН\s*(\d{10}|\d{12})/iu);
      const kppMatch = clean.match(/КПП\s*(\d{9})/iu);
      result.ownOrganization = {
        name: orgName,
        inn: innMatch ? innMatch[1] : '',
        kpp: kppMatch ? kppMatch[1] : undefined,
      };
    }
  }

  // Founder percentage shares: "Иванов И.И. 30%, Сидоров С.С. 70%" or "Иванов И.И. - 30%"
  const pctRegex =
    /([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)\s*[-—–:]?\s*(\d{1,3}(?:[.,]\d{1,4})?)\s*%/gu;
  let m: RegExpExecArray | null;
  while ((m = pctRegex.exec(clean)) !== null) {
    const founderName = normalizeRussianFioToNominative1C(m[1], { obliqueContext: false });
    const pct = Number(m[2].replace(',', '.'));
    if (founderName && Number.isFinite(pct) && pct > 0) {
      const amt =
        totalAmount && totalAmount > 0
          ? Math.round((totalAmount * (pct / 100) + Number.EPSILON) * 100) / 100
          : undefined;
      result.founders.push({
        founderName,
        sharePercent: pct,
        amount: amt,
      });
    }
  }

  if (result.founders.length > 0) {
    // Reconcile rounding penny on last founder if percentages sum to 100%
    const pctSum = result.founders.reduce((s, f) => s + (f.sharePercent ?? 0), 0);
    if (totalAmount && totalAmount > 0 && Math.abs(pctSum - 100) < 0.01 && result.founders.length >= 2) {
      const allocatedExceptLast = result.founders
        .slice(0, -1)
        .reduce((s, f) => s + (f.amount ?? 0), 0);
      result.founders[result.founders.length - 1].amount =
        Math.round((totalAmount - allocatedExceptLast + Number.EPSILON) * 100) / 100;
    }
    return result;
  }

  // Single founder charter capital increase ("за счет вклада третьего лица - генерального директора Федорова Ф.Ф.")
  if (/уставн\p{L}*\s+капитал/iu.test(clean)) {
    const singleMatch = clean.match(
      /(?:вклад\p{L}*|доли|участник\p{L}*|учредител\p{L}*|директор\p{L}*|лиц\p{L}*)[^.;\n]{0,45}?([А-ЯЁ][а-яё-]{2,30}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/iu
    );
    if (singleMatch) {
      const founderName = normalizeRussianFioToNominative1C(singleMatch[1], {
        obliqueContext: true,
      });
      result.founders.push({
        founderName,
        sharePercent: 100,
        amount: totalAmount && totalAmount > 0 ? totalAmount : undefined,
      });
    }
  }

  return result;
}

export interface ExtractedEmployeeTaxInfo1C {
  childCount?: number;
  isSingleParent?: boolean;
  propertyTaxDeduction?: number;
}

/**
 * Extracts standard child tax deductions (ст. 218 НК РФ) and property tax deduction notice (ст. 220 НК РФ):
 * - "(3 детей до 18 лет)", "(трое детей до 18 лет)" -> childCount: 3
 * - "(одинокий родитель с двумя детьми до 18 лет)" -> childCount: 2, isSingleParent: true
 * - "уведомление ... на имущественный налоговый вычет в размере 2 000 000 руб." -> propertyTaxDeduction: 2_000_000
 */
export function extractEmployeeTaxDeductions1C(text: string): ExtractedEmployeeTaxInfo1C {
  const clean = (text ?? '').replace(/\u00A0/g, ' ').trim();
  const res: ExtractedEmployeeTaxInfo1C = {};
  if (!clean) return res;

  if (/одинок\p{L}*\s+родител|единственн\p{L}*\s+родител/iu.test(clean)) {
    res.isSingleParent = true;
  }

  const digitChild = clean.match(/(\d)\s*(?:дет\p{L}*|реб[её]нк\p{L}*)/iu);
  if (digitChild) {
    res.childCount = Number(digitChild[1]);
  } else if (/(?:трое|троих|трех|трёх)\s+дет/iu.test(clean)) {
    res.childCount = 3;
  } else if (/(?:двое|двоих|двух|двумя)\s+дет/iu.test(clean)) {
    res.childCount = 2;
  } else if (/(?:один|одного|одним)\s+реб[её]н/iu.test(clean)) {
    res.childCount = 1;
  } else if (/(?:четверо|четверых|четырех|четырёх)\s+дет/iu.test(clean)) {
    res.childCount = 4;
  }

  if (/имущественн\p{L}*\s+(?:налогов\p{L}*\s+)?вычет/iu.test(clean)) {
    const dedMatch = clean.match(
      /вычет\p{L}*[^.;\n]{0,40}?(\d{1,3}(?:[\s]\d{3})+(?:[.,]\d{1,2})?|\d{5,9})/iu
    );
    if (dedMatch) {
      const val = Number(dedMatch[1].replace(/\s+/g, '').replace(',', '.'));
      if (Number.isFinite(val) && val > 0) {
        res.propertyTaxDeduction = val;
      }
    }
  }

  return res;
}

const BANNED_GENERIC_NOMENCLATURE_RE =
  /^(?:материал[ыа]?|материл[ыа]?|сырь[её](?:\s+и\s+материалы)?|товар[ыа]?|продукци[яюи]|готов\p{L}*\s+продукци[яюи]|услуг[иа]|работ[ыа]|тмц|мпз|номенклатур[аы]|объект\s+ос|основн(?:ое|ые)\s+средств[оа]|оборудовани[ея]|инвентарь|(?:предоплат|аванс|доплат|оплат|плат[её]ж|перечислен)\p{L}*(?:\s+.*)?|на\s+основани\p{L}*(?:\s+.*)?|кредит\p{L}*(?:\s+в\s+банк\p{L}*)?(?:\s+.*)?|(?:процент\p{L}*|%%)\s+(?:по|за)\s+.*|задолженност\p{L}*\s+по\s+.*|долговы[ех]\s+ценн\p{L}*\s+бумаг\p{L}*)$/iu;

export function isGenericPlaceholderNomenclature1C(rawName?: string): boolean {
  const s = (rawName ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return true;
  return BANNED_GENERIC_NOMENCLATURE_RE.test(s);
}

/**
 * Cleans nomenclature names extracted from operation descriptions so person names,
 * quantities, prices, prepositional tails, and generic placeholders ("Материлы", "Продукция", "Товары")
 * never leak into `Справочник.Номенклатура`.
 */
export function cleanNomenclatureName1C(rawName: string, descriptionContext?: string): string {
  let s = (rawName ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

  // Reject pure person phrases ("Через Федорова Ф.Ф.", "Федоров Ф.Ф.") or clipped fragments ("...я третьих лиц")
  if (/^через\s+/iu.test(s) || /^\.{2,}|третьих\s+лиц/iu.test(s)) {
    s = '';
  }

  // Strip leading passive verbs FIRST ("Получены от ООО ...", "и оплачен экскаватор-погрузчик", "приобретен принтер", "поставлена продукция 284 шт")
  s = s
    .replace(
      /^(?:и\s+)?(?:оплачен|оплатил|приобретен|приобрел|получен|получил|поступил|введен|передан|поставлен|отгружен|реализован|купил|закуплен)\p{L}*(?:\s+и\s+(?:оплачен|оплатил|приобретен|приобрел|получен|получил|поступил)\p{L}*)?\s+/iu,
      ''
    )
    .replace(
      /^(?:готов\p{L}*\s+|собственн\p{L}*\s+)?продукци[яюи]\s+(?:в\s+(?:кол-ве|количестве)\s+)?(?:\d+(?:[.,]\d+)?\s*(?:шт|штук|ед|кг|т|м2|м3|п\.?\s*м|компл)\.?\s+)?/iu,
      ''
    )
    .trim();

  // Strip leading counterparty source clauses ("От ООО 'Строймаркет' (7806...) на основании ... - ", "От ООО 'Сбыт' поступили ...")
  s = s
    .replace(
      /^(?:от|у|в|из)\s+(?:(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП)\s*[«"'„“”]?[^»"'”:\n(]{2,55}[»"'”]?|ИП\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?)\s*(?:\([^)]*\)\s*)?(?:по\s+дог[^,;:\n-]*\s*)?(?:на\s+основани\p{L}*\s+[^-—–:\n]+[-—–:]\s*)?(?:(?:и\s+)?(?:поступил|получен|принят|приобретен|оплачен)\p{L}*(?:\s+и\s+(?:оплачен|получен|поступил)\p{L}*)?\s*)?:?\s*/iu,
      ''
    )
    .replace(/^на\s+основани\p{L}*\s+[^-—–:\n]+[-—–:]\s*/iu, '')
    .trim();

  // Reject residual counterparty-only strings ("От ООО ...", "ООО ...") or multi-item price lists ("обои 400 м по цене..., клей...")
  if (
    /^(?:(?:от|у|в|из|для)\s+)?(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ИП)(?=$|[^\p{L}])/iu.test(s) ||
    /,.*(?:^|[^\p{L}])по\s+цене(?=$|[^\p{L}])/iu.test(s)
  ) {
    s = '';
  }

  // If rawName is empty or generic placeholder ("Материалы", "Материлы", "Продукция", "Товары", etc.), try extracting concrete item from descriptionContext
  if (descriptionContext && (!s || isGenericPlaceholderNomenclature1C(s))) {
    const ctx = descriptionContext.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    const isMaterialWriteoffCtx = /передан\p{L}*\s+матери[а]?л\p{L}*\s+в\s+производств/iu.test(ctx);
    if (!isMaterialWriteoffCtx && /панел\p{L}*\s+из\s+пвх\s+и\s+мдф/iu.test(ctx)) {
      s = 'Панель из ПВХ и МДФ';
    } else if (/плит[аыу]?\s+пвх/iu.test(ctx) && !/панел/iu.test(ctx)) {
      s = 'Плита ПВХ';
    } else if (/(?:заготовк[ауи]?|заготовок)\s+мдф/iu.test(ctx) && !/панел/iu.test(ctx)) {
      s = 'Заготовка МДФ';
    } else if (/оконн(?:ый|ые|ого|ых)\s+блок/iu.test(ctx)) {
      s = 'Оконный блок';
    } else if (/потолочн\p{L}*\s+плит/iu.test(ctx)) {
      s = 'Потолочные плиты';
    } else if (/паркет/iu.test(ctx)) {
      s = 'Паркет';
    } else if (/строительн\p{L}*\s+материал|(?:(?:^|[^\p{L}])обои(?=$|[^\p{L}]).*краск)/iu.test(ctx)) {
      s = 'Строительные материалы';
    } else if (/экскаватор[ау]?-погрузчик/iu.test(ctx)) {
      s = 'Экскаватор-погрузчик';
    } else if (/вагон-бытовк|вагон\s+бытовк/iu.test(ctx)) {
      s = 'Вагон-бытовка';
    } else if (/спецодежд|рабоч\p{L}*\s+одежд/iu.test(ctx)) {
      s = 'Спецодежда';
    } else if (/(?:^|[^\p{L}])кирпич[ау]?(?=$|[^\p{L}])/iu.test(ctx) && !/строительн\p{L}*\s+раствор/iu.test(ctx)) {
      s = 'Кирпич';
    } else if (/(?:^|[^\p{L}])цемент[ау]?(?=$|[^\p{L}])/iu.test(ctx) && !/доставк\p{L}*\s+цемент/iu.test(ctx)) {
      s = 'Цемент';
    } else if (/(?:^|[^\p{L}])принтер[ау]?(?=$|[^\p{L}])/iu.test(ctx) && !/плат[её]ж\s+за\s+принтер/iu.test(ctx)) {
      s = 'Принтер';
    } else if (/(?:^|[^\p{L}])плоттер[ау]?(?=$|[^\p{L}])/iu.test(ctx)) {
      s = 'Плоттер';
    } else if (/(?:^|[^\p{L}])минитрактор[ау]?(?=$|[^\p{L}])/iu.test(ctx)) {
      s = 'Минитрактор';
    } else {
      const dashItemMatch = ctx.match(
        /[-—–:]\s*([А-ЯЁа-яё][А-ЯЁа-яё0-9\s-]{2,40}?)(?=\s+\d+(?:[.,]\d+)?\s*(?:шт|штук|ед|кг|т|л|м|м2|м3|бан|уп|рул|компл))/u
      );
      const prodAfterMatch = ctx.match(
        /продукци[яюи]\s+(?:в\s+(?:кол-ве|количестве)\s+)?(?:\d+(?:[.,]\d+)?\s*(?:шт|штук|ед)\.?\s+)?([А-ЯЁ][А-ЯЁа-яё0-9\s-]{3,50}?)(?=\s+(?:по\s+цене|вкл\.?\s*ндс|с\s+ндс|без\s+ндс|в\s+кол-ве|в\s+количестве)|[.,;]|$)/u
      );
      if (dashItemMatch?.[1] && !isGenericPlaceholderNomenclature1C(dashItemMatch[1])) {
        s = dashItemMatch[1].trim();
      } else if (prodAfterMatch?.[1] && !isGenericPlaceholderNomenclature1C(prodAfterMatch[1])) {
        s = prodAfterMatch[1].trim();
      }
    }
  }

  if (!s) return '';

  // Strip trailing prepositional/person/quantity/price/document/enumeration clauses
  s = s
    .replace(/\s+через\s+[А-ЯЁа-яё.\s-]+$/iu, '')
    .replace(/\s+(?:каменщик\p{L}*|сотрудник\p{L}*|работник\p{L}*)\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?.*$/iu, '')
    .replace(/\s*\(\s*(?:материал\p{L}*|товар\p{L}*|ос|основн\p{L}*\s+средств\p{L}*|спи\s+[^)]+|\d+\s*(?:шт|ед|кг|т|м2|м3|п\.м|компл)[^)]*)\s*\)/giu, '')
    .replace(/\s+на\s+основани\p{L}*\s+(?:счет|накладн|акт|упд|договор).*$/iu, '')
    .replace(/\s+в\s+(?:количеств[еа]|кол-ве)\s+\d+.*$/iu, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:шт|штук|ед|кг|т|тонн|м2|м3|п\.?\s*м|компл)\.?(?=$|[^\p{L}]).*$/iu, '')
    .replace(/\s+по\s+(?:цене\s+)?(?:\d+|вкл\.?\s*ндс|с\s+ндс|без\s+ндс).*$/iu, '')
    .replace(/\s+(?:в|у|от|для)\s+(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)(?=$|[^\p{L}]).*$/iu, '')
    .replace(/\s+для\s+(?:производств|бухгалтери|офис|каменщик|сотрудник|работник|сдач)\p{L}*.*$/iu, '')
    .replace(/\s+(?:с\s+ндс|в\s+т\.?\s*ч\.?\s*ндс|вкл\.?\s*ндс|без\s+ндс).*$/iu, '')
    .replace(/:\s*.*$/u, '')
    .replace(/^[«"'„“(]+|[»"'”.,;)]+$/g, '')
    .trim();

  if (/^(?:(?:от|у|в|из|для)\s+)?(?:ООО|АО|ПАО|ЗАО|ОАО|НАО|ГУП|МУП|ИП)(?=$|[^\p{L}])/iu.test(s)) {
    return '';
  }

  if (!s || isGenericPlaceholderNomenclature1C(s)) return '';

  // Canonical singular/nominative forms for common inflected Russian nouns in coursework descriptions
  if (/^(?:заготовк[ауи]?|заготовок)\s+мдф$/iu.test(s)) return 'Заготовка МДФ';
  if (/^плит[аыу]?\s+пвх$/iu.test(s)) return 'Плита ПВХ';
  if (/^кле[йяю]$/iu.test(s)) return 'Клей';
  if (/^потолочн\p{L}*\s+плит[аыу]?$/iu.test(s)) return 'Потолочные плиты';
  if (/^строительн\p{L}*\s+материал\p{L}*$/iu.test(s)) return 'Строительные материалы';
  if (/^панел[ьией]?\s+из\s+пвх\s+и\s+мдф$/iu.test(s)) return 'Панель из ПВХ и МДФ';
  if (/^оконн(?:ый|ые|ого|ых)\s+блок[аи]?$/iu.test(s)) return 'Оконный блок';
  if (/^(?:\d+\s+)?вагон-бытовк[аиу]|вагон-бытовок$/iu.test(s)) return 'Вагон-бытовка';
  if (/^экскаватор[ау]?-погрузчик[ау]?$/iu.test(s)) return 'Экскаватор-погрузчик';
  if (/^спецодежд[аыу]$|^рабоч\p{L}*\s+одежд\p{L}*(?:\s+[«"'„“][^»"'”]+[»"'”])?$/iu.test(s)) return 'Спецодежда';
  if (/^кирпич[ау]?$/iu.test(s)) return 'Кирпич';
  if (/^цемент[ау]?$/iu.test(s)) return 'Цемент';
  if (/^принтер[ау]?$/iu.test(s)) return 'Принтер';
  if (/^плоттер[ау]?$/iu.test(s)) return 'Плоттер';
  if (/^минитрактор[ау]?$/iu.test(s)) return 'Минитрактор';
  if (/^бумаг[аиу]$/iu.test(s)) return 'Бумага';
  if (/^лес[ао]\s+строительн\p{L}*$/iu.test(s)) return 'Леса строительные';
  if (/^доск[аиу]$/iu.test(s)) return 'Доски';
  if (/^керамогранитн(?:ые|ая)\s+плит[аыу]$/iu.test(s)) return 'Керамогранитные плиты';

  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extracts concrete multi-item material lists from parenthesized or colon-delimited enumerations,
 * e.g. `(плита ПВХ 284 шт, заготовка МДФ 284 шт, клей 284 шт.)` ->
 * `[{ cleanName: 'Плита ПВХ', quantity: 284, unit: 'шт', account: '10.01' }, ...]`.
 */
export function extractMultipleWriteoffItemsFromText1C(
  rawText?: string
): Array<{
  cleanName: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  account: '10.01' | '10.03' | '10.08' | '10.09' | '10.10';
}> {
  const t = (rawText ?? '').replace(/\u00A0/g, ' ').trim();
  if (!t) return [];

  const parenBlocks = [...t.matchAll(/\(([^()]{8,400})\)/g)].map((m) => m[1]);
  const colonIdx = t.indexOf(':');
  const candidateSources =
    parenBlocks.length > 0
      ? parenBlocks
      : colonIdx >= 0 && colonIdx < t.length - 8
        ? [t.slice(colonIdx + 1)]
        : [];

  for (const block of candidateSources) {
    if (!block.includes(',') && !block.includes(';')) continue;
    const parts = block
      .split(/[,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;

    const parsedItems: Array<{
      cleanName: string;
      quantity?: number;
      unit?: string;
      unitPrice?: number;
      account: '10.01' | '10.03' | '10.08' | '10.09' | '10.10';
    }> = [];
    const seen = new Set<string>();

    for (const part of parts) {
      if (/\d\s*%|инн|кпп|бик|оклад|детей|алимент/iu.test(part)) continue;
      const qtyUnitM = part.match(
        /(\d+(?:[.,]\d+)?)\s*(шт|штук|ед|кг|т|тонн|л|м2|м3|кв\.?\s*м|куб\.?\s*м|п\.?\s*м|м|рулон\p{L}*|уп\p{L}*|компл\p{L}*)\.?(?=$|[^\p{L}])/iu
      );
      const priceM = part.match(
        /по\s+(?:цене\s+)?(\d+(?:[\s]\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб|р\.?)?/iu
      );
      const rawItemHead = qtyUnitM ? part.slice(0, qtyUnitM.index).trim() : part;
      const cleaned = cleanNomenclatureName1C(rawItemHead);
      if (!cleaned || isGenericPlaceholderNomenclature1C(cleaned)) continue;

      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const qty = qtyUnitM ? Number(qtyUnitM[1].replace(',', '.')) : undefined;
      const unitRaw = qtyUnitM?.[2]?.toLowerCase() ?? 'шт';
      const unit = unitRaw.startsWith('штук') ? 'шт' : unitRaw;
      const unitPrice = priceM
        ? Number(priceM[1].replace(/\s+/g, '').replace(',', '.'))
        : undefined;

      const lowName = cleaned.toLowerCase();
      const account: '10.01' | '10.03' | '10.08' | '10.09' | '10.10' =
        /спецодежд|каск|перчатк/iu.test(lowName)
          ? '10.10'
          : /принтер|бумаг|канц|инвентар/iu.test(lowName)
            ? '10.09'
            : /бензин|дизель|гсм|топлив/iu.test(lowName)
              ? '10.03'
              : /кирпич|цемент|бетон|щебн|песок|арматур|обои|краск|плитк|шпаклев|штукатур|сух\p{L}*\s+смес/iu.test(
                    lowName
                  )
                ? '10.08'
                : '10.01';

      parsedItems.push({
        cleanName: cleaned,
        quantity: qty && Number.isFinite(qty) && qty > 0 ? qty : undefined,
        unit,
        unitPrice: unitPrice && Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : undefined,
        account,
      });
    }

    if (parsedItems.length >= 2) {
      return parsedItems;
    }
  }

  return [];
}

export interface ExtractedRpbScheduleTerms1C {
  termMonths: number;
  hasExplicitTerm: boolean;
  writeOffMethod: 'monthly' | 'calendar_days';
  startDate?: string;
  endDate?: string;
}

/**
 * Extracts exact RPB (`97.21`) term and write-off method from BOTH `description` and `actionSequenceHint`:
 * - Exact date range `с ДД.ММ.ГГГГ по ДД.ММ.ГГГГ` or explicit «по календарным дням» -> `writeOffMethod: 'calendar_days'`
 * - Otherwise (`32 мес.`, `24 мес.`, `2 года 8 мес.`, or default term) -> `writeOffMethod: 'monthly'` (equal monthly shares)
 * - Default term when not explicitly stated: `32` months for SRO entrance fee (`вступительный взнос в СРО`), `12` months for other RPB.
 */
export function extractRpbTermAndDates1C(
  description?: string,
  actionSequenceHint?: string
): ExtractedRpbScheduleTerms1C {
  const combined = `${description ?? ''} ${actionSequenceHint ?? ''}`
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const dateRangeMatch = combined.match(
    /(?:^|[^\p{L}])(?:с|на\s+период\s+с)\s*(\d{2})[./](\d{2})[./](\d{4})\s*(?:по|до|-|—)\s*(\d{2})[./](\d{2})[./](\d{4})/iu
  );
  const startDate = dateRangeMatch
    ? `${dateRangeMatch[3]}-${dateRangeMatch[2]}-${dateRangeMatch[1]}`
    : undefined;
  const endDate = dateRangeMatch
    ? `${dateRangeMatch[6]}-${dateRangeMatch[5]}-${dateRangeMatch[4]}`
    : undefined;

  const hasCalendarDaysPhrase = /календарн\p{L}*\s+дн/iu.test(combined);
  const hasEqualMonthlyPhrase =
    /равными\s+долями|по\s+месяцам|ежемесячно\s+равн/iu.test(combined);

  let explicitMonths: number | undefined;

  // 1) Combined years + optional months: "2 года 8 мес.", "2 г. и 8 месяцев", "на 3 года"
  const ymCombo = combined.match(
    /(?:срок\p{L}*|на\s+срок|на|в\s+течение|период\p{L}*\s+списани\p{L}*|=|\()\s*(\d{1,2})\s*(?:год[ао]?|лет|г\.)(?:\s*(?:и\s*)?(\d{1,2})\s*(?:мес\p{L}*|м\.))?/iu
  );
  if (ymCombo) {
    const yrs = Number(ymCombo[1]) || 0;
    const mos = ymCombo[2] ? Number(ymCombo[2]) || 0 : 0;
    const total = yrs * 12 + mos;
    if (total >= 1 && total <= 240) {
      explicitMonths = total;
    }
  }

  // 2) Direct months count: "32 мес.", "на 24 месяца", "в течение 32 месяцев", "срок списания 18 мес"
  if (!explicitMonths) {
    const mMatch = combined.match(
      /(?:срок\p{L}*(?:\s+списани\p{L}*|\s+полезн\p{L}*)?|на|в\s+течение|период\p{L}*|=|\(|—|-)\s*(\d{1,3})\s*(?:мес(?:яц\p{L}*|\.)?)(?=$|[^\p{L}])/iu
    ) || combined.match(/(?:^|[^\d])(\d{1,3})\s*(?:мес(?:яц\p{L}*|\.)?)(?=$|[^\p{L}])/iu);
    if (mMatch) {
      const mVal = Number(mMatch[1]);
      if (mVal >= 1 && mVal <= 240) {
        explicitMonths = mVal;
      }
    }
  }

  // 3) Month range "с 03.2026 по 10.2028"
  if (!explicitMonths && !dateRangeMatch) {
    const monthSpanM = combined.match(
      /(?:с|на\s+период\s+с)\s*(\d{2})[./](\d{4})\s*(?:по|до|-|—)\s*(\d{2})[./](\d{4})/iu
    );
    if (monthSpanM) {
      const m1 = Number(monthSpanM[1]);
      const y1 = Number(monthSpanM[2]);
      const m2 = Number(monthSpanM[3]);
      const y2 = Number(monthSpanM[4]);
      const span = (y2 - y1) * 12 + (m2 - m1) + 1;
      if (span >= 1 && span <= 240) {
        explicitMonths = span;
      }
    }
  }

  // 4) Derive approximate months from explicit DD.MM.YYYY..DD.MM.YYYY range if no month count stated
  if (!explicitMonths && startDate && endDate) {
    const sy = Number(startDate.slice(0, 4));
    const sm = Number(startDate.slice(5, 7));
    const ey = Number(endDate.slice(0, 4));
    const em = Number(endDate.slice(5, 7));
    const approxM = Math.max(1, (ey - sy) * 12 + (em - sm) + (endDate.slice(8, 10) >= startDate.slice(8, 10) ? 1 : 0));
    if (approxM >= 1 && approxM <= 240) {
      explicitMonths = approxM;
    }
  }

  const isSroEntrance = /вступительн\p{L}*\s+взнос.*(?:сро|саморегулируем)/iu.test(combined);
  const defaultMonths = isSroEntrance ? 32 : 12;
  const termMonths = explicitMonths ?? defaultMonths;

  const writeOffMethod: 'monthly' | 'calendar_days' = hasEqualMonthlyPhrase
    ? 'monthly'
    : hasCalendarDaysPhrase || Boolean(startDate && endDate)
      ? 'calendar_days'
      : 'monthly';

  return {
    termMonths,
    hasExplicitTerm: explicitMonths !== undefined,
    writeOffMethod,
    startDate,
    endDate,
  };
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

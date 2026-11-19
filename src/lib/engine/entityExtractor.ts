import {
  BusinessOperation,
  CounterpartyCard1C,
  EmployeeCard1C,
  ExtractedDirectories1C,
  NomenclatureCard1C,
  OpeningBalanceEntry,
} from '@/types/accounting';

const RUSSIAN_BANKS = [
  { bankName: 'ПАО Сбербанк', bik: '044525225', bankPrefix: '40702810438000' },
  { bankName: 'АО «Альфа-Банк»', bik: '044525593', bankPrefix: '40702810101300' },
  { bankName: 'Банк ВТБ (ПАО)', bik: '044525187', bankPrefix: '40702810700000' },
  { bankName: 'АО «ТБанк»', bik: '044525974', bankPrefix: '40702810910000' },
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/**
 * Generates a valid 10-digit Russian legal-entity INN with an authentic ФНС РФ control digit
 * so 1C:Бухгалтерия 8.3 accepts it without checksum warnings when pasted by the student.
 */
function generateValidRussianInn10(seed: number): string {
  const regions = ['78', '77', '50', '54', '66', '23', '16'];
  const region = regions[seed % regions.length];
  const inspectorate = String(10 + ((seed >>> 3) % 39)).padStart(2, '0');
  const serial = String(10000 + ((seed >>> 7) % 89999)).padStart(5, '0');
  const first9 = `${region}${inspectorate}${serial}`;
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(first9[i]) * weights[i];
  }
  const checkDigit = (sum % 11) % 10;
  return `${first9}${checkDigit}`;
}

function generateValidRussianInn12ForIp(seed: number): string {
  const first10 =
    '78' +
    String(15 + (seed % 30)).padStart(2, '0') +
    String(100000 + ((seed >>> 4) % 899999)).padStart(6, '0');
  const w11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const d11 =
    (w11.reduce((acc, w, idx) => acc + Number(first10[idx]) * w, 0) % 11) % 10;
  const first11 = `${first10}${d11}`;
  const w12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const d12 =
    (w12.reduce((acc, w, idx) => acc + Number(first11[idx]) * w, 0) % 11) % 10;
  return `${first11}${d12}`;
}

function expandFullLegalName(shortName: string): string {
  const trimmed = shortName.trim();
  if (/^ООО\s+/i.test(trimmed)) {
    return trimmed.replace(/^ООО\s+/i, 'Общество с ограниченной ответственностью ');
  }
  if (/^АО\s+/i.test(trimmed)) {
    return trimmed.replace(/^АО\s+/i, 'Акционерное общество ');
  }
  if (/^ПАО\s+/i.test(trimmed)) {
    return trimmed.replace(/^ПАО\s+/i, 'Публичное акционерное общество ');
  }
  if (/^ЗАО\s+/i.test(trimmed)) {
    return trimmed.replace(/^ЗАО\s+/i, 'Закрытое акционерное общество ');
  }
  if (/^ИП\s+/i.test(trimmed)) {
    return trimmed.replace(/^ИП\s+/i, 'Индивидуальный предприниматель ');
  }
  return trimmed;
}

function normalizeEntityKey(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIgnoredCounterpartyName(name: string): boolean {
  const norm = normalizeEntityKey(name);
  if (!norm || norm.length < 3) return true;
  return /^(налог\s*\(|бюджет|основной договор|поставщик|покупатель|сотрудники|работники|персонал|прочие|расчеты)/i.test(
    norm
  );
}

function parseContractDetails(
  rawContract?: string,
  fallbackDate = '01.04.2026'
): { contractNumber: string; contractDate: string } {
  if (!rawContract || !rawContract.trim()) {
    return { contractNumber: 'Основной договор', contractDate: fallbackDate };
  }
  const trimmed = rawContract.trim();
  const dateMatch = /от\s+(\d{1,2}\.\d{1,2}\.\d{4})/i.exec(trimmed);
  const contractDate = dateMatch ? dateMatch[1] : fallbackDate;

  const numPart = trimmed.replace(/\s*от\s+\d{1,2}\.\d{1,2}\.\d{4}.*$/i, '').trim();
  const contractNumber = /^(договор|счет|исполнительн|налогов)/i.test(numPart)
    ? numPart
    : numPart.startsWith('№')
      ? `Договор ${numPart}`
      : `Договор №${numPart}`;

  return { contractNumber, contractDate };
}

interface InlineRequisites {
  inn?: string;
  kpp?: string;
  bankAccount?: string;
  bik?: string;
}

function extractInlineRequisitesFromText(text: string): InlineRequisites {
  const innMatch = /ИНН\s*(\d{10}|\d{12})\b/i.exec(text);
  const kppMatch = /КПП\s*(\d{9})\b/i.exec(text);
  const rsMatch = /(?:р\/сч?|расч\.\s*счет)\s*(\d{20})\b/i.exec(text);
  const bikMatch = /БИК\s*(\d{9})\b/i.exec(text);
  return {
    inn: innMatch ? innMatch[1] : undefined,
    kpp: kppMatch ? kppMatch[1] : undefined,
    bankAccount: rsMatch ? rsMatch[1] : undefined,
    bik: bikMatch ? bikMatch[1] : undefined,
  };
}

function buildFallbackCounterpartyCard(
  name: string,
  contractKind: CounterpartyCard1C['contractKind'],
  rawContract: string | undefined,
  fallbackDate: string,
  inlineReq?: InlineRequisites
): CounterpartyCard1C {
  const cleanName = name.trim();
  const seed = hashString(normalizeEntityKey(cleanName));
  const isIp = /^ИП\s+/i.test(cleanName);
  const inn =
    inlineReq?.inn ||
    (isIp ? generateValidRussianInn12ForIp(seed) : generateValidRussianInn10(seed));
  const kpp =
    inlineReq?.kpp ??
    (isIp ? '' : `${inn.slice(0, 4)}01001`);
  const bank = RUSSIAN_BANKS[seed % RUSSIAN_BANKS.length];
  const bankTail = String(100000 + ((seed >>> 5) % 899999)).padStart(6, '0');
  const { contractNumber, contractDate } = parseContractDetails(rawContract, fallbackDate);

  const bankName =
    inlineReq?.bik === '044030001'
      ? 'СЕВЕРО-ЗАПАДНОЕ ГУ БАНКА РОССИИ // УФК по г. Санкт-Петербургу'
      : bank.bankName;

  return {
    id: `cp-auto-${seed}-${hashString(contractNumber) % 10000}`,
    name: cleanName,
    fullName: expandFullLegalName(cleanName),
    inn,
    kpp,
    bankAccount: inlineReq?.bankAccount || `${bank.bankPrefix}${bankTail}`,
    bankName,
    bik: inlineReq?.bik || bank.bik,
    contractKind,
    contractNumber,
    contractDate,
    createdIn1C: false,
  };
}

/**
 * Merges `baseDirectories` with 1C 8.3 reference cards auto-extracted from `operations`
 * and `openingBalances`, ensuring every Counterparty (with inline INN/KPP/BIK when present!),
 * Nomenclature item (Товары 41.01, Материалы 10.01, Услуги/Субподряд 20.01 & 26),
 * Nomenclature Group, Expense Item, Cash Flow Item, and Employee has copy-ready requisites.
 */
export function extractDirectoriesFromTask(
  operations: BusinessOperation[],
  openingBalances: OpeningBalanceEntry[],
  baseDirectories?: Partial<ExtractedDirectories1C>
): ExtractedDirectories1C {
  const counterparties: CounterpartyCard1C[] = (baseDirectories?.counterparties || []).map(
    (c) => ({ ...c })
  );
  const nomenclature: NomenclatureCard1C[] = (baseDirectories?.nomenclature || []).map(
    (n) => ({ ...n })
  );
  const employees: EmployeeCard1C[] = (baseDirectories?.employees || []).map((e) => ({
    ...e,
  }));

  const nomenclatureGroupSet = new Map<string, string>();
  const expenseItemSet = new Map<string, string>();
  const cashFlowItemSet = new Map<string, string>();

  const addUniqueString = (map: Map<string, string>, value?: string) => {
    const clean = (value || '').trim();
    if (!clean) return;
    const key = normalizeEntityKey(clean);
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, clean);
    }
  };

  (baseDirectories?.nomenclatureGroups || []).forEach((g) =>
    addUniqueString(nomenclatureGroupSet, g)
  );
  (baseDirectories?.expenseItems || []).forEach((e) =>
    addUniqueString(expenseItemSet, e)
  );
  (baseDirectories?.cashFlowItems || []).forEach((c) =>
    addUniqueString(cashFlowItemSet, c)
  );

  const upsertCounterparty = (
    rawName: string,
    kind: CounterpartyCard1C['contractKind'],
    rawContract?: string,
    opDate = '01.04.2026',
    inlineReq?: InlineRequisites
  ) => {
    const reqFromName = extractInlineRequisitesFromText(rawName || '');
    const mergedReq: InlineRequisites = {
      inn: inlineReq?.inn || reqFromName.inn,
      kpp: inlineReq?.kpp || reqFromName.kpp,
      bankAccount: inlineReq?.bankAccount || reqFromName.bankAccount,
      bik: inlineReq?.bik || reqFromName.bik,
    };
    const name = (rawName || '')
      .replace(/\s*\((?:ИНН|КПП|р\/сч?|БИК|договор)[^)]*\)\s*$/i, '')
      .trim();

    if (isIgnoredCounterpartyName(name)) return;
    const normName = normalizeEntityKey(name);
    const parsedContract = rawContract
      ? parseContractDetails(rawContract, opDate)
      : undefined;

    const sameCompanyCards = counterparties.filter(
      (c) => normalizeEntityKey(c.name) === normName
    );

    if (sameCompanyCards.length > 0) {
      if (mergedReq.inn) sameCompanyCards[0].inn = mergedReq.inn;
      if (mergedReq.kpp) sameCompanyCards[0].kpp = mergedReq.kpp;
      if (mergedReq.bankAccount) sameCompanyCards[0].bankAccount = mergedReq.bankAccount;
      if (mergedReq.bik) sameCompanyCards[0].bik = mergedReq.bik;

      const placeholder = sameCompanyCards.find((c) =>
        /^(основной\s+договор|договор\s*№?1)$/i.test(c.contractNumber.trim())
      );
      if (
        placeholder &&
        parsedContract &&
        !/^(основной\s+договор|договор\s*№?1)$/i.test(parsedContract.contractNumber)
      ) {
        placeholder.contractNumber = parsedContract.contractNumber;
        placeholder.contractDate = parsedContract.contractDate;
      }
      return;
    }

    counterparties.push(
      buildFallbackCounterpartyCard(name, kind, rawContract, opDate, mergedReq)
    );
  };

  const upsertNomenclature = (card: Omit<NomenclatureCard1C, 'id'>) => {
    const cleanName = (card.name || '').trim();
    if (!cleanName || cleanName.length < 2) return;
    if (
      /^(основной склад|материалы|товары|услуги|оплата труда|страховые взносы|амортизация)$/i.test(
        cleanName
      )
    ) {
      return;
    }
    const normName = normalizeEntityKey(cleanName);
    const exists = nomenclature.some((n) => normalizeEntityKey(n.name) === normName);
    if (exists) return;

    nomenclature.push({
      ...card,
      id: `nom-auto-${hashString(normName) % 100000}`,
      name: cleanName,
      createdIn1C: false,
    });
  };

  // 1. Scan Opening Balances
  for (const ob of openingBalances) {
    if (ob.accountCode.startsWith('60') && ob.subconto1) {
      upsertCounterparty(ob.subconto1, 'С поставщиком', ob.subconto2, '15.01.2026');
    } else if (ob.accountCode.startsWith('62') && ob.subconto1) {
      upsertCounterparty(ob.subconto1, 'С покупателем', ob.subconto2, '15.01.2023');
    } else if (ob.accountCode.startsWith('76') && ob.subconto1) {
      upsertCounterparty(ob.subconto1, 'Прочее', ob.subconto2, '01.01.2026');
    } else if (ob.accountCode.startsWith('41') && ob.subconto1) {
      upsertNomenclature({
        name: ob.subconto1,
        kind: 'Товары',
        unit: 'шт.',
        accountCode: '41.01',
        vatAccountCode: '19.03',
        defaultVatRate: 20,
      });
    } else if (ob.accountCode.startsWith('10') && ob.subconto1) {
      upsertNomenclature({
        name: ob.subconto1,
        kind: 'Материалы',
        unit: 'шт.',
        accountCode: ob.accountCode === '10' ? '10.01' : ob.accountCode,
        vatAccountCode: '19.03',
        defaultVatRate: 20,
      });
    }
  }

  // 2. Scan Operations
  for (const op of operations) {
    if (op.isMonthEndClosing) continue;

    // Extract HR Hiring employees (e.g. Op 5: "Принят на работу главный бухгалтер (ФИО студента) с окладом 72 200")
    if (
      /принят[ао]?\s+на\s+работу/i.test(op.rawDescription) ||
      /прием\s+на\s+работу/i.test(op.documentType1C)
    ) {
      const salary = op.explicitAmount ?? op.resolvedAmount;
      if (salary > 0) {
        const isChiefAcc = /главн[ыйая]*\s+бухгалтер|главбух/i.test(op.rawDescription);
        const isProd = /прораб|рабоч|инженер|монтажник/i.test(op.rawDescription);
        const alreadyHasMatch = employees.some((e) =>
          isChiefAcc
            ? /главн[ыйая]*\s+бухгалтер|главбух/i.test(e.position) ||
              /фио\s+студента/i.test(e.fullName)
            : Math.abs(e.salary - salary) < 1
        );
        if (!alreadyHasMatch) {
          employees.push({
            id: `emp-auto-${op.id}`,
            fullName: isChiefAcc ? 'Главный бухгалтер (ФИО студента)' : 'Сотрудник организации',
            position: isChiefAcc ? 'Главный бухгалтер' : 'Специалист',
            department: isProd ? 'Основное производство' : 'Администрация',
            salary,
            hireDate: op.date,
            costAccount: isProd ? '20.01' : '26',
            createdIn1C: false,
          });
        }
      }
    }

    const inlineReq = extractInlineRequisitesFromText(op.rawDescription);

    // Check for tax office with explicit INN/KPP/BIK in rawDescription (e.g. МИ ФНС №10 по СПб)
    const taxOfficeMatch = /(МИ\s*ФНС\s*№\s*\d+\s*по\s*[А-Яа-яЁё.-]+|ИФНС\s*России\s*№\s*\d+[^,(]*)/i.exec(
      op.rawDescription
    );
    if (taxOfficeMatch && inlineReq.inn) {
      upsertCounterparty(
        taxOfficeMatch[1].trim(),
        'Прочее',
        'Налоговые платежи в бюджет',
        op.date,
        inlineReq
      );
    }

    const cpField = op.documentFields.find((f) =>
      /^(контрагент|поставщик|покупатель|заказчик|подрядчик|дебитор|кредитор|получатель)/i.test(
        f.label.trim()
      )
    );
    const contractField = op.documentFields.find((f) => /договор/i.test(f.label));
    const contractFromDescMatch =
      /(?:договор[ауеом]?|дог\.?)\s*(?:№|n|#)?\s*([0-9a-zа-я/-]+(?:\s+от\s+\d{1,2}\.\d{1,2}\.\d{4})?)/i.exec(
        op.rawDescription
      );
    const rawContract =
      contractField?.value ||
      (contractFromDescMatch ? `Договор №${contractFromDescMatch[1]}` : undefined);

    const touches60 = op.postings.some(
      (p) => p.debitAccount.startsWith('60') || p.creditAccount.startsWith('60')
    );
    const touches62 = op.postings.some(
      (p) => p.debitAccount.startsWith('62') || p.creditAccount.startsWith('62')
    );
    const cpKind: CounterpartyCard1C['contractKind'] = touches60
      ? 'С поставщиком'
      : touches62
        ? 'С покупателем'
        : 'Прочее';

    if (cpField?.value) {
      upsertCounterparty(cpField.value, cpKind, rawContract, op.date, inlineReq);
    } else {
      const entityRegex =
        /((?:ООО|АО|ПАО|ЗАО|ОАО)\s*[«"]([^»"]+)[»"]|ИП\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.)/g;
      let match: RegExpExecArray | null;
      while ((match = entityRegex.exec(op.rawDescription)) !== null) {
        upsertCounterparty(match[1], cpKind, rawContract, op.date, inlineReq);
      }
    }

    for (const p of op.postings) {
      if (p.debitAccount.startsWith('60') && p.debitSubconto[0]) {
        upsertCounterparty(
          p.debitSubconto[0],
          'С поставщиком',
          p.debitSubconto[1] || rawContract,
          op.date,
          inlineReq
        );
      }
      if (p.creditAccount.startsWith('60') && p.creditSubconto[0]) {
        upsertCounterparty(
          p.creditSubconto[0],
          'С поставщиком',
          p.creditSubconto[1] || rawContract,
          op.date,
          inlineReq
        );
      }
      if (p.debitAccount.startsWith('62') && p.debitSubconto[0]) {
        upsertCounterparty(
          p.debitSubconto[0],
          'С покупателем',
          p.debitSubconto[1] || rawContract,
          op.date,
          inlineReq
        );
      }
      if (p.creditAccount.startsWith('62') && p.creditSubconto[0]) {
        upsertCounterparty(
          p.creditSubconto[0],
          'С покупателем',
          p.creditSubconto[1] || rawContract,
          op.date,
          inlineReq
        );
      }
      if (p.creditAccount === '76.02' && p.creditSubconto[0]) {
        upsertCounterparty(
          p.creditSubconto[0],
          'Прочее',
          p.creditSubconto[1] || rawContract,
          op.date,
          inlineReq
        );
      }

      if (p.debitAccount.startsWith('41') && p.debitSubconto[0]) {
        upsertNomenclature({
          name: p.debitSubconto[0],
          kind: 'Товары',
          unit: op.vatBreakdown?.unit || 'шт.',
          accountCode: '41.01',
          vatAccountCode: '19.03',
          nomenclatureGroup: 'Оптовая торговля',
          defaultVatRate: op.vatBreakdown?.vatRate ?? 20,
        });
      }

      if (
        (p.debitAccount.startsWith('10') && p.debitSubconto[0]) ||
        (p.creditAccount.startsWith('10') && p.creditSubconto[0])
      ) {
        const matName = p.debitAccount.startsWith('10')
          ? p.debitSubconto[0]
          : p.creditSubconto[0];
        const matAcc = p.debitAccount.startsWith('10')
          ? p.debitAccount
          : p.creditAccount;
        upsertNomenclature({
          name: matName,
          kind: 'Материалы',
          unit: op.vatBreakdown?.unit || 'шт.',
          accountCode: matAcc === '10' ? '10.01' : matAcc,
          vatAccountCode: '19.03',
          expenseItem: 'Материальные расходы',
          defaultVatRate: op.vatBreakdown?.vatRate ?? 20,
        });
      }

      if (p.debitAccount === '20.01' || p.debitAccount === '20') {
        if (p.debitSubconto[0]) addUniqueString(nomenclatureGroupSet, p.debitSubconto[0]);
        if (p.debitSubconto[1]) addUniqueString(expenseItemSet, p.debitSubconto[1]);
      }

      if (p.debitAccount === '26' && p.debitSubconto[0]) {
        addUniqueString(expenseItemSet, p.debitSubconto[0]);
      }

      if (
        (p.creditAccount === '90.01.1' && p.creditSubconto[0]) ||
        (p.debitAccount === '90.02.1' && p.debitSubconto[0])
      ) {
        const grp =
          p.creditAccount === '90.01.1' ? p.creditSubconto[0] : p.debitSubconto[0];
        addUniqueString(nomenclatureGroupSet, grp);
      }

      if (p.debitAccount === '51' && p.debitSubconto[1]) {
        addUniqueString(cashFlowItemSet, p.debitSubconto[1]);
      }
      if (p.creditAccount === '51' && p.creditSubconto[1]) {
        addUniqueString(cashFlowItemSet, p.debitSubconto[1]);
      }
      if (p.debitAccount.startsWith('50') && p.debitSubconto[0]) {
        addUniqueString(cashFlowItemSet, p.debitSubconto[0]);
      }
      if (p.creditAccount.startsWith('50') && p.creditSubconto[0]) {
        addUniqueString(cashFlowItemSet, p.debitSubconto[0]);
      }
    }

    const isServicePurchase =
      touches60 &&
      op.postings.some((p) => p.debitAccount === '20.01' || p.debitAccount === '26');
    if (isServicePurchase) {
      const nomField = op.documentFields.find((f) =>
        /(номенклатур|услуг|работ|содержан)/i.test(f.label)
      );
      const objMatch = /объект[уе]?\s*[«"]([^»"]+)[»"]/i.exec(op.rawDescription);
      const costPosting = op.postings.find(
        (p) => p.debitAccount === '20.01' || p.debitAccount === '26'
      );
      const serviceName =
        nomField?.value ||
        (objMatch ? `Субподрядные работы по объекту «${objMatch[1]}»` : undefined);
      if (serviceName && costPosting) {
        upsertNomenclature({
          name: serviceName,
          kind: 'Услуги / Субподрядные работы',
          unit: op.vatBreakdown?.unit || 'усл.',
          accountCode: costPosting.debitAccount,
          vatAccountCode: '19.04',
          nomenclatureGroup:
            costPosting.debitAccount === '20.01'
              ? costPosting.debitSubconto[0] || (objMatch ? objMatch[1] : undefined)
              : undefined,
          expenseItem:
            costPosting.debitAccount === '20.01'
              ? costPosting.debitSubconto[1] || 'Субподрядные работы'
              : costPosting.debitSubconto[0] || 'Прочие расходы',
          defaultVatRate: op.vatBreakdown?.vatRate ?? 20,
        });
      }
    }

    const isWorksSale =
      op.postings.some((p) => p.creditAccount === '90.01.1') &&
      !op.postings.some((p) => p.creditAccount.startsWith('41'));
    if (isWorksSale) {
      const workField = op.documentFields.find((f) =>
        /(объект|наименован.*работ|номенклатур|содержан)/i.test(f.label)
      );
      const objMatch = /объект[уе]?\s*[«"]([^»"]+)[»"]/i.exec(op.rawDescription);
      const workName = workField?.value || (objMatch ? objMatch[1] : undefined);
      if (workName) {
        addUniqueString(nomenclatureGroupSet, workName);
        upsertNomenclature({
          name: workName,
          kind: 'Продукция / СМР',
          unit: 'компл.',
          accountCode: '20.01',
          vatAccountCode: '90.03',
          nomenclatureGroup: workName,
          defaultVatRate: op.vatBreakdown?.vatRate ?? 20,
        });
      }
    }
  }

  for (const n of nomenclature) {
    if (n.nomenclatureGroup) addUniqueString(nomenclatureGroupSet, n.nomenclatureGroup);
    if (n.expenseItem) addUniqueString(expenseItemSet, n.expenseItem);
  }
  for (const emp of employees) {
    if (emp.nomenclatureGroup) addUniqueString(nomenclatureGroupSet, emp.nomenclatureGroup);
  }

  if (nomenclatureGroupSet.size === 0) {
    addUniqueString(nomenclatureGroupSet, 'Основная номенклатурная группа');
  }
  [
    'Материальные расходы',
    'Оплата труда',
    'Страховые взносы',
    'Амортизация',
    'Субподрядные работы',
  ].forEach((item) => addUniqueString(expenseItemSet, item));

  [
    'Оплата товаров, работ, услуг, сырья и иных оборотных активов',
    'Поступление от продажи продукции и товаров, выполнения работ, оказания услуг',
    'Уплата налогов и взносов',
    'Оплата труда',
    'Получение наличных в банке',
  ].forEach((item) => addUniqueString(cashFlowItemSet, item));

  return {
    counterparties,
    nomenclature,
    nomenclatureGroups: Array.from(nomenclatureGroupSet.values()),
    expenseItems: Array.from(expenseItemSet.values()),
    cashFlowItems: Array.from(cashFlowItemSet.values()),
    employees,
  };
}

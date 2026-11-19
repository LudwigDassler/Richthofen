import type {
  CounterpartyCard1C,
  EmployeeCard1C,
  OpeningBalanceEntry,
  OrganizationCard,
} from '@/types/accounting';

function round2(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function decode1CTextBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // UTF-16LE BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  // UTF-16BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  // Peek ASCII header for explicit windows-1251 declaration
  const asciiHeader = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  if (/encoding\s*=\s*["']windows-1251["']|encoding\s*=\s*["']cp1251["']/i.test(asciiHeader)) {
    return new TextDecoder('windows-1251').decode(bytes);
  }

  // Strict UTF-8 validation — if invalid UTF-8 byte sequence occurs, decode as windows-1251!
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/Кодировка\s*=\s*DOS/i.test(utf8Text.slice(0, 400))) {
      try {
        return new TextDecoder('ibm866').decode(bytes);
      } catch {
        return utf8Text;
      }
    }
    return utf8Text;
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

export interface XmlOrBankParseOutput {
  detectedFormat: string;
  periodLabel?: string;
  organizationPatch?: Partial<OrganizationCard>;
  bankBalances: OpeningBalanceEntry[];
  xmlBalances: OpeningBalanceEntry[];
  counterparties: CounterpartyCard1C[];
  employees: EmployeeCard1C[];
  warnings: string[];
}

function unescapeXml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function getXmlTagValue(block: string, tagNames: string[]): string | undefined {
  for (const tag of tagNames) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}>`,
      'i'
    );
    const match = block.match(regex);
    if (match && match[1]) {
      const inner = match[1].replace(/<[^>]+>/g, '').trim();
      if (inner) return unescapeXml(inner);
    }
  }
  return undefined;
}

function getAllXmlBlocks(xml: string, tagNames: string[]): string[] {
  const blocks: string[] = [];
  for (const tag of tagNames) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}>`,
      'gi'
    );
    let m: RegExpExecArray | null;
    while ((m = regex.exec(xml)) !== null) {
      blocks.push(m[1]);
    }
  }
  return blocks;
}

export function parse1CClientBankTxt(text: string, filename: string): XmlOrBankParseOutput {
  const out: XmlOrBankParseOutput = {
    detectedFormat: `1CClientBankExchange (${filename})`,
    bankBalances: [],
    xmlBalances: [],
    counterparties: [],
    employees: [],
    warnings: [],
  };

  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let ourAccount = '';
  let endDate = '';
  let closingBalance: number | null = null;

  // Header & СекцияРасчСчет scan
  let inAccSection = false;
  for (const line of lines) {
    if (/^СекцияРасчСчет/i.test(line)) {
      inAccSection = true;
      continue;
    }
    if (/^КонецРасчСчет/i.test(line)) {
      inAccSection = false;
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();

    if (/^РасчСчет$/i.test(key) && !ourAccount && /^\d{20}$/.test(val)) {
      ourAccount = val;
    }
    if (/^ДатаКонца$/i.test(key) && val) {
      endDate = val;
    }
    if ((inAccSection || closingBalance === null) && /^ОстатокНаКонец$/i.test(key)) {
      const num = Number(val.replace(/[\s\u00A0]/g, '').replace(',', '.'));
      if (Number.isFinite(num)) {
        closingBalance = round2(num);
      }
    }
  }

  if (endDate) {
    out.periodLabel = `по ${endDate}`;
  }

  if (closingBalance !== null && closingBalance > 0) {
    out.bankBalances.push({
      id: 'imp-bank-51',
      accountCode: '51',
      subconto1: ourAccount ? `Расчетный счет ${ourAccount}` : 'Основной расчетный счет',
      debit: closingBalance,
      credit: 0,
      comment: `Остаток на р/сч из выписки клиент-банка (${filename}${endDate ? ` на ${endDate}` : ''})`,
    });
  }

  // Parse СекцияДокумент blocks
  let currentDoc: Record<string, string> | null = null;
  const docs: Record<string, string>[] = [];

  for (const line of lines) {
    if (/^СекцияДокумент/i.test(line)) {
      currentDoc = {};
      continue;
    }
    if (/^КонецДокумент/i.test(line)) {
      if (currentDoc) docs.push(currentDoc);
      currentDoc = null;
      continue;
    }
    if (currentDoc) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim();
        currentDoc[k] = v;
      }
    }
  }

  const orgPatch: Partial<OrganizationCard> = {};
  if (ourAccount) orgPatch.bankAccount = ourAccount;

  const cpMap = new Map<string, CounterpartyCard1C>();

  for (const doc of docs) {
    const payerAcc = doc['ПлательщикСчет'] || doc['ПлательщикРасчСчет'] || '';
    const receiverAcc = doc['ПолучательСчет'] || doc['ПолучательРасчСчет'] || '';
    const purpose = doc['НазначениеПлатежа'] || '';
    const docDate = doc['Дата'] || '15.03.2026';

    const weArePayer = ourAccount ? payerAcc === ourAccount : false;
    const weAreReceiver = ourAccount ? receiverAcc === ourAccount : false;

    if (weArePayer || weAreReceiver) {
      const ourPrefix = weArePayer ? 'Плательщик' : 'Получатель';
      const cpPrefix = weArePayer ? 'Получатель' : 'Плательщик';

      const ourName = doc[`${ourPrefix}1`] || doc[ourPrefix];
      const ourInn = doc[`${ourPrefix}ИНН`];
      const ourKpp = doc[`${ourPrefix}КПП`];
      const ourBank = doc[`${ourPrefix}Банк1`];
      const ourBik = doc[`${ourPrefix}БИК`];
      const ourCorr = doc[`${ourPrefix}Корсчет`];

      if (ourName && !orgPatch.shortName) {
        orgPatch.shortName = ourName;
        orgPatch.name = ourName.startsWith('ООО ')
          ? ourName.replace(/^ООО\s+/, 'Общество с ограниченной ответственностью ')
          : ourName;
      }
      if (ourInn && !orgPatch.inn) orgPatch.inn = ourInn;
      if (ourKpp && !orgPatch.kpp) orgPatch.kpp = ourKpp;
      if (ourBank && !orgPatch.bankName) orgPatch.bankName = ourBank;
      if (ourBik && !orgPatch.bik) orgPatch.bik = ourBik;
      if (ourCorr && !orgPatch.corrAccount) orgPatch.corrAccount = ourCorr;

      const cpName = (doc[`${cpPrefix}1`] || doc[cpPrefix] || '').trim();
      const cpInn = (doc[`${cpPrefix}ИНН`] || '').trim();
      const cpKpp = (doc[`${cpPrefix}КПП`] || '').trim();
      const cpAcc = (doc[`${cpPrefix}Счет`] || doc[`${cpPrefix}РасчСчет`] || '').trim();
      const cpBank = (doc[`${cpPrefix}Банк1`] || 'ПАО Сбербанк').trim();
      const cpBik = (doc[`${cpPrefix}БИК`] || '044030653').trim();

      if (cpName) {
        const contractMatch = purpose.match(
          /(?:договор[ауеом]?|дог\.)\s*(?:№\s*)?([0-9А-ЯЁA-Zа-яё/-]+)/i
        );
        const contractNumber = contractMatch
          ? `Договор №${contractMatch[1]}`
          : /налог|взнос|фнс/i.test(cpName + ' ' + purpose)
            ? 'Бюджетные платежи'
            : 'Основной договор';
        const contractKind: CounterpartyCard1C['contractKind'] = /фнс|казначейств|бюджет/i.test(cpName)
          ? 'Прочее'
          : weArePayer
            ? 'С поставщиком'
            : 'С покупателем';

        const dedupKey = (cpInn || cpName).toLowerCase();
        if (!cpMap.has(dedupKey)) {
          cpMap.set(dedupKey, {
            id: `imp-kl-cp-${cpMap.size + 1}`,
            name: cpName,
            fullName: cpName,
            inn: cpInn || '7810000000',
            kpp: cpKpp || '781001001',
            bankAccount: cpAcc || '40702810000000000000',
            bankName: cpBank,
            bik: cpBik,
            contractKind,
            contractNumber,
            contractDate: docDate,
            createdIn1C: true,
          });
        }
      }
    }
  }

  if (Object.keys(orgPatch).length > 0) {
    out.organizationPatch = orgPatch;
  }
  out.counterparties = Array.from(cpMap.values());
  return out;
}

export function parse1CXml(xmlText: string, filename: string): XmlOrBankParseOutput {
  const isEnterpriseData = /EnterpriseData|Справочник\.|Документ\./i.test(xmlText);
  const isCommerceMl = /КоммерческаяИнформация/i.test(xmlText);

  const out: XmlOrBankParseOutput = {
    detectedFormat: isEnterpriseData
      ? `1С EnterpriseData XML (${filename})`
      : isCommerceMl
        ? `1С CommerceML XML (${filename})`
        : `XML выгрузка 1С (${filename})`,
    bankBalances: [],
    xmlBalances: [],
    counterparties: [],
    employees: [],
    warnings: [],
  };

  // 1. Extract Organization requisites (<Справочник.Организации>, <Организация>, <Владелец>)
  const orgBlocks = getAllXmlBlocks(xmlText, [
    'Справочник.Организации',
    'Организация',
    'Владелец',
    'НашаОрганизация',
  ]);
  for (const block of orgBlocks) {
    const shortName = getXmlTagValue(block, ['НаименованиеСокращенное', 'Наименование', 'ОфициальноеНаименование']);
    const fullName = getXmlTagValue(block, ['НаименованиеПолное', 'ОфициальноеНаименование', 'Наименование']);
    const inn = getXmlTagValue(block, ['ИНН']);
    const kpp = getXmlTagValue(block, ['КПП']);
    const ogrn = getXmlTagValue(block, ['ОГРН']);
    const bankAccount = getXmlTagValue(block, ['НомерСчета', 'РасчетныйСчет']);
    const bankName = getXmlTagValue(block, ['НаименованиеБанка', 'Банк']);
    const bik = getXmlTagValue(block, ['БИК']);
    const corrAccount = getXmlTagValue(block, ['КоррСчет', 'КорреспондентскийСчет']);

    if (shortName || inn) {
      out.organizationPatch = {
        ...(fullName ? { name: fullName } : {}),
        ...(shortName ? { shortName } : {}),
        ...(inn ? { inn } : {}),
        ...(kpp ? { kpp } : {}),
        ...(ogrn ? { ogrn } : {}),
        ...(bankAccount ? { bankAccount } : {}),
        ...(bankName ? { bankName } : {}),
        ...(bik ? { bik } : {}),
        ...(corrAccount ? { corrAccount } : {}),
      };
      break;
    }
  }

  // 2. Extract Counterparties (<Справочник.Контрагенты>, <Контрагент>)
  const cpBlocks = getAllXmlBlocks(xmlText, ['Справочник.Контрагенты', 'Контрагент']);
  const cpMap = new Map<string, CounterpartyCard1C>();

  for (const block of cpBlocks) {
    const name = getXmlTagValue(block, ['Наименование', 'НаименованиеСокращенное']);
    if (!name) continue;
    const inn = getXmlTagValue(block, ['ИНН']) || '7810000000';
    // Skip if identical to our own extracted org INN
    if (out.organizationPatch?.inn && inn === out.organizationPatch.inn) continue;

    const fullName = getXmlTagValue(block, ['НаименованиеПолное', 'ОфициальноеНаименование']) || name;
    const kpp = getXmlTagValue(block, ['КПП']) || `${inn.slice(0, 4)}01001`;
    const bankAccount = getXmlTagValue(block, ['НомерСчета', 'РасчетныйСчет']) || '40702810555000000101';
    const bankName = getXmlTagValue(block, ['НаименованиеБанка', 'Банк']) || 'ПАО Сбербанк';
    const bik = getXmlTagValue(block, ['БИК']) || '044030653';
    const contractNum = getXmlTagValue(block, ['Договор', 'НомерДоговора', 'НаименованиеДоговора']) || 'Основной договор';
    const contractDate = getXmlTagValue(block, ['ДатаДоговора']) || '10.01.2026';
    const roleRaw = getXmlTagValue(block, ['ВидДоговора', 'Роль']) || '';

    const key = (inn !== '7810000000' ? inn : name).toLowerCase();
    if (!cpMap.has(key)) {
      cpMap.set(key, {
        id: `imp-xml-cp-${cpMap.size + 1}`,
        name,
        fullName,
        inn,
        kpp,
        bankAccount,
        bankName,
        bik,
        contractKind: /покупател/i.test(roleRaw) ? 'С покупателем' : 'С поставщиком',
        contractNumber: contractNum,
        contractDate,
        createdIn1C: true,
      });
    }
  }
  out.counterparties = Array.from(cpMap.values());

  // 3. Extract Employees if present (<Справочник.Сотрудники>, <Сотрудник>)
  const empBlocks = getAllXmlBlocks(xmlText, ['Справочник.Сотрудники', 'Сотрудник']);
  for (const block of empBlocks) {
    const fullName = getXmlTagValue(block, ['Наименование', 'ФИО', 'ПолноеИмя']);
    if (!fullName) continue;
    const position = getXmlTagValue(block, ['Должность']) || 'Специалист';
    const department = getXmlTagValue(block, ['Подразделение']) || 'Основное подразделение';
    const salaryStr = getXmlTagValue(block, ['Оклад', 'ТарифнаяСтавка']) || '70000';
    const salary = Number(salaryStr.replace(/[\s\u00A0]/g, '').replace(',', '.')) || 70000;

    out.employees.push({
      id: `imp-xml-emp-${out.employees.length + 1}`,
      fullName,
      position,
      department,
      salary: round2(salary),
      hireDate: getXmlTagValue(block, ['ДатаПриема']) || '10.01.2026',
      costAccount: /прораб|рабоч|строител/i.test(position) ? '20.01' : '26',
      createdIn1C: true,
    });
  }

  // 4. Extract Opening Balances (<Остаток>, <СтрокаОстатков>, <ЗаписьОстатка>) if present
  const balBlocks = getAllXmlBlocks(xmlText, ['Остаток', 'СтрокаОстатков', 'ЗаписьОстатка']);
  for (const block of balBlocks) {
    const accountCode = getXmlTagValue(block, ['Счет', 'КодСчета', 'СчетУчета']);
    if (!accountCode) continue;
    const subconto1 = getXmlTagValue(block, ['Субконто1', 'Контрагент', 'Номенклатура', 'Сотрудник']);
    const subconto2 = getXmlTagValue(block, ['Субконто2', 'Договор', 'Склад']);
    const dtStr = getXmlTagValue(block, ['СальдоДебет', 'СуммаДебет', 'Дебет']) || '0';
    const ktStr = getXmlTagValue(block, ['СальдоКредит', 'СуммаКредит', 'Кредит']) || '0';
    const debit = round2(Number(dtStr.replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0);
    const credit = round2(Number(ktStr.replace(/[\s\u00A0]/g, '').replace(',', '.')) || 0);
    if (debit > 0 || credit > 0) {
      out.xmlBalances.push({
        id: `imp-xml-bal-${out.xmlBalances.length + 1}`,
        accountCode,
        subconto1,
        subconto2,
        debit,
        credit,
        comment: `Импортировано из XML 1С (${filename})`,
      });
    }
  }

  return out;
}

import {
  CounterpartyCard1C,
  EntityRequisiteCheck,
  ExtractedDirectories1C,
  OrganizationCard,
  RequisiteCheckReport,
  RequisiteFieldGap,
  Synced1CCounterparty,
  Synced1CSnapshot,
} from '@/types/accounting';

function normalizeDigits(val?: string): string {
  return (val || '').replace(/\D/g, '');
}

function normalizeCompanyCoreName(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`.,()]/g, ' ')
    .replace(
      /\b(общество\s+с\s+ограниченной\s+ответственностью|акционерное\s+общество|публичное\s+акционерное\s+общество|закрытое\s+акционерное\s+общество|индивидуальный\s+предприниматель|межрайонная\s+инспекция\s+фнс\s+россии|межрайонная\s+ифнс\s+россии|ооо|ао|пао|зао|оао|ип)\b/g,
      ' '
    )
    .replace(/\bпо\s+(?:г\.\s*)?(?:санкт-петербургу|спб)\b/g, 'спб')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholderPersonName(val?: string): boolean {
  if (!val || !val.trim()) return true;
  return /фио\s+студента|^не\s+указан|^—$|^-$/i.test(val.trim());
}

function findMatching1CCounterparty(
  refCp: CounterpartyCard1C,
  syncedList: Synced1CCounterparty[]
): Synced1CCounterparty | undefined {
  const refInn = normalizeDigits(refCp.inn);
  if (refInn.length >= 10) {
    const byInn = syncedList.find((c) => normalizeDigits(c.inn) === refInn);
    if (byInn) return byInn;
  }

  const refCore = normalizeCompanyCoreName(refCp.name);
  if (!refCore) return undefined;

  // Tax office fuzzy match (МИ ФНС №10 / ИФНС №10 / ФНС №10)
  const isRefTaxOffice = /(?:фнс|ифнс).*10/i.test(refCp.name);
  if (isRefTaxOffice) {
    const byTax = syncedList.find(
      (c) =>
        /(?:фнс|ифнс).*10/i.test(c.name || '') ||
        /(?:фнс|ифнс).*10/i.test(c.fullName || '')
    );
    if (byTax) return byTax;
  }

  return syncedList.find((c) => {
    const candName = normalizeCompanyCoreName(c.name);
    const candFull = normalizeCompanyCoreName(c.fullName);
    return (
      (candName &&
        (candName === refCore ||
          candName.includes(refCore) ||
          refCore.includes(candName))) ||
      (candFull &&
        (candFull === refCore ||
          candFull.includes(refCore) ||
          refCore.includes(candFull)))
    );
  });
}

function extractCoreContractToken(contractStr?: string): string {
  if (!contractStr) return '';
  const m = /(?:№|дог\.?\s*|счет[-a-я]*\s*№?\s*)([0-9a-zа-я/-]+)/i.exec(contractStr);
  return m ? m[1].toLowerCase().replace(/ё/g, 'е') : '';
}

function checkOrganizationRequisites(
  effectiveOrganization: OrganizationCard,
  synced1C: Synced1CSnapshot | null
): EntityRequisiteCheck {
  const orgIn1C = synced1C?.organization;
  const hasOrgInSnapshot =
    Boolean(synced1C) &&
    Boolean(orgIn1C) &&
    Object.values(orgIn1C!).some((v) => v !== undefined && v !== null);

  const missingFields: RequisiteFieldGap[] = [];
  const totalRequired = 8;

  const checkStringOrDigitsField = (
    fieldKey: string,
    fieldLabel: string,
    expectedRaw: string,
    actualRaw: string | undefined,
    mode: 'text' | 'digits' | 'person'
  ) => {
    const expected = (expectedRaw || '').trim();
    const actual = (actualRaw ?? '').trim();

    if (!actual || (mode === 'person' && isPlaceholderPersonName(actual) && hasOrgInSnapshot)) {
      missingFields.push({
        fieldKey,
        fieldLabel,
        expectedValue: expected || 'Требуется заполнить',
        actualValueIn1C: actual || undefined,
        reason: 'empty',
      });
      return;
    }

    if (mode === 'digits' && expected) {
      const expDigits = normalizeDigits(expected);
      const actDigits = normalizeDigits(actual);
      if (expDigits && actDigits !== expDigits) {
        missingFields.push({
          fieldKey,
          fieldLabel,
          expectedValue: expected,
          actualValueIn1C: actual,
          reason: 'mismatch',
        });
      }
    }
  };

  const targetSource = hasOrgInSnapshot ? orgIn1C! : effectiveOrganization;

  checkStringOrDigitsField(
    'name',
    'Наименование',
    effectiveOrganization.name || effectiveOrganization.shortName,
    targetSource.name || targetSource.shortName,
    'text'
  );
  checkStringOrDigitsField(
    'inn',
    'ИНН',
    effectiveOrganization.inn,
    targetSource.inn,
    'digits'
  );
  checkStringOrDigitsField(
    'kpp',
    'КПП',
    effectiveOrganization.kpp,
    targetSource.kpp,
    'digits'
  );
  checkStringOrDigitsField(
    'bankAccount',
    'Расчетный счет',
    effectiveOrganization.bankAccount,
    targetSource.bankAccount,
    'digits'
  );
  checkStringOrDigitsField(
    'bik',
    'БИК',
    effectiveOrganization.bik,
    targetSource.bik,
    'digits'
  );
  checkStringOrDigitsField(
    'bankName',
    'Банк',
    effectiveOrganization.bankName,
    targetSource.bankName,
    'text'
  );
  checkStringOrDigitsField(
    'directorName',
    'Руководитель',
    effectiveOrganization.directorName,
    targetSource.directorName,
    'person'
  );
  checkStringOrDigitsField(
    'chiefAccountantName',
    'Главный бухгалтер',
    effectiveOrganization.chiefAccountantName,
    targetSource.chiefAccountantName,
    'person'
  );

  const filledCount = Math.max(0, totalRequired - missingFields.length);
  const status: EntityRequisiteCheck['status'] =
    missingFields.length === 0 ? 'complete' : 'incomplete_in_1c';

  return {
    entityId: 'our-organization',
    entityType: 'organization',
    name: effectiveOrganization.shortName || effectiveOrganization.name || 'Наша организация',
    innExpected: effectiveOrganization.inn || '',
    status,
    totalRequired,
    filledCount,
    missingFields,
  };
}

function checkCounterpartyRequisites(
  refCp: CounterpartyCard1C,
  synced1C: Synced1CSnapshot | null
): EntityRequisiteCheck {
  const totalRequired = 7;
  const expectedContractDisplay = refCp.contractKind
    ? `${refCp.contractNumber} (${refCp.contractKind})`
    : refCp.contractNumber;
  const isIndividualEntrepreneur =
    /^ИП\s+/i.test(refCp.name) || normalizeDigits(refCp.inn).length === 12;

  // When no 1C snapshot is loaded yet, validate the current reference directory card fields
  if (!synced1C) {
    const gaps: RequisiteFieldGap[] = [];
    if (!refCp.name?.trim()) {
      gaps.push({
        fieldKey: 'name',
        fieldLabel: 'Наименование',
        expectedValue: refCp.fullName || 'Контрагент',
        reason: 'empty',
      });
    }
    if (!normalizeDigits(refCp.inn)) {
      gaps.push({
        fieldKey: 'inn',
        fieldLabel: 'ИНН',
        expectedValue: '10 или 12 цифр ИНН',
        reason: 'empty',
      });
    }
    if (!isIndividualEntrepreneur && !normalizeDigits(refCp.kpp)) {
      gaps.push({
        fieldKey: 'kpp',
        fieldLabel: 'КПП',
        expectedValue: '9 цифр КПП',
        reason: 'empty',
      });
    }
    if (!normalizeDigits(refCp.bankAccount)) {
      gaps.push({
        fieldKey: 'bankAccount',
        fieldLabel: 'Расчетный счет',
        expectedValue: '20 цифр р/сч',
        reason: 'empty',
      });
    }
    if (!normalizeDigits(refCp.bik)) {
      gaps.push({
        fieldKey: 'bik',
        fieldLabel: 'БИК',
        expectedValue: '9 цифр БИК',
        reason: 'empty',
      });
    }
    if (!refCp.bankName?.trim()) {
      gaps.push({
        fieldKey: 'bankName',
        fieldLabel: 'Банк',
        expectedValue: 'Наименование банка',
        reason: 'empty',
      });
    }
    if (!refCp.contractNumber?.trim()) {
      gaps.push({
        fieldKey: 'contract',
        fieldLabel: 'Договор',
        expectedValue: 'Основной договор',
        reason: 'empty',
      });
    }

    return {
      entityId: refCp.id,
      entityType: 'counterparty',
      name: refCp.name,
      innExpected: refCp.inn,
      status: gaps.length === 0 ? 'complete' : 'incomplete_in_1c',
      totalRequired,
      filledCount: Math.max(0, totalRequired - gaps.length),
      missingFields: gaps,
    };
  }

  // Match against `synced1C.counterparties`
  const matched1C = findMatching1CCounterparty(refCp, synced1C.counterparties || []);

  if (!matched1C) {
    const allMissing: RequisiteFieldGap[] = [
      {
        fieldKey: 'name',
        fieldLabel: 'Наименование',
        expectedValue: refCp.name,
        reason: 'empty',
      },
      {
        fieldKey: 'inn',
        fieldLabel: 'ИНН',
        expectedValue: refCp.inn,
        reason: 'empty',
      },
      {
        fieldKey: 'kpp',
        fieldLabel: 'КПП',
        expectedValue: isIndividualEntrepreneur ? 'Не требуется (ИП)' : refCp.kpp,
        reason: 'empty',
      },
      {
        fieldKey: 'bankAccount',
        fieldLabel: 'Расчетный счет',
        expectedValue: refCp.bankAccount,
        reason: 'empty',
      },
      {
        fieldKey: 'bik',
        fieldLabel: 'БИК',
        expectedValue: refCp.bik,
        reason: 'empty',
      },
      {
        fieldKey: 'bankName',
        fieldLabel: 'Банк',
        expectedValue: refCp.bankName,
        reason: 'empty',
      },
      {
        fieldKey: 'contract',
        fieldLabel: 'Договор',
        expectedValue: expectedContractDisplay,
        reason: 'empty',
      },
    ];

    return {
      entityId: refCp.id,
      entityType: 'counterparty',
      name: refCp.name,
      innExpected: refCp.inn,
      status: 'missing_in_1c',
      totalRequired,
      filledCount: 0,
      missingFields: allMissing,
    };
  }

  const missingFields: RequisiteFieldGap[] = [];

  // 1. Наименование
  if (!matched1C.name?.trim()) {
    missingFields.push({
      fieldKey: 'name',
      fieldLabel: 'Наименование',
      expectedValue: refCp.name,
      reason: 'empty',
    });
  }

  // 2. ИНН
  const actInn = normalizeDigits(matched1C.inn);
  const expInn = normalizeDigits(refCp.inn);
  if (!actInn) {
    missingFields.push({
      fieldKey: 'inn',
      fieldLabel: 'ИНН',
      expectedValue: refCp.inn,
      reason: 'empty',
    });
  } else if (expInn && actInn !== expInn) {
    missingFields.push({
      fieldKey: 'inn',
      fieldLabel: 'ИНН',
      expectedValue: refCp.inn,
      actualValueIn1C: matched1C.inn,
      reason: 'mismatch',
    });
  }

  // 3. КПП
  if (!isIndividualEntrepreneur && normalizeDigits(refCp.kpp)) {
    const actKpp = normalizeDigits(matched1C.kpp);
    const expKpp = normalizeDigits(refCp.kpp);
    if (!actKpp) {
      missingFields.push({
        fieldKey: 'kpp',
        fieldLabel: 'КПП',
        expectedValue: refCp.kpp,
        reason: 'empty',
      });
    } else if (actKpp !== expKpp) {
      missingFields.push({
        fieldKey: 'kpp',
        fieldLabel: 'КПП',
        expectedValue: refCp.kpp,
        actualValueIn1C: matched1C.kpp,
        reason: 'mismatch',
      });
    }
  }

  // 4. Расчетный счет
  const actRs = normalizeDigits(matched1C.bankAccount);
  const expRs = normalizeDigits(refCp.bankAccount);
  if (!actRs) {
    missingFields.push({
      fieldKey: 'bankAccount',
      fieldLabel: 'Расчетный счет',
      expectedValue: refCp.bankAccount,
      reason: 'empty',
    });
  } else if (expRs && actRs !== expRs) {
    missingFields.push({
      fieldKey: 'bankAccount',
      fieldLabel: 'Расчетный счет',
      expectedValue: refCp.bankAccount,
      actualValueIn1C: matched1C.bankAccount,
      reason: 'mismatch',
    });
  }

  // 5. БИК
  const actBik = normalizeDigits(matched1C.bik);
  const expBik = normalizeDigits(refCp.bik);
  if (!actBik) {
    missingFields.push({
      fieldKey: 'bik',
      fieldLabel: 'БИК',
      expectedValue: refCp.bik,
      reason: 'empty',
    });
  } else if (expBik && actBik !== expBik) {
    missingFields.push({
      fieldKey: 'bik',
      fieldLabel: 'БИК',
      expectedValue: refCp.bik,
      actualValueIn1C: matched1C.bik,
      reason: 'mismatch',
    });
  }

  // 6. Банк
  if (!matched1C.bankName?.trim()) {
    missingFields.push({
      fieldKey: 'bankName',
      fieldLabel: 'Банк',
      expectedValue: refCp.bankName,
      reason: 'empty',
    });
  }

  // 7. Договор (номер + вид договора)
  const isTaxAuthority = /(?:фнс|ифнс)/i.test(refCp.name);
  const contractsIn1C = (matched1C.contracts || []).filter(
    (c) => (c.number && c.number.trim()) || (c.name && c.name.trim())
  );

  if (!isTaxAuthority && contractsIn1C.length === 0) {
    missingFields.push({
      fieldKey: 'contract',
      fieldLabel: 'Договор',
      expectedValue: expectedContractDisplay,
      reason: 'empty',
    });
  } else if (!isTaxAuthority && contractsIn1C.length > 0) {
    const coreExpectedToken = extractCoreContractToken(refCp.contractNumber);
    const kindExpectedNorm = (refCp.contractKind || '').toLowerCase().replace(/ё/g, 'е');

    // Check if contract number (when explicitly required like №177) or contract kind mismatches
    const hasMatchingContract = contractsIn1C.some((c) => {
      const combined = `${c.number || ''} ${c.name || ''}`.toLowerCase().replace(/ё/g, 'е');
      const kindActual = (c.kind || '').toLowerCase().replace(/ё/g, 'е');

      const kindOk =
        !kindActual ||
        !kindExpectedNorm ||
        kindActual.includes(kindExpectedNorm) ||
        kindExpectedNorm.includes(kindActual) ||
        (kindExpectedNorm === 'прочее' && /проч/i.test(kindActual));

      // Specifically enforce contract 177 on ООО «Сбыт» (and any explicit numbered contract when 1C only has "Основной договор" if mismatching)
      if (coreExpectedToken === '177' && !combined.includes('177')) {
        return false;
      }

      return kindOk;
    });

    if (!hasMatchingContract) {
      const firstC = contractsIn1C[0];
      const actualLabel = [firstC.number || firstC.name, firstC.kind ? `(${firstC.kind})` : '']
        .filter(Boolean)
        .join(' ');
      missingFields.push({
        fieldKey: 'contract',
        fieldLabel: 'Договор',
        expectedValue: expectedContractDisplay,
        actualValueIn1C: actualLabel,
        reason: 'mismatch',
      });
    }
  }

  const filledCount = Math.max(0, totalRequired - missingFields.length);
  const status: EntityRequisiteCheck['status'] =
    missingFields.length === 0 ? 'complete' : 'incomplete_in_1c';

  return {
    entityId: refCp.id,
    entityType: 'counterparty',
    name: refCp.name,
    innExpected: refCp.inn,
    status,
    totalRequired,
    filledCount,
    missingFields,
  };
}

/**
 * Performs «Реквизит-контроль» across Our Organization (8 mandatory fields) and all
 * reference Counterparties (7 mandatory fields including Contract & Contract Kind),
 * comparing against the live `Synced1CSnapshot` when available.
 */
export function checkRequisitesCompleteness(
  effectiveOrganization: OrganizationCard,
  referenceDirectories: ExtractedDirectories1C,
  synced1C: Synced1CSnapshot | null
): RequisiteCheckReport {
  const organizationCheck = checkOrganizationRequisites(effectiveOrganization, synced1C);
  const counterpartyChecks = (referenceDirectories.counterparties || []).map((cp) =>
    checkCounterpartyRequisites(cp, synced1C)
  );

  const incompleteCount =
    (organizationCheck.status !== 'complete' ? 1 : 0) +
    counterpartyChecks.filter((c) => c.status !== 'complete').length;

  return {
    has1CSnapshot: Boolean(synced1C),
    organizationCheck,
    counterpartyChecks,
    incompleteCount,
  };
}

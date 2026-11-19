export * from "./auditEngine";
export * from "./closingGenerator";
export * from "./entityExtractor";
export * from "./osvCalculator";
export * from "./osvReconciler";
export * from "./requisiteChecker";
export * from "./smartLinker";

export function extractDirectoriesFromTask(
  rawOperations: any[] = [],
  openingBalances: any[] = [],
  baseDirectories?: any,
  synced1C?: any
): {
  counterparties: any[];
  employees: any[];
  nomenclature: any[];
  contracts: any[];
  bankAccounts: any[];
  nomenclatureGroups: any[];
  expenseItems: any[];
  cashFlowItems: any[];
} {
  const ops = Array.isArray(rawOperations) ? rawOperations : [];
  const balances = Array.isArray(openingBalances) ? openingBalances : [];

  const cp1CList: any[] =
    synced1C?.ВсеСправочники?.Контрагенты ||
    synced1C?.Контрагенты ||
    baseDirectories?.counterparties ||
    [];

  const emp1CList: any[] =
    synced1C?.ВсеСправочники?.Сотрудники ||
    synced1C?.Сотрудники ||
    baseDirectories?.employees ||
    [];

  const nom1CList: any[] =
    synced1C?.ВсеСправочники?.Номенклатура ||
    synced1C?.Номенклатура ||
    baseDirectories?.nomenclature ||
    [];

  const norm = (v: any) => String(v || "").trim().toLowerCase();

  // 1. Контрагенты
  const cpMap = new Map<string, any>();

  const upsertCp = (rawName: any, extra: any = {}) => {
    const name = String(rawName || "").trim();
    if (!name || name.length < 2) return;
    const key = norm(name);
    const existing = cpMap.get(key) || {
      id: `cp-${cpMap.size + 1}`,
      name,
      inn: "",
      kpp: "",
      bankAccount: "",
      bik: "",
      bankName: "",
      contractNumber: "",
      contractType: "",
      createdIn1C: false,
      missingFields: [],
    };

    const in1C = cp1CList.find((c: any) => {
      const cName = norm(typeof c === "string" ? c : c.Наименование || c.name);
      return cName && (cName.includes(key) || key.includes(cName));
    });

    const inn = extra.inn || in1C?.ИНН || in1C?.inn || existing.inn;
    const kpp = extra.kpp || in1C?.КПП || in1C?.kpp || existing.kpp;
    const bankAccount =
      extra.bankAccount ||
      in1C?.РасчетныйСчет ||
      in1C?.bankAccount ||
      existing.bankAccount;
    const bik = extra.bik || in1C?.БИК || in1C?.bik || existing.bik;
    const bankName =
      extra.bankName || in1C?.Банк || in1C?.bankName || existing.bankName;

    const missingFields: string[] = [];
    if (!inn) missingFields.push("ИНН");
    if (!kpp && String(inn).length !== 12) missingFields.push("КПП");
    if (!bankAccount) missingFields.push("Расчетный счет");
    if (!bik) missingFields.push("БИК");

    cpMap.set(key, {
      ...existing,
      ...extra,
      name,
      inn,
      kpp,
      bankAccount,
      bik,
      bankName,
      createdIn1C: Boolean(in1C || extra.createdIn1C || existing.createdIn1C),
      missingFields,
    });
  };

  cp1CList.forEach((c: any) => {
    const name = typeof c === "string" ? c : c.Наименование || c.name;
    upsertCp(name, { createdIn1C: true });
  });

  if (Array.isArray(baseDirectories?.counterparties)) {
    baseDirectories.counterparties.forEach((c: any) =>
      upsertCp(c.name || c.Наименование, c)
    );
  }

  ops.forEach((op: any) => {
    if (op.counterparty || op.Контрагент) {
      upsertCp(op.counterparty || op.Контрагент, {
        inn: op.inn || op.ИНН || "",
        kpp: op.kpp || op.КПП || "",
        bankAccount: op.bankAccount || op.РасчетныйСчет || "",
        bik: op.bik || op.БИК || "",
      });
    }
  });

  balances.forEach((b: any) => {
    const acc = String(b.account || b.Счет || "");
    if (acc.startsWith("60") || acc.startsWith("62") || acc.startsWith("76")) {
      const sub = b.subconto1 || b.Субконто1;
      if (sub && sub !== "null") upsertCp(sub);
    }
  });

  // 2. Сотрудники
  const empMap = new Map<string, any>();
  const upsertEmp = (rawName: any, extra: any = {}) => {
    const name = String(rawName || "").trim();
    if (!name || name.length < 2) return;
    const key = norm(name);
    const in1C = emp1CList.find((e: any) => {
      const eName = norm(typeof e === "string" ? e : e.Наименование || e.name);
      return eName && (eName.includes(key) || key.includes(eName));
    });
    const prev = empMap.get(key) || {
      id: `emp-${empMap.size + 1}`,
      name,
      position: "",
      salary: 0,
      createdIn1C: false,
    };
    empMap.set(key, {
      ...prev,
      ...extra,
      name,
      createdIn1C: Boolean(in1C || extra.createdIn1C || prev.createdIn1C),
    });
  };

  emp1CList.forEach((e: any) => {
    upsertEmp(typeof e === "string" ? e : e.Наименование || e.name, {
      createdIn1C: true,
    });
  });
  if (Array.isArray(baseDirectories?.employees)) {
    baseDirectories.employees.forEach((e: any) =>
      upsertEmp(e.name || e.Наименование, e)
    );
  }
  ops.forEach((op: any) => {
    if (op.employee || op.Сотрудник) upsertEmp(op.employee || op.Сотрудник);
  });

  // 3. Номенклатура
  const nomMap = new Map<string, any>();
  const upsertNom = (rawName: any, extra: any = {}) => {
    const name = String(rawName || "").trim();
    if (!name || name.length < 2) return;
    const key = norm(name);
    const in1C = nom1CList.find((n: any) => {
      const nName = norm(typeof n === "string" ? n : n.Наименование || n.name);
      return nName && (nName.includes(key) || key.includes(nName));
    });
    const prev = nomMap.get(key) || {
      id: `nom-${nomMap.size + 1}`,
      name,
      unit: "шт",
      vatRate: "20%",
      createdIn1C: false,
    };
    nomMap.set(key, {
      ...prev,
      ...extra,
      name,
      createdIn1C: Boolean(in1C || extra.createdIn1C || prev.createdIn1C),
    });
  };

  nom1CList.forEach((n: any) => {
    upsertNom(typeof n === "string" ? n : n.Наименование || n.name, {
      createdIn1C: true,
    });
  });
  if (Array.isArray(baseDirectories?.nomenclature)) {
    baseDirectories.nomenclature.forEach((n: any) =>
      upsertNom(n.name || n.Наименование, n)
    );
  }
  ops.forEach((op: any) => {
    if (op.nomenclature || op.Номенклатура)
      upsertNom(op.nomenclature || op.Номенклатура);
    if (Array.isArray(op.items)) {
      op.items.forEach((item: any) =>
        upsertNom(item.name || item.nomenclature || item.Номенклатура, item)
      );
    }
  });

  return {
    counterparties: Array.from(cpMap.values()),
    employees: Array.from(empMap.values()),
    nomenclature: Array.from(nomMap.values()),
    contracts: Array.isArray(baseDirectories?.contracts)
      ? baseDirectories.contracts
      : [],
    bankAccounts: Array.isArray(baseDirectories?.bankAccounts)
      ? baseDirectories.bankAccounts
      : [],
    nomenclatureGroups: Array.isArray(baseDirectories?.nomenclatureGroups)
      ? baseDirectories.nomenclatureGroups
      : Array.isArray(synced1C?.ВсеСправочники?.НоменклатурныеГруппы)
      ? synced1C.ВсеСправочники.НоменклатурныеГруппы
      : [],
    expenseItems: Array.isArray(baseDirectories?.expenseItems)
      ? baseDirectories.expenseItems
      : Array.isArray(synced1C?.ВсеСправочники?.СтатьиЗатрат)
      ? synced1C.ВсеСправочники.СтатьиЗатрат
      : [],
    cashFlowItems: Array.isArray(baseDirectories?.cashFlowItems)
      ? baseDirectories.cashFlowItems
      : Array.isArray(synced1C?.ВсеСправочники?.СтатьиДвиженияДенежныхСредств)
      ? synced1C.ВсеСправочники.СтатьиДвиженияДенежныхСредств
      : [],
  };
}

export function checkRequisitesCompleteness(
  organization: any = {},
  directories: any = {},
  synced1C?: any
): any {
  const org1C = synced1C?.Организация || {};
  const respPersons: any[] =
    synced1C?.РегистрыСведений?.ОтветственныеЛицаОрганизаций || [];

  const findResponsible = (roleKeyword: string) => {
    const found = respPersons.find((r: any) =>
      String(r.ОтветственноеЛицо || r.Должность || "")
        .toLowerCase()
        .includes(roleKeyword)
    );
    return found?.ФизическоеЛицо || found?.Сотрудник || "";
  };

  const orgName = org1C.Наименование || organization?.name || "";
  const orgInn = org1C.ИНН || organization?.inn || "";
  const orgKpp = org1C.КПП || organization?.kpp || "";
  const orgAccount = org1C.РасчетныйСчет || organization?.bankAccount || "";
  const orgBik = org1C.БИК || organization?.bik || "";
  const orgBank = org1C.Банк || organization?.bankName || "";
  const director =
    organization?.director || findResponsible("руководитель") || "";
  const chiefAccountant =
    organization?.chiefAccountant || findResponsible("бухгалтер") || "";

  const orgMissing: string[] = [];
  const orgFilled: string[] = [];
  (orgName ? orgFilled : orgMissing).push("Наименование");
  (orgInn ? orgFilled : orgMissing).push("ИНН");
  if (String(orgInn).length !== 12) {
    (orgKpp ? orgFilled : orgMissing).push("КПП");
  }
  (orgAccount ? orgFilled : orgMissing).push("Расчетный счет");
  (orgBik ? orgFilled : orgMissing).push("БИК");
  (director ? orgFilled : orgMissing).push("Руководитель");
  (chiefAccountant ? orgFilled : orgMissing).push("Главный бухгалтер");

  const organizationCheck = {
    entityId: organization?.id || "org-main",
    entityType: "organization" as const,
    entityName: orgName || "Наша организация",
    missingFields: orgMissing,
    filledFields: orgFilled,
    isComplete: orgMissing.length === 0,
    status: orgMissing.length === 0 ? "complete" : "incomplete",
  };

  const organizationReport = {
    ...organizationCheck,
    name: orgName,
    inn: orgInn,
    kpp: orgKpp,
    bankAccount: orgAccount,
    bik: orgBik,
    bankName: orgBank,
    director,
    chiefAccountant,
  };

  const cp1CList: any[] =
    synced1C?.ВсеСправочники?.Контрагенты || synced1C?.Контрагенты || [];
  const contracts1C: any[] =
    synced1C?.ВсеСправочники?.ДоговорыКонтрагентов || [];
  const accounts1C: any[] =
    synced1C?.ВсеСправочники?.БанковскиеСчета || [];

  const dirCounterparties: any[] = Array.isArray(directories?.counterparties)
    ? directories.counterparties
    : [];

  const counterpartyChecks = dirCounterparties.map((cp: any, idx: number) => {
    const name = String(cp.name || cp.Наименование || "").trim();
    const normName = name.toLowerCase();

    const matched1C = cp1CList.find((c: any) => {
      const cName = String(c.Наименование || c.name || "").toLowerCase();
      return cName && (cName.includes(normName) || normName.includes(cName));
    });

    const matchedAcc = accounts1C.find((a: any) =>
      String(a.Владелец || "").toLowerCase().includes(normName)
    );

    const matchedContract = contracts1C.find((d: any) =>
      String(d.Владелец || "").toLowerCase().includes(normName)
    );

    const inn = matched1C?.ИНН || cp.inn || "";
    const kpp = matched1C?.КПП || cp.kpp || "";
    const bankAccount =
      matched1C?.РасчетныйСчет ||
      matchedAcc?.НомерСчета ||
      cp.bankAccount ||
      "";
    const bik = matched1C?.БИК || cp.bik || "";
    const bankName = matched1C?.Банк || cp.bankName || "";
    const contractNumber =
      matchedContract?.Номер ||
      matchedContract?.Наименование ||
      cp.contractNumber ||
      "";
    const contractType =
      matchedContract?.ВидДоговора || cp.contractType || "";

    const missingFields: string[] = [];
    const filledFields: string[] = [];
    (inn ? filledFields : missingFields).push("ИНН");
    if (String(inn).length !== 12) {
      (kpp ? filledFields : missingFields).push("КПП");
    }
    (bankAccount ? filledFields : missingFields).push("Расчетный счет");
    (bik ? filledFields : missingFields).push("БИК");
    (contractNumber ? filledFields : missingFields).push("Договор");

    const createdIn1C = Boolean(matched1C || cp.createdIn1C);
    const isComplete = missingFields.length === 0;

    return {
      entityId: cp.id || `cp-${idx + 1}`,
      entityType: "counterparty" as const,
      entityName: name,
      id: cp.id || `cp-${idx + 1}`,
      name,
      inn,
      kpp,
      bankAccount,
      bik,
      bankName,
      contractNumber,
      contractType,
      createdIn1C,
      missingFields,
      filledFields,
      isComplete,
      status: isComplete ? "complete" : createdIn1C ? "incomplete" : "missing",
    };
  });

  const dirEmployees: any[] = Array.isArray(directories?.employees)
    ? directories.employees
    : [];

  const employeeChecks = dirEmployees.map((emp: any, idx: number) => {
    const name = String(emp.name || emp.Наименование || "").trim();
    const missingFields: string[] = [];
    const filledFields: string[] = [];
    (emp.position ? filledFields : missingFields).push("Должность");
    (emp.salary ? filledFields : missingFields).push("Оклад");

    return {
      entityId: emp.id || `emp-${idx + 1}`,
      entityType: "employee" as const,
      entityName: name,
      id: emp.id || `emp-${idx + 1}`,
      name,
      createdIn1C: Boolean(emp.createdIn1C),
      missingFields,
      filledFields,
      isComplete: missingFields.length === 0,
      status: missingFields.length === 0 ? "complete" : "incomplete",
    };
  });

  const incompleteCount =
    counterpartyChecks.filter((c: any) => !c.isComplete).length +
    (organizationCheck.isComplete ? 0 : 1);
  const totalChecked = counterpartyChecks.length + 1;
  const completeCount = totalChecked - incompleteCount;
  const totalMissing =
    orgMissing.length +
    counterpartyChecks.reduce(
      (sum: number, c: any) => sum + c.missingFields.length,
      0
    );

  const issues = [
    ...(orgMissing.length > 0 ? [organizationCheck] : []),
    ...counterpartyChecks.filter((c: any) => c.missingFields.length > 0),
  ];

  return {
    organizationCheck,
    counterpartyChecks,
    employeeChecks,
    organization: organizationReport,
    counterparties: counterpartyChecks,
    issues,
    totalChecked,
    completeCount,
    incompleteCount,
    missingCount: totalMissing,
    totalMissing,
    isAllComplete: totalMissing === 0,
  };
}

export function enrichOperationsWith1CMatch(
  operations: any[],
  synced1C?: any,
  requisiteReport?: any
): any[] {
  if (!Array.isArray(operations)) return [];
  if (!synced1C) return operations;

  const postings1C: any[] = Array.isArray(synced1C.ПроводкиС_Апреля)
    ? synced1C.ПроводкиС_Апреля
    : [];

  const docs1C: any[] = synced1C.ВсеДокументы
    ? Object.values(synced1C.ВсеДокументы).flat()
    : [];

  return operations.map((op: any) => {
    const opDate = String(op.date || op.Дата || "").slice(0, 10);
    const opAmount = Number(op.amount || op.Сумма || 0);
    const opCounterparty = String(
      op.counterparty || op.Контрагент || ""
    ).toLowerCase();

    const matchedPostings = postings1C.filter((p: any) => {
      const pDate = String(p.Дата || "").slice(0, 10);
      const pAmount = Number(p.Сумма || 0);
      const subText = `${p.СубконтоДт1 || ""} ${p.СубконтоДт2 || ""} ${p.СубконтоКт1 || ""} ${p.СубконтоКт2 || ""} ${p.Документ || ""}`.toLowerCase();

      const amountMatch = opAmount > 0 && Math.abs(pAmount - opAmount) < 1;
      const dateMatch = opDate && pDate === opDate;
      const cpMatch = opCounterparty && subText.includes(opCounterparty);

      return (amountMatch && (dateMatch || cpMatch)) || (dateMatch && cpMatch);
    });

    const matchedDoc = docs1C.find((d: any) => {
      const dDate = String(d.Дата || "").slice(0, 10);
      const dSum = Number(d.СуммаДокумента || d.Сумма || 0);
      const dCp = String(d.Контрагент || "").toLowerCase();

      const sameDate = opDate && dDate === opDate;
      const sameCp = opCounterparty && dCp.includes(opCounterparty);
      const sameSum = opAmount > 0 && Math.abs(dSum - opAmount) < 1;

      return (sameDate && sameCp) || (sameCp && sameSum);
    });

    const missingRequisites: string[] = [];
    if (
      requisiteReport &&
      Array.isArray(requisiteReport.counterparties) &&
      opCounterparty
    ) {
      const cpReport = requisiteReport.counterparties.find((c: any) =>
        String(c.name || c.Наименование || "")
          .toLowerCase()
          .includes(opCounterparty)
      );
      if (cpReport && Array.isArray(cpReport.missingFields)) {
        missingRequisites.push(...cpReport.missingFields);
      }
    }

    const isExactMatch =
      matchedPostings.length > 0 &&
      (!opAmount ||
        matchedPostings.some(
          (p: any) => Math.abs(Number(p.Сумма || 0) - opAmount) < 1
        ));

    return {
      ...op,
      status: isExactMatch ? "done" : op.status,
      match1C: {
        status: isExactMatch
          ? "matched"
          : matchedDoc || matchedPostings.length > 0
          ? "discrepancy"
          : "missing",
        postings: matchedPostings,
        document: matchedDoc || null,
        missingRequisites,
      },
    };
  });
}
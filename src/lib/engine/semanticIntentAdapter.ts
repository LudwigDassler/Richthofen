import type { RawDraftOperationInput } from './postingEngine';
import type { ParsedOperationIntent } from '@/types/semanticIntent';

/**
 * Применяет проверенное семантическое намерение ИИ-главбуха (Слой 1)
 * к черновому входу детерминированного математического ядра 1С:БП 3.0 (Слой 2).
 *
 * ВАЖНО: адаптер НЕ вычисляет суммы НДС, амортизации, ФОТ, НДФЛ, остатков ТМЦ или ОСВ.
 * Все расчётные показатели вычисляются исключительно внутри postingEngine / virtual1CState.
 */
export function applyParsedIntentToDraft(
  baseDraft: RawDraftOperationInput,
  intent: ParsedOperationIntent
): RawDraftOperationInput {
  const next: RawDraftOperationInput = {
    ...baseDraft,
    semanticIntent: intent,
    categoryHint: intent.category,
    docTypeHint: intent.docType1C,
  };

  // Намерение по сумме: сохраняем rawExcelAmount нетронутым; для расчётных/непроводных режимов
  // обнуляем amount только если исходная колонка Excel не содержит явной суммы.
  if (
    intent.amountIntent.mode === 'payroll_from_staff' ||
    intent.amountIntent.mode === 'full_stock_writeoff' ||
    intent.amountIntent.mode === 'closing_auto' ||
    intent.amountIntent.mode === 'non_posting' ||
    intent.isNonPostingEvent
  ) {
    if (
      intent.category === 'hr_hire' ||
      intent.category === 'writ_of_execution' ||
      intent.category === 'policy_event'
    ) {
      next.amount = 0;
    } else if (intent.category === 'wip_inventory' && next.rawExcelAmount && next.rawExcelAmount > 0) {
      next.amount = next.rawExcelAmount;
    } else if (!(next.rawExcelAmount && next.rawExcelAmount > 0)) {
      next.amount = 0;
    }
  } else if (
    intent.amountIntent.mode === 'qty_times_price' &&
    intent.nomenclature?.quantity &&
    intent.nomenclature.quantity > 0 &&
    intent.nomenclature?.unitPrice &&
    intent.nomenclature.unitPrice > 0 &&
    !(next.rawExcelAmount && next.rawExcelAmount > 0)
  ) {
    next.amount =
      Math.round((intent.nomenclature.quantity * intent.nomenclature.unitPrice + Number.EPSILON) * 100) /
      100;
  }

  if (intent.amountIntent.orderTotalAmount && intent.amountIntent.orderTotalAmount > 0) {
    next.orderTotalAmount = intent.amountIntent.orderTotalAmount;
  }
  if (intent.amountIntent.isRecurringMonthly !== undefined) {
    next.isRecurringMonthly = intent.amountIntent.isRecurringMonthly;
    if (!intent.amountIntent.isRecurringMonthly) {
      next.periodicPaymentAmount = undefined;
    }
  }

  // Намерение по НДС
  next.vatRule =
    intent.vatIntent.rule === 'included'
      ? 'included'
      : intent.vatIntent.rule === 'on_top'
        ? 'on_top'
        : 'none';
  next.vatRate = intent.vatIntent.rate;

  // Собственная организация (для УК 75.01 / 80.09)
  if (intent.ownOrganization && intent.ownOrganization.canonicalName.trim().length >= 2) {
    next.ownOrganization = {
      name: intent.ownOrganization.canonicalName.trim(),
      inn: (intent.ownOrganization.inn || '').replace(/\D/g, ''),
      kpp: intent.ownOrganization.kpp?.replace(/\D/g, '') || undefined,
    };
  }

  // Внешний контрагент
  if (intent.counterparty && intent.counterparty.canonicalName.trim().length >= 2) {
    next.counterpartyName = intent.counterparty.canonicalName.trim();
    if (intent.counterparty.inn && /^\d{10}(\d{2})?$/.test(intent.counterparty.inn.trim())) {
      next.counterpartyInn = intent.counterparty.inn.trim();
    }
    if (intent.counterparty.kpp && /^\d{9}$/.test(intent.counterparty.kpp.trim())) {
      next.counterpartyKpp = intent.counterparty.kpp.trim();
    }
    next.counterpartyKindHint =
      intent.counterparty.kind === 'individual' ? 'ФизическоеЛицо' : 'ЮридическоеЛицо';
  }

  // Многострочный подбор материалов / ТМЦ (например: Плита ПВХ, Заготовка МДФ, Клей)
  if (intent.items && intent.items.length > 0) {
    next.items = intent.items.map((it) => ({
      cleanName: it.cleanName,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      account: it.account !== 'service' ? it.account : undefined,
    }));
  }

  // Номенклатура, субсчёт 10.* / 43 / 41.01 / 08.04.1, объект работ / НЗП (номенклатурная группа)
  if (intent.nomenclature) {
    if (intent.nomenclature.canonicalName.trim().length >= 2) {
      next.nomenclatureName = intent.nomenclature.canonicalName.trim();
    } else if (!intent.nomenclature.canonicalName.trim()) {
      next.nomenclatureName = '';
    }
    if (
      intent.nomenclature.quantity !== undefined &&
      intent.nomenclature.quantity > 0 &&
      !(next.quantity && next.quantity > 0)
    ) {
      next.quantity = intent.nomenclature.quantity;
    }
    if (
      intent.nomenclature.unitPrice !== undefined &&
      intent.nomenclature.unitPrice > 0 &&
      !(next.unitPrice && next.unitPrice > 0)
    ) {
      next.unitPrice = intent.nomenclature.unitPrice;
    }
    if (
      intent.nomenclature.nomenclatureGroup &&
      intent.nomenclature.nomenclatureGroup.trim().length >= 2
    ) {
      next.nomenclatureGroupHint = intent.nomenclature.nomenclatureGroup.trim();
    }
    if (
      intent.nomenclature.account.startsWith('10.') ||
      intent.nomenclature.account === '43' ||
      intent.nomenclature.account === '41.01' ||
      intent.nomenclature.account === '08.04.1' ||
      intent.nomenclature.account === '97.21'
    ) {
      next.materialAccountHint = intent.nomenclature.account;
    }
  }

  // Кадры, ФОТ, вычеты и исполнительные листы
  if (intent.employee) {
    if (intent.employee.fullName.trim().length >= 2) {
      next.employeeName = intent.employee.fullName.trim();
    }
    if (intent.employee.position && intent.employee.position.trim().length >= 2) {
      next.employeePosition = intent.employee.position.trim();
    }
    if (
      intent.employee.monthlySalary !== undefined &&
      intent.employee.monthlySalary > 0 &&
      !(next.monthlySalary && next.monthlySalary > 0)
    ) {
      next.monthlySalary = intent.employee.monthlySalary;
    }
    if (
      intent.employee.hireStartDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(intent.employee.hireStartDate)
    ) {
      next.employeeHireStartDate = intent.employee.hireStartDate;
    }
    if (
      intent.employee.terminationDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(intent.employee.terminationDate)
    ) {
      next.employeeTerminationDate = intent.employee.terminationDate;
    }
    if (intent.employee.costAccount) {
      next.costAccountHint = intent.employee.costAccount;
    }
    if (
      intent.employee.nomenclatureGroup &&
      intent.employee.nomenclatureGroup.trim().length >= 2
    ) {
      next.nomenclatureGroupHint = intent.employee.nomenclatureGroup.trim();
    }
    if (intent.employee.childDeductionCount !== undefined && intent.employee.childDeductionCount >= 0) {
      next.employeeChildCount = intent.employee.childDeductionCount;
    }
    if (intent.employee.isSingleParent !== undefined) {
      next.employeeIsSingleParent = intent.employee.isSingleParent;
    }
    if (
      intent.employee.propertyDeductionAmount !== undefined &&
      intent.employee.propertyDeductionAmount > 0
    ) {
      next.employeePropertyDeduction = intent.employee.propertyDeductionAmount;
    }
    if (intent.employee.alimony) {
      next.alimonyRecipientName = intent.employee.alimony.recipientName;
      if (intent.employee.alimony.recipientInn) {
        next.alimonyRecipientInn = intent.employee.alimony.recipientInn;
      }
      if (intent.employee.alimony.sharePercent !== undefined) {
        next.alimonyRatePercent = intent.employee.alimony.sharePercent;
      }
      if (intent.employee.alimony.fixedAmount !== undefined) {
        next.alimonyFixedAmount = intent.employee.alimony.fixedAmount;
      }
      if (intent.employee.alimony.startDate) {
        next.writStartDate = intent.employee.alimony.startDate;
      }
    }
  }

  // Расходы будущих периодов (97.21)
  if (intent.rpbIntent) {
    next.rpbTermMonths = intent.rpbIntent.termMonths;
    next.rpbSettlementAccount = intent.rpbIntent.settlementAccount;
    if (intent.rpbIntent.writeOffMethod) {
      next.rpbWriteOffMethod = intent.rpbIntent.writeOffMethod;
    }
    if (intent.rpbIntent.startDate && /^\d{4}-\d{2}-\d{2}$/.test(intent.rpbIntent.startDate)) {
      next.rpbStartDate = intent.rpbIntent.startDate;
    }
    if (intent.rpbIntent.endDate && /^\d{4}-\d{2}-\d{2}$/.test(intent.rpbIntent.endDate)) {
      next.rpbEndDate = intent.rpbIntent.endDate;
    }
    next.costAccountHint = intent.rpbIntent.costAccount;
    if (!next.nomenclatureName && intent.rpbIntent.assetName) {
      next.nomenclatureName = intent.rpbIntent.assetName;
    }
  }

  // Основные средства (08.04.1 / 01.01 / модернизация)
  if (intent.osIntent) {
    if (intent.osIntent.spiMonths && intent.osIntent.spiMonths > 0) {
      next.usefulLifeMonths = intent.osIntent.spiMonths;
    }
    if (intent.osIntent.isModernization) {
      next.isOsModernization = true;
    }
    next.costAccountHint = intent.osIntent.costAccount;
    if (!next.nomenclatureName && intent.osIntent.assetName) {
      next.nomenclatureName = intent.osIntent.assetName;
    }
  }

  // Комбинированная оплата в той же строке (Дт 76.09/60.01 Кт 51/50/71)
  if (intent.paidImmediately?.enabled) {
    next.paidImmediatelyVia = intent.paidImmediately.via;
  }

  // Явные проводки из условия преподавателя (если не были извлечены локально)
  if (
    intent.explicitEntries &&
    intent.explicitEntries.length > 0 &&
    !(next.explicitCorrespondences && next.explicitCorrespondences.length > 0)
  ) {
    next.explicitCorrespondences = intent.explicitEntries.map((e) => ({
      debit: e.debit,
      credit: e.credit,
    }));
  }

  // Защитный клапан customPostings для нетиповых ручных операций (ОперацияБух)
  if (intent.customPostings && intent.customPostings.length > 0) {
    next.customPostings = intent.customPostings.map((cp) => ({ ...cp }));
  }

  if (intent.studentExplanation && intent.studentExplanation.trim().length >= 3) {
    next.studentExplanation = intent.studentExplanation.trim();
  }

  return next;
}

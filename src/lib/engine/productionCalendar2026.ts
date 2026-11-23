/**
 * Official 2026 Russian Federation Production Calendar (5-day workweek, Mon–Fri)
 * in accordance with Art. 112 of the Labor Code of the RF and Government Decree on 2026 holiday transfers:
 * - Sat Jan 3 -> Fri Jan 9
 * - Sun Jan 4 -> Thu Dec 31
 * - Sun Mar 8 -> Mon Mar 9
 * - Sat May 9 -> Mon May 11
 *
 * Monthly working day totals for 2026:
 * Jan: 15, Feb: 19, Mar: 21, Apr: 22, May: 19, Jun: 21,
 * Jul: 23, Aug: 21, Sep: 22, Oct: 22, Nov: 20, Dec: 22 (Total: 247 working days).
 */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Non-working public holidays and official transferred holidays in 2026 (MM-DD).
 */
export const RF_NON_WORKING_HOLIDAYS_2026 = new Set<string>([
  // New Year & Christmas holidays + transferred Fri Jan 9
  '01-01',
  '01-02',
  '01-03',
  '01-04',
  '01-05',
  '01-06',
  '01-07',
  '01-08',
  '01-09',
  // Defender of the Fatherland Day
  '02-23',
  // International Women's Day + transferred Mon Mar 9
  '03-08',
  '03-09',
  // Spring and Labor Day
  '05-01',
  // Victory Day + transferred Mon May 11
  '05-09',
  '05-11',
  // Russia Day
  '06-12',
  // National Unity Day
  '11-04',
  // Transferred New Year's Eve from Sun Jan 4
  '12-31',
]);

/**
 * Standard RF public holidays for non-2026 fallback years (MM-DD).
 */
const RF_FIXED_HOLIDAYS_FALLBACK = new Set<string>([
  '01-01',
  '01-02',
  '01-03',
  '01-04',
  '01-05',
  '01-06',
  '01-07',
  '01-08',
  '02-23',
  '03-08',
  '05-01',
  '05-09',
  '06-12',
  '11-04',
]);

export const RF_WORKING_DAYS_BY_MONTH_2026: Readonly<Record<number, number>> = {
  1: 15,
  2: 19,
  3: 21,
  4: 22,
  5: 19,
  6: 21,
  7: 23,
  8: 21,
  9: 22,
  10: 22,
  11: 20,
  12: 22,
};

function daysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

export function isRfWorkingDay(year: number, month1To12: number, day1To31: number): boolean {
  const dt = new Date(Date.UTC(year, month1To12 - 1, day1To31));
  const dow = dt.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return false;
  const mmdd = `${String(month1To12).padStart(2, '0')}-${String(day1To31).padStart(2, '0')}`;
  if (year === 2026) {
    return !RF_NON_WORKING_HOLIDAYS_2026.has(mmdd);
  }
  return !RF_FIXED_HOLIDAYS_FALLBACK.has(mmdd);
}

export function getWorkingDaysInMonthRf(year: number, month1To12: number): number {
  if (year === 2026 && RF_WORKING_DAYS_BY_MONTH_2026[month1To12] !== undefined) {
    return RF_WORKING_DAYS_BY_MONTH_2026[month1To12];
  }
  const totalCalDays = daysInMonth(year, month1To12);
  let count = 0;
  for (let d = 1; d <= totalCalDays; d++) {
    if (isRfWorkingDay(year, month1To12, d)) count += 1;
  }
  return count;
}

export interface ProRataSalaryCalculation {
  monthlySalary: number;
  accruedSalary: number;
  workedDays: number;
  totalWorkingDays: number;
  isProRata: boolean;
  formulaNote?: string;
}

/**
 * Computes exact monthly salary for an employee in 1C:BP 3.0 (Art. 129, 136 TK RF):
 * - If hired before or on the first working day of the payroll month (and not terminated mid-month),
 *   workedDays === totalWorkingDays -> 100% of monthlySalary.
 * - If hired after the first working day of the month (or terminated before the last working day),
 *   accruedSalary = round2(monthlySalary * workedDays / totalWorkingDays).
 */
export function calculateEmployeeMonthlySalaryProRata2026(params: {
  monthlySalary: number;
  payrollDateIso: string;
  hireDateIso?: string;
  terminationDateIso?: string;
}): ProRataSalaryCalculation {
  const baseSalary = round2(Math.max(0, params.monthlySalary || 0));
  const m = (params.payrollDateIso || '').match(/^(\d{4})-(\d{2})/);
  if (!m || baseSalary <= 0) {
    return {
      monthlySalary: baseSalary,
      accruedSalary: baseSalary,
      workedDays: 0,
      totalWorkingDays: 0,
      isProRata: false,
    };
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const ymPrefix = `${m[1]}-${m[2]}`;
  const calDays = daysInMonth(year, month);

  const hireIso = (params.hireDateIso || '').slice(0, 10);
  const termIso = (params.terminationDateIso || '').slice(0, 10);

  // If hired strictly after the end of this month or terminated strictly before the start of this month
  const monthStartIso = `${ymPrefix}-01`;
  const monthEndIso = `${ymPrefix}-${String(calDays).padStart(2, '0')}`;
  if ((hireIso && hireIso > monthEndIso) || (termIso && termIso < monthStartIso)) {
    const totalWorkingDays = getWorkingDaysInMonthRf(year, month);
    return {
      monthlySalary: baseSalary,
      accruedSalary: 0,
      workedDays: 0,
      totalWorkingDays,
      isProRata: true,
      formulaNote: `0 из ${totalWorkingDays} раб. дн.`,
    };
  }

  let totalWorkingDays = 0;
  let workedDays = 0;

  for (let d = 1; d <= calDays; d++) {
    if (!isRfWorkingDay(year, month, d)) continue;
    totalWorkingDays += 1;
    const dayIso = `${ymPrefix}-${String(d).padStart(2, '0')}`;
    if (hireIso && dayIso < hireIso) continue;
    if (termIso && dayIso > termIso) continue;
    workedDays += 1;
  }

  if (totalWorkingDays <= 0 || workedDays >= totalWorkingDays) {
    return {
      monthlySalary: baseSalary,
      accruedSalary: baseSalary,
      workedDays: totalWorkingDays,
      totalWorkingDays,
      isProRata: false,
    };
  }

  const accruedSalary = round2((baseSalary * workedDays) / totalWorkingDays);
  return {
    monthlySalary: baseSalary,
    accruedSalary,
    workedDays,
    totalWorkingDays,
    isProRata: true,
    formulaNote: `${baseSalary.toLocaleString('ru-RU')} ₽ × ${workedDays} / ${totalWorkingDays} раб. дн. = ${accruedSalary.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`,
  };
}

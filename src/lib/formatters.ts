export function formatMoney(value: number, showZero = false): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) {
    return showZero ? '0,00' : '—';
  }
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return formatted;
}

export function formatMoneyWithCurrency(value: number): string {
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
  return `${formatted} ₽`;
}

export function formatDateRu(isoDate: string): string {
  if (!isoDate) return '—';
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

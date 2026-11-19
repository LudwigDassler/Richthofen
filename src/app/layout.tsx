import type { Metadata } from 'next';
import './globals.css';
import { AccountantProvider } from '@/context/AccountantContext';

export const metadata: Metadata = {
  title: '1С:Личный Бухгалтер (8.3) — Контроль реквизитов, ОСВ и аудит ошибок',
  description:
    'Профессиональная рабочая среда для 1С:Бухгалтерия 8.3 (ред. 3.0): пошаговый разбор операций, реквизит-контроль, живая синхронизация с 1С, сверка ОСВ и автоматический поиск ошибок.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="min-h-screen bg-[#FAFAFA] text-zinc-950 dark:bg-[#09090B] dark:text-zinc-50 antialiased selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-900">
        <AccountantProvider>{children}</AccountantProvider>
      </body>
    </html>
  );
}

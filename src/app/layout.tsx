import type { Metadata } from 'next';
import { Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AccountantProvider } from '@/context/AccountantContext';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-mono',
  display: 'swap',
});

const APP_TITLE = '1С:Бухгалтерский Контур 8.3';
const APP_DESCRIPTION =
  'Рабочая среда бухгалтера 1С:Предприятие 8.3 (БП 3.0, РСБУ, ОСНО): загрузка базы 1С, расчёт ОСВ, пакетный разбор документов, автопроводки, реквизит-контроль и экспорт в 1С (.bsl, EnterpriseData XML, JSON).';

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${manrope.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen font-sans bg-[#F8F9FA] text-zinc-950 dark:bg-[#0B0C0E] dark:text-zinc-100 antialiased selection:bg-amber-600 selection:text-white">
        <AccountantProvider>{children}</AccountantProvider>
      </body>
    </html>
  );
}

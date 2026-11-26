import React, { Suspense } from 'react';
import { ClientAppEntry } from '@/components/ClientAppEntry';

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
          Загрузка рабочего контура 1С:Бухгалтерия 8.3...
        </div>
      }
    >
      <ClientAppEntry />
    </Suspense>
  );
}

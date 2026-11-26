'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const WorkspaceRoot = dynamic(() => import('@/components/WorkspaceRoot'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
      Загрузка рабочего контура 1С:Бухгалтерия 8.3...
    </div>
  ),
});

export function ClientAppEntry() {
  return <WorkspaceRoot />;
}

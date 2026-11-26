'use client';

import React from 'react';
import { AccountantProvider } from '@/context/AccountantContext';
import { WorkspaceShell } from '@/components/WorkspaceShell';

export default function WorkspaceRoot() {
  return (
    <AccountantProvider>
      <WorkspaceShell />
    </AccountantProvider>
  );
}

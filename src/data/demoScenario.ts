import { DemoScenarioPreset } from '@/types/accounting';

export const DEMO_SCENARIOS: DemoScenarioPreset[] = [
  {
    id: 'clean-1c',
    title: 'Рабочая база 1С',
    subtitle: '',
    organization: {
      name: '',
      shortName: '',
      inn: '',
      kpp: '',
      ogrn: '',
      bankAccount: '',
      bankName: '',
      bik: '',
      corrAccount: '',
      address: '',
      taxSystem: 'OSNO',
      defaultVatRate: 20,
      directorName: '',
      chiefAccountantName: '',
      studentName: '',
      substituteStudentInOrgName: false,
      substituteStudentAsAccountant: false,
      costingMethod: 'direct-costing',
      periodLabel: '',
      periodStartDate: '',
    },
    openingBalances: [],
    operations: [],
  },
];

export const DEFAULT_DEMO_SCENARIO = DEMO_SCENARIOS[0];

import type { Step } from '../models/pipeline.models';

export const GIT_STEPS: Omit<Step, 'status' | 'detail'>[] = [
  { id: 'build',    label: 'Build Solution',  sublabel: 'dotnet build — must pass before push' },
  { id: 'checkout', label: 'Checkout Branch', sublabel: 'Switch to source branch'              },
  { id: 'add',      label: 'Stage Changes',   sublabel: 'git add . — all files'               },
  { id: 'status',   label: 'Show Status',     sublabel: 'Confirm staged files'                },
  { id: 'commit',   label: 'Commit',          sublabel: 'Save snapshot with message'          },
  { id: 'push',     label: 'Push to GitHub',  sublabel: 'Upload to remote branch'             },
];

export const PIPE_STEPS: Omit<Step, 'status' | 'detail'>[] = [
  { id: 'validate',   label: 'Validate Repo',  sublabel: 'Check token & repo access'          },
  { id: 'branches',   label: 'Check Branches', sublabel: 'Verify branches & sync CI workflow' },
  { id: 'check-pr',   label: 'Detect PR',      sublabel: 'Find open pull request'             },
  { id: 'create-pr',  label: 'Create PR',      sublabel: 'Open or reuse pull request'         },
  { id: 'auto-merge', label: 'Auto-merge',     sublabel: 'Enable merge on CI pass'            },
  { id: 'monitor-ci', label: 'Monitor CI',     sublabel: 'Poll GitHub Actions status'         },
  { id: 'pr-merge',   label: 'PR Merged',      sublabel: 'Confirm merge into target branch'   },
];

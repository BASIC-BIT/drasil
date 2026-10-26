// Design-only state definitions. No production action adapter is connected.
export interface StudyAction {
  readonly id: string;
  readonly label: string;
  readonly effect: string;
  readonly tone?: 'neutral' | 'positive' | 'warning' | 'danger';
  readonly reason?: 'required' | 'optional';
}

export type ToolView =
  | { readonly kind: 'quarantine'; readonly state: 'preview' | 'incomplete' | 'parked' }
  | {
      readonly kind: 'security';
      readonly state: 'pending' | 'passed' | 'expired' | 'delivery_failed' | 'bypassed';
    }
  | {
      readonly kind: 'cleanup';
      readonly state: 'scope' | 'preview' | 'blocked' | 'results' | 'finalization';
    };

export type ResultView =
  'queued' | 'processing' | 'failed' | 'updates_pending' | 'unknown' | 'resolved_elsewhere';

export const workflowViews = {
  inbox: 'Mixed inbox',
  report: 'Submitted report',
  alert: 'Observed alert',
  screening: 'Discord screening',
  reporter: 'Reporter follow-up',
  support: 'Recovery reply',
  breach: 'Containment breach',
  quarantine: 'Quarantine preview',
  incomplete: 'Incomplete containment',
  recovery: 'Account recovery',
  security: 'Security check pending',
  passed: 'Security check passed',
  expired: 'Security check expired',
  delivery: 'Security check delivery failed',
  bypassed: 'Security check bypassed',
  cleanup: 'Message cleanup scope',
  preview: 'Message cleanup preview',
  blocked: 'Message cleanup blocked',
  cleanupResults: 'Message cleanup results',
  finalization: 'Case finalization retry',
  conversation: 'Channel conversation',
  unavailable: 'Conversation unavailable',
  queued: 'Action queued',
  processing: 'Action processing',
  failed: 'Action failure',
  updates: 'Ban updates pending',
  unknown: 'Ban outcome unknown',
  resolved: 'Resolved by another moderator',
} as const;
export type WorkflowViewName = keyof typeof workflowViews;

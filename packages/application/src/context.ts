export type SystemPurpose = 'captcha_pass' | 'captcha_attention' | 'report_ban_recovery';

export interface ActionContext {
  readonly guildId: string;
  readonly requestId: string;
  readonly source: string;
  readonly actor:
    | { readonly kind: 'user'; readonly userId: string }
    | { readonly kind: 'system'; readonly purpose: SystemPurpose };
}

export type ActionDenialCode =
  | 'permission_denied'
  | 'policy_disabled'
  | 'reason_required'
  | 'confirmation_required'
  | 'binding_mismatch'
  | 'stale_state'
  | 'actor_unavailable';

export type ActionResult<T> =
  | { readonly kind: 'outcome'; readonly outcome: T }
  | { readonly kind: 'denied'; readonly code: ActionDenialCode };

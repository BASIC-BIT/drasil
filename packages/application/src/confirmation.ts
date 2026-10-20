// Runtime adapters verify their existing confirmation store before producing this binding.
export interface ConfirmationBinding {
  readonly guildId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
}

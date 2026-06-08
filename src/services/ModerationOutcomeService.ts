import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IModerationOutcomeRepository } from '../repositories/ModerationOutcomeRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IUserRepository } from '../repositories/UserRepository';
import {
  ModerationOutcome,
  ModerationOutcomeCreate,
  ModerationOutcomeSource,
  ModerationOutcomeType,
} from '../repositories/types';

export interface ModerationOutcomeRecordInput extends ModerationOutcomeCreate {
  username?: string | null;
  accountCreatedAt?: Date | null;
}

export interface IModerationOutcomeService {
  recordOutcome(data: ModerationOutcomeRecordInput): Promise<ModerationOutcome>;
}

@injectable()
export class ModerationOutcomeService implements IModerationOutcomeService {
  constructor(
    @inject(TYPES.ModerationOutcomeRepository)
    private moderationOutcomeRepository: IModerationOutcomeRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository
  ) {}

  async recordOutcome(data: ModerationOutcomeRecordInput): Promise<ModerationOutcome> {
    await Promise.all([
      this.serverRepository.getOrCreateServer(data.server_id),
      this.userRepository.getOrCreateUser(
        data.user_id,
        data.username ?? undefined,
        data.accountCreatedAt ?? undefined
      ),
    ]);

    return this.moderationOutcomeRepository.createOutcome({
      server_id: data.server_id,
      user_id: data.user_id,
      detection_event_id: data.detection_event_id,
      verification_event_id: data.verification_event_id,
      outcome_type: data.outcome_type,
      source: data.source,
      actor_id: data.actor_id,
      reason: data.reason,
      occurred_at: data.occurred_at,
      metadata: data.metadata,
    });
  }
}

export { ModerationOutcomeSource, ModerationOutcomeType };

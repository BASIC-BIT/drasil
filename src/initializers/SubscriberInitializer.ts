import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { RestrictionSubscriber } from '../events/subscribers/RestrictionSubscriber';
import { NotificationSubscriber } from '../events/subscribers/NotificationSubscriber';
import { RoleUpdateSubscriber } from '../events/subscribers/RoleUpdateSubscriber';
import { ActionLogSubscriber } from '../events/subscribers/ActionLogSubscriber';
import { ServerMemberStatusSubscriber } from '../events/subscribers/ServerMemberStatusSubscriber';
import { VerificationReopenSubscriber } from '../events/subscribers/VerificationReopenSubscriber';
import { DetectionResultHandlerSubscriber } from '../events/subscribers/DetectionResultHandlerSubscriber';
import { AdminFlagUserSubscriber } from '../events/subscribers/AdminFlagUserSubscriber';
import { UserReportSubscriber } from '../events/subscribers/UserReportSubscriber';

/**
 * Interface for the Subscriber Initializer service.
 * Its purpose is to ensure all necessary event subscribers are instantiated eagerly.
 */
export interface ISubscriberInitializer {}

@injectable()
export class SubscriberInitializer implements ISubscriberInitializer {
  constructor(
    /* eslint-disable no-unused-vars */
    // Inject all subscribers that need eager loading.
    // The act of injecting them forces InversifyJS to create their instances.
    @inject(TYPES.RestrictionSubscriber) _restrictionSubscriber: RestrictionSubscriber,
    @inject(TYPES.NotificationSubscriber) _notificationSubscriber: NotificationSubscriber,
    @inject(TYPES.RoleUpdateSubscriber) _roleUpdateSubscriber: RoleUpdateSubscriber,
    @inject(TYPES.ActionLogSubscriber) _actionLogSubscriber: ActionLogSubscriber,
    @inject(TYPES.ServerMemberStatusSubscriber)
    _serverMemberStatusSubscriber: ServerMemberStatusSubscriber,
    @inject(TYPES.VerificationReopenSubscriber)
    _verificationReopenSubscriber: VerificationReopenSubscriber,
    @inject(TYPES.DetectionResultHandlerSubscriber)
    _detectionResultHandlerSubscriber: DetectionResultHandlerSubscriber, // Added comma
    @inject(TYPES.AdminFlagUserSubscriber) _adminFlagUserSubscriber: AdminFlagUserSubscriber,
    @inject(TYPES.UserReportSubscriber) _userReportSubscriber: UserReportSubscriber
    /* eslint-enable no-unused-vars */
  ) {
    // The constructor body can be empty. The dependencies are resolved upon instantiation.
  }
}

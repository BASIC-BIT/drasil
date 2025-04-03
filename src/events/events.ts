// src/events/events.ts

import { DetectionResult } from '../services/DetectionOrchestrator';
import { AdminAction, VerificationEvent } from '../repositories/types';

// Event Names (using constants for type safety)
export const EventNames = {
  UserDetectedSuspicious: 'userDetectedSuspicious',
  VerificationStarted: 'verificationStarted',
  UserVerified: 'userVerified',
  UserBanned: 'userBanned',
  VerificationThreadCreated: 'verificationThreadCreated',
  AdminActionRecorded: 'adminActionRecorded',
  // Add more events as needed
} as const;

// Type for valid event names
export type EventName = (typeof EventNames)[keyof typeof EventNames];

// --- Event Payloads ---

export interface UserDetectedSuspiciousPayload {
  userId: string;
  serverId: string;
  detectionResult: DetectionResult;
  sourceMessageId?: string;
  detectionEventId: string; // Include the ID of the created detection event
}

export interface VerificationStartedPayload {
  userId: string;
  serverId: string;
  verificationEvent: VerificationEvent; // Pass the created verification event
  detectionEventId?: string;
  detectionResult: DetectionResult; // Added DetectionResult
}

export interface UserVerifiedPayload {
  userId: string;
  serverId: string;
  moderatorId: string;
  verificationEventId: string;
}

export interface UserBannedPayload {
  userId: string;
  serverId: string;
  moderatorId: string;
  reason: string;
  verificationEventId: string;
}

export interface VerificationThreadCreatedPayload {
  userId: string;
  serverId: string;
  threadId: string;
  verificationEventId: string;
}

export interface AdminActionRecordedPayload {
  action: AdminAction;
}

// --- Event Map (Maps event names to payload types) ---

export interface EventMap {
  [EventNames.UserDetectedSuspicious]: UserDetectedSuspiciousPayload;
  [EventNames.VerificationStarted]: VerificationStartedPayload;
  [EventNames.UserVerified]: UserVerifiedPayload;
  [EventNames.UserBanned]: UserBannedPayload;
  [EventNames.VerificationThreadCreated]: VerificationThreadCreatedPayload;
  [EventNames.AdminActionRecorded]: AdminActionRecordedPayload;
  // Add mappings for other events
}

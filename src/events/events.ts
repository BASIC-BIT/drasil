// src/events/events.ts

import { DetectionResult } from '../services/DetectionOrchestrator';
import { AdminAction, VerificationEvent } from '../repositories/types';
import { Message } from 'discord.js'; // Added import

// Event Names (using constants for type safety)
export const EventNames = {
  UserDetectedSuspicious: 'userDetectedSuspicious',
  VerificationStarted: 'verificationStarted',
  UserVerified: 'userVerified',
  AdditionalSuspicionDetected: 'additionalSuspicionDetected',
  UserBanned: 'userBanned',
  VerificationReopened: 'verificationReopened',
  VerificationThreadCreated: 'verificationThreadCreated',
  AdminActionRecorded: 'adminActionRecorded',
  AdminVerifyUserRequested: 'adminVerifyUserRequested',
  // Add more events as needed
  AdminBanUserRequested: 'adminBanUserRequested',
} as const;

// Type for valid event names
export type EventName = (typeof EventNames)[keyof typeof EventNames];

// --- Event Payloads ---

export interface UserDetectedSuspiciousPayload {
  userId: string;
  serverId: string;
  detectionResult: DetectionResult;
  sourceMessageId?: string;
  channelId?: string; // Added optional channelId
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
  verificationEventId?: string; // Made optional as ban might not be related to verification
}

export interface AdditionalSuspicionDetectedPayload {
  userId: string;
  serverId: string;
  detectionEventId: string; // ID of the *new* detection event
  detectionResult: DetectionResult; // The *new* detection result
  existingVerificationEvent: VerificationEvent; // The verification event that was already active
  sourceMessage?: Message; // Optional source message for context
}

export interface VerificationReopenedPayload {
  verificationEventId: string; // ID of the verification event being reopened
  userId: string;
  serverId: string;
  moderatorId: string; // Discord ID of the moderator reopening
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
  [EventNames.AdditionalSuspicionDetected]: AdditionalSuspicionDetectedPayload; // Added mapping
  [EventNames.VerificationReopened]: VerificationReopenedPayload; // Added mapping
  [EventNames.VerificationThreadCreated]: VerificationThreadCreatedPayload;
  [EventNames.AdminActionRecorded]: AdminActionRecordedPayload;
  [EventNames.AdminVerifyUserRequested]: AdminVerifyUserRequestedPayload; // Added mapping
  [EventNames.AdminBanUserRequested]: AdminBanUserRequestedPayload; // Added mapping
  // Add mappings for other events
}

export interface AdminVerifyUserRequestedPayload {
  targetUserId: string;
  serverId: string;
  adminId: string;
  interactionId?: string; // Optional: ID of the interaction for potential follow-up replies
  verificationEventId?: string; // Optional: If triggered from a specific verification context
}

export interface AdminBanUserRequestedPayload {
  targetUserId: string;
  serverId: string;
  adminId: string;
  reason: string;
  interactionId?: string; // Optional: ID of the interaction
  verificationEventId?: string; // Optional: If triggered from a specific verification context
}
// Removed misplaced mappings from here

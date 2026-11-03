import {
  reportAnalysisOutcomeSchema,
  reportDirectoryCoverageSchema,
  reportAnalysisMetadataSchema,
  reportHandoffSchema,
} from '../index';

const schemas = {
  reportAnalysisOutcomeSchema,
  reportDirectoryCoverageSchema,
  reportAnalysisMetadataSchema,
  reportHandoffSchema,
};
const coverage = {
  kind: 'complete',
  scannedAt: '2026-11-03T00:00:00.000Z',
  expiresAt: '2026-11-03T00:01:00.000Z',
  memberCount: 3,
};

test('requires a candidate for confirmation and a reason for admin review', () => {
  const schema = schemas.reportAnalysisOutcomeSchema;
  expect(schema).toBeDefined();
  expect(
    schema.safeParse({
      kind: 'confirm',
      coverage,
      includedEvidenceIds: [],
      excludedEvidenceIds: [],
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      kind: 'admin_review',
      reason: 'no_match',
      candidates: [],
      coverage,
      includedEvidenceIds: ['evidence'],
      excludedEvidenceIds: [],
    }).success
  ).toBe(true);
  expect(
    schema.safeParse({
      kind: 'admin_review',
      reason: 'invented',
      candidates: [],
      coverage,
      includedEvidenceIds: [],
      excludedEvidenceIds: [],
    }).success
  ).toBe(false);
});

test('rejects incomplete coverage without a reason and malformed metadata', () => {
  expect(schemas.reportDirectoryCoverageSchema).toBeDefined();
  expect(
    schemas.reportDirectoryCoverageSchema.safeParse({ ...coverage, kind: 'partial' }).success
  ).toBe(false);
  expect(
    schemas.reportAnalysisMetadataSchema.safeParse({ schemaVersion: 1, sources: 'corrupt' }).success
  ).toBe(false);
});

test('requires actual delivery identifiers and retains them on acknowledgement', () => {
  const schema = schemas.reportHandoffSchema;
  expect(schema).toBeDefined();
  expect(
    schema.safeParse({
      state: 'delivered',
      reason: 'no_match',
      attempts: 1,
      nextDueAt: null,
      receipt: 'sent',
    }).success
  ).toBe(false);
  expect(
    schema.safeParse({
      state: 'acknowledged',
      reason: 'no_match',
      messageId: 'message',
      channelId: 'channel',
      attempts: 1,
      nextDueAt: null,
      receipt: 'sent',
      acknowledgedBy: 'moderator',
      acknowledgedAt: coverage.scannedAt,
    }).success
  ).toBe(true);
});

test('allows staff resolution before delivery without inventing receipt identifiers', () => {
  expect(
    schemas.reportHandoffSchema.safeParse({
      state: 'resolved',
      reason: 'no_match',
      attempts: 0,
      nextDueAt: null,
      receipt: 'pending',
      resolvedBy: 'moderator',
      resolvedAt: coverage.scannedAt,
    }).success
  ).toBe(true);
});

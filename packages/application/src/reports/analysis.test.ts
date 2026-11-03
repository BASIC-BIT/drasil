import {
  reportIdentityCandidateSchema,
  reportAnalysisOutcomeSchema,
  reportDirectoryCoverageSchema,
  reportAnalysisMetadataSchema,
  reportHandoffSchema,
  reportSourceVersionSchema,
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

test('allows an unknown author only for deletion tombstones and validates availability', () => {
  const source = {
    sourceVersion: 0,
    sourceFingerprint: 'deleted',
    sourceChannelId: 'thread',
    sourceAuthorId: null,
    observedAt: '2026-11-03T00:00:00.000Z',
    editedAt: null,
    operation: 'delete',
  };
  expect(reportSourceVersionSchema.parse(source)).toMatchObject({
    availability: 'available',
    sourceAuthorId: null,
  });
  expect(reportSourceVersionSchema.safeParse({ ...source, operation: 'upsert' }).success).toBe(
    false
  );
  expect(reportSourceVersionSchema.safeParse({ ...source, availability: 'unknown' }).success).toBe(
    false
  );
});

test('represents validated anchors without claiming a directory scan', () => {
  expect(
    reportDirectoryCoverageSchema.parse({ kind: 'not_required', reason: 'validated_anchor' })
  ).toEqual({ kind: 'not_required', reason: 'validated_anchor' });
  expect(
    reportDirectoryCoverageSchema.safeParse({ kind: 'not_required', reason: 'name_match' }).success
  ).toBe(false);
});

test('requires source-associated subject matches for deduplicated candidates', () => {
  const candidate = {
    candidateId: 'guild:user',
    discordUserId: 'user',
    serverId: 'guild',
    username: 'name',
    globalName: null,
    nickname: null,
    displayName: 'name',
    avatarUrl: null,
    sourceRefs: [],
    matchedFields: ['username'],
    subjectMatches: [
      { subjectId: 'first', sourceRefs: [], matchedFields: ['username'] },
      { subjectId: 'second', sourceRefs: [], matchedFields: ['userId'] },
    ],
  };
  expect(reportIdentityCandidateSchema.parse(candidate).subjectMatches).toHaveLength(2);
  expect(
    reportIdentityCandidateSchema.safeParse({ ...candidate, subjectMatches: [] }).success
  ).toBe(false);
  expect(
    reportIdentityCandidateSchema.safeParse({
      ...candidate,
      subjectMatches: undefined,
      subjectId: 'first',
    }).success
  ).toBe(false);
});

export const CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID = 'case_digest:open';
export const CASE_REVIEW_DIGEST_PAGE_CUSTOM_ID_PREFIX = 'case_digest:page';
export const CASE_REVIEW_DIGEST_SELECT_CUSTOM_ID_PREFIX = 'case_digest:select';

export function buildCaseReviewDigestPageCustomId(page: number): string {
  return `${CASE_REVIEW_DIGEST_PAGE_CUSTOM_ID_PREFIX}:${page}`;
}

export function buildCaseReviewDigestSelectCustomId(page: number): string {
  return `${CASE_REVIEW_DIGEST_SELECT_CUSTOM_ID_PREFIX}:${page}`;
}

export function parseCaseReviewDigestPageCustomId(customId: string): number | null {
  const [, , pageValue] = customId.split(':');
  return parseNonNegativeInteger(pageValue);
}

export function parseCaseReviewDigestSelectCustomId(customId: string): number | null {
  const [, , pageValue] = customId.split(':');
  return parseNonNegativeInteger(pageValue);
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

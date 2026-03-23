# Scam/Spam Intelligence Repository

This document defines a simple repository structure for collecting scammer/spammer evidence that can later support domain understanding, prompt examples, analytics, and model training.

## Goal

Keep evidence collection boring and consistent:

- keep schemas, tooling, and workflow docs in git;
- keep actual case data and screenshots out of git by default;
- store raw screenshots and case manifests in S3 under a predictable prefix;
- separate confirmed labels from early suspicion;
- preserve provenance so later training data is auditable.

## Recommended storage model

Use an S3-first model with a gitignored local staging area:

1. `data/intel/cases/`
   - local staging for case JSON;
   - gitignored by default.
2. `data/intel/evidence/`
   - local staging for screenshots and binaries;
   - gitignored by default.
3. S3 bucket
   - recommended prefix: `s3://<bucket>/spam-intel/`;
   - upload staged files while preserving relative paths, for example:
     - local: `data/intel/evidence/2026/03/example.png`
     - S3: `s3://<bucket>/spam-intel/evidence/2026/03/example.png`

This keeps sensitive intelligence out of the repository while staying lightweight.

## Minimum viable workflow

For now, keep it simple:

1. copy the screenshot into `data/intel/evidence/YYYY/MM/`;
2. copy `data/intel/templates/case.template.json` and fill in a small case JSON under `data/intel/cases/YYYY/`;
3. upload both files to the private S3 bucket under `spam-intel/`;
4. move on.

The schema and uploader script are there to help, not to force ceremony.

## Bucket provisioning

Terraform for the bucket lives in `infra/aws/intel/`.

- bucket is private by default;
- S3 Block Public Access is enabled;
- object ownership is `BucketOwnerEnforced`;
- TLS-only access is enforced;
- SSE-S3 encryption is enabled.

## Case record rules

Each case file should include:

- stable `case_id`;
- capture timestamp;
- source platform and collection method;
- subject identifiers exactly as seen;
- evidence references;
- a conservative label (`needs_review`, `confirmed_scam`, `confirmed_spam`, `benign`, `unknown`);
- notes about why the case matters.

Default to `needs_review` when evidence is thin, but allow higher-confidence labeling when multiple profile tells align and the collector has strong domain context.

## High-signal profile tells

Some cases are strong even before direct outreach occurs. In this domain, examples of meaningful signals include:

- a fresh account paired with generic naming or numeric suffixes;
- presence only in low-trust or public funnel servers;
- no mutual friends, bio, connections, banner, or other signs of normal account history;
- profile imagery that appears copied from artist renders or VRChat avatar screenshots;
- low-effort avatar captures such as Blender or Unity screenshots, especially T-pose or rig previews.

Any single tell can be weak. Several together can justify a high-confidence scammer classification.

## Evidence naming

Use timestamp-first filenames so assets sort naturally.

- case file: `YYYY-MM-DD-short-slug.json`
- evidence file: `YYYY-MM-DD-short-slug-01.png`

If a case has multiple screenshots, increment the suffix.

## Label hygiene

For later training value, keep these fields accurate:

- `classification.label`
- `classification.confidence`
- `classification.reasoning`
- `review.status`
- `review.reviewed_by`
- `review.reviewed_at`

Do not force low confidence just because the evidence is profile-only. Profile-only evidence can still be strong when the pattern matches known scammer behavior.

## Privacy and safety

- Assume screenshots may contain personal data or sensitive context.
- Prefer minimal retention of unrelated bystander information.
- If a screenshot contains DMs, payment info, or personal identifiers, note redaction status.
- Never put credentials, tokens, or private exports in git.

## Suggested next phase

When the dataset starts growing, add:

- lifecycle rules on the S3 bucket if storage starts growing;
- content hashes for dedupe;
- a small ingestion/export script that converts case JSON into JSONL for training pipelines;
- reviewer workflow for confirmed labels.

# Intelligence Data

This directory stores the local staging layout for scam/spam evidence.

Actual case data in `cases/` and binaries in `evidence/` are gitignored. Only shared docs, schemas, and tooling stay checked in.

## Layout

- `cases/`
  - one JSON file per case;
  - local staging only;
  - upload to S3, do not commit.
- `evidence/`
  - screenshots and related binary evidence;
  - local staging only;
  - upload to S3, do not commit.
- `schema/`
  - JSON schema for case records.

## Workflow

1. Save the screenshot or asset under `evidence/YYYY/MM/`.
2. Create a matching case JSON in `cases/YYYY/`.
3. Use `classification.label = "needs_review"` only when the signals are genuinely ambiguous.
4. Update the case later as moderation outcomes become known.

If you want the minimum possible workflow, steps 1-2 plus an `aws s3 cp` upload are enough.

## S3 convention

Mirror this directory under a prefix like `spam-intel/` so paths stay stable.

- local: `data/intel/evidence/2026/03/example.png`
- S3: `s3://<bucket>/spam-intel/evidence/2026/03/example.png`

Use `node scripts/upload-intel-case.js ...` to upload staged files with the same relative paths.

That helper is optional. Plain AWS CLI works too.

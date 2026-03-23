#!/usr/bin/env node

const { existsSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    prefix: 'spam-intel',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      fail(`Missing value for --${key}`);
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

function ensureFile(filePath, label) {
  if (!filePath) {
    fail(`Missing required --${label} argument`);
  }

  if (!existsSync(filePath)) {
    fail(`${label} file not found: ${filePath}`);
  }
}

function toS3Key(filePath, prefix) {
  const normalized = filePath.split(path.sep).join('/');
  const marker = 'data/intel/';
  const start = normalized.indexOf(marker);

  if (start === -1) {
    fail(`File must live under data/intel/: ${filePath}`);
  }

  return `${prefix}/${normalized.slice(start + marker.length)}`;
}

function uploadFile(bucket, prefix, filePath) {
  const key = toS3Key(filePath, prefix);
  const destination = `s3://${bucket}/${key}`;
  const result = spawnSync('aws', ['s3', 'cp', filePath, destination], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    fail(`Upload failed for ${filePath}`);
  }

  return destination;
}

const args = parseArgs(process.argv.slice(2));

if (!args.bucket) {
  fail('Missing required --bucket argument');
}

ensureFile(args.case, 'case');
ensureFile(args.evidence, 'evidence');

const caseUri = uploadFile(args.bucket, args.prefix, args.case);
const evidenceUri = uploadFile(args.bucket, args.prefix, args.evidence);

console.log('Uploaded intelligence case:');
console.log(`- case: ${caseUri}`);
console.log(`- evidence: ${evidenceUri}`);

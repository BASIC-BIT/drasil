import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';
import { z } from 'zod';
import type { ReportIdentityExtraction } from '@drasil/application';
import { GPTService } from '../services/GPTService';
import { MAX_REPORT_AI_MAX_IMAGE_BYTES } from '../utils/reportAiSettings';

const labelSchema = z
  .object({
    id: z.enum(['clean-match', 'multiple-people', 'uncertain-name']),
    subjects: z.array(
      z.object({
        role: z.enum(['target', 'reporter', 'other', 'unknown']),
        readableNames: z.array(z.string().min(1)),
      })
    ),
    contextLabels: z.array(z.string().min(1)),
    uncertaintyRequired: z.boolean(),
    permittedIdentityOutcome: z.enum(['confirm', 'admin_review']),
  })
  .strict();
type Labels = Omit<z.infer<typeof labelSchema>, 'id'>;
const normalize = (name: string): string =>
  name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

export function evaluateLabels(extraction: ReportIdentityExtraction, labels: Labels): string[] {
  if (extraction.kind === 'failed') return [`extraction failed: ${extraction.reason}`];
  const failures: string[] = [];
  for (const expected of labels.subjects) {
    const matches = extraction.subjects.filter((subject) => subject.role === expected.role);
    for (const name of expected.readableNames) {
      if (
        !matches.some((subject) =>
          [...subject.displayNames, ...subject.usernames].some(
            (actual) => normalize(actual) === normalize(name)
          )
        )
      )
        failures.push(`missing ${expected.role}: ${name}`);
      if (
        extraction.subjects.some(
          (subject) =>
            subject.role !== expected.role &&
            [...subject.displayNames, ...subject.usernames].some(
              (actual) => normalize(actual) === normalize(name)
            )
        )
      )
        failures.push(`wrong subject for ${name}`);
    }
  }
  for (const name of labels.contextLabels)
    if (!extraction.contextLabels.some((label) => normalize(label.text) === normalize(name)))
      failures.push(`missing context: ${name}`);
  const targets = extraction.subjects.filter(
    (subject) => subject.role === 'target' || subject.role === 'unknown'
  );
  const uncertain = targets.some(
    (subject) => subject.readability !== 'clear' || subject.uncertainty.length > 0
  );
  if (labels.uncertaintyRequired && !uncertain) failures.push('missing target uncertainty');
  if (labels.permittedIdentityOutcome === 'confirm' && uncertain)
    failures.push('clear fixture remains uncertain');
  // This is extraction evaluation only. Directory uniqueness and identity outcome require journey tests.
  return failures;
}

export async function runEvaluation(args: string[]): Promise<{
  mode: 'dry-run' | 'paid';
  maximumRequests: number;
  requestCount: number;
  elapsedMs: number;
  results: {
    id: string;
    failures: string[];
    permittedIdentityOutcome: string;
    lookupCoverage: 'not_run';
  }[];
}> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--execute-paid'))
    throw new Error(
      'Usage: node -r ts-node/register src/scripts/evaluateReportIntake.ts [--execute-paid]'
    );
  const root = join(__dirname, '../__tests__/fixtures/report-intake');
  const fixtures = z
    .array(labelSchema)
    .length(3)
    .parse(JSON.parse(readFileSync(join(root, 'evaluation-labels.json'), 'utf8')));
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new Error('Duplicate fixture ID');
  const assets = fixtures.map((fixture) => {
    const png = readFileSync(join(root, `${fixture.id}.png`));
    if (
      png.length <= 8 ||
      png.length > MAX_REPORT_AI_MAX_IMAGE_BYTES ||
      !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    )
      throw new Error(`Invalid fixture PNG: ${fixture.id}`);
    return png;
  });
  console.log(
    `Maximum provider requests: ${fixtures.length}. One request per fixture, no retries.`
  );
  const result: Awaited<ReturnType<typeof runEvaluation>> = {
    mode: args.length ? 'paid' : 'dry-run',
    maximumRequests: fixtures.length,
    requestCount: 0,
    elapsedMs: 0,
    results: [],
  };
  if (!args.length) return result;
  if (!process.env.OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY is required after explicit paid opt-in.');
  const service = new GPTService(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }));
  const started = Date.now();
  for (const [index, fixture] of fixtures.entries()) {
    result.requestCount++;
    try {
      const extraction = await service.extractReportIdentityFixture({
        ref: {
          evidenceId: fixture.id,
          messageId: `synthetic-${fixture.id}`,
          sourceVersion: 1,
          role: 'reporter',
          kind: 'image',
        },
        png: assets[index],
        signal: AbortSignal.timeout(45_000),
      });
      result.results.push({
        id: fixture.id,
        failures: evaluateLabels(extraction, fixture),
        permittedIdentityOutcome: fixture.permittedIdentityOutcome,
        lookupCoverage: 'not_run',
      });
    } catch {
      result.results.push({
        id: fixture.id,
        failures: [
          'request aborted or failed before a structured result; provider outcome unknown',
        ],
        permittedIdentityOutcome: fixture.permittedIdentityOutcome,
        lookupCoverage: 'not_run',
      });
    } finally {
      result.elapsedMs = Date.now() - started;
      console.log(JSON.stringify(result));
    }
  }
  return result;
}

if (require.main === module) {
  void runEvaluation(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (result.results.some((item) => item.failures.length)) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Evaluation failed');
      process.exitCode = 1;
    });
}

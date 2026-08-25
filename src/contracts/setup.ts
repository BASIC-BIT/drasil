// The bot emits CommonJS, while @drasil/contracts currently exposes ESM-only TypeScript source.
// Keep bot imports behind this adapter until that package publishes a CommonJS `require` export;
// the root TypeScript build follows this source import and emits a compatible copy under dist.
export * from '../../packages/contracts/src/setup';

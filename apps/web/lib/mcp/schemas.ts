import type { StandardSchemaWithJSON } from '@drasil/mcp-runtime/server';
import { z } from 'zod';
import { ignoreOverride, zodToJsonSchema } from 'zod-to-json-schema';

/** Advertise canonical input, but always validate with the original Zod 3 parser. */
export function toMcpSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): StandardSchemaWithJSON<unknown, T> {
  const input = (): Record<string, unknown> =>
    zodToJsonSchema(schema, {
      target: 'jsonSchema7',
      effectStrategy: 'input',
      $refStrategy: 'none',
      override(definition) {
        // A preprocessor accepts unknown input and may map values outside the
        // inner enum. Only the canonical parser can decide which ones succeed.
        if (
          'effect' in definition &&
          typeof definition.effect === 'object' &&
          definition.effect !== null &&
          'type' in definition.effect &&
          definition.effect.type === 'preprocess'
        )
          return {};
        return ignoreOverride;
      },
    });
  return {
    '~standard': {
      version: 1,
      vendor: 'drasil-zod3',
      async validate(value) {
        const result = await schema.safeParseAsync(value);
        return result.success
          ? { value: result.data }
          : {
              issues: result.error.issues.map((issue) => ({
                message: issue.message,
                path: issue.path,
              })),
            };
      },
      jsonSchema: {
        input,
        // Zod effects may transform the output. This input-only adapter makes no
        // narrower output promise; tools define their own allowlisted results.
        output: () => ({}),
      },
    },
  };
}

import type { StandardSchemaWithJSON } from '@drasil/mcp-runtime/server';
import { z } from 'zod';

/** Advertise canonical input and validate with its original parser. */
export function toMcpSchema<T>(schema: z.ZodType<T, unknown>): StandardSchemaWithJSON<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'drasil-zod4',
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
        input: ({ target }) =>
          z.toJSONSchema(schema, {
            target,
            io: 'input',
            reused: 'inline',
            override({ zodSchema, jsonSchema }) {
              // Preprocessors can accept values outside their inner schema.
              // Only the canonical parser can decide which inputs succeed.
              if (zodSchema instanceof z.ZodPipe && zodSchema.in instanceof z.ZodTransform)
                for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
            },
          }),
        // Transforms may change the output. Tools define their own allowlisted results.
        output: () => ({}),
      },
    },
  };
}

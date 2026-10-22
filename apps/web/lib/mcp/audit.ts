import { createMcpAudit } from '@drasil/application';
export { createMcpAudit } from '@drasil/application';
export const recordMcpAudit = createMcpAudit((line) => console.info(line));
/** Provider messages and variadic arguments may contain credentials, response bodies or Errors. */
export function createProviderLogger(sink: (line: string) => void = (line) => console.info(line)) {
  return {
    level: 'warn' as const,
    log(level: string, _message: string, ..._args: unknown[]): void {
      const safe = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'error';
      try {
        sink(JSON.stringify({ event: 'provider', level: safe }));
      } catch {
        /* Logging is best effort. */
      }
    },
  };
}

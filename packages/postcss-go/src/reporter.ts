import type { CliProcessResult } from './engine.js';

export function formatWarnings(result: Pick<CliProcessResult, 'messages'>): string {
  return result.messages
    .filter((message) => message.type === 'warning')
    .map((message) => {
      if (
        typeof message.toString === 'function' &&
        message.toString !== Object.prototype.toString
      ) {
        return message.toString();
      }
      const location =
        message.file && typeof message.line === 'number' && typeof message.column === 'number'
          ? `${message.file}:${message.line}:${message.column}: `
          : '';
      const plugin = message.plugin ? `${String(message.plugin)}: ` : '';
      return `${location}${plugin}${message.text ?? 'Unknown warning'}`;
    })
    .join('\n');
}

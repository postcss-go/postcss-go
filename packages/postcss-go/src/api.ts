import { NodePostcssGoService } from './node.js';
import type { PostcssGoService } from './service.js';
import type { ParseResult, ProcessOptions, ProcessResult } from './types.js';

export async function parse(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<ParseResult> {
  const activeService = service ?? new NodePostcssGoService();
  try {
    return await activeService.parse(css, options);
  } finally {
    if (!service) {
      await activeService.close();
    }
  }
}

export async function process(
  css: string,
  options: ProcessOptions = {},
  service?: PostcssGoService,
): Promise<ProcessResult> {
  const activeService = service ?? new NodePostcssGoService();
  try {
    return await activeService.process(css, options);
  } finally {
    if (!service) {
      await activeService.close();
    }
  }
}

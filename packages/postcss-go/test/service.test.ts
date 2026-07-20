import { expect, test } from 'vitest';

import { UnsupportedServiceError } from '../src/service.ts';

test('UnsupportedServiceError sets a stable error name', () => {
  const error = new UnsupportedServiceError('browser runtime is unavailable');

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('UnsupportedServiceError');
  expect(error.message).toBe('browser runtime is unavailable');
});

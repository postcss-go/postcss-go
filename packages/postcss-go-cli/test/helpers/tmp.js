import path from 'path';
import { randomUUID } from 'node:crypto';

export default function (ext = '') {
  return path.join('test/fixtures/.tmp', randomUUID(), ext);
}

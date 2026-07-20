import fs from 'node:fs/promises';
import path from 'node:path';

export default async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

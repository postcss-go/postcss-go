import fs from 'node:fs/promises';

export default function (path: string) {
  return fs.readFile(path, 'utf8').then((content) => content.replace(/\r\n/g, '\n'));
}

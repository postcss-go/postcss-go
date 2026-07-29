/** PostCSS-compatible list helpers for comma/space-separated values. */
export const list = {
  comma(value: string): string[] {
    return list.split(value, [','], true);
  },
  space(value: string): string[] {
    return list.split(value, [' ', '\n', '\t']);
  },
  split(value: string, separators: string[], last?: boolean): string[] {
    const array: string[] = [];
    let current = '';
    let split = false;
    let func = 0;
    let inQuote = false;
    let prevQuote = '';
    let escape = false;

    for (const letter of value) {
      if (escape) {
        escape = false;
      } else if (letter === '\\') {
        escape = true;
      } else if (inQuote) {
        if (letter === prevQuote) inQuote = false;
      } else if (letter === '"' || letter === "'") {
        inQuote = true;
        prevQuote = letter;
      } else if (letter === '(') {
        func += 1;
      } else if (letter === ')') {
        if (func > 0) func -= 1;
      } else if (func === 0 && separators.includes(letter)) {
        split = true;
      }

      if (split) {
        if (current !== '') array.push(current.trim());
        current = '';
        split = false;
      } else {
        current += letter;
      }
    }

    if (last || current !== '') array.push(current.trim());
    return array;
  },
};

export interface ProgressGroup {
  id: string;
  name: string;
  shortName: string;
  description: string;
  completed: number;
  total: number;
  percent: number;
}

export interface ProgressSummary {
  completed: number;
  total: number;
  percent: number;
  groups: ProgressGroup[];
}

const REQUIRED_SECTION = 'Required completion criteria';

const GROUP_METADATA: Record<string, Pick<ProgressGroup, 'shortName' | 'description'>> = {
  'Zero PostCSS production dependency': {
    shortName: 'Zero dependency',
    description: 'Runtime · package · clean install',
  },
  'Public JavaScript API': {
    shortName: 'JS API',
    description: 'Entry point · results · sync APIs',
  },
  'Plugin execution': {
    shortName: 'Plugins',
    description: 'Lifecycle · context · diagnostics',
  },
  'Node N-API and synchronous execution': {
    shortName: 'Node N-API',
    description: 'Native async/sync · packaging',
  },
  'Core CSS pipeline': {
    shortName: 'Core CSS',
    description: 'Tokenizer · parser · AST · maps',
  },
  'Node CLI and package boundary': {
    shortName: 'CLI/package',
    description: 'Config · reporting · migration',
  },
  'Browser and WASM': {
    shortName: 'Browser/WASM',
    description: 'Worker · plugins · CSP · contracts',
  },
};
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function percentage(completed: number, total: number): number {
  return total === 0 ? 0 : Math.round((completed / total) * 100);
}

export function parseRequiredProgress(markdown: string): ProgressSummary {
  let currentSection = '';
  let currentGroup = '';
  const counts = new Map<string, { completed: number; total: number }>();

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim();
      currentGroup = '';
      continue;
    }
    if (line.startsWith('### ')) {
      currentGroup = line.slice(4).trim();
      continue;
    }
    if (currentSection !== REQUIRED_SECTION || !currentGroup) continue;

    const task = line.match(/^- \[([ xX])\]/);
    if (!task) continue;
    const count = counts.get(currentGroup) ?? { completed: 0, total: 0 };
    count.total += 1;
    if (task[1].toLowerCase() === 'x') count.completed += 1;
    counts.set(currentGroup, count);
  }

  const groups = [...counts.entries()].map(([name, count]) => {
    const metadata = GROUP_METADATA[name] ?? {
      shortName: name,
      description: 'Required completion criteria',
    };
    return {
      id: slugify(name),
      name,
      ...metadata,
      ...count,
      percent: percentage(count.completed, count.total),
    };
  });
  const completed = groups.reduce((sum, group) => sum + group.completed, 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);

  return {
    completed,
    total,
    percent: percentage(completed, total),
    groups,
  };
}

export function getPollInterval(poll) {
  if (!poll) return 100;
  if (poll === true) return 100;
  if (typeof poll === 'number' && !Number.isNaN(poll) && poll > 0) return poll;
  if (typeof poll === 'string') {
    const parsed = Number(poll);
    if (poll !== '' && !Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 100;
}

export function usePolling(poll) {
  return Boolean(poll);
}

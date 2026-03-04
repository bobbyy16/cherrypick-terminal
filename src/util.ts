/**
 * util.ts — Helper utilities
 */

/**
 * Parses a git remote URL (https or ssh) and returns { owner, repo }
 * Examples:
 *   https://github.com/owner/repo.git  → { owner, repo }
 *   git@github.com:owner/repo.git      → { owner, repo }
 */
export function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

/**
 * Truncates a string to maxLen, appending '…' if needed.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Formats a commit hash to short form (7 chars).
 */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/**
 * Pads a string to a fixed width (left-aligned).
 */
export function padEnd(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

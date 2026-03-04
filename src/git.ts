import simpleGit, { SimpleGit, LogResult, DefaultLogFields } from 'simple-git';

export interface Commit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  refs: string;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflictedFiles: string[];
}

export function createGit(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

export async function getLog(git: SimpleGit, maxCount = 100): Promise<Commit[]> {
  const log: LogResult<DefaultLogFields> = await git.log([
    `--max-count=${maxCount}`,
    '--format=%H|%ad|%s|%an|%D',
    '--date=short',
  ]);
  return log.all.map((entry) => ({
    hash: entry.hash,
    date: entry.date,
    message: entry.message,
    author_name: entry.author_name,
    refs: entry.refs,
  }));
}

export async function getDiffStat(git: SimpleGit, hash: string): Promise<string> {
  try {
    const result = await git.show(['--stat', '--no-color', hash]);
    return result;
  } catch {
    return 'Could not load diff for this commit.';
  }
}

export async function cherryPick(
  git: SimpleGit,
  hashes: string[]
): Promise<ConflictResult> {
  for (const hash of hashes) {
    try {
      await git.raw(['cherry-pick', hash]);
    } catch (err: unknown) {
      const status = await git.status();
      const conflictedFiles = status.conflicted;
      return { hasConflict: true, conflictedFiles };
    }
  }
  return { hasConflict: false, conflictedFiles: [] };
}

export async function cherryPickContinue(git: SimpleGit): Promise<void> {
  await git.raw(['cherry-pick', '--continue', '--no-edit']);
}

export async function cherryPickAbort(git: SimpleGit): Promise<void> {
  await git.raw(['cherry-pick', '--abort']);
}

export async function getBranches(git: SimpleGit): Promise<string[]> {
  const summary = await git.branch(['-a']);
  return Object.keys(summary.branches).map((b) => b.trim());
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const summary = await git.branch();
  return summary.current;
}

export async function getRemoteUrl(git: SimpleGit): Promise<string> {
  try {
    const url = await git.remote(['get-url', 'origin']);
    return (url ?? '').trim();
  } catch {
    return '';
  }
}

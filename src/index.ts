#!/usr/bin/env node
import * as path from 'path';
import { createGit } from './git';
import { startUI } from './ui';

async function main(): Promise<void> {
  // Allow passing a repo path as the first CLI arg, e.g.:
  //   node dist/index.js /path/to/my-repo
  const repoPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : process.cwd();

  const git = createGit(repoPath);

  // Verify it's a valid git repo
  try {
    await git.status();
  } catch {
    console.error(`❌  Not a git repository: ${repoPath}`);
    console.error('Usage: cherrypick [path/to/repo]');
    process.exit(1);
  }

  await startUI(git, repoPath);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

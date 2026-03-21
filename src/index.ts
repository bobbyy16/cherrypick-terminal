#!/usr/bin/env node
process.env.FORCE_COLOR = '1';
import * as path from 'path';
import { createGit } from './git';
import { startUI } from './ui';

async function main(): Promise<void> {
  const arg = process.argv[2];

  // Handle version flag
  if (arg === '-v' || arg === '--version') {
    const { version } = require('../package.json');
    console.log(`cherrypick-terminal v${version}`);
    process.exit(0);
  }

  // Handle help flag
  if (arg === '-h' || arg === '--help') {
    console.log(`
Usage: cherrypick [path/to/repo]

Options:
  -v, --version   Show version number
  -h, --help      Show help

Examples:
  cherrypick                  # uses current directory
  cherrypick /path/to/repo    # uses specified repo
    `);
    process.exit(0);
  }

  // Allow passing a repo path as the first CLI arg, e.g.:
  //   node dist/index.js /path/to/my-repo
  const repoPath = arg ? path.resolve(arg) : process.cwd();

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
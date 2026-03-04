import { Octokit } from '@octokit/rest';
import { parseRemoteUrl } from './util';

export interface PROptions {
  token: string;
  remoteUrl: string;
  head: string;       // source branch (current branch)
  base: string;       // target branch
  title: string;
  body?: string;
}

export interface PRResult {
  url: string;
  number: number;
  title: string;
}

export async function createPullRequest(opts: PROptions): Promise<PRResult> {
  const parsed = parseRemoteUrl(opts.remoteUrl);
  if (!parsed) {
    throw new Error(
      `Could not parse GitHub owner/repo from remote URL: ${opts.remoteUrl}`
    );
  }

  const octokit = new Octokit({ auth: opts.token });

  const response = await octokit.pulls.create({
    owner: parsed.owner,
    repo: parsed.repo,
    title: opts.title,
    body: opts.body ?? 'Created via cherrypick-terminal 🍒',
    head: opts.head,
    base: opts.base,
  });

  return {
    url: response.data.html_url,
    number: response.data.number,
    title: response.data.title,
  };
}

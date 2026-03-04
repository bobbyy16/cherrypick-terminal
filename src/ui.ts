import * as blessed from 'blessed';
import { SimpleGit } from 'simple-git';
import {
  Commit,
  getLog,
  getDiffStat,
  cherryPick,
  cherryPickContinue,
  cherryPickAbort,
  getLocalBranches,
  getCurrentBranch,
  getRemoteUrl,
} from './git';
import { shortHash, truncate } from './util';
import { getSavedToken, saveToken, hasToken } from './token';
import { createPullRequest } from './github';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppState {
  commits: Commit[];
  filteredCommits: Commit[];
  selected: Set<string>;
  currentIndex: number;
  searchMode: boolean;
  searchQuery: string;
  tokenAvailable: boolean;
  currentBranch: string;  // branch we're ON (cherry-pick target)
  sourceBranch: string;   // branch we're picking FROM
  remoteUrl: string;
  conflictFiles: string[];
  inConflict: boolean;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function startUI(git: SimpleGit, repoPath: string): Promise<void> {
  const [allBranches, currentBranch, remoteUrl] = await Promise.all([
    getLocalBranches(git),
    getCurrentBranch(git),
    getRemoteUrl(git),
  ]);

  // ── Phase 1: Branch Selector ─────────────────────────────────────────────
  // Ask "which branch are you cherry-picking FROM?" before showing commit list.
  const sourceBranch = await showBranchSelector(allBranches, currentBranch);

  // ── Phase 2: Load commits unique to sourceBranch vs currentBranch ─────────
  // git log currentBranch..sourceBranch  → commits in source but NOT in current
  const commits = await getLog(git, 100, sourceBranch, currentBranch);

  const state: AppState = {
    commits,
    filteredCommits: commits,
    selected: new Set(),
    currentIndex: 0,
    searchMode: false,
    searchQuery: '',
    tokenAvailable: hasToken(),
    currentBranch,
    sourceBranch,
    remoteUrl,
    conflictFiles: [],
    inConflict: false,
  };

  await showMainUI(git, repoPath, state, allBranches);
}

// ─── Branch Selector Screen ───────────────────────────────────────────────────

function showBranchSelector(
  branches: string[],
  currentBranch: string
): Promise<string> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: '🍒 CherryPick Terminal — Select Source Branch',
      fullUnicode: true,
    });

    // Header
    const header = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content:
        ` {bold}🍒 CherryPick Terminal{/bold}  ` +
        `{gray-fg}You are on:{/gray-fg} {cyan-fg}${currentBranch}{/cyan-fg}  ` +
        `{yellow-fg}↑↓ to select source branch · Enter to confirm{/yellow-fg}`,
      tags: true,
      style: { fg: 'white', bg: 'blue', bold: true },
    });

    // Info box
    const info = blessed.box({
      top: 3,
      left: '5%',
      width: '90%',
      height: 5,
      content:
        `\n  {bold}Which branch are you cherry-picking commits FROM?{/bold}\n\n` +
        `  {gray-fg}Commits unique to that branch (not yet in {cyan-fg}${currentBranch}{/cyan-fg}{gray-fg}) will be shown.{/gray-fg}`,
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'yellow' }, fg: 'white' },
    });

    // Branch list — exclude current branch from options
    const choices = branches.filter((b) => b !== currentBranch);

    const list = blessed.list({
      top: 9,
      left: '5%',
      width: '90%',
      height: `100%-12`,
      border: { type: 'line' },
      label: ' {bold}{cyan-fg}Source Branch{/cyan-fg}{/bold} ',
      tags: true,
      keys: true,
      vi: true,
      scrollbar: { ch: '│', style: { fg: 'cyan' } },
      style: {
        border: { fg: 'cyan' },
        selected: { bg: 'blue', fg: 'white', bold: true },
        item: { fg: 'white' },
      },
      items: choices.map((b) => `  ${b}`),
    });

    const footer = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {gray-fg}[↑↓]{/gray-fg} Navigate   {green-fg}[Enter]{/green-fg} Select branch   {gray-fg}[q]{/gray-fg} Quit',
      tags: true,
      style: { fg: 'white', border: { fg: 'cyan' } },
      border: { type: 'line' },
    });

    screen.append(header);
    screen.append(info);
    screen.append(list);
    screen.append(footer);
    list.focus();
    screen.render();

    list.key('enter', () => {
      const idx = (list as any).selected as number;
      const chosen = choices[idx];
      screen.destroy();
      resolve(chosen);
    });

    screen.key(['q', 'C-c'], () => {
      screen.destroy();
      process.exit(0);
    });
  });
}

// ─── Main UI ─────────────────────────────────────────────────────────────────

async function showMainUI(
  git: SimpleGit,
  repoPath: string,
  state: AppState,
  allBranches: string[]
): Promise<void> {
  const screen = blessed.screen({
    smartCSR: true,
    title: '🍒 CherryPick Terminal',
    fullUnicode: true,
    dockBorders: true,
  });

  // ─── Layout ────────────────────────────────────────────────────────────────

  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: buildHeader(state),
    tags: true,
    style: { fg: 'white', bg: 'blue', bold: true },
  });

  const commitList = blessed.list({
    top: 3,
    left: 0,
    width: '50%',
    height: '100%-7',
    border: { type: 'line' },
    label: ` {bold}{cyan-fg}Commits{/cyan-fg}{/bold} from {yellow-fg}${state.sourceBranch}{/yellow-fg} → {green-fg}${state.currentBranch}{/green-fg} `,
    tags: true,
    keys: true,
    vi: true,
    scrollbar: { ch: '│', style: { fg: 'cyan' } },
    style: {
      border: { fg: 'cyan' },
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white' },
    },
    items: [],
  });

  const diffPanel = blessed.box({
    top: 3,
    left: '50%',
    width: '50%',
    height: '100%-7',
    border: { type: 'line' },
    label: ' {bold}{cyan-fg}Diff Preview{/cyan-fg}{/bold} (git show --stat) ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: '│', style: { fg: 'cyan' } },
    style: { border: { fg: 'cyan' }, fg: 'white' },
    content: '{gray-fg}Move cursor to preview diff…{/gray-fg}',
  });

  const searchBar = blessed.textbox({
    bottom: 4,
    left: 0,
    width: '50%',
    height: 3,
    hidden: true,
    border: { type: 'line' },
    label: ' {yellow-fg}/ Search{/yellow-fg} — Esc to clear ',
    tags: true,
    inputOnFocus: true,
    style: { border: { fg: 'yellow' }, fg: 'white' },
  });

  const conflictPanel = blessed.box({
    top: '10%',
    left: '10%',
    width: '80%',
    height: '60%',
    hidden: true,
    border: { type: 'line' },
    label: ' {bold}{red-fg}⚠  Cherry-Pick Conflict{/red-fg}{/bold} ',
    tags: true,
    style: { border: { fg: 'red' } },
    content: '',
  });

  // Token prompt
  const tokenPrompt = blessed.form({
    top: '20%',
    left: '15%',
    width: '70%',
    height: 11,
    hidden: true,
    border: { type: 'line' },
    label: ' {bold}{yellow-fg}  GitHub Token Setup{/yellow-fg}{/bold} ',
    tags: true,
    style: { border: { fg: 'yellow' } },
  });

  blessed.text({
    parent: tokenPrompt,
    top: 1,
    left: 2,
    content: 'Enter your GitHub Personal Access Token {gray-fg}(needs repo scope){/gray-fg}',
    tags: true,
    style: { fg: 'white' },
  });

  const tokenInput = blessed.textbox({
    parent: tokenPrompt,
    top: 3,
    left: 2,
    width: '94%',
    height: 3,
    border: { type: 'line' },
    censor: true,
    inputOnFocus: true,
    style: { border: { fg: 'yellow' }, fg: 'white' },
  });

  blessed.text({
    parent: tokenPrompt,
    top: 7,
    left: 2,
    content: '{green-fg}[Enter]{/green-fg} Save & Continue    {gray-fg}[Esc]{/gray-fg} Skip (PR disabled)',
    tags: true,
    style: { fg: 'white' },
  });

  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 4,
    border: { type: 'line' },
    tags: true,
    style: { border: { fg: 'cyan' }, fg: 'white' },
    content: buildStatusBar(state),
  });

  screen.append(header);
  screen.append(commitList);
  screen.append(diffPanel);
  screen.append(searchBar);
  screen.append(conflictPanel);
  screen.append(tokenPrompt);
  screen.append(statusBar);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function buildHeader(s: AppState): string {
    const tokenStatus = s.tokenAvailable
      ? '{green-fg}● Token OK{/green-fg}'
      : '{red-fg}● No Token{/red-fg}';
    return (
      ` {bold}🍒 CherryPick Terminal{/bold}  ` +
      `{gray-fg}picking from:{/gray-fg} {yellow-fg}${s.sourceBranch}{/yellow-fg}` +
      ` {gray-fg}→ into:{/gray-fg} {green-fg}${s.currentBranch}{/green-fg}  ` +
      `{gray-fg}repo:{/gray-fg} ${repoPath}  ${tokenStatus}`
    );
  }

  function buildStatusBar(s: AppState): string {
    const selCount = s.selected.size;
    const sel =
      selCount > 0
        ? `{green-fg}${selCount} commit(s) selected{/green-fg}`
        : '{gray-fg}No commits selected{/gray-fg}';
    return (
      ` ${sel}  ` +
      `{gray-fg}[Space]{/gray-fg} Toggle  {gray-fg}[Enter]{/gray-fg} Cherry-Pick  ` +
      `{gray-fg}[p]{/gray-fg} Create PR  {gray-fg}[b]{/gray-fg} Change source branch  ` +
      `{gray-fg}[t]{/gray-fg} Token  {gray-fg}[q]{/gray-fg} Quit`
    );
  }

  function setStatus(msg: string): void {
    statusBar.setContent(` ${msg}\n\n ${buildStatusBar(state).trim()}`);
    screen.render();
  }

  function renderList(): void {
    const items = state.filteredCommits.map((c) => {
      const tick = state.selected.has(c.hash)
        ? '{green-fg}✔{/green-fg} '
        : '  ';
      const hash = `{yellow-fg}${shortHash(c.hash)}{/yellow-fg}`;
      const date = `{gray-fg}${c.date}{/gray-fg}`;
      const msg = truncate(c.message, 45);
      const author = `{cyan-fg}${truncate(c.author_name, 12)}{/cyan-fg}`;
      return `${tick}${hash} ${date} ${author} ${msg}`;
    });

    if (items.length === 0) {
      (commitList as any).setItems([
        `  {gray-fg}No unique commits found between {/gray-fg}` +
        `{cyan-fg}${state.currentBranch}{/cyan-fg}{gray-fg} and {/gray-fg}` +
        `{yellow-fg}${state.sourceBranch}{/yellow-fg}`,
      ]);
    } else {
      (commitList as any).setItems(items);
    }

    if (state.currentIndex >= 0 && state.currentIndex < items.length) {
      commitList.select(state.currentIndex);
    }
    screen.render();
  }

  async function updateDiff(): Promise<void> {
    const commit = state.filteredCommits[state.currentIndex];
    if (!commit) {
      diffPanel.setContent('{gray-fg}No commit selected.{/gray-fg}');
      screen.render();
      return;
    }
    diffPanel.setContent(
      `{gray-fg}Loading diff for ${shortHash(commit.hash)}…{/gray-fg}`
    );
    screen.render();
    const stat = await getDiffStat(git, commit.hash);
    diffPanel.setContent(stat);
    (diffPanel as any).scrollTo(0);
    screen.render();
  }

  function applyFilter(): void {
    if (!state.searchQuery) {
      state.filteredCommits = state.commits;
    } else {
      const q = state.searchQuery.toLowerCase();
      state.filteredCommits = state.commits.filter(
        (c) =>
          c.message.toLowerCase().includes(q) ||
          c.author_name.toLowerCase().includes(q)
      );
    }
    state.currentIndex = 0;
    renderList();
    void updateDiff();
  }

  function showConflict(files: string[]): void {
    state.inConflict = true;
    state.conflictFiles = files;
    const fileList = files
      .map((f) => `  {red-fg}✗{/red-fg} ${f}`)
      .join('\n');
    conflictPanel.setContent(
      `{bold}Cherry-pick paused — conflicts in ${files.length} file(s):{/bold}\n\n` +
      fileList +
      `\n\n{green-fg}[c]{/green-fg} Continue (after resolving)   {red-fg}[a]{/red-fg} Abort`
    );
    conflictPanel.show();
    conflictPanel.focus();
    screen.render();
  }

  function hideConflict(): void {
    state.inConflict = false;
    state.conflictFiles = [];
    conflictPanel.hide();
    commitList.focus();
    screen.render();
  }

  async function reloadCommits(): Promise<void> {
    state.commits = await getLog(
      git,
      100,
      state.sourceBranch,
      state.currentBranch
    );
    state.filteredCommits = state.commits;
    state.currentIndex = 0;
    renderList();
    void updateDiff();
  }

  async function showPRPrompt(): Promise<void> {
    if (!state.tokenAvailable) {
      setStatus('{red-fg}No GitHub token. Press [t] to set one first.{/red-fg}');
      return;
    }

    const prompt = blessed.prompt({
      top: 'center',
      left: 'center',
      width: '60%',
      height: 'shrink',
      border: 'line',
      label: ' {cyan-fg}Create Pull Request{/cyan-fg} ',
      tags: true,
      style: { border: { fg: 'cyan' } },
    });
    screen.append(prompt);

    // Default base = currentBranch (e.g. canvas)
    prompt.input(
      `Target branch (base to merge into, e.g. ${state.currentBranch}):`,
      state.currentBranch,
      async (_err, targetBranch) => {
        if (!targetBranch) {
          prompt.destroy();
          screen.render();
          return;
        }
        prompt.input(
          'PR Title:',
          `Cherry-pick: ${state.sourceBranch} → ${targetBranch}`,
          async (_err2, title) => {
            prompt.destroy();
            if (!title) {
              screen.render();
              return;
            }
            setStatus('{yellow-fg}Creating PR…{/yellow-fg}');
            try {
              const pr = await createPullRequest({
                token: getSavedToken(),
                remoteUrl: state.remoteUrl,
                head: state.currentBranch,
                base: targetBranch,
                title,
              });
              setStatus(
                `{green-fg}✔ PR #${pr.number} created: ${pr.url}{/green-fg}`
              );
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              setStatus(`{red-fg}PR failed: ${msg}{/red-fg}`);
            }
            screen.render();
          }
        );
      }
    );
    screen.render();
  }

  function showTokenPrompt(): void {
    tokenPrompt.show();
    tokenInput.clearValue();
    tokenInput.focus();
    screen.render();
  }

  // ─── Keybindings ───────────────────────────────────────────────────────────

  commitList.key(['up', 'k'], () => {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      commitList.select(state.currentIndex);
      void updateDiff();
      screen.render();
    }
  });

  commitList.key(['down', 'j'], () => {
    if (state.currentIndex < state.filteredCommits.length - 1) {
      state.currentIndex++;
      commitList.select(state.currentIndex);
      void updateDiff();
      screen.render();
    }
  });

  commitList.key('space', () => {
    const commit = state.filteredCommits[state.currentIndex];
    if (!commit) return;
    if (state.selected.has(commit.hash)) {
      state.selected.delete(commit.hash);
    } else {
      state.selected.add(commit.hash);
    }
    statusBar.setContent(buildStatusBar(state));
    renderList();
  });

  // Enter — cherry-pick selected commits
  commitList.key('enter', async () => {
    if (state.selected.size === 0) {
      setStatus('{yellow-fg}No commits selected. Press Space to select.{/yellow-fg}');
      return;
    }
    // Oldest-first order for clean cherry-pick stack
    const orderedHashes = state.commits
      .filter((c) => state.selected.has(c.hash))
      .map((c) => c.hash)
      .reverse();

    setStatus(`{yellow-fg}Cherry-picking ${orderedHashes.length} commit(s)…{/yellow-fg}`);
    const result = await cherryPick(git, orderedHashes);

    if (result.hasConflict) {
      showConflict(result.conflictedFiles);
    } else {
      state.selected.clear();
      await reloadCommits();
      setStatus('{green-fg}✔ Cherry-pick complete! Run [p] to create a PR.{/green-fg}');
    }
  });

  // / — search
  commitList.key('/', () => {
    state.searchMode = true;
    searchBar.show();
    searchBar.clearValue();
    searchBar.focus();
    screen.render();
  });

  searchBar.key('escape', () => {
    state.searchMode = false;
    state.searchQuery = '';
    searchBar.clearValue();
    searchBar.hide();
    applyFilter();
    commitList.focus();
  });

  searchBar.on('keypress', (_ch: string, key: { name: string }) => {
    if (key.name === 'enter') {
      state.searchQuery = searchBar.getValue();
      applyFilter();
      searchBar.hide();
      state.searchMode = false;
      commitList.focus();
    }
  });

  // p — PR
  commitList.key('p', () => { void showPRPrompt(); });

  // t — token
  commitList.key('t', () => { showTokenPrompt(); });

  // b — change source branch (restart branch selector)
  commitList.key('b', async () => {
    screen.destroy();
    const allBranchesNow = await getLocalBranches(git);
    const newSource = await showBranchSelector(allBranchesNow, state.currentBranch);
    state.sourceBranch = newSource;
    state.selected.clear();
    state.searchQuery = '';
    await showMainUI(git, repoPath, state, allBranchesNow);
  });

  // Token save
  tokenInput.key('enter', () => {
    const token = tokenInput.getValue().trim();
    if (token) {
      saveToken(token);
      state.tokenAvailable = true;
      header.setContent(buildHeader(state));
    }
    tokenPrompt.hide();
    commitList.focus();
    setStatus(token ? '{green-fg}✔ Token saved!{/green-fg}' : '{gray-fg}Token skipped.{/gray-fg}');
    screen.render();
  });

  tokenInput.key('escape', () => {
    tokenPrompt.hide();
    commitList.focus();
    screen.render();
  });

  // Conflict handlers
  conflictPanel.key('c', async () => {
    try {
      await cherryPickContinue(git);
      hideConflict();
      await reloadCommits();
      setStatus('{green-fg}✔ Cherry-pick continued!{/green-fg}');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`{red-fg}Continue failed: ${msg}{/red-fg}`);
    }
  });

  conflictPanel.key('a', async () => {
    try {
      await cherryPickAbort(git);
      hideConflict();
      setStatus('{yellow-fg}Cherry-pick aborted.{/yellow-fg}');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`{red-fg}Abort failed: ${msg}{/red-fg}`);
    }
  });

  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  // Tab — switch focus between list and diff panel
  let diffFocused = false;
  screen.key('tab', () => {
    if (diffFocused) {
      diffFocused = false;
      commitList.focus();
    } else {
      diffFocused = true;
      diffPanel.focus();
    }
  });

  // ─── Initial render ────────────────────────────────────────────────────────

  renderList();
  void updateDiff();
  commitList.focus();

  if (!state.tokenAvailable) {
    showTokenPrompt();
  }

  screen.render();
}

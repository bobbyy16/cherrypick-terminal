import * as blessed from 'blessed';
import { SimpleGit } from 'simple-git';
import {
  Commit,
  getLog,
  getDiffStat,
  cherryPick,
  cherryPickContinue,
  cherryPickAbort,
  getBranches,
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
  selected: Set<string>;      // hashes selected for cherry-pick
  currentIndex: number;
  searchMode: boolean;
  searchQuery: string;
  tokenAvailable: boolean;
  currentBranch: string;
  remoteUrl: string;
  conflictFiles: string[];
  inConflict: boolean;
}

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = {
  bg: 'black',
  border: 'cyan',
  selected: 'green',
  highlight: 'blue',
  dim: 'gray',
  error: 'red',
  success: 'green',
  accent: 'yellow',
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export async function startUI(git: SimpleGit, repoPath: string): Promise<void> {
  // 1. Load initial data
  const [commits, currentBranch, remoteUrl] = await Promise.all([
    getLog(git),
    getCurrentBranch(git),
    getRemoteUrl(git),
  ]);

  const state: AppState = {
    commits,
    filteredCommits: commits,
    selected: new Set(),
    currentIndex: 0,
    searchMode: false,
    searchQuery: '',
    tokenAvailable: hasToken(),
    currentBranch,
    remoteUrl,
    conflictFiles: [],
    inConflict: false,
  };

  // 2. Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: '🍒 CherryPick Terminal',
    fullUnicode: true,
    dockBorders: true,
  });

  // ─── Layout ────────────────────────────────────────────────────────────────

  // Top header bar
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: buildHeader(currentBranch, repoPath, state.tokenAvailable),
    tags: true,
    style: { fg: 'white', bg: COLORS.highlight, bold: true },
  });

  // Left pane — commit list
  const commitList = blessed.list({
    top: 3,
    left: 0,
    width: '50%',
    height: '100%-7',
    border: { type: 'line' },
    label: ' {bold}{cyan-fg}Commits{/cyan-fg}{/bold} (↑↓ navigate · Space select · / search · Enter run) ',
    tags: true,
    keys: true,
    vi: true,
    scrollbar: { ch: '│', style: { fg: 'cyan' } },
    style: {
      border: { fg: COLORS.border },
      selected: { bg: COLORS.highlight, fg: 'white', bold: true },
      item: { fg: 'white' },
    },
    items: [],
  });

  // Right pane — diff / stat preview
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
    style: { border: { fg: COLORS.border }, fg: 'white' },
    content: '{gray-fg}Move cursor to preview diff…{/gray-fg}',
  });

  // Search bar (hidden by default)
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
    style: { border: { fg: COLORS.accent }, fg: 'white' },
  });

  // Conflict panel (hidden by default)
  const conflictPanel = blessed.box({
    top: '10%',
    left: '10%',
    width: '80%',
    height: '60%',
    hidden: true,
    border: { type: 'line' },
    label: ' {bold}{red-fg}⚠  Cherry-Pick Conflict{/red-fg}{/bold} ',
    tags: true,
    style: { border: { fg: COLORS.error } },
    content: '',
  });

  // Token prompt (shown if no token)
  const tokenPrompt = blessed.form({
    top: '20%',
    left: '15%',
    width: '70%',
    height: 11,
    hidden: true,
    border: { type: 'line' },
    label: ' {bold}{yellow-fg}  GitHub Token Setup{/yellow-fg}{/bold} ',
    tags: true,
    style: { border: { fg: COLORS.accent } },
  });

  const tokenLabel = blessed.text({
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
    censor: true,           // masks input as *
    inputOnFocus: true,
    style: { border: { fg: COLORS.accent }, fg: 'white' },
  });

  const tokenHint = blessed.text({
    parent: tokenPrompt,
    top: 7,
    left: 2,
    content: '{green-fg}[Enter]{/green-fg} Save & Continue    {gray-fg}[Esc]{/gray-fg} Skip (PR creation disabled)',
    tags: true,
    style: { fg: 'white' },
  });

  // Bottom status bar
  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 4,
    border: { type: 'line' },
    tags: true,
    style: { border: { fg: COLORS.border }, fg: 'white' },
    content: buildStatusBar(state),
  });

  // Append all elements to screen
  screen.append(header);
  screen.append(commitList);
  screen.append(diffPanel);
  screen.append(searchBar);
  screen.append(conflictPanel);
  screen.append(tokenPrompt);
  screen.append(statusBar);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function renderList(): void {
    const items = state.filteredCommits.map((c) => {
      const tick = state.selected.has(c.hash) ? '{green-fg}✔{/green-fg} ' : '  ';
      const hash = `{yellow-fg}${shortHash(c.hash)}{/yellow-fg}`;
      const date = `{gray-fg}${c.date}{/gray-fg}`;
      const msg = truncate(c.message, 45);
      const author = `{cyan-fg}${truncate(c.author_name, 12)}{/cyan-fg}`;
      return `${tick}${hash} ${date} ${author} ${msg}`;
    });
    (commitList as any).setItems(items);
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
    diffPanel.setContent(`{gray-fg}Loading diff for ${shortHash(commit.hash)}…{/gray-fg}`);
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

  function buildHeader(branch: string, path: string, tokenOk: boolean): string {
    const tokenStatus = tokenOk
      ? '{green-fg}● GitHub Token OK{/green-fg}'
      : '{red-fg}● No Token (PR disabled){/red-fg}';
    return (
      ` {bold}🍒 CherryPick Terminal{/bold}  ` +
      `{gray-fg}branch:{/gray-fg} {cyan-fg}${branch}{/cyan-fg}  ` +
      `{gray-fg}repo:{/gray-fg} ${path}  ` +
      tokenStatus
    );
  }

  function buildStatusBar(s: AppState): string {
    const selCount = s.selected.size;
    const sel = selCount > 0
      ? `{green-fg}${selCount} commit(s) selected{/green-fg}`
      : '{gray-fg}No commits selected{/gray-fg}';
    return (
      ` ${sel}  ` +
      `{gray-fg}[Space]{/gray-fg} Toggle  {gray-fg}[Enter]{/gray-fg} Cherry-Pick  ` +
      `{gray-fg}[p]{/gray-fg} Create PR  {gray-fg}[t]{/gray-fg} Set Token  {gray-fg}[q]{/gray-fg} Quit`
    );
  }

  function setStatus(msg: string): void {
    statusBar.setContent(` ${msg}\n\n ${buildStatusBar(state).trim()}`);
    screen.render();
  }

  function showConflict(files: string[]): void {
    state.inConflict = true;
    state.conflictFiles = files;
    const fileList = files.map((f) => `  {red-fg}✗{/red-fg} ${f}`).join('\n');
    conflictPanel.setContent(
      `{bold}Cherry-pick paused due to conflicts in ${files.length} file(s):{/bold}\n\n` +
      fileList +
      `\n\n{green-fg}[c]{/green-fg} Continue (after resolving)   {red-fg}[a]{/red-fg} Abort cherry-pick`
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

  async function showPRPrompt(): Promise<void> {
    if (!state.tokenAvailable) {
      setStatus('{red-fg}No GitHub token. Press [t] to set one first.{/red-fg}');
      return;
    }

    const branches = await getBranches(git);
    // Simple inline prompt using blessed prompt widget
    const prompt = blessed.prompt({
      top: 'center',
      left: 'center',
      width: '60%',
      height: 'shrink',
      border: 'line',
      label: ' {cyan-fg}Create Pull Request{/cyan-fg} ',
      tags: true,
      style: { border: { fg: COLORS.border } },
    });
    screen.append(prompt);

    prompt.input('Target branch (e.g. main):', '', async (_err, targetBranch) => {
      if (!targetBranch) {
        prompt.destroy();
        screen.render();
        return;
      }
      prompt.input('PR Title:', `Cherry-pick from ${state.currentBranch}`, async (_err2, title) => {
        prompt.destroy();
        if (!title) { screen.render(); return; }

        setStatus('{yellow-fg}Creating PR…{/yellow-fg}');
        try {
          const pr = await createPullRequest({
            token: getSavedToken(),
            remoteUrl: state.remoteUrl,
            head: state.currentBranch,
            base: targetBranch,
            title,
          });
          setStatus(`{green-fg}✔ PR #${pr.number} created: ${pr.url}{/green-fg}`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus(`{red-fg}PR failed: ${msg}{/red-fg}`);
        }
        screen.render();
      });
    });
    screen.render();
  }

  function showTokenPrompt(): void {
    tokenPrompt.show();
    tokenInput.clearValue();
    tokenInput.focus();
    screen.render();
  }

  // ─── Key bindings ──────────────────────────────────────────────────────────

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

  // Enter — run cherry-pick
  commitList.key('enter', async () => {
    if (state.selected.size === 0) {
      setStatus('{yellow-fg}No commits selected. Press Space to select.{/yellow-fg}');
      return;
    }
    // Cherry-pick in the order they appear in log
    const orderedHashes = state.commits
      .filter((c) => state.selected.has(c.hash))
      .map((c) => c.hash)
      .reverse(); // oldest first

    setStatus(`{yellow-fg}Cherry-picking ${orderedHashes.length} commit(s)…{/yellow-fg}`);
    const result = await cherryPick(git, orderedHashes);

    if (result.hasConflict) {
      showConflict(result.conflictedFiles);
    } else {
      state.selected.clear();
      // Refresh log
      state.commits = await getLog(git);
      state.filteredCommits = state.commits;
      state.currentIndex = 0;
      renderList();
      void updateDiff();
      setStatus(`{green-fg}✔ Cherry-pick complete!{/green-fg}`);
    }
  });

  // / — enter search mode
  commitList.key('/', () => {
    state.searchMode = true;
    searchBar.show();
    searchBar.clearValue();
    searchBar.focus();
    screen.render();
  });

  // Escape from search
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

  // p — create PR
  commitList.key('p', () => { void showPRPrompt(); });

  // t — set/reset token
  commitList.key('t', () => { showTokenPrompt(); });

  // Token input submit
  tokenInput.key('enter', () => {
    const token = tokenInput.getValue().trim();
    if (token) {
      saveToken(token);
      state.tokenAvailable = true;
      header.setContent(buildHeader(state.currentBranch, repoPath, true));
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

  // Conflict panel keys
  conflictPanel.key('c', async () => {
    try {
      await cherryPickContinue(git);
      hideConflict();
      state.commits = await getLog(git);
      state.filteredCommits = state.commits;
      state.currentIndex = 0;
      renderList();
      void updateDiff();
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

  // q / Ctrl-C — quit
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  // Scroll diff panel with Tab
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

  // Show token prompt on first launch if no token saved
  if (!state.tokenAvailable) {
    showTokenPrompt();
  }

  screen.render();
}

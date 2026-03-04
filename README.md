# 🍒 CherryPick Terminal

An interactive terminal UI for `git cherry-pick` — browse commits, select what you want, preview diffs, and optionally create a GitHub PR. No `gh` CLI required.

---

## Features

| Feature                        | Key                 |
| ------------------------------ | ------------------- |
| Browse commits                 | `↑ / ↓` or `j / k`  |
| Select commits for cherry-pick | `Space`             |
| Execute cherry-pick            | `Enter`             |
| Diff preview (side panel)      | auto on cursor move |
| Search / filter commits        | `/` then type       |
| Create GitHub Pull Request     | `p`                 |
| Set / update GitHub token      | `t`                 |
| Tab between panels             | `Tab`               |
| Quit                           | `q` or `Ctrl+C`     |

---

## Installation

```bash
git clone https://github.com/your-username/cherrypick-terminal
cd cherrypick-terminal
npm install
npm run build
```

---

## Usage

```bash
# Run on current git repo
npm start

# Dev mode (ts-node, no build needed)
npm run dev

# Point to a different repo
node dist/index.js /path/to/your/repo
```

---

## GitHub Token (for PR creation)

On first launch, the app will prompt you to enter a **GitHub Personal Access Token** with `repo` scope.

Your token is stored securely in the OS config directory (via [`conf`](https://github.com/sindresorhus/conf)) and never hardcoded or committed.

> To create a token: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → `repo` scope.

You can press **`t`** at any time to update your token.

---

## Conflict Handling

If a cherry-pick conflicts, the app pauses and shows a list of conflicted files.

- Resolve conflicts in your editor
- Press **`c`** inside the app → `git cherry-pick --continue`
- Press **`a`** → `git cherry-pick --abort`

---

## Project Structure

```
src/
├── index.ts    — entry point, CLI arg parsing
├── ui.ts       — blessed TUI layout and keybindings
├── git.ts      — simple-git wrappers
├── token.ts    — GitHub token storage (conf)
├── github.ts   — PR creation via @octokit/rest
└── util.ts     — helpers (URL parser, truncate, etc.)
```

---

## Dependencies

- [`blessed`](https://github.com/chjj/blessed) — Terminal UI
- [`simple-git`](https://github.com/steveukx/git-js) — Git operations
- [`@octokit/rest`](https://github.com/octokit/rest.js) — GitHub API
- [`conf`](https://github.com/sindresorhus/conf) — Token persistence

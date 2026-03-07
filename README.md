# 🍒 CherryPick Terminal

An interactive terminal UI for `git cherry-pick` — browse commits, select what you want, preview diffs, and optionally create a GitHub PR. No `gh` CLI required.

---

## Installation

```bash
npm install -g @bobbyy16/cherrypick-terminal
```

## Usage

Navigate to any Git repository and run:

```bash
cherrypick
```

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
| Quit                           | `q` or `Ctrl+C`     |

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

## Dependencies

- [`blessed`](https://github.com/chjj/blessed) — Terminal UI
- [`simple-git`](https://github.com/steveukx/git-js) — Git operations
- [`@octokit/rest`](https://github.com/octokit/rest.js) — GitHub API
- [`conf`](https://github.com/sindresorhus/conf) — Token persistence

---

## Author

**Bobbyy16**

- [GitHub Profile](https://github.com/bobbyy16)
- [Sponsor / Support](https://github.com/sponsors/bobbyy16)

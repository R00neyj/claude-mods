# claude-mods

Personal Claude Code mods.

## flex-status

A status band drawn above the prompt that replaces a one-line `statusLine` command. It shows the model, effort, account, folder, git branch and changes, a context bar that runs up to the auto-compact point, the prompt-cache countdown, the 5h / 7d rate limits, the cache hit ratio, the session time and the clock. When the terminal gets narrow it folds onto more rows (one row, then left/bar/right, then each group wrapped) instead of cutting text off.

Turn off any `statusLine` in `~/.claude/settings.json` so the two do not show at once.

## tidy-tools

Draws Edit, Write, Bash, PowerShell, Read, Grep and Glob calls in the transcript as compact cards, in a layout borrowed from [oh-my-pi](https://github.com/can1357/oh-my-pi): a rounded frame with the title on its top border and facts (wall time, exit code) on its bottom one. Edits and new files show only the changed lines as the engine's highlighted diff, commands show the last 10 output lines, reads show the first 12 lines with line numbers, and searches show a short tree.

- `/tidy-tools` turns it off and on (off shows Claude Code's own rows)
- `▸ 펼치기` under a card that hides lines shows them all; `▾ 접기` folds it back
- `/tidy-tools bg auto|dark|light|off` sets the card background

## Install

At the prompt of a terminal session:

```
/plugin install flex-status --marketplace R00neyj/claude-mods
/plugin install tidy-tools --marketplace R00neyj/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope.

From a shell:

```
claude plugin install flex-status --marketplace R00neyj/claude-mods
claude plugin install tidy-tools --marketplace R00neyj/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `R00neyj/claude-mods`, then Add plugin.

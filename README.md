# claude-mods

Personal Claude Code mods.

## flex-status

A status band drawn above the prompt that replaces a one-line `statusLine` command. It shows the model, effort, account, folder, git branch and changes, a context bar that runs up to the auto-compact point, the prompt-cache countdown, the 5h / 7d rate limits, the cache hit ratio, the session time and the clock. When the terminal gets narrow it folds onto more rows (one row, then left/bar/right, then each group wrapped) instead of cutting text off.

Turn off any `statusLine` in `~/.claude/settings.json` so the two do not show at once.

## Install

At the prompt of a terminal session:

```
/plugin install flex-status --marketplace R00neyj/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope.

From a shell:

```
claude plugin install flex-status --marketplace R00neyj/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `R00neyj/claude-mods`, then Add plugin.

# pi-better

`/better` turns a prompt into a deeper version of itself before you send it. A helper with a copy of your conversation reads the real material the prompt touches (code, screenshots, docs), works out what a top professional would do, and rewrites the prompt with those facts in it. You see the result and choose: send it, have it changed, edit it yourself, or drop it.

```
/better make the buttons feel clickable when I hover them
```

```
┌─ Improved prompt ────────────────────────────────┐
│ ▸ why (w)                                        │
│ Clickable things in the app don't look …         │
│ Enter fire · b fire as /boomerang · t tweak      │
│ e edit · w show why · Esc cancel                 │
└──────────────────────────────────────────────────┘
```

## Install

```bash
pi install /Users/nicobailon/.pi/agent/skills/pi-better
```

It needs [pi-subagents](https://github.com/nicobailon/pi-subagents) loaded; the helper runs as one of its subagents. `b` (fire as /boomerang) shows only when [pi-boomerang](https://github.com/nicobailon/pi-boomerang) is loaded.

## Use

- `/better <prompt>`: deepen that prompt.
- `/better`: deepen the task you're working on now, including any feedback you gave on work so far.

While the helper works you see its progress; Esc cancels it. Then the box shows the improved prompt, with the reasoning folded away under `w`:

| Key | What happens |
|---|---|
| Enter | Sends the prompt as your message. |
| `b` | Sends it as `/boomerang <prompt>`, so the long run folds into a summary when it ends. |
| `t` | Asks "What should change?". The helper redoes the prompt with your note and the box comes back; you can tweak again. An empty note puts the prompt in your input box instead. |
| `e` | Puts the prompt in your input box to edit and send yourself. |
| `w` | Shows or hides the four answers behind the rewrite. |
| Esc | Closes the box; nothing is sent. |

## How it works

The helper is pi-subagents' read-only `oracle` agent on `pi-claude/claude-opus-5-5` with high thinking, started from a fork of your conversation. It follows `helper.md`: answer four questions (what a top professional would do that you didn't ask for, the rawest material, the methods and tools, and what outside check shows the result is right), gather that raw material first, then rewrite. It never carries the prompt out. It returns its answers through a fixed schema, and `/better` fails loudly if the shape is wrong.

Your conversation only gains what you send. The helper runs in its own fork, each result is stored as a session entry the model doesn't see, and firing adds just your message. Earlier history never changes, so the prompt cache stays warm.

Outside the interactive terminal (print, JSON or RPC mode), `/better` posts the answers and the prompt as a message and stops.

## Limitations

- The helper can't ask you questions while it works; you're waiting on it, so it decides from what it can read.
- `b` is hidden when the prompt starts with `/` or a /boomerang subcommand word, or contains `->`, `--`, `--rethrow` or `--loop`, because /boomerang would read those as its own syntax.
- A very long prompt makes a tall box; edit it with `e` if it doesn't fit your screen.

## Troubleshooting

- "pi-subagents didn't pick up the request": load pi-subagents, then `/reload`.
- "The helper failed: …": the text after it comes from pi-subagents (timeout after 20 minutes, unknown agent or model, and so on).

## Development

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc against the global Pi install
```

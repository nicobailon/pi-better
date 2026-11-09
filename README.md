# pi-better

`/better` turns a prompt into a deeper version of itself and puts that in your input box, so you read it and press Enter yourself. A read-only helper with a copy of your conversation reads the real material the prompt touches (code, screenshots, docs), works out what a top professional would do, and rewrites the prompt with those facts in it.

```
/better make the buttons feel clickable when I hover them
```

Two commands, one rewrite method:

```
/better <prompt>            helper (separate run, read-only) ─► rewrite ─► your input box; you press Enter
/better-boomerang <prompt>  this chat rewrites it ─► jumps back to where it started ─► your input box; you press Enter
```

Leave the prompt out of either to deepen the task you're working on now, including any feedback you gave on work so far.

## Install

pi-better lives in `~/.pi/agent/extensions/pi-better`, and Pi loads it from there automatically; no `pi install` needed. To keep it somewhere else, run `pi install <path>` on that folder instead.

`/better` needs [pi-subagents](https://github.com/nicobailon/pi-subagents) loaded; the helper runs as one of its subagents. `/better-boomerang` needs no other extension.

## Use

### `/better`: rewrite with a helper

While the helper works you see its progress; Esc cancels it. When it's done the improved prompt is in your input box; read it, change it if you like, and press Enter to send it. Nothing is sent until you do. If you'd already typed something there, it stays, below the improved prompt. If the helper fails, your input box is left alone and you get an error.

### `/better-boomerang`: rewrite here, then jump back

No helper: the agent in this chat does the rewrite itself, with everything it already knows. It can read and run commands like any turn here, but it's told only to read and rewrite. Then pi-better jumps the chat back to where the rewrite started (no summary) and puts the improved prompt in your input box for you to send. The rewrite turn leaves the chat's context but stays in `/tree`. You can keep typing while the rewrite runs; whatever you typed stays in the box, below the improved prompt. If the reply has no `<improved-prompt>` block, the chat doesn't jump back, you get an error, and the rewrite stays in the chat so you can see what happened.

## How it works

```
 YOU  /better <prompt>                              /better-boomerang <prompt>
      (leave the prompt out to deepen what we're doing now)
          │                                                 │
          ▼                                                 ▼
┌─ helper (/better) ─────────────────────────────┐   ┌─ this chat (/better-boomerang) ───────────┐
│ pi-better-helper, registered once per session  │   │ a hidden message asks the agent here to   │
│ tools: read · grep · find · ls · bash          │   │ read, answer (1)–(4), and end its reply   │
│ (no edit, no write)                            │   │ with the prompt in an <improved-prompt>   │
│ copy of this chat if the session is saved,     │   │ block                                     │
│ else a fresh start                             │   │ then the chat jumps back to where it      │
│ reads the real material, answers (1)–(4),      │   │ started; the rewrite stays in /tree       │
│ returns a fixed schema                         │   └──────────────────┬────────────────────────┘
└────────┬───────────────────────────────────────┘                      │ block missing → error,
         │ fails → error, nothing sent                                  │ nothing sent
         ▼                                                              ▼
  improved prompt in your input box, above anything you'd typed; you press Enter to send
```

The helper runs on `pi-claude/claude-opus-5-5` with high thinking. pi-better registers it with pi-subagents on first use and removes it when the session ends. Every rewrite, including the helper's four answers, is also stored as a session entry the model never sees.

Either way, the chat afterwards holds the earlier messages plus the one you send, and earlier history never changes, so the prompt cache stays warm. `/better-boomerang` costs one extra turn on top of the cached history.

Outside the interactive terminal (print, JSON or RPC mode) there's no input box pi-better can rely on, so `/better` posts the helper's answers and the prompt as a message and stops; `/better-boomerang` posts the prompt.

## Limitations

- The helper can't ask you questions while it works; you're waiting on it, so it decides from what it can read.
- The helper keeps `bash` so it can run read-only searches and quick experiments. A shell command could still write a file; `helper.md` tells it not to.
- In a new session with no history yet, there's no task to deepen, so each command needs a prompt.

## Troubleshooting

- "pi-subagents didn't register the helper agent" or "didn't pick up the request": load pi-subagents, then `/reload`.
- "pi-subagents refused the helper agent": usually another agent is already named `pi-better-helper`; rename or remove it.
- "The helper failed: …" or "The helper timed out: …": the text after it comes from pi-subagents (unknown agent or model, the 20-minute limit, and so on).

## Development

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc against the global Pi install
```

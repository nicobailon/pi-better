# pi-better

`/better` turns a prompt into a deeper version of itself and puts that in your input box, so you read it and press Enter yourself. A read-only helper with a copy of your conversation reads the real material the prompt touches (code, screenshots, docs), works out what a top professional would do, and rewrites the prompt with those facts in it. It works in the background, so you can keep chatting meanwhile.

```
/better make the buttons feel clickable when I hover them
```

Two commands, one rewrite method:

```
/better <prompt>            helper (separate pi process, read-only, in the background) ─► rewrite ─► your input box; you press Enter
/better-boomerang <prompt>  this chat rewrites it ─► jumps back to where it started ─► your input box; you press Enter
```

Leave the prompt out of either to deepen the task you're working on now, including any feedback you gave on work so far.

## Install

pi-better lives in `~/.pi/agent/extensions/pi-better`, and Pi loads it from there automatically; no `pi install` needed. To keep it somewhere else, run `pi install <path>` on that folder instead. It needs no other extension.

## Use

### `/better`: rewrite with a helper, in the background

`/better` returns right away. A line above your input box shows the helper's progress: how many tools it has run, the command it's running now, and how long it's been going. Meanwhile you can keep chatting with the agent as usual. When the helper is done, the improved prompt lands in your input box, even if the agent is in the middle of a reply; read it, change it if you like, and press Enter to send it. Nothing is sent until you do. Anything you've typed there stays, below the improved prompt. If the helper fails, your input box is left alone and you get an error.

`/better-cancel` stops the helper; nothing is sent and your input box is left alone. One helper runs at a time: a second `/better` while one is running tells you to wait or cancel. Starting a new session or switching sessions (`/new`, `/resume`) stops the helper too.

The helper gets a copy of the chat as it was when you ran `/better`. Messages you send while it works don't reach it.

### `/better-boomerang`: rewrite here, then jump back

No helper: the agent in this chat does the rewrite itself, with everything it already knows. It can read and run commands like any turn here, but it's told only to read and rewrite. Then pi-better jumps the chat back to where the rewrite started (no summary) and puts the improved prompt in your input box for you to send. The rewrite turn leaves the chat's context but stays in `/tree`. You can keep typing while the rewrite runs; whatever you typed stays in the box, below the improved prompt. If the reply has no `<improved-prompt>` block, the chat doesn't jump back, you get an error, and the rewrite stays in the chat so you can see what happened.

## How it works

```
 YOU  /better <prompt>                              /better-boomerang <prompt>
      (leave the prompt out to deepen what we're doing now)
          │                                                 │
          ▼                                                 ▼
┌─ helper (/better) ─────────────────────────────┐   ┌─ this chat (/better-boomerang) ───────────┐
│ a separate `pi -p` process with your usual     │   │ a hidden message asks the agent here to   │
│ extensions and settings, no skills             │   │ read, answer (1)–(4), and end its reply   │
│ tools: read · grep · find · ls · bash          │   │ with the prompt in an <improved-prompt>   │
│ (no edit, no write)                            │   │ block                                     │
│ copy of this chat as of /better if the session │   │ then the chat jumps back to where it      │
│ is saved, else a fresh start                   │   │ started; the rewrite stays in /tree       │
│ you keep chatting; a line above the input box  │   └──────────────────┬────────────────────────┘
│ shows its progress; /better-cancel stops it    │                      │
│ answers (1)–(4), ends with <improved-prompt>   │                      │
└────────┬───────────────────────────────────────┘                      │ block missing → error,
         │ fails → error, nothing sent                                  │ nothing sent
         ▼                                                              ▼
  improved prompt in your input box, above anything you'd typed; you press Enter to send
```

The helper runs on `pi-claude/claude-opus-5-5` with high thinking and stops after 20 minutes. Its copy of the chat lives in a temporary folder that's deleted when it finishes, so it never shows up in `/resume`. Every rewrite, including the helper's whole reply with its four answers, is also stored as a session entry the model never sees.

Either way, the chat afterwards holds the earlier messages plus the one you send, and earlier history never changes, so the prompt cache stays warm. `/better-boomerang` costs one extra turn on top of the cached history.

Outside the interactive terminal (print, JSON or RPC mode) there's no input box pi-better can rely on, so `/better` posts the helper's reply as a message; `/better-boomerang` posts the prompt. In print and JSON mode `/better` waits for the helper before returning.

## Limitations

- The helper can't ask you questions while it works, so it decides from what it can read.
- The helper keeps `bash` so it can run read-only searches and quick experiments. A shell command could still write a file; `helper.md` tells it not to.
- In a new session with no history yet, there's no task to deepen, so each command needs a prompt.

## Troubleshooting

- "/better failed: The helper exited with code …": the text after it is the end of the helper's error output, for example an unknown model.
- "/better failed: The reply has no `<improved-prompt>` … block": the helper finished without the marked prompt; run `/better` again.

## Development

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc against the global Pi install
```

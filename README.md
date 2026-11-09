# pi-better

`/better` turns a prompt into a deeper version of itself and puts that in your input box, so you read it and press Enter yourself. A read-only helper with a copy of your conversation reads the real material the prompt touches (code, screenshots, docs), works out what a top professional would do, and rewrites the prompt with those facts in it.

```
/better make the buttons feel clickable when I hover them
```

Three commands, one rewrite method:

```
/better <prompt>            helper (separate run, read-only) ─► rewrite ─► your input box; you press Enter
/better-prompt <prompt>     helper (separate run, read-only) ─► rewrite ─► box: you fire, tweak, edit, … or cancel
/better-boomerang <prompt>  this chat rewrites it ─► jumps back to where it started ─► your input box; you press Enter
```

Leave the prompt out of any of them to deepen the task you're working on now, including any feedback you gave on work so far.

## Install

pi-better lives in `~/.pi/agent/extensions/pi-better`, and Pi loads it from there automatically; no `pi install` needed. To keep it somewhere else, run `pi install <path>` on that folder instead.

`/better` and `/better-prompt` need [pi-subagents](https://github.com/nicobailon/pi-subagents) loaded; the helper runs as one of its subagents, and `s` launches the prompt through it. `/better-boomerang` needs no other extension.

## Use

### `/better`: rewrite into your input box

While the helper works you see its progress; Esc cancels it. When it's done the improved prompt is in your input box; read it, change it if you like, and press Enter to send it. Nothing is sent until you do. If you'd already typed something there, it stays, below the improved prompt. If the helper fails or returns something malformed, your input box is left alone and you get an error.

### `/better-prompt`: rewrite, then choose

The same helper, but the improved prompt shows in a box first, with the reasoning folded away under `w`:

```
┌─ Improved prompt ────────────────────────────────┐
│ ▸ why (w)                                        │
│ Clickable things in the app don't look …         │
│ Enter fire · s run as a subagent                 │
│ t tweak · e edit                                 │
│ w show why · Esc cancel                          │
└──────────────────────────────────────────────────┘
```

| Key | What happens |
|---|---|
| Enter | Sends the prompt as your message. |
| `s` | Runs it as a background subagent (a `worker` on `pi-claude/claude-opus-5-5`, high thinking) instead of in this chat. Pick **Forked** to give it a copy of this conversation or **Fresh** to start it empty. Its result comes back into the chat when it finishes, like any pi-subagents background run. |
| `t` | Asks "What should change?". The helper redoes the prompt with your note and the box comes back; you can tweak again. An empty note puts the prompt in your input box instead. |
| `e` | Puts the prompt in your input box to edit and send yourself. |
| `w` | Shows or hides the four answers behind the rewrite. |
| Esc | Closes the box; nothing is sent. |

### `/better-boomerang`: rewrite here, then jump back

No helper: the agent in this chat does the rewrite itself, with everything it already knows. It can read and run commands like any turn here, but it's told only to read and rewrite, and to end with the prompt in a marked block. Then pi-better jumps the chat back to where the rewrite started (no summary) and puts the improved prompt in your input box for you to send. The rewrite turn leaves the chat's context but stays in `/tree`. You can keep typing while the rewrite runs; whatever you typed stays in the box, below the improved prompt. If the block is missing, the chat doesn't jump back, you get an error, and the rewrite stays in the chat so you can see what happened.

## How it works

```
 YOU  /better <prompt>   /better-prompt <prompt>   /better-boomerang <prompt>
      (leave the prompt out to deepen what we're doing now)
          │                    │                            │
          ▼                    ▼                            ▼
┌─ helper (/better and /better-prompt) ──────────┐   ┌─ this chat (/better-boomerang) ───────────┐
│ pi-better-helper, registered once per session  │   │ a hidden message asks the agent here to   │
│ tools: read · grep · find · ls · bash          │   │ read, answer (1)–(4), and end its reply   │
│ (no edit, no write)                            │   │ with the prompt in an <improved-prompt>   │
│ copy of this chat if the session is saved,     │   │ block                                     │
│ else a fresh start                             │   │ then the chat jumps back to where it      │
│ reads the real material, answers (1)–(4),      │   │ started; the rewrite stays in /tree       │
│ returns a fixed schema                         │   └──────────────────┬────────────────────────┘
└────────┬──────────────────────┬────────────────┘                      │ block missing → error,
         │                      │                                       │ nothing sent
         │ bad shape → error,   │                                       │
         │ nothing sent         │                                       │
         ▼                      ▼                                       ▼
  /better                /better-prompt                           improved prompt in your
  improved prompt in     box: Enter fire · s subagent ·           input box, above anything
  your input box, above  t tweak · e edit ·                       you typed meanwhile;
  anything already       w why · Esc cancel                       you press Enter to send
  there; you press
  Enter to send
```

In the box:

```
  Enter    s        t       e     Esc
    │      │        │       │      └─► nothing sent
    │      │        │       └─► prompt goes into your input box; you edit and send it
    │      │        └─► "What should change?"
    │      │              note  → helper redoes it ──► box shows again (loop)
    │      │              empty → same as e · Esc → nothing sent
    │      └─► Forked (copy of this chat) | Fresh (empty) background worker;
    │          its result comes back into this chat when it finishes
    └─► sent as your normal message; the agent runs it here
```

The helper runs on `pi-claude/claude-opus-5-5` with high thinking. pi-better registers it with pi-subagents on first use and removes it when the session ends. Every rewrite is also stored as a session entry the model never sees.

With `/better` and `/better-prompt`, your conversation only gains the message you send, and earlier history never changes, so the prompt cache stays warm:

```
chat before   [ … earlier messages … ]
chat after    [ … earlier messages … ] + your one message
              the helper's work and your tweaks stay outside the chat
```

`/better-boomerang` does its rewrite in this chat, then jumps back, so the chat's context afterwards is the same as with the other two: earlier messages plus your one message. The rewrite turn itself was one extra turn on top of the cached history.

Outside the interactive terminal (print, JSON or RPC mode) there's no input box pi-better can rely on, so `/better` and `/better-prompt` post the answers and the prompt as a message and stop; `/better-boomerang` posts the prompt.

## Limitations

- The helper can't ask you questions while it works; you're waiting on it, so it decides from what it can read.
- The helper keeps `bash` so it can run read-only searches and quick experiments. A shell command could still write a file; `helper.md` tells it not to.
- In a new session with no history yet, there's nothing to fork: each command needs a prompt, and `s` offers only Fresh.
- A very long prompt makes a tall box; edit it with `e` if it doesn't fit your screen.

## Troubleshooting

- "pi-subagents didn't register the helper agent" or "didn't pick up the request": load pi-subagents, then `/reload`.
- "pi-subagents refused the helper agent": usually another agent is already named `pi-better-helper`; rename or remove it.
- "The helper failed: …": the text after it comes from pi-subagents (timeout after 20 minutes, unknown agent or model, and so on).

## Development

```bash
npm test           # node --test, no dependencies
npm run typecheck  # tsc against the global Pi install
```

# pi-better

`/better` turns a prompt into a deeper version of itself before you send it. A helper with a copy of your conversation reads the real material the prompt touches (code, screenshots, docs), works out what a top professional would do, and rewrites the prompt with those facts in it. You see the result and choose: send it, have it changed, edit it yourself, or drop it.

```
/better make the buttons feel clickable when I hover them
```

```
┌─ Improved prompt ────────────────────────────────┐
│ ▸ why (w)                                        │
│ Clickable things in the app don't look …         │
│ Enter fire · b fire as /boomerang                │
│ s run as a subagent · t tweak · e edit           │
│ w show why · Esc cancel                          │
└──────────────────────────────────────────────────┘
```

## Install

```bash
pi install /Users/nicobailon/.pi/agent/skills/pi-better
```

It needs [pi-subagents](https://github.com/nicobailon/pi-subagents) loaded; the helper runs as one of its subagents, and `s` launches the prompt through it. `b` (fire as /boomerang) shows only when [pi-boomerang](https://github.com/nicobailon/pi-boomerang) is loaded.

## Use

- `/better <prompt>`: deepen that prompt.
- `/better`: deepen the task you're working on now, including any feedback you gave on work so far.

While the helper works you see its progress; Esc cancels it. Then the box shows the improved prompt, with the reasoning folded away under `w`:

| Key | What happens |
|---|---|
| Enter | Sends the prompt as your message. |
| `b` | Sends it as `/boomerang <prompt>`, so the long run folds into a summary when it ends. |
| `s` | Runs it as a background subagent (a `worker` on `pi-claude/claude-opus-5-5`, high thinking) instead of in this chat. Pick **Forked** to give it a copy of this conversation or **Fresh** to start it empty. Its result comes back into the chat when it finishes, like any pi-subagents background run. |
| `t` | Asks "What should change?". The helper redoes the prompt with your note and the box comes back; you can tweak again. An empty note puts the prompt in your input box instead. |
| `e` | Puts the prompt in your input box to edit and send yourself. |
| `w` | Shows or hides the four answers behind the rewrite. |
| Esc | Closes the box; nothing is sent. |

## How it works

Nothing is ever sent on its own: the improved prompt goes out only when you press a key in the box.

```
 YOU  /better <prompt>          or just  /better  (= "deepen what we're doing now")
  │
  ▼
┌─ pi-better (in your Pi window) ──────────────────────────────────────────┐
│ 1. bare /better in a new session with no history? → error: give a prompt │
│ 2. registers its helper agent once: pi-better-helper                     │
│      tools: read · grep · find · ls · bash   (no edit, no write)         │
│ 3. copy of this chat?  session saved already → yes (fork)                │
│                        new session           → no  (fresh)               │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ task = helper.md + your prompt (+ tweak note, if any)
                               ▼
┌─ helper (runs on its own; your chat only shows a spinner) ───────────────┐
│ reads the real material first (code, files, docs)                        │
│ answers: (1) what a top professional would add  (2) the rawest material  │
│          (3) methods and tools  (4) what outside check shows it's right  │
│ writes the better prompt (never carries it out)                          │
│ returns a fixed schema; a bad shape is a loud error and nothing is sent  │
└──────────────────────────────┬───────────────────────────────────────────┘
                               ▼
        stored as a session entry the model never sees
                               ▼
┌─ Improved prompt ─────────────────────────────────────────────┐
│ <the better prompt, in full>                                  │
│ Enter fire · b /boomerang · s subagent · t tweak · e edit     │
│ w why (the 4 answers) · Esc cancel                            │
└───┬──────┬──────┬────────┬───────┬──────┬────────────────────┘
  Enter    b      s        t       e     Esc
    │      │      │        │       │      └─► nothing sent
    │      │      │        │       └─► prompt goes into your input box; you edit and send it
    │      │      │        └─► "What should change?"
    │      │      │              note  → helper redoes it ──► box shows again (loop)
    │      │      │              empty → same as e · Esc → nothing sent
    │      │      └─► Forked (copy of this chat) | Fresh (empty) background worker;
    │      │          its result comes back into this chat when it finishes
    │      └─► sent as "/boomerang <prompt>": the work runs, then folds into a summary
    └─► sent as your normal message; the agent runs it here
```

The helper runs on `pi-claude/claude-opus-5-5` with high thinking. `/better` registers it with pi-subagents on first use and removes it when the session ends.

Your conversation only gains what you send, and earlier history never changes, so the prompt cache stays warm:

```
chat before   [ … earlier messages … ]
chat after    [ … earlier messages … ] + your one message (only on Enter or b)
              the helper's work and your tweaks stay outside the chat
```

Outside the interactive terminal (print, JSON or RPC mode), `/better` posts the answers and the prompt as a message and stops.

## Limitations

- The helper can't ask you questions while it works; you're waiting on it, so it decides from what it can read.
- The helper keeps `bash` so it can run read-only searches and quick experiments. A shell command could still write a file; `helper.md` tells it not to.
- In a new session with no history yet, there's nothing to fork: `/better` needs a prompt, and `s` offers only Fresh.
- `b` is hidden when the prompt starts with `/` or a /boomerang subcommand word, or contains `->`, `--`, `--rethrow` or `--loop`, because /boomerang would read those as its own syntax.
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

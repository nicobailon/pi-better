# How pi-better works

Both commands send the same task: [helper.md](../helper.md) (Felix Rieseberg's "Depth" prompt plus how to gather the raw material), then the prompt to deepen, then a request to end the reply with the rewritten prompt between `<improved-prompt>` and `</improved-prompt>`. They differ in who answers it.

```text
/better <prompt>                                 /better-boomerang <prompt>
      │                                                │
      ▼                                                ▼
separate `pi -p` process, in the background      this chat answers, as a hidden message
 · copy of this chat as of /better               (you watch it read and write)
 · read, grep, find, ls, bash; no edit or write        │
 · Opus 5.5, high thinking, 20-minute limit            ▼
      │                                          the chat jumps back to where it was
      ▼                                          before; the rewrite stays in /tree
      └──────────────┬─────────────────────────────────┘
                     ▼
     the prompt in the last <improved-prompt> block goes into your input box,
     above anything you'd typed; nothing is sent until you press Enter
```

## `/better`

**The helper is its own Pi process.** pi-better runs `pi --mode json -p` with `--model pi-claude/claude-opus-5-5 --thinking high`, `--tools read,grep,find,ls,bash` and `--no-skills`, plus a system-prompt line telling it to read and rewrite only. It loads your usual extensions and settings. It's launched the same way as Pi's own subagent example: the CLI script of the Pi you're running, the Pi binary itself when Pi is a compiled binary, or `pi` from your PATH.

**It gets a copy of your chat, as it was when you ran `/better`.** If the session has been saved (it has once there's a message in it), the helper starts with `--fork` of the session file. The copy goes into a temporary folder that's deleted when the helper finishes, so it never shows up in `/resume`. Messages you send while it works don't reach it. In a new session with nothing saved yet, it starts fresh, so `/better` needs a prompt there.

**It runs in the background.** `/better` returns right away and you keep chatting. The progress line comes from the helper's JSON event stream: each tool it starts updates the tool count and the command shown, and a local one-second clock keeps the time moving during slow commands. When the helper exits, pi-better takes the text of its last reply, reads the prompt out of the last `<improved-prompt>` block, saves the whole reply as a `better` session entry that the model never sees, and puts the prompt in your input box. That works whether the agent is idle or in the middle of a reply.

**One at a time.** A second `/better` while one is running is refused. `/better-cancel` stops the helper, and so does starting or switching sessions (`/new`, `/resume`, `/reload`); after a session switch, the stopped run doesn't touch the old session.

## `/better-boomerang`

The agent in this chat answers the same task, as a hidden message that starts a turn. It can read and run commands like any turn, but it's told only to read and rewrite. When the turn ends, pi-better reads the prompt from the reply, jumps the chat back to the entry before the rewrite with Pi's tree navigation (no summary), and puts the prompt in your input box. The rewrite turn leaves the chat's context but stays in `/tree`.

If the chat's last entry is a message (yours or one an extension added), pi-better first adds an invisible marker entry to jump back to, because jumping to a message would put its text back into your input box.

## Outside the interactive terminal

Print and JSON mode have no input box, and in RPC mode pi-better can't read what's already in the box, so a draft would be lost. In those modes `/better` posts the helper's whole reply as a message and `/better-boomerang` posts the prompt. In print and JSON mode `/better` waits for the helper before the command returns, since Pi would exit otherwise.

## The prompt cache

Neither command changes earlier history, and your conversation only gains the message you send, so the prompt cache stays warm. `/better-boomerang` costs one extra turn on top of the cached history. `/better`'s helper is a separate conversation with its own cache.

## Error messages

| Message | What it means |
|---|---|
| `/better has no task to deepen yet; give it a prompt: /better <prompt>` | nothing has been saved in this session yet, so there's no task to deepen |
| `/better is already running; /better-cancel stops it.` | one helper runs at a time |
| `/better cancelled; nothing was sent` | you ran `/better-cancel` |
| `No /better is running.` | `/better-cancel` had nothing to stop |
| `/better failed: Couldn't start pi for the helper: …` | the `pi` command couldn't be launched |
| `/better failed: The helper timed out after 20 minutes` | the helper hit its limit; try a narrower prompt |
| `/better failed: The helper exited with code …` | the text after it is the end of the helper's error output, for example an unknown model |
| `/better failed: The helper's model call failed: …` | the model returned an error, for example a rate limit or a sign-in problem |
| `/better failed: The reply has no <improved-prompt> … </improved-prompt> block.` | the reply ended without the marked prompt; run the command again |
| `/better failed: The reply's <improved-prompt> block is empty.` | same, with an empty block |
| `/better-boomerang is already running; wait for it to finish.` | one boomerang at a time |
| `/better-boomerang failed: another extension cancelled the jump back to where the rewrite started` | another extension blocked the tree navigation; the rewrite is still in the chat |

`/better-boomerang` reports a missing or empty block with the same text as `/better`, and leaves the rewrite in the chat so you can see what happened.

## Limitations

- The helper can't ask you questions while it works, so it decides from what it can read.
- The helper keeps `bash` so it can run read-only searches and quick experiments. A shell command could still write a file; only [helper.md](../helper.md) tells it not to.
- The helper loads your usual extensions, so any extension that does something at session start does it once per helper too.
- In a new session with no history yet, there's no task to deepen, so each command needs a prompt.

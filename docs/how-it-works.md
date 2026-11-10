# How pi-better works

Both commands send the same task: [helper.md](../helper.md) (Felix Rieseberg's "Depth" prompt, opened with an instruction to read the code and files first without asking, plus how to keep searches quick), then the prompt to deepen, then a request to end the reply with the rewritten prompt between `<improved-prompt>` and `</improved-prompt>`. They differ in who answers it.

```text
/better <prompt>                                 /better-boomerang <prompt>
      │                                                │
      ▼                                                ▼
separate `pi -p` process, in the background      this chat answers, as a hidden message
 · copy of this chat as of /better               (you watch it read and write)
 · read-only: tools other than reading are refused     │
 · the chat's model and thinking, 20-minute limit      ▼
      │                                          the chat jumps back to where it was
      ▼                                          before; the rewrite stays in /tree
      └──────────────┬─────────────────────────────────┘
                     ▼
     the prompt in the last <improved-prompt> block goes into your input box,
     above anything you'd typed; nothing is sent until you press Enter
```

## `/better`

**The helper is its own Pi process.** pi-better runs `pi --mode json -p` with the chat's `--model` and `--thinking` level. It loads your usual extensions, skills and settings, and `--fork` brings back the chat's tool list, so it sends the same tools and system prompt as the chat (unless the chat was started with flags that change them; see Limitations). It's launched the same way as Pi's own subagent example: the CLI script of the Pi you're running, the Pi binary itself when Pi is a compiled binary, or `pi` from your PATH.

**It reuses the chat's prompt cache.** Providers cache a request's opening (tools, then system prompt, then messages) and match it exactly, so the helper changes nothing before its own task message. Measured on `pi-claude/claude-opus-5-5`, same thinking level, run back to back:

| Input tokens | read from cache | written to cache |
|---|---|---|
| the chat's turn | 21,247 | 16,030 |
| helper with its own tool list and system prompt (before) | 1,651 | 17,135 |
| helper with the chat's (now) | 36,860 | 1,352 |

`"better": { "model": "…", "thinking": "…" }` in `settings.json` pins either one for the helper instead, at the cost of the cache.

**It can only read.** Narrowing the helper's tool list can change the start of its request (for most models Pi puts tool changes into the opening system prompt), so it keeps every tool and pi-better refuses the calls instead: the helper process runs with `PI_BETTER_HELPER=1`, and pi-better's copy inside it blocks any tool other than `read`, `grep`, `find`, `ls` and the shell (`bash`, or `powershell` where your setup uses it), telling the model which of those it has. Pi turns on only `read` and `bash` of these by default; `grep`, `find` and `ls` are there when your chat has them.

**It gets a copy of your chat, as it was when you ran `/better`.** If the session has been saved (it has once there's a message in it), the helper starts with `--fork` of the session file. The copy goes into a temporary folder that's deleted when the helper finishes, so it never shows up in `/resume`. Messages you send while it works don't reach it. In a new session with nothing saved yet, it starts fresh, so `/better` needs a prompt there.

**It runs in the background.** `/better` returns right away and you keep chatting. The two progress rows come from the helper's JSON event stream. Tool start and end events fill the second row: each tool shows as its first real command or its path, inside the project, under `~`, or as a bare file name, with ✓ or ✗, newest last, oldest dropped when the row is full. The reply's text sets the first row, a six-cell meter and what the helper is doing: "Reading your code and files" until the reply starts a line with "(n)", then what it is working out for that question, like "Picking the methods and tools (3 of 4)", then "Writing your improved prompt" once the `<improved-prompt>` line opens. Each step fills one more cell. Both rows stay the same height and are cut to the terminal's width; when the full wording doesn't fit, a short form shows ("Reading files", "Thinking", "Writing prompt"). The meter's timer pulses the current cell and also repaints the clock.

When the helper exits, pi-better takes the text of its last reply, reads the prompt out of the last `<improved-prompt>` block, saves the whole reply as a `better` session entry that the model never sees, and puts the prompt in your input box.

**It works while the agent is busy.** Pi runs a slash command from an extension as soon as you press Enter, even while the agent is writing a reply, running a tool or compacting; a normal message sent then waits in the queue. So `/better` starts its helper right away, and the improved prompt lands in your input box while the agent keeps working. The copy holds every message saved so far. Pi saves a message when it finishes, so a reply still being written isn't in it, and a tool call still running has no result yet; Pi fills in a "No result provided" result when it sends the copy to the model. In a new session, Pi saves the file as soon as your first message starts the turn, so `/better` with no prompt works during that first turn too.

**One at a time.** A second `/better` while one is running is refused. `/better-cancel` stops the helper, and so does starting or switching sessions (`/new`, `/resume`, `/reload`); after a session switch, the stopped run doesn't touch the old session.

## `/better-boomerang`

The agent in this chat answers the same task, as a hidden message that starts a turn. It can read and run commands like any turn, but it's told only to read and rewrite. When the turn ends, pi-better reads the prompt from the reply, jumps the chat back to the entry before the rewrite with Pi's tree navigation (no summary), and puts the prompt in your input box. The rewrite turn leaves the chat's context but stays in `/tree`.

If the chat's last entry is a message (yours or one an extension added), pi-better first adds an invisible marker entry to jump back to, because jumping to a message would put its text back into your input box.

## Outside the interactive terminal

Print and JSON mode have no input box, and in RPC mode pi-better can't read what's already in the box, so a draft would be lost. In those modes `/better` posts the helper's whole reply as a message and `/better-boomerang` posts the prompt. In print and JSON mode `/better` waits for the helper before the command returns, since Pi would exit otherwise.

## The prompt cache

Neither command changes earlier history, and your conversation only gains the message you send, so the prompt cache stays warm. `/better-boomerang` costs one extra turn on top of the cached history. `/better`'s helper sends the same opening as the chat, so it reads the chat's cached history too (see [`/better`](#better)), unless `settings.json` gives it a different model or thinking level.

## Error messages

| Message | What it means |
|---|---|
| `/better has no task to deepen yet; give it a prompt: /better <prompt>` | nothing has been saved in this session yet, so there's no task to deepen |
| `/better is already running; /better-cancel stops it.` | one helper runs at a time |
| `/better failed: No model is selected; pick one with /model.` | the chat has no model yet, so the helper has none to use |
| `/better failed: "better" in settings.json must be an object like …` | `better` in `settings.json` isn't `{ "model": …, "thinking": … }` |
| `/better failed: "better.model" in settings.json must be a string like …` | `better.model` is empty or not a string |
| `/better failed: "better.thinking" in settings.json must be one of …` | `better.thinking` isn't one of Pi's thinking levels |
| `/better cancelled; nothing was sent` | you ran `/better-cancel` |
| `No /better is running.` | `/better-cancel` had nothing to stop |
| `/better failed: Couldn't start pi for the helper: …` | the `pi` command couldn't be launched |
| `/better failed: The helper timed out after 20 minutes` | the helper hit its limit; try a narrower prompt |
| `/better failed: The helper exited with code …` | the text after it is the end of the helper's error output, for example an unknown model |
| `/better failed: The helper exited with code … without printing an error` | the helper stopped with no error output; code 143 means something sent it SIGTERM |
| `/better failed: The helper was stopped by …` | something outside pi-better killed the helper with that signal, for example `SIGKILL` |
| `/better failed: The helper finished without replying` | the helper exited normally but wrote no reply text; run the command again |
| `/better failed: The helper's model call failed: …` | the model returned an error, for example a rate limit or a sign-in problem |
| `/better failed: The reply has no <improved-prompt> … </improved-prompt> block. The helper's whole reply is in …` | the reply ended without the marked prompt; open the file named at the end to see what the helper wrote, then run the command again |
| `/better failed: The reply's <improved-prompt> block is empty. The helper's whole reply is in …` | same, with an empty block |
| `/better-boomerang is already running; wait for it to finish.` | one boomerang at a time |
| `/better-boomerang has no task to deepen yet; give it a prompt: /better-boomerang <prompt>` | this chat has no entries yet, so there's no task to deepen |
| `/better-boomerang failed: another extension cancelled the jump back to where the rewrite started` | another extension blocked the tree navigation; the rewrite is still in the chat |
| `/better-boomerang failed: the rewrite's branch point is gone from the session` | the chat moved off the rewrite's branch during the turn; the rewrite is still in the session |

`/better` also saves that reply as a `better` session entry. `/better-boomerang` reports a missing or empty block without the file part, and leaves the rewrite in the chat so you can see what happened.

## Limitations

- The helper can't ask you questions while it works, so it decides from what it can read.
- The helper keeps its shell (`bash`, or `powershell`) so it can run read-only searches and quick experiments. A shell command could still write a file; only [helper.md](../helper.md) tells it not to.
- The refusal comes from pi-better's copy inside the helper, so it needs pi-better installed where Pi finds it on its own (`~/.pi/agent/extensions` or `pi install`). Loaded only with `-e` for one chat, the helper won't have it, and only helper.md keeps it from editing.
- The helper gets your settings, not the flags the chat was started with. A chat started with `--append-system-prompt`, `-e`, `--no-context-files` or similar flags sends a different opening, so the helper's request misses the cache.
- The helper loads your usual extensions, so any extension that does something at session start does it once per helper too.

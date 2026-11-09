# pi-better

Put `/better` in front of a prompt and pi-better rewrites it into the version a top professional would ask for, with facts from your own code and files in it. The new prompt lands in your input box, so you read it before anything runs.

It's built on the "Depth" prompt from Felix Rieseberg's [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/#depth). In his words:

```text
I want a deeper version of this task, not a bigger one. Before rewriting it: (1) say what a top
professional in this field would do here that I'm not asking for; (2) name the rawest material they
would start from instead of what has already been digested for me; (3) name the specific methods
and tools they would use; (4) say what, other than you or me, would show the result is right. Then
rewrite my prompt to ask for exactly that.
```

pi-better sends this prompt with two changes: it opens with "First, without asking me anything, find and read the code, files, docs and logs this touches, so your answers rest on them.", and "this task" becomes "this task/plan request". It adds instructions to keep searches quick and never to start the work itself ([helper.md](helper.md)).

## Why this exists

Ask a model to "make this better" and it usually changes its vocabulary, not its methods. It works from whatever summary is already in the chat, does a bigger version of the same task, and then judges its own result. Felix's four questions fix each of those: what a professional would do that you didn't ask for, the raw material instead of the digest, the actual methods and tools, and a check that doesn't come from you or the model.

The prompt only works as well as the answers to those questions, and good answers need the real material. pi-better runs the prompt with a read-only helper that opens your code, files and logs and runs searches before it answers, so the rewrite names real files, real commands and a real way to check the result. The helper works in the background while you keep chatting, and the result goes into your input box, so you decide what gets sent.

## Example

A real run on this repo, pi-better itself. You type:

```text
/better make the error messages clearer
```

44 seconds later the helper had read `index.ts`, `better.ts`, the tests and the README, and wrote this prompt for your input box:

```text
Make pi-better's error messages tell me what happened, the likely cause, and what to do next. Base
that on the text each failure really produces, not on how the template strings in the code read.

Start with the raw material. List every path in `index.ts` and `better.ts` that shows an error: the
usage notices (index.ts:171, 175, 215, 226, 230), the `askHelper` failures (spawn failure at :95,
the 20-minute timeout at :98, non-zero exit with the last 3 stderr lines at :99, model error from
`message_end` at :100), `parseMarkedPrompt`'s missing-block and empty-block errors (better.ts:25,
27), and the boomerang "another extension cancelled" error (:260). They all go through `failed()` at
:128. Then cause each one for real with the installed `pi`, and copy down the exact text I'd see:
- `--model` set to a model that doesn't exist
- a PATH with no `pi` on it
- `kill -9` on the helper child, so the exit code is `null`
- a helper that exits non-zero with empty stderr
- an auth or rate-limit failure, if you can trigger one safely
- a reply with no `<improved-prompt>` block
- a timeout shortened for the test, then put back

Before you change anything, show me a table: trigger → current message → what I should do next.

Then fix what the table shows. I already know about these:
- "exited with code null:" when the child is killed by a signal
- a message ending in a bare colon when stderr is empty
- `/better` throwing away the helper's reply when the block is missing. `appendEntry` only runs on
  success, so "run /better again" leaves me no way to see what went wrong. Keep the reply somewhere
  I can read it (the `/better-boomerang` path already leaves it on the branch), and have the message
  say where it is.

Every message should give the next step as a command or setting. Follow the NN/g error-message
guidelines: say what happened, say how to fix it, no blame, no internal names I'd have to know. Keep
the existing `/<command> failed:` prefix. Don't add recovery or retries; this is about wording and
keeping the evidence.

Proof it's right:
- Run the same real failures again and show me the new text for each, next to the old.
- Update the README Troubleshooting section so every entry matches a real string word for word, and
  add entries for the paths it doesn't cover yet.
- Add black-box `node:test` cases in `better.test.ts` only where behavior changed (for example, the
  parse errors), and check that they fail on the old code.
- `npm test` and `npm run typecheck` pass.
- Last check: someone who has never used pi-better should be able to read each message cold and know
  what to do without opening the README.
```

It didn't just reword strings. It listed every error path with its line number, said to cause each failure for real before changing anything, and found three problems nobody had asked about: a killed helper reports "exited with code null", an empty error output leaves the message ending in a colon, and a reply with no marked prompt is thrown away. It also says what proves the result right: the real failures rerun, the README matching the real messages word for word, and a cold read by someone new.

## Three ways to run the prompt

| | Type Felix's prompt yourself | `/better` | `/better-boomerang` |
|---|---|---|---|
| Where it runs | in this chat | a separate read-only `pi` process with a copy of this chat | in this chat |
| Keep chatting meanwhile | no | yes | no, but you can type your next message |
| Watch it work | yes | no; two rows show its step, its latest tools and the time | yes |
| Your context afterwards | holds the four answers, the research and the rewrite | unchanged | rewinds to where it was before you ran it; the rewrite stays in `/tree` |
| The improved prompt | in a reply, for you to copy | in your input box | in your input box |

Use `/better-boomerang` when you want to watch the agent research and write the prompt live, then have the chat rewind as if it never happened.

## Install

```bash
git clone https://github.com/nicobailon/pi-better ~/.pi/agent/extensions/pi-better
```

Pi loads extensions from `~/.pi/agent/extensions` on its own, so run `/reload` (or restart Pi) and the commands are there. To keep the folder somewhere else, run `pi install <path>` on it instead.

`/better`'s helper runs on `pi-claude/claude-opus-5-5` with high thinking, a model that comes from pi-claude-bridge, so that needs to be installed and signed in. `/better-boomerang` uses whatever model the chat is on.

## What you'll see

While `/better` works, two rows above your input box show which step the helper is on (gather the material, answer the four questions, write the prompt) and its latest tools with ✓ or ✗. From a real run at 80 columns:

```text
 ⠙ /better  ✓ gather ━━━ ● answer 3/4 ─── ○ prompt         29s · /better-cancel
   ✓ ls  ✓ head -60 ~/Documents/docs/p…  ✓ git -C $W status -sb         6 tools
```

When it's done, the improved prompt is in your input box with this notice:

```text
The improved prompt is in your input box. Edit it, then press Enter to send.
```

Anything you'd typed meanwhile stays in the box, below the prompt, and the notice says so. Nothing is sent until you press Enter. The helper has `read`, `grep`, `find`, `ls` and `bash`, with no edit or write tools, and stops after 20 minutes.

## Common tasks

| Want | Do |
|---|---|
| Deepen a prompt | `/better <prompt>` |
| Deepen the task you're working on now, including your feedback so far | `/better` with no prompt |
| Stop the helper | `/better-cancel` |
| Watch the rewrite happen in the chat | `/better-boomerang <prompt>` (or no prompt, for the task in progress) |

[How it works](docs/how-it-works.md) covers the helper process, the copy of your chat, print and RPC mode, the prompt cache, every error message and the limitations.

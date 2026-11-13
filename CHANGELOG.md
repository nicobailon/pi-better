# Changelog

## [Unreleased]

## [0.2.0] - 2026-11-13

### Highlights

- `/better` puts the improved prompt in your input box, so you read and edit it before you press Enter.
- `/better` works in the background. You keep chatting while the helper reads your code, even while the agent is busy, and Esc stops it.
- Your agent can use `/better` too: with pi-subagents, a subagent's brief is checked against your repo before the subagent starts.
- New `/better-boomerang` does the rewrite live in your chat, then rewinds the chat so the research doesn't use up your context.
- Install it from npm with `pi install npm:pi-better`.

### Added

- An agent can use `/better` on a subagent's brief the way you use it on a prompt. With pi-subagents, a task that starts with `/better` is checked on a copy of the chat before the subagent starts. The subagent sees none of the chat, so the helper reads the brief as the subagent will, fixes paths and names that are wrong, spells out anything only the chat explains, and adds how the subagent will know it's done. It keeps the brief's scope and leaves it unchanged when nothing is missing. This works today for single subagents. For workflow children, including chain steps, it needs the next pi-subagents release after 0.88.0.
- `/better-boomerang <prompt>`: the agent in this chat rewrites the prompt with everything it already knows, then the chat jumps back to where it started and the improved prompt lands in your input box. The rewrite stays in `/tree`, and no other extension is needed.
- While `/better` works, two rows above your input box show a meter that fills as the helper reads your files, works through the four questions and writes your prompt, plus what it's doing now, like "Picking the methods and tools (3 of 4)", and its latest tools with ✓ or ✗.
- Esc stops `/better`, even while the agent is busy; press Esc again to stop the agent. `/better-cancel` does the same in RPC mode, which has no Esc key.
- To run the helper on a different model or thinking level, set `"better": { "model": "…", "thinking": "…" }` in `settings.json`.
- Typing a space after either command shows what its argument is for.

### Changed

- `/better <prompt>` now puts the improved prompt in your input box instead of a box with fire, /boomerang, tweak, edit, why and cancel, so pi-boomerang is no longer needed. Anything you'd already typed stays in the box, below the improved prompt.
- `/better` starts right away even while the agent is replying, running a tool or compacting, where a normal message would wait in the queue.
- The helper is now a separate read-only `pi` process, so `/better` itself no longer needs pi-subagents. It can only read files and run shell commands.
- The helper runs on the chat's model and thinking level instead of always on Opus 5.5 with high thinking, and it reuses the chat's prompt cache, so reading your conversation costs far fewer input tokens.
- The helper is told to find and read the code, files, docs and logs your request touches before answering, without asking you anything, and to keep its searches small. Felix Rieseberg's four questions follow word for word.
- The README opens with Felix Rieseberg's "Depth" prompt from [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/#depth) and credits him. It also shows a real before-and-after, compares the three ways to run the prompt, and has a short video.
- Install with `pi install npm:pi-better`.

### Fixed

- An improved prompt that mentions the `<improved-prompt>` tag itself now lands in your input box whole, instead of only the part after that mention.
- When the helper's reply has no improved prompt in it, `/better` keeps the reply in a file and tells you where. A helper that's killed or exits without an error message now says so plainly, instead of "exited with code null:".
- Quitting Pi while `/better` works no longer leaves a copy of your session in the temp folder.

## [0.1.0] - 2026-11-08

### Highlights

- `/better <prompt>` has a helper read the real material your prompt touches and rewrite it into a deeper version, without adding anything to your conversation while it works.
- `/better` on its own deepens the task you're working on now, including your feedback so far.
- Fire the result, fire it through /boomerang, tweak it with a one-line note, edit it in your input box, or cancel.

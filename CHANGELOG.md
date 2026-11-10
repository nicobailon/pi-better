# Changelog

## [Unreleased]

### Highlights

- The helper's prompt now opens by telling it to find and read the code, files, docs and logs the request touches before answering, without asking you anything. Felix's four questions follow word for word.
- While `/better` works, two rows above your input box show a six-cell meter that fills as the helper reads your files, works through the four questions and writes your prompt. Next to it is what the helper is doing, like "Picking the methods and tools (3 of 4)", and below are its latest tools with ✓ or ✗. The rows keep their height and fit the terminal's width, and the time and `/better-cancel` stay in place.
- The README now opens with Felix Rieseberg's "Depth" prompt from [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/#depth), the method every rewrite follows, and credits him. It also shows a real before-and-after and compares the three ways to run the prompt.
- `/better <prompt>` now puts the improved prompt in your input box, so you read it and press Enter yourself. The box with fire, /boomerang, tweak, edit, why and cancel is gone, so pi-boomerang is no longer used; edit the prompt in your input box instead.
- An improved prompt that mentions the `<improved-prompt>` tag itself now lands in your input box whole, instead of only the part after that mention.
- When the helper's reply has no improved prompt in it, `/better` keeps the reply in a file and tells you where, so you can see what it wrote. A helper that's killed or exits without an error message now says so plainly, instead of "exited with code null:" or a message ending in a colon.
- New `/better-boomerang <prompt>`: the agent in this chat rewrites the prompt with everything it already knows, then the chat jumps back to where it started and the improved prompt lands in your input box. The rewrite stays in `/tree`, and no other extension is needed.
- Anything you'd already typed in the input box stays there, below the improved prompt.
- `/better` works in the background: you keep chatting with the agent while the helper reads and rewrites, and the improved prompt lands in your input box when it's ready. `/better-cancel` stops it. The helper is also told to keep its searches small and give slow commands a timeout.
- `/better` no longer needs pi-subagents: the helper runs as a separate read-only `pi` process.
- Typing a space after either command shows what its argument is for.
- pi-better lives in `~/.pi/agent/extensions/pi-better` and Pi loads it from there automatically, with no `pi install`.

## [0.1.0] - 2026-11-08

### Highlights

- `/better <prompt>` has a helper read the real material your prompt touches and rewrite it into a deeper version, without adding anything to your conversation while it works.
- `/better` on its own deepens the task you're working on now, including your feedback so far.
- Fire the result, fire it through /boomerang, tweak it with a one-line note, edit it in your input box, or cancel.

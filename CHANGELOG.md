# Changelog

## [Unreleased]

### Highlights

- The README now opens with Felix Rieseberg's "Depth" prompt from [How to be more ambitious: A tutorial for humans with models](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/#depth), the method every rewrite follows, and credits him. It also shows a real before-and-after and compares the three ways to run the prompt.
- `/better <prompt>` now puts the improved prompt in your input box, so you read it and press Enter yourself. The box with fire, /boomerang, tweak, edit, why and cancel is gone, so pi-boomerang is no longer used; edit the prompt in your input box instead.
- An improved prompt that mentions the `<improved-prompt>` tag itself now lands in your input box whole, instead of only the part after that mention.
- New `/better-boomerang <prompt>`: the agent in this chat rewrites the prompt with everything it already knows, then the chat jumps back to where it started and the improved prompt lands in your input box. The rewrite stays in `/tree`, and no other extension is needed.
- Anything you'd already typed in the input box stays there, below the improved prompt.
- `/better` works in the background: you keep chatting with the agent while the helper reads and rewrites, a line above your input box shows how long it's been going and the command it's running, and the improved prompt lands in your input box when it's ready. `/better-cancel` stops it. The helper is also told to keep its searches small and give slow commands a timeout.
- `/better` no longer needs pi-subagents: the helper runs as a separate read-only `pi` process.
- Typing a space after either command shows what its argument is for.
- pi-better lives in `~/.pi/agent/extensions/pi-better` and Pi loads it from there automatically, with no `pi install`.

## [0.1.0] - 2026-11-08

### Highlights

- `/better <prompt>` has a helper read the real material your prompt touches and rewrite it into a deeper version, without adding anything to your conversation while it works.
- `/better` on its own deepens the task you're working on now, including your feedback so far.
- Fire the result, fire it through /boomerang, tweak it with a one-line note, edit it in your input box, or cancel.

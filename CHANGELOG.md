# Changelog

## [Unreleased]

### Highlights

- `/better <prompt>` now puts the improved prompt in your input box, so you read it and press Enter yourself. The box with fire, subagent, tweak, edit and cancel is gone; edit the prompt in your input box instead.
- New `/better-boomerang <prompt>`: the agent in this chat rewrites the prompt with everything it already knows, then the chat jumps back to where it started and the improved prompt lands in your input box. The rewrite stays in `/tree`, and no other extension is needed.
- Anything you'd already typed in the input box stays there, below the improved prompt.
- Typing a space after either command shows what its argument is for.
- pi-better no longer uses pi-boomerang.
- pi-better lives in `~/.pi/agent/extensions/pi-better` and Pi loads it from there automatically, with no `pi install`.

## [0.1.0] - 2026-11-08

### Highlights

- `/better <prompt>` has a helper read the real material your prompt touches and rewrite it into a deeper version, without adding anything to your conversation while it works.
- `/better` on its own deepens the task you're working on now, including your feedback so far.
- Fire the result, fire it through /boomerang, run it as a forked or fresh background subagent, tweak it with a one-line note, edit it in your input box, or cancel.

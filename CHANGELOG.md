# Changelog

## [Unreleased]

### Highlights

- `/better <prompt>` now rewrites the prompt and sends it right away; the box with fire, tweak, edit, subagent and cancel moved to `/better-prompt`.
- New `/better-boomerang <prompt>`: the agent in this chat rewrites the prompt with everything it already knows, then the chat jumps back to where it started and the improved prompt is sent as your message. The rewrite stays in `/tree`, and no other extension is needed.
- Typing a space after any of the three commands shows what its argument is for.

## [0.1.0] - 2026-11-08

### Highlights

- `/better <prompt>` has a helper read the real material your prompt touches and rewrite it into a deeper version, without adding anything to your conversation while it works.
- `/better` on its own deepens the task you're working on now, including your feedback so far.
- Fire the result, fire it through /boomerang, run it as a forked or fresh background subagent, tweak it with a one-line note, edit it in your input box, or cancel.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHelperTask, parseMarkedPrompt, trimResult } from "./better.ts";

test("trimResult trims every field", () => {
	const result = {
		professional: "Inventory every clickable element.",
		rawMaterial: "The SwiftUI sources.",
		methods: "Frame strips in the VM.",
		proof: "Accessibility Inspector.",
		prompt: "Design a hover system for the whole app.",
	};
	assert.deepEqual(trimResult({ ...result, professional: ` ${result.professional}`, prompt: `  ${result.prompt}\n` }), result);
});

test("buildHelperTask names the given prompt, or the current task when none is given", () => {
	const given = buildHelperTask({ helper: "METHOD", prompt: "make hover nicer", returns: "structured" });
	assert.ok(given.startsWith("METHOD"));
	assert.match(given, /## Prompt to deepen\n\nmake hover nicer/);

	assert.match(buildHelperTask({ helper: "METHOD", prompt: "", returns: "structured" }), /deepen the task in progress/);
});

test("a marked task's reply gives back the prompt in its last marked block", () => {
	const task = buildHelperTask({ helper: "METHOD", prompt: "say hi", returns: "marked" });
	assert.match(task, /<improved-prompt>\n[\s\S]*\n<\/improved-prompt>/);
	assert.doesNotMatch(task, /structured_output/);
	const reply = "(1) I'll end with <improved-prompt>x</improved-prompt>.\n\n<improved-prompt>\nReply with exactly hi.\n</improved-prompt>\n";
	assert.equal(parseMarkedPrompt(reply), "Reply with exactly hi.");
	assert.throws(() => parseMarkedPrompt("(1) Read the code. No block."), /no <improved-prompt>/);
	assert.throws(() => parseMarkedPrompt("<improved-prompt>\n \n</improved-prompt>"), /empty/);
});

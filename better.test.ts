import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHelperTask, parseBetterResult, parseMarkedPrompt } from "./better.ts";

const result = {
	professional: "Inventory every clickable element.",
	rawMaterial: "The SwiftUI sources.",
	methods: "Frame strips in the VM.",
	proof: "Accessibility Inspector.",
	prompt: "Design a hover system for the whole app.",
};

test("parseBetterResult accepts the five fields and trims them", () => {
	assert.deepEqual(parseBetterResult({ ...result, prompt: `  ${result.prompt}\n` }), result);
});

test("parseBetterResult rejects a missing or blank field", () => {
	assert.throws(() => parseBetterResult({ ...result, prompt: " " }), /"prompt"/);
	const { proof: _proof, ...withoutProof } = result;
	assert.throws(() => parseBetterResult(withoutProof), /"proof"/);
	assert.throws(() => parseBetterResult("just text"), /not an object/);
});

test("buildHelperTask names the given prompt, or the current task when none is given", () => {
	const given = buildHelperTask({ helper: "METHOD", prompt: "make hover nicer", returns: "structured" });
	assert.ok(given.startsWith("METHOD"));
	assert.match(given, /## Prompt to deepen\n\nmake hover nicer/);

	assert.match(buildHelperTask({ helper: "METHOD", prompt: "", returns: "structured" }), /deepen the task currently in progress/);
});

test("buildHelperTask carries the previous result and the user's note into a tweak", () => {
	const task = buildHelperTask({ helper: "METHOD", prompt: "make hover nicer", returns: "structured", tweak: { previous: result, note: "drop the VM part" } });
	assert.match(task, /make hover nicer/);
	assert.match(task, /Design a hover system for the whole app\./);
	assert.match(task, /Accessibility Inspector\./);
	assert.match(task, /## What the user wants changed\n\ndrop the VM part/);
});

test("a marked task's reply gives back the prompt in its last marked block", () => {
	const task = buildHelperTask({ helper: "METHOD", prompt: "say hi", returns: "marked" });
	assert.doesNotMatch(task, /structured_output/);
	const reply = "(1) Read the code.\n\n<improved-prompt>\nReply with exactly hi.\n</improved-prompt>\n";
	assert.equal(parseMarkedPrompt(reply), "Reply with exactly hi.");
	assert.throws(() => parseMarkedPrompt("(1) Read the code. No block."), /no <improved-prompt>/);
	assert.throws(() => parseMarkedPrompt("<improved-prompt>\n \n</improved-prompt>"), /empty/);
});

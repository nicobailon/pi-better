import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHelperTask, helperExitError, helperModelArgs, helperToolBlock, parseMarkedPrompt } from "./better.ts";

test("buildHelperTask names the given prompt, or the current task when none is given", () => {
	const given = buildHelperTask("METHOD", "make hover nicer");
	assert.ok(given.startsWith("METHOD"));
	assert.match(given, /## Prompt to deepen\n\nmake hover nicer/);

	assert.match(buildHelperTask("METHOD", ""), /deepen the task in progress/);
});

test("a task's reply gives back the prompt in its last marked block", () => {
	assert.match(buildHelperTask("METHOD", "say hi"), /<improved-prompt>\n[\s\S]*\n<\/improved-prompt>/);
	const reply = "(1) I'll end with <improved-prompt>x</improved-prompt>.\n\n<improved-prompt>\nReply with exactly hi.\n</improved-prompt>\n";
	assert.equal(parseMarkedPrompt(reply), "Reply with exactly hi.");
	const mentionsTag = "<improved-prompt>\nKeep the reply when there's no `<improved-prompt>` block.\n</improved-prompt>";
	assert.equal(parseMarkedPrompt(mentionsTag), "Keep the reply when there's no `<improved-prompt>` block.");
	assert.throws(() => parseMarkedPrompt("(1) Read the code. No block."), /no <improved-prompt>/);
	assert.throws(() => parseMarkedPrompt("<improved-prompt>\n \n</improved-prompt>"), /empty/);
});

test("helperExitError names the signal or code, and never ends on a bare colon", () => {
	assert.equal(helperExitError(null, "SIGKILL", ""), "The helper was stopped by SIGKILL without printing an error");
	assert.equal(helperExitError(143, null, "  \n"), "The helper exited with code 143 without printing an error");
	assert.equal(helperExitError(1, null, "a\nb\nc\nError: unknown model\n"), "The helper exited with code 1: b c Error: unknown model");
});

test("the helper runs on the chat's model and thinking level unless settings pin them", () => {
	assert.deepEqual(helperModelArgs(undefined, "pi-claude/claude-opus-5-5", "medium"), ["--model", "pi-claude/claude-opus-5-5", "--thinking", "medium"]);
	assert.deepEqual(helperModelArgs({ model: "anthropic/claude-opus-4-5", thinking: "high" }, "openai/gpt-5", "low"), ["--model", "anthropic/claude-opus-4-5", "--thinking", "high"]);
	assert.deepEqual(helperModelArgs({ thinking: "high" }, "openai/gpt-5", "low"), ["--model", "openai/gpt-5", "--thinking", "high"]);
	assert.deepEqual(helperModelArgs(undefined, "openai/gpt-5", undefined), ["--model", "openai/gpt-5"]);
	assert.throws(() => helperModelArgs(undefined, undefined, undefined), /pick one with \/model/);
	assert.throws(() => helperModelArgs({ model: 5 }, "openai/gpt-5", "low"), /"better.model" in settings.json must be a string/);
	assert.throws(() => helperModelArgs("opus", "openai/gpt-5", "low"), /"better" in settings.json must be an object/);
	assert.throws(() => helperModelArgs(["x/y"], "openai/gpt-5", "low"), /"better" in settings.json must be an object/);
	assert.throws(() => helperModelArgs({ thinking: "hihg" }, "openai/gpt-5", "low"), /"better.thinking" in settings.json must be one of off, minimal/);
});

test("the helper may only call read-only tools", () => {
	for (const tool of ["read", "grep", "find", "ls", "bash"]) assert.equal(helperToolBlock(tool, ["read", "bash"]), undefined);
	assert.match(helperToolBlock("edit", ["read", "bash", "edit", "write"])!.reason, /edit is off\. Use read, bash\.$/);
	assert.equal(helperToolBlock("subagent", ["read", "bash"])?.block, true);
});

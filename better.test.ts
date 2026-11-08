import assert from "node:assert/strict";
import { test } from "node:test";
import { boomerangSafe, buildHelperTask, parseBetterResult } from "./better.ts";

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
	const given = buildHelperTask({ helper: "METHOD", prompt: "make hover nicer" });
	assert.ok(given.startsWith("METHOD"));
	assert.match(given, /## Prompt to deepen\n\nmake hover nicer/);

	assert.match(buildHelperTask({ helper: "METHOD", prompt: "" }), /deepen the task currently in progress/);
});

test("buildHelperTask carries the previous result and the user's note into a tweak", () => {
	const task = buildHelperTask({ helper: "METHOD", prompt: "make hover nicer", tweak: { previous: result, note: "drop the VM part" } });
	assert.match(task, /make hover nicer/);
	assert.match(task, /Design a hover system for the whole app\./);
	assert.match(task, /Accessibility Inspector\./);
	assert.match(task, /## What the user wants changed\n\ndrop the VM part/);
});

test("boomerangSafe refuses prompts /boomerang would read as its own syntax", () => {
	assert.equal(boomerangSafe("Fix the login bug in src/auth.ts"), true);
	assert.equal(boomerangSafe("Fix the bug.\nThen run /Users/me/test.sh"), true);
	assert.equal(boomerangSafe("/deslop the module"), false);
	assert.equal(boomerangSafe("auto on"), false);
	assert.equal(boomerangSafe("Step one -> step two"), false);
	assert.equal(boomerangSafe('Replace "->" with "=>" in /src/a.ts'), false);
	assert.equal(boomerangSafe("Run it twice --rethrow 2"), false);
	assert.equal(boomerangSafe("Keep going --loop 3"), false);
});

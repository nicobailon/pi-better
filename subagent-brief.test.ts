import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const PI_PACKAGES = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works";
registerHooks({
	resolve: (specifier, context, next) =>
		next(specifier.startsWith("@earendil-works/") ? pathToFileURL(`${PI_PACKAGES}/${specifier.slice(16)}/dist/index.js`).href : specifier, context),
});
const { default: extension } = await import("./index.ts");

// Same setup as progress.test.ts's withFakeHelper: the helper is fixtures/fake-pi.mjs, which replies once the gate exists.
async function withFakeHelper(body: (setup: { dir: string; session: string; gate: string; helperArgs: () => string[] }) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "pb-brief-"));
	const session = join(dir, "session.jsonl");
	writeFileSync(session, "{}\n");
	const script = process.argv[1];
	const temp = process.env.TMPDIR;
	process.argv[1] = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
	process.env.PI_BETTER_TEST_GATE = join(dir, "gate");
	process.env.PI_BETTER_TEST_ARGS = join(dir, "helper-args.json");
	process.env.TMPDIR = dir;
	try {
		await body({ dir, session, gate: process.env.PI_BETTER_TEST_GATE, helperArgs: () => JSON.parse(readFileSync(join(dir, "helper-args.json"), "utf8")) });
	} finally {
		process.argv[1] = script;
		delete process.env.PI_BETTER_TEST_GATE;
		delete process.env.PI_BETTER_TEST_ARGS;
		if (temp === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = temp;
		rmSync(dir, { recursive: true, force: true });
	}
}

// pi-subagents calls `subagent` for a single child and offers every workflow child as its own `subagent_launch` call.
function load() {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	extension({ registerCommand() {}, on: (name: string, handler: any) => (handlers[name] = handler), getSettings: () => ({}), appendEntry() {} } as any);
	return (toolName: string, input: unknown, ctx: unknown) => handlers.tool_call?.({ type: "tool_call", toolName, toolCallId: "c1", input }, ctx);
}

const context = (dir: string, session: string, signal = new AbortController().signal) =>
	({ cwd: dir, model: { provider: "p", id: "m" }, thinkingLevel: "low", signal, sessionManager: { getSessionFile: () => session }, ui: { setStatus() {} } });

test("a subagent brief marked /better is checked as a brief, not deepened, and the subagent gets the checked brief", { timeout: 10_000 }, () =>
	withFakeHelper(async ({ dir, session, gate, helperArgs }) => {
		const toolCall = load();
		writeFileSync(gate, "");
		for (const toolName of ["subagent", "subagent_launch"]) {
			const input = { agent: "worker", task: "/better add a name flag", key: "fix" };
			assert.equal(await toolCall(toolName, input, context(dir, session)), undefined, "the start goes ahead");
			assert.equal(input.task, "Add --name to run.sh and prove it with ./run.sh --name Ann.");
			const task = helperArgs().at(-1)!;
			assert.match(task, /^The brief below is for a subagent that starts with none of this conversation/);
			assert.match(task, /## Brief to check\n\nadd a name flag\n/);
		}
		const unmarked = { agent: "reviewer", task: "review the diff" };
		await toolCall("subagent_launch", unmarked, context(dir, session));
		assert.equal(unmarked.task, "review the diff");
	}),
);

test("Esc during the check stops the subagent from starting and deletes the chat copy", { timeout: 10_000 }, () =>
	withFakeHelper(async ({ dir, session }) => {
		const toolCall = load();
		const turn = new AbortController();
		const input = { workflowRunId: "w1", key: "fix", agent: "worker", task: "/better add a name flag" };
		const start = Promise.resolve(toolCall("subagent_launch", input, context(dir, session, turn.signal)));
		const copies = () => readdirSync(dir).filter((name) => name.startsWith("pi-better-"));
		assert.equal(copies().length, 1, "the helper works on a copy of the chat");
		turn.abort();
		await assert.rejects(start, /cancelled, so the subagent didn't start/);
		assert.deepEqual(copies(), []);
		assert.equal(input.task, "/better add a name flag", "no subagent got a rewrite");
	}),
);

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

// Pi's loader supplies its own pi-tui at runtime; outside Pi, use the global install like tsconfig.json does.
const PI_PACKAGES = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works";
registerHooks({
	resolve: (specifier, context, next) =>
		next(specifier.startsWith("@earendil-works/") ? pathToFileURL(`${PI_PACKAGES}/${specifier.slice(16)}/dist/index.js`).href : specifier, context),
});
const { isKeyRelease, KeybindingsManager, setKeybindings, stripTerminalSequences: plain, visibleWidth } = await import("@earendil-works/pi-tui");
const { default: extension, HelperProgress } = await import("./index.ts");

// A real helper run in a clone at /tmp/pb-rec/pi-better: four tools (bash and grep in parallel, the bash failed),
// then answers (1) to (4) and the prompt. Payloads are trimmed; every event is kept, in order.
const events = readFileSync(new URL("./fixtures/helper-run.jsonl", import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const colors: Record<string, number> = { accent: 36, muted: 90, dim: 2, success: 32, error: 31 };
const theme = { fg: (role: string, text: string) => `\x1b[${colors[role]}m${text}\x1b[0m` } as any;

test("the /better widget keeps the same height and fits the width in every frame of a real run", () => {
	for (const width of [50, 80, 120, 200]) {
		// 19m 59s in: the widest clock before the 20-minute timeout.
		const widget = new HelperProgress({ requestRender() {} } as any, theme, ["/tmp/pb-rec/pi-better", "/private/tmp/pb-rec/pi-better"], Date.now() - 1_199_000);
		try {
			let frame: string[] = [];
			const shown = new Set<string>();
			for (const event of events) {
				widget.apply(event);
				frame = widget.render(width);
				assert.equal(frame.length, 2, `${width} columns, ${event.type}`);
				for (const line of frame) assert.ok(visibleWidth(line) <= width, `${width} columns: ${plain(line)}`);
				shown.add(plain(frame[0]).slice(9).replace(/ +19m 59s.*/, ""));
			}
			const [steps, tools] = frame.map(plain);
			assert.match(steps, /^ ▰{5}[▰▱]  /);
			assert.match(steps, /19m 59s · \/better-cancel $/);
			assert.match(tools, /✓ grep index\.ts +4 tools · 1 failed $/);
			if (width === 50) {
				assert.deepEqual([...shown], ["Reading files", "Thinking", "Writing prompt"]);
			} else {
				assert.deepEqual([...shown], [
					"Reading your code and files",
					"Working out what a pro would do (1 of 4)",
					"Finding the rawest material (2 of 4)",
					"Picking the methods and tools (3 of 4)",
					"Deciding what would prove it right (4 of 4)",
					"Writing your improved prompt",
				]);
				assert.match(tools, /✗ ls -a \.pi\/todos/);
			}
		} finally {
			widget.dispose();
		}
	}
});

test("each tool shows as one short line: the real command or path, shortened to the project, ~ or a file name", () => {
	const project = "/private/tmp/pb-rec/pi-better";
	const cases: [string, object, string][] = [
		["bash", { command: `cd ${project} && git log --oneline -5 && ls -la` }, "git log --oneline -5"],
		["bash", { command: "W=/p; GIT_PAGER=cat git -C $W log | head -5" }, "git -C $W log"],
		["bash", { command: "grep -E 'foo|bar' f" }, "grep -E 'foo|bar' f"],
		["bash", { command: "curl -s https://ex.com/a/b" }, "curl -s https://ex.com/a/b"],
		["bash", { command: "awk '/^##/' README.md" }, "awk '/^##/' README.md"],
		["bash", { command: `cat ${project}/docs/a.md /var/folders/hn/T/b.png` }, "cat docs/a.md b.png"],
		["read", { path: `${project}/index.ts` }, "read index.ts"],
		["grep", { pattern: "a\nb\tc", path: project }, "grep a b c"],
	];
	for (const [toolName, args, label] of cases) {
		const widget = new HelperProgress({ requestRender() {} } as any, theme, [project], Date.now());
		try {
			widget.apply({ type: "tool_execution_start", toolCallId: "1", toolName, args });
			const tools = plain(widget.render(200)[1]);
			assert.ok(tools.startsWith(`   • ${label}  `), `${toolName}: ${tools}`);
		} finally {
			widget.dispose();
		}
	}
});

// Runs `body` with the helper replaced by fixtures/fake-pi.mjs, which replies once the gate file exists (or after 5 s),
// and with `dir` as the temp folder, where pi-better puts the helper's copy of the session.
async function withFakeHelper(body: (setup: { dir: string; session: string; gate: string }) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "pb-busy-"));
	const session = join(dir, "session.jsonl");
	writeFileSync(session, "{}\n");
	const script = process.argv[1];
	const temp = process.env.TMPDIR;
	// pi-better launches the helper from the running Pi's CLI script.
	process.argv[1] = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
	process.env.PI_BETTER_TEST_GATE = join(dir, "gate");
	process.env.TMPDIR = dir;
	try {
		await body({ dir, session, gate: process.env.PI_BETTER_TEST_GATE });
	} finally {
		process.argv[1] = script;
		delete process.env.PI_BETTER_TEST_GATE;
		process.env.TMPDIR = temp;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("/better returns at once while the agent is busy, and its prompt lands above the draft before the agent is idle", { timeout: 10_000 }, () =>
	withFakeHelper(async ({ dir, session, gate }) => {
		const commands: Record<string, any> = {};
		const entries: string[] = [];
		const sent: unknown[] = [];
		extension({ registerCommand: (name: string, command: any) => (commands[name] = command), on() {}, getSettings: () => ({}), appendEntry: (type: string) => entries.push(type), sendMessage: (message: unknown) => sent.push(message) } as any);
		let landed!: (text: string) => void;
		const inputBox = new Promise<string>((resolve) => (landed = resolve));
		const ui = { setWidget() {}, notify() {}, onTerminalInput: () => () => {}, getEditorText: () => "my draft", setEditorText: (text: string) => landed(text) };
		const ctx = { hasUI: true, mode: "tui", cwd: dir, model: { provider: "p", id: "m" }, thinkingLevel: "low", isIdle: () => false, sessionManager: { getSessionFile: () => session }, ui };

		await commands.better.handler("add a name flag", ctx);
		assert.deepEqual(entries, [], "the command returned before the helper replied");

		writeFileSync(gate, "");
		assert.equal(await inputBox, "Add --name to run.sh and prove it with ./run.sh --name Ann.\n\nmy draft");
		assert.deepEqual(entries, ["better"]);
		assert.deepEqual(sent, [], "nothing reaches the model");
	}),
);

test("the first Esc cancels /better even while the agent is busy, and the next Esc goes to Pi", { timeout: 10_000 }, () =>
	withFakeHelper(async ({ dir, session }) => {
		setKeybindings(new KeybindingsManager({ "app.interrupt": { defaultKeys: "escape", description: "Cancel or abort" } }));
		const commands: Record<string, any> = {};
		const entries: string[] = [];
		extension({ registerCommand: (name: string, command: any) => (commands[name] = command), on() {}, getSettings: () => ({}), appendEntry: (type: string) => entries.push(type) } as any);
		// Every key this test presses is Esc, which Pi's editor passes to its app-level handler (stopping the agent's run).
		let piEscapes = 0;
		const editor = { actionHandlers: new Map(), onEscape: () => piEscapes++, handleInput() { this.onEscape(); } };
		const tui = { getFocusedComponent: () => editor, requestRender() {} };
		let listener: ((data: string) => { consume?: boolean } | undefined) | undefined;
		// Like Pi's TUI: the input listeners see each key first, then the focused component gets it, minus key releases.
		const press = (data: string) => {
			if (!listener?.(data)?.consume && !isKeyRelease(data)) editor.handleInput();
		};
		let shown: { dispose(): void } | undefined;
		let notified!: (message: string) => void;
		const notice = new Promise<string>((resolve) => (notified = resolve));
		const ui = {
			setWidget: (_key: string, factory?: (tui: unknown, theme: unknown) => { dispose(): void }) => {
				shown?.dispose();
				shown = factory?.(tui, theme);
			},
			onTerminalInput: (handler: typeof listener) => {
				listener = handler;
				return () => (listener = undefined);
			},
			notify: (message: string) => notified(message),
		};
		const ctx = { hasUI: true, mode: "tui", cwd: dir, model: { provider: "p", id: "m" }, thinkingLevel: "low", isIdle: () => false, sessionManager: { getSessionFile: () => session }, ui };

		await commands.better.handler("add a name flag", ctx);
		const copies = () => readdirSync(dir).filter((name) => name.startsWith("pi-better-"));
		assert.equal(copies().length, 1, "the helper works on a copy of the session");
		// Esc pressed twice fast in a Kitty terminal: press, release and press arrive in one chunk.
		press("\x1b[27u");
		press("\x1b[27;1:3u");
		press("\x1b[27u");
		assert.equal(piEscapes, 1, "the second Esc stops the agent");
		// When Pi quits mid-run, it exits before the helper does, so the copy can't wait for the helper's exit.
		assert.deepEqual(copies(), [], "the copy is deleted as soon as /better is cancelled");
		assert.equal(await notice, "/better cancelled; nothing was sent");
		assert.deepEqual(entries, []);

		press("\x1b");
		assert.equal(piEscapes, 2, "after the run, Esc is Pi's");
	}),
);

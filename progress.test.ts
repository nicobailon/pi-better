import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Pi's loader supplies its own pi-tui at runtime; outside Pi, use the global install like tsconfig.json does.
const PI_PACKAGES = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works";
registerHooks({
	resolve: (specifier, context, next) =>
		next(specifier.startsWith("@earendil-works/") ? pathToFileURL(`${PI_PACKAGES}/${specifier.slice(16)}/dist/index.js`).href : specifier, context),
});
const { stripTerminalSequences: plain, visibleWidth } = await import("@earendil-works/pi-tui");
const { HelperProgress } = await import("./index.ts");

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
			// Reading and the four answers are done; the sixth cell, writing, is the one pulsing.
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

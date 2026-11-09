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
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { HelperProgress } = await import("./index.ts");

// A real helper run in a clone at /tmp/pb-rec/pi-better: four tools (bash and grep in parallel, the bash failed),
// then answers (1) to (4) and the prompt. Payloads are trimmed; every event is kept, in order.
const events = readFileSync(new URL("./fixtures/helper-run.jsonl", import.meta.url), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const colors: Record<string, number> = { accent: 36, muted: 90, dim: 2, success: 32, error: 31 };
const theme = { fg: (role: string, text: string) => `\x1b[${colors[role]}m${text}\x1b[0m` } as any;
const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("the /better widget keeps the same height and fits the width in every frame of a real run", () => {
	for (const width of [50, 80, 120, 200]) {
		// 19m 59s in: the widest clock before the 20-minute timeout.
		const widget = new HelperProgress({ requestRender() {} } as any, theme, ["/tmp/pb-rec/pi-better", "/private/tmp/pb-rec/pi-better"], Date.now() - 1_199_000);
		try {
			let frame = widget.render(width);
			for (const event of events) {
				widget.apply(event);
				frame = widget.render(width);
				assert.equal(frame.length, 2, `${width} columns, ${event.type}`);
				for (const line of frame) assert.ok(visibleWidth(line) <= width, `${width} columns: ${plain(line)}`);
			}
			const [steps, tools] = frame.map(plain);
			assert.match(steps, /19m 59s · \/better-cancel $/);
			assert.match(steps, /● prompt/);
			assert.match(tools, /✓ grep index\.ts +4 tools · 1 failed $/);
			if (width >= 80) {
				assert.match(steps, /✓ gather ━━━ ✓ answer 4\/4 ━━━ ● prompt/);
				assert.match(tools, /✗ ls -a \.pi\/todos/);
			}
		} finally {
			widget.dispose();
		}
	}
});

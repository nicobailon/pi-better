// Stands in for the helper's `pi --mode json -p …` in tests: holds its reply until the test creates the gate file.
import { existsSync } from "node:fs";

const timer = setInterval(() => {
	if (!existsSync(process.env.PI_BETTER_TEST_GATE)) return;
	clearInterval(timer);
	const text = "(1) a\n(2) b\n(3) c\n(4) d\n\n<improved-prompt>\nAdd --name to run.sh and prove it with ./run.sh --name Ann.\n</improved-prompt>";
	process.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } })}\n`);
}, 10);

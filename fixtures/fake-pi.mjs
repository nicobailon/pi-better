// Stands in for the helper's `pi --mode json -p …` in tests: holds its reply until the test creates the gate file.
import { existsSync, writeFileSync } from "node:fs";

// Lets a test read the task pi-better gave the helper (the last argument).
if (process.env.PI_BETTER_TEST_ARGS) writeFileSync(process.env.PI_BETTER_TEST_ARGS, JSON.stringify(process.argv.slice(2)));
const reply = () => {
	clearInterval(timer);
	const text = "(1) a\n(2) b\n(3) c\n(4) d\n\n<improved-prompt>\nAdd --name to run.sh and prove it with ./run.sh --name Ann.\n</improved-prompt>";
	process.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" } })}\n`);
};
const timer = setInterval(() => existsSync(process.env.PI_BETTER_TEST_GATE) && reply(), 10);
// If /better waited for its helper, the gate would never open; reply anyway so that test fails on its first check
// instead of hanging.
setTimeout(reply, 5000).unref();

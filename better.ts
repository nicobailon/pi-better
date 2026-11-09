const OPEN = "<improved-prompt>";
const CLOSE = "</improved-prompt>";

const RETURN = `## Return

Give answers (1) to (4) in your reply, then end it with the rewritten prompt, complete, between these two lines and nothing after them:

${OPEN}
the rewritten prompt
${CLOSE}`;

/** `prompt` is the command's trimmed argument; empty means "deepen the current task". */
export function buildHelperTask(helper: string, prompt: string): string {
	return [
		helper.trim(),
		`## Prompt to deepen\n\n${prompt || "None given: deepen the task in progress in the conversation so far, including any feedback the user gave on work already done."}`,
		RETURN,
	].join("\n\n");
}

/** The prompt in the last marked block of a reply to a task from buildHelperTask. */
export function parseMarkedPrompt(reply: string): string {
	const end = reply.lastIndexOf(CLOSE);
	// The opening tag is on a line of its own; the prompt itself may mention the tag inline.
	const before = `\n${reply.slice(0, Math.max(end, 0))}`;
	const start = before.lastIndexOf(`\n${OPEN}\n`);
	if (end < 0 || start < 0) throw new Error(`The reply has no ${OPEN} … ${CLOSE} block.`);
	const prompt = before.slice(start + OPEN.length + 2).trim();
	if (!prompt) throw new Error(`The reply's ${OPEN} block is empty.`);
	return prompt;
}

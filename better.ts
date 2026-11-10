const OPEN = "<improved-prompt>";
const CLOSE = "</improved-prompt>";
// The opening tag counts only on a line of its own; the prompt itself may mention the tag inline.
const OPEN_LINE = `\n${OPEN}\n`;

const RETURN = `## Return

Give answers (1) to (4) in your reply, each starting a new line with its number, like "(1)". Then end it with the rewritten prompt, complete, between these two lines and nothing after them:

${OPEN}
the rewritten prompt
${CLOSE}`;

/** `prompt` is the command's trimmed argument; empty means "deepen the current task". */
export function buildHelperTask(helper: string, prompt: string): string {
	return [
		helper.trim(),
		`## Prompt to deepen\n\n${prompt || "None given: deepen the task in progress in the conversation so far, including any feedback I gave on work already done."}`,
		RETURN,
	].join("\n\n");
}

/** The prompt in the last marked block of a reply to a task from buildHelperTask. */
export function parseMarkedPrompt(reply: string): string {
	const end = reply.lastIndexOf(CLOSE);
	const before = `\n${reply.slice(0, Math.max(end, 0))}`;
	const start = before.lastIndexOf(OPEN_LINE);
	if (end < 0 || start < 0) throw new Error(`The reply has no ${OPEN} … ${CLOSE} block.`);
	const prompt = before.slice(start + OPEN_LINE.length).trim();
	if (!prompt) throw new Error(`The reply's ${OPEN} block is empty.`);
	return prompt;
}

/**
 * How far a reply to buildHelperTask has got, from the text written so far: `answered` is the highest of the
 * headed answers (1) to (4), and `writingPrompt` turns true once the marked block opens on a line of its own.
 */
export function replyProgress(text: string): { answered: number; writingPrompt: boolean } {
	let answered = 0;
	for (const [, n] of text.matchAll(/^\W*\(([1-4])\)/gm)) answered = Math.max(answered, Number(n));
	return { answered, writingPrompt: `\n${text}`.includes(OPEN_LINE) };
}

/** Why the helper process failed, from how it ended (Node gives a code or a signal) and its error output. */
export function helperExitError(code: number | null, signal: string | null, stderr: string): string {
	const how = code === null ? `was stopped by ${signal}` : `exited with code ${code}`;
	const tail = stderr.trim().split("\n").slice(-3).join(" ");
	return tail ? `The helper ${how}: ${tail}` : `The helper ${how} without printing an error`;
}

const OPEN = "<improved-prompt>";
const CLOSE = "</improved-prompt>";
// The opening tag counts only on a line of its own; the prompt itself may mention the tag inline.
const OPEN_LINE = `\n${OPEN}\n`;

const RETURN = `## Return

Give answers (1) to (4) in your reply, each starting a new line with its number, like "(1)". Then end it with the rewritten prompt, complete, between these two lines and nothing after them:

${OPEN}
the rewritten prompt
${CLOSE}`;

export const HELPER_ENV = "PI_BETTER_HELPER";
// bash stays for read-only searches and experiments; only the prompts keep it from writing.
const HELPER_TOOLS = ["read", "grep", "find", "ls", "bash"];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

// The helper keeps the chat's whole tool list, so its request starts the same as the chat's and reads from the
// provider's prompt cache; it's held to reading by refusing the other tools when they're called.
export function helperToolBlock(toolName: string, activeTools: string[]): { block: true; reason: string } | undefined {
	if (HELPER_TOOLS.includes(toolName)) return undefined;
	const usable = HELPER_TOOLS.filter((tool) => activeTools.includes(tool)).join(", ");
	return { block: true, reason: `/better's helper only reads and rewrites, so ${toolName} is off. Use ${usable}.` };
}

// By default the helper runs on the chat's model and thinking level, which the prompt cache needs. settings.json's
// "better": { "model": "provider/id", "thinking": "high" } pins either one instead.
export function helperModelArgs(setting: unknown, chatModel: string | undefined, chatThinking: string | undefined): string[] {
	if (setting !== undefined && (typeof setting !== "object" || setting === null)) {
		throw new Error(`"better" in settings.json must be an object like { "model": "anthropic/claude-opus-4-5", "thinking": "high" }.`);
	}
	const { model = chatModel, thinking = chatThinking } = (setting ?? {}) as { model?: unknown; thinking?: unknown };
	if (typeof model !== "string" || model === "") {
		throw new Error(model === undefined ? "No model is selected; pick one with /model." : `"better.model" in settings.json must be a string like "anthropic/claude-opus-4-5".`);
	}
	// Pi only warns about an unknown --thinking level, on the helper's stderr where nobody sees it.
	if (thinking !== undefined && (typeof thinking !== "string" || !THINKING_LEVELS.includes(thinking))) {
		throw new Error(`"better.thinking" in settings.json must be one of ${THINKING_LEVELS.join(", ")}.`);
	}
	return ["--model", model, ...(typeof thinking === "string" ? ["--thinking", thinking] : [])];
}

export function buildHelperTask(helper: string, prompt: string): string {
	return [
		helper.trim(),
		`## Prompt to deepen\n\n${prompt || "None given: deepen the task in progress in the conversation so far, including any feedback I gave on work already done."}`,
		RETURN,
	].join("\n\n");
}

export function parseMarkedPrompt(reply: string): string {
	const end = reply.lastIndexOf(CLOSE);
	const before = `\n${reply.slice(0, Math.max(end, 0))}`;
	const start = before.lastIndexOf(OPEN_LINE);
	if (end < 0 || start < 0) throw new Error(`The reply has no ${OPEN} … ${CLOSE} block.`);
	const prompt = before.slice(start + OPEN_LINE.length).trim();
	if (!prompt) throw new Error(`The reply's ${OPEN} block is empty.`);
	return prompt;
}

export function replyProgress(text: string): { answered: number; writingPrompt: boolean } {
	let answered = 0;
	for (const [, n] of text.matchAll(/^\W*\(([1-4])\)/gm)) answered = Math.max(answered, Number(n));
	return { answered, writingPrompt: `\n${text}`.includes(OPEN_LINE) };
}

export function helperExitError(code: number | null, signal: string | null, stderr: string): string {
	const how = code === null ? `was stopped by ${signal}` : `exited with code ${code}`;
	const tail = stderr.trim().split("\n").slice(-3).join(" ");
	return tail ? `The helper ${how}: ${tail}` : `The helper ${how} without printing an error`;
}

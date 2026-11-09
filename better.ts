const FIELDS = ["professional", "rawMaterial", "methods", "proof", "prompt"] as const;

export type BetterResult = Record<(typeof FIELDS)[number], string>;

// pi-subagents checks structured_output against this schema, so a blank field ("\S" also rejects whitespace)
// makes the helper retry instead of finishing.
export const RESULT_SCHEMA = {
	type: "object",
	properties: Object.fromEntries(FIELDS.map((field) => [field, { type: "string", pattern: "\\S" }])),
	required: [...FIELDS],
	additionalProperties: false,
};

/** Trims a result that pi-subagents has already checked against RESULT_SCHEMA. */
export function trimResult(result: BetterResult): BetterResult {
	return Object.fromEntries(FIELDS.map((field) => [field, result[field].trim()])) as BetterResult;
}

const OPEN = "<improved-prompt>";
const CLOSE = "</improved-prompt>";

const STRUCTURED_RETURN = `## Return

Finish by calling \`structured_output\` with:

- \`professional\`: answer (1)
- \`rawMaterial\`: answer (2)
- \`methods\`: answer (3)
- \`proof\`: answer (4)
- \`prompt\`: the rewritten prompt, complete, as plain text or Markdown, with no preamble such as "Here is the prompt"`;

const MARKED_RETURN = `## Return

Give answers (1) to (4) in your reply, then end it with the rewritten prompt, complete, between these two lines and nothing after them:

${OPEN}
the rewritten prompt
${CLOSE}`;

/** `prompt` is the command's trimmed argument; empty means "deepen the current task". */
export function buildHelperTask({ helper, prompt, returns }: { helper: string; prompt: string; returns: "structured" | "marked" }): string {
	return [
		helper.trim(),
		`## Prompt to deepen\n\n${prompt || "None given: deepen the task in progress in the conversation so far, including any feedback the user gave on work already done."}`,
		returns === "structured" ? STRUCTURED_RETURN : MARKED_RETURN,
	].join("\n\n");
}

/** The prompt in the last marked block of a reply built with `returns: "marked"`. */
export function parseMarkedPrompt(reply: string): string {
	const start = reply.lastIndexOf(OPEN);
	const end = reply.lastIndexOf(CLOSE);
	if (start < 0 || end < start) throw new Error(`The reply has no ${OPEN} … ${CLOSE} block.`);
	const prompt = reply.slice(start + OPEN.length, end).trim();
	if (!prompt) throw new Error(`The reply's ${OPEN} block is empty.`);
	return prompt;
}

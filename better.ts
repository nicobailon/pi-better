export interface BetterResult {
	professional: string;
	rawMaterial: string;
	methods: string;
	proof: string;
	prompt: string;
}

const FIELDS = ["professional", "rawMaterial", "methods", "proof", "prompt"] as const;

export const RESULT_SCHEMA = {
	type: "object",
	properties: Object.fromEntries(FIELDS.map((field) => [field, { type: "string", minLength: 1 }])),
	required: [...FIELDS],
	additionalProperties: false,
};

export function parseBetterResult(value: unknown): BetterResult {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`The helper returned ${JSON.stringify(value)}, not an object with ${FIELDS.join(", ")}.`);
	}
	const record = value as Record<string, unknown>;
	for (const field of FIELDS) {
		const text = record[field];
		if (typeof text !== "string" || !text.trim()) {
			throw new Error(`The helper's result has no "${field}" text.`);
		}
	}
	return {
		professional: (record.professional as string).trim(),
		rawMaterial: (record.rawMaterial as string).trim(),
		methods: (record.methods as string).trim(),
		proof: (record.proof as string).trim(),
		prompt: (record.prompt as string).trim(),
	};
}

export interface TaskInput {
	/** The method the helper follows (helper.md). */
	helper: string;
	/** The prompt from `/better <prompt>`; empty means "deepen the current task". */
	prompt: string;
	/** "structured": a helper subagent returns through structured_output. "marked": the main agent ends its reply with a marked block. */
	returns: "structured" | "marked";
	/** Set when the user asked for a tweak of an earlier result. */
	tweak?: { previous: BetterResult; note: string };
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
${CLOSE}

Don't carry the prompt out: it is sent as the user's next message once this reply is done.`;

export function buildHelperTask({ helper, prompt, returns, tweak }: TaskInput): string {
	const parts = [helper.trim()];
	parts.push(prompt.trim()
		? `## Prompt to deepen\n\n${prompt.trim()}`
		: "## Prompt to deepen\n\nNone given: deepen the task currently in progress in the conversation so far.");
	if (tweak) {
		const { previous, note } = tweak;
		parts.push([
			"## Your previous result",
			`(1) ${previous.professional}`,
			`(2) ${previous.rawMaterial}`,
			`(3) ${previous.methods}`,
			`(4) ${previous.proof}`,
			`Rewritten prompt:\n\n${previous.prompt}`,
		].join("\n\n"));
		parts.push(`## What the user wants changed\n\n${note.trim()}\n\nRevise your previous result to make that change. Keep what the note doesn't touch, and gather more raw material only if the change needs it.`);
	}
	parts.push(returns === "structured" ? STRUCTURED_RETURN : MARKED_RETURN);
	return parts.join("\n\n");
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

/**
 * /boomerang reads some of its argument as its own syntax: a leading `/` or subcommand word,
 * and `->`, `--`, `--rethrow` or `--loop` tokens. Such a prompt can't go through it unchanged.
 */
export function boomerangSafe(prompt: string): boolean {
	// /boomerang drops quote marks before it reads tokens, so a quoted "->" still counts.
	const tokens = prompt.replace(/["']/g, "").trim().split(/\s+/);
	if (tokens[0].startsWith("/") || ["auto", "anchor", "tool", "guidance"].includes(tokens[0])) return false;
	return !tokens.some((token) => token === "->" || token === "--" || token.startsWith("--rethrow") || token.startsWith("--loop"));
}

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container } from "@earendil-works/pi-tui";
import { type BetterResult, RESULT_SCHEMA, buildHelperTask, parseMarkedPrompt, trimResult } from "./better.ts";

// pi-subagents' structured delegation events (pi-subagents src/api/delegation.ts).
const REQUEST_EVENT = "prompt-template:subagent:request";
const STARTED_EVENT = "prompt-template:subagent:started";
const UPDATE_EVENT = "prompt-template:subagent:update";
const RESPONSE_EVENT = "prompt-template:subagent:response";
const CANCEL_EVENT = "prompt-template:subagent:cancel";

// Registered with pi-subagents at runtime (pi-subagents docs/extension-api.md, "Runtime agent registration").
// No edit or write tool; bash stays for read-only searches and experiments, and helper.md forbids writes.
// The list has no extension tools, because pi-subagents runs this request as a foreground child that can't load them.
const HELPER_AGENT = "pi-better-helper";
const RUNTIME_AGENT_REGISTER_EVENT = "pi-subagents:runtime-agent-register:v1";
const HELPER_DEFINITION = {
	description: "Reads the material a prompt touches and rewrites the prompt for /better; never edits or starts work",
	systemPrompt: "You read and rewrite. Never edit files, start the work, or launch anything.",
	tools: ["read", "grep", "find", "ls", "bash"],
	inheritProjectContext: true,
	inheritSkills: false,
};
const HELPER_MODEL = "pi-claude/claude-opus-5-5";
const HELPER_TIMEOUT_MS = 20 * 60 * 1000;

interface Progress {
	toolCount?: number;
	currentTool?: string;
	currentToolArgs?: string;
}

class Cancelled extends Error {}

function askHelper(pi: ExtensionAPI, cwd: string, task: string, context: "fork" | "fresh", signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<BetterResult> {
	const requestId = randomUUID();
	const identity = { requestId, ownerRunId: requestId, nodeId: "better" };
	// trimResult runs outside the executor, so a throw rejects the promise instead of escaping into the event bus.
	return new Promise<BetterResult>((resolve, reject) => {
		let started = false;
		let done = false;
		const offs = [
			pi.events.on(STARTED_EVENT, (data: any) => {
				if (data?.requestId === requestId) started = true;
			}),
			pi.events.on(UPDATE_EVENT, (data: any) => {
				if (data?.requestId === requestId) onProgress(data);
			}),
			pi.events.on(RESPONSE_EVENT, (data: any) => {
				if (data?.requestId !== requestId) return;
				// A completed structured request always carries a result that matches RESULT_SCHEMA.
				if (data.status !== "completed") return finish(() => reject(new Error(`The helper ${data.status.replaceAll("_", " ")}: ${data.error ?? "no error text"}`)));
				finish(() => resolve(data.result.value));
			}),
		];
		const onAbort = () => {
			pi.events.emit(CANCEL_EVENT, identity);
			finish(() => reject(new Cancelled()));
		};
		const finish = (next: () => void) => {
			if (done) return;
			done = true;
			for (const off of offs) off();
			signal.removeEventListener("abort", onAbort);
			next();
		};
		signal.addEventListener("abort", onAbort, { once: true });
		pi.events.emit(REQUEST_EVENT, {
			...identity,
			agent: HELPER_AGENT,
			task,
			context,
			cwd,
			model: HELPER_MODEL,
			thinking: "high",
			timeoutMs: HELPER_TIMEOUT_MS,
			// The parent is waiting on this run, so the helper must not ask it questions.
			intercomBridge: { mode: "off" },
			result: { kind: "structured", schema: RESULT_SCHEMA },
		});
		// pi-subagents answers a request with STARTED synchronously, inside emit().
		if (!started) finish(() => reject(new Error("pi-subagents didn't pick up the request. /better needs the pi-subagents extension loaded.")));
	}).then(trimResult);
}

function registerHelper(pi: ExtensionAPI): { dispose(): void } {
	const request: {
		version: 1;
		name: string;
		definition: typeof HELPER_DEFINITION;
		result?: { ok: true; registration: { dispose(): void } } | { ok: false; error: Error };
	} = { version: 1, name: HELPER_AGENT, definition: HELPER_DEFINITION };
	pi.events.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
	if (!request.result) throw new Error("pi-subagents didn't register the helper agent. /better needs the pi-subagents extension loaded.");
	if (!request.result.ok) throw new Error(`pi-subagents refused the helper agent: ${request.result.error.message}`, { cause: request.result.error });
	return request.result.registration;
}

function progressText(progress: Progress, elapsedMs: number): string {
	const parts = ["Helper is reading and rewriting"];
	if (progress.toolCount) parts.push(`${progress.toolCount} tool${progress.toolCount === 1 ? "" : "s"}`);
	// pi-subagents already shortens currentToolArgs to a one-line preview.
	if (progress.currentTool) parts.push(progress.currentToolArgs ? `${progress.currentTool}: ${progress.currentToolArgs}` : progress.currentTool);
	const seconds = Math.floor(elapsedMs / 1000);
	parts.push(seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`);
	return `${parts.join(" · ")} · Esc cancels`;
}

/** Rejects with Cancelled when the user presses Esc. */
async function runHelper(pi: ExtensionAPI, ctx: ExtensionCommandContext, task: string, context: "fork" | "fresh"): Promise<BetterResult> {
	if (ctx.mode !== "tui") return askHelper(pi, ctx.cwd, task, context, new AbortController().signal, () => {});
	const outcome = await ctx.ui.custom<{ result: BetterResult } | { error: unknown }>((tui, theme, _keybindings, done) => {
		const startedAt = Date.now();
		let progress: Progress = {};
		const loader = new CancellableLoader(tui, (s) => theme.fg("accent", s), (s) => theme.fg("muted", s), progressText(progress, 0));
		const refresh = () => loader.setMessage(progressText(progress, Date.now() - startedAt));
		// pi-subagents sends progress only when a tool starts or ends, so the clock ticks here; a slow command
		// would otherwise look like a hang.
		const clock = setInterval(refresh, 1000);
		const stop = () => {
			clearInterval(clock);
			loader.dispose();
		};
		const box = new Container();
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		box.addChild(loader);
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		const onProgress = (next: Progress) => {
			progress = next;
			refresh();
		};
		// Stop here too: on an immediate failure done() runs before Pi stores the component, so Pi never disposes it.
		askHelper(pi, ctx.cwd, task, context, loader.signal, onProgress)
			.finally(stop)
			.then((result) => done({ result }), (error) => done({ error }));
		return Object.assign(box, { handleInput: (data: string) => loader.handleInput(data), dispose: stop });
	});
	if ("error" in outcome) throw outcome.error;
	return outcome.result;
}

const promptCompletions = (prefix: string) =>
	prefix.trim() ? null : [{ value: "", label: "<prompt>", description: "The prompt to deepen. Leave it out to deepen the task in progress." }];

function lastAssistantText(entries: readonly SessionEntry[]): string {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const text = entry.message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
		if (text) return text;
	}
	return "";
}

function failed(ctx: ExtensionContext, command: string, error: unknown): void {
	const message = `/${command} failed: ${error instanceof Error ? error.message : String(error)}`;
	if (!ctx.hasUI) throw new Error(message);
	ctx.ui.notify(message, "error");
}

/**
 * Puts the prompt in the input box for the user to read and send. A draft already there stays, below the prompt.
 * Print and JSON mode have no editor, and RPC's getEditorText is always empty, so a draft there would be lost;
 * outside the TUI the prompt (with the helper's answers, when given) is posted as a message instead.
 */
function handOver(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string, result?: BetterResult): void {
	if (ctx.mode !== "tui") {
		const content = result
			? `(1) ${result.professional}\n\n(2) ${result.rawMaterial}\n\n(3) ${result.methods}\n\n(4) ${result.proof}\n\nImproved prompt:\n\n${prompt}`
			: prompt;
		pi.sendMessage({ customType: "better", content, display: true, details: result });
		return;
	}
	const draft = ctx.ui.getEditorText().trim();
	ctx.ui.setEditorText(draft ? `${prompt}\n\n${draft}` : prompt);
	// setEditorText doesn't repaint on its own; the notice does, so the prompt shows right away.
	ctx.ui.notify(`The improved prompt is in your input box${draft ? ", above the draft you'd typed" : ""}. Edit it, then press Enter to send.`, "info");
}

export default function (pi: ExtensionAPI) {
	const helper = () => readFileSync(new URL("./helper.md", import.meta.url), "utf8");
	let helperRegistration: { dispose(): void } | undefined;
	let boomerangRunning = false;

	pi.on("session_shutdown", () => {
		helperRegistration?.dispose();
		helperRegistration = undefined;
	});

	pi.registerCommand("better", {
		description: "Deepen a prompt (or the current task) with a read-only helper, then put the improved prompt in your input box",
		getArgumentCompletions: promptCompletions,
		handler: async (args, ctx) => {
			const prompt = args.trim();
			// A fork needs the session file, which Pi writes only once the conversation has history.
			const sessionFile = ctx.sessionManager.getSessionFile();
			const canFork = sessionFile !== undefined && existsSync(sessionFile);
			if (!prompt && !canFork) {
				ctx.ui.notify("/better has no task to deepen yet; give it a prompt: /better <prompt>", "error");
				return;
			}
			let result: BetterResult;
			try {
				helperRegistration ??= registerHelper(pi);
				result = await runHelper(pi, ctx, buildHelperTask({ helper: helper(), prompt, returns: "structured" }), canFork ? "fork" : "fresh");
			} catch (error) {
				if (error instanceof Cancelled) return ctx.ui.notify("/better cancelled; nothing was sent", "info");
				return failed(ctx, "better", error);
			}
			pi.appendEntry("better", { prompt, result });
			handOver(pi, ctx, result.prompt, result);
		},
	});

	pi.registerCommand("better-boomerang", {
		description: "Deepen a prompt (or the current task) in this chat, then jump back and put the improved prompt in your input box",
		getArgumentCompletions: promptCompletions,
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt && ctx.sessionManager.getBranch().length === 0) {
				ctx.ui.notify("/better-boomerang has no task to deepen yet; give it a prompt: /better-boomerang <prompt>", "error");
				return;
			}
			if (boomerangRunning) {
				ctx.ui.notify("/better-boomerang is already running; wait for it to finish.", "error");
				return;
			}
			boomerangRunning = true;
			try {
				await ctx.waitForIdle();
				// navigateTree to a user or custom message moves to its parent and refills the input box with its text,
				// so the branch point must be another kind of entry; add an invisible one when the leaf isn't.
				const leaf = ctx.sessionManager.getLeafEntry();
				if (!leaf || (leaf.type === "message" && leaf.message.role === "user") || leaf.type === "custom_message") {
					pi.appendEntry("better-boomerang-start", { prompt });
				}
				const branchPoint = ctx.sessionManager.getLeafId()!;

				// Hidden from the chat but sent to the model; it starts a turn right away, so waitForIdle waits for it.
				pi.sendMessage(
					{ customType: "better-boomerang", content: buildHelperTask({ helper: helper(), prompt, returns: "marked" }), display: false },
					{ triggerTurn: true },
				);
				await ctx.waitForIdle();

				const branch = ctx.sessionManager.getBranch();
				let improved: string;
				try {
					improved = parseMarkedPrompt(lastAssistantText(branch.slice(branch.findIndex((entry) => entry.id === branchPoint) + 1)));
				} catch (error) {
					// The rewrite stays on the branch so the user can see what went wrong.
					return failed(ctx, "better-boomerang", error);
				}

				// No summary: the rewrite leaves the active context and stays reachable in /tree.
				const navigated = await ctx.navigateTree(branchPoint, { summarize: false });
				if (navigated.cancelled) {
					return failed(ctx, "better-boomerang", new Error("another extension cancelled the jump back to where the rewrite started"));
				}
				pi.appendEntry("better", { prompt, inline: true, improved });
				// navigateTree keeps the same session, so this ctx and pi stay valid.
				handOver(pi, ctx, improved);
			} finally {
				boomerangRunning = false;
			}
		},
	});
}

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container, Key, Markdown, Spacer, Text, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { type BetterResult, RESULT_SCHEMA, buildHelperTask, parseBetterResult, parseMarkedPrompt } from "./better.ts";

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

// pi-subagents' RPC bridge (pi-subagents src/extension/rpc.ts). Its spawn runs detached (async), and the
// run's result comes back into the chat the normal pi-subagents way.
const RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";
const SUBAGENT_AGENT = "worker";
const SUBAGENT_MODEL = "pi-claude/claude-opus-5-5:high";
const FORKED = "Forked: gets a copy of this conversation";
const FRESH = "Fresh: starts with an empty context";

interface Progress {
	toolCount?: number;
	currentTool?: string;
	durationMs?: number;
}

type Choice = "fire" | "subagent" | "tweak" | "edit" | "cancel";

type Context = "fork" | "fresh";

interface Offers {
	subagent: boolean;
}

class Cancelled extends Error {}

function askHelper(pi: ExtensionAPI, cwd: string, task: string, context: Context, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<BetterResult> {
	const requestId = randomUUID();
	const identity = { requestId, ownerRunId: requestId, nodeId: "better" };
	return new Promise((resolve, reject) => {
		let started = false;
		let done = false;
		const offs = [
			pi.events.on(STARTED_EVENT, (data: any) => {
				if (data?.requestId === requestId) started = true;
			}),
			pi.events.on(UPDATE_EVENT, (data: any) => {
				if (data?.requestId === requestId) onProgress({ toolCount: data.toolCount, currentTool: data.currentTool, durationMs: data.durationMs });
			}),
			pi.events.on(RESPONSE_EVENT, (data: any) => {
				if (data?.requestId !== requestId) return;
				if (data.status !== "completed") return finish(() => reject(new Error(`The helper ${data.status}: ${data.error ?? "no error text"}`)));
				if (data.result?.kind !== "structured") return finish(() => reject(new Error(`The helper returned a ${data.result?.kind ?? "missing"} result instead of a structured one.`)));
				try {
					const result = parseBetterResult(data.result.value);
					finish(() => resolve(result));
				} catch (error) {
					finish(() => reject(error));
				}
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
		if (!started && !done) finish(() => reject(new Error("pi-subagents didn't pick up the request. /better needs the pi-subagents extension loaded.")));
	});
}

function registerHelper(pi: ExtensionAPI): { dispose(): void } {
	const request: { version: 1; name: string; definition: typeof HELPER_DEFINITION; result?: any } = { version: 1, name: HELPER_AGENT, definition: HELPER_DEFINITION };
	pi.events.emit(RUNTIME_AGENT_REGISTER_EVENT, request);
	if (!request.result) throw new Error("pi-subagents didn't register the helper agent. /better needs the pi-subagents extension loaded.");
	if (!request.result.ok) throw new Error(`pi-subagents refused the helper agent: ${request.result.error?.message ?? String(request.result.error)}`);
	return request.result.registration;
}

function spawnSubagent(pi: ExtensionAPI, cwd: string, task: string, context: Context, signal: AbortSignal): Promise<void> {
	const requestId = randomUUID();
	return new Promise((resolve, reject) => {
		const stop = () => {
			clearTimeout(timer);
			off();
			signal.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			stop();
			reject(new Cancelled());
		};
		const timer = setTimeout(() => {
			stop();
			reject(new Error("pi-subagents didn't answer the launch within 30s."));
		}, 30_000);
		const off = pi.events.on(RPC_REPLY_EVENT_PREFIX + requestId, (reply: any) => {
			stop();
			if (reply?.success) resolve();
			else reject(new Error(reply?.error?.message ?? "unknown error"));
		});
		signal.addEventListener("abort", onAbort, { once: true });
		pi.events.emit(RPC_REQUEST_EVENT, {
			version: 1,
			requestId,
			method: "spawn",
			source: { extension: "pi-better" },
			params: { agent: SUBAGENT_AGENT, task, context, model: SUBAGENT_MODEL, cwd },
		});
	});
}

function progressText(progress: Progress): string {
	const parts = ["Helper is reading and rewriting"];
	if (progress.toolCount) parts.push(`${progress.toolCount} tool${progress.toolCount === 1 ? "" : "s"}`);
	if (progress.currentTool) parts.push(progress.currentTool);
	if (progress.durationMs) parts.push(`${Math.round(progress.durationMs / 1000)}s`);
	return `${parts.join(" · ")} · Esc cancels`;
}

async function runHelper(pi: ExtensionAPI, ctx: ExtensionCommandContext, task: string, context: Context): Promise<BetterResult | undefined> {
	if (ctx.mode !== "tui") {
		return await askHelper(pi, ctx.cwd, task, context, new AbortController().signal, () => {});
	}
	const outcome = await ctx.ui.custom<{ result?: BetterResult; error?: unknown }>((tui, theme, _keybindings, done) => {
		const loader = new CancellableLoader(tui, (s) => theme.fg("accent", s), (s) => theme.fg("muted", s), progressText({}));
		const box = new Container();
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		box.addChild(loader);
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		askHelper(pi, ctx.cwd, task, context, loader.signal, (progress) => loader.setMessage(progressText(progress))).then(
			// Dispose here too: on an immediate failure done() runs before Pi stores the component, so Pi never disposes it.
			(result) => {
				loader.dispose();
				done({ result });
			},
			(error) => {
				loader.dispose();
				done(error instanceof Cancelled ? {} : { error });
			},
		);
		return {
			render: (width: number) => box.render(width),
			invalidate: () => box.invalidate(),
			handleInput: (data: string) => loader.handleInput(data),
			dispose: () => loader.dispose(),
		};
	});
	if (outcome.error) throw outcome.error;
	return outcome.result;
}

function resultBox(tui: TUI, theme: Theme, result: BetterResult, offers: Offers, done: (choice: Choice) => void) {
	let showWhy = false;
	const box = new Container();
	const build = () => {
		box.clear();
		const border = (s: string) => theme.fg("accent", s);
		box.addChild(new DynamicBorder(border));
		box.addChild(new Text(theme.bold(theme.fg("accent", "Improved prompt")), 1, 0));
		if (showWhy) {
			const why = [
				`**(1) What a top professional would do**\n\n${result.professional}`,
				`**(2) Rawest material**\n\n${result.rawMaterial}`,
				`**(3) Methods and tools**\n\n${result.methods}`,
				`**(4) What shows it's right**\n\n${result.proof}`,
			].join("\n\n");
			box.addChild(new Markdown(why, 1, 1, getMarkdownTheme()));
		} else {
			box.addChild(new Text(theme.fg("dim", "▸ why (w)"), 1, 0));
		}
		box.addChild(new Spacer(1));
		box.addChild(new Markdown(result.prompt, 1, 0, getMarkdownTheme()));
		box.addChild(new Spacer(1));
		const keys = [
			"Enter fire",
			...(offers.subagent ? ["s run as a subagent"] : []),
			"t tweak",
			"e edit",
			`w ${showWhy ? "hide" : "show"} why`,
			"Esc cancel",
		];
		box.addChild(new Text(theme.fg("dim", keys.join(" · ")), 1, 0));
		box.addChild(new DynamicBorder(border));
	};
	build();
	return {
		render: (width: number) => box.render(width),
		invalidate: () => box.invalidate(),
		handleInput(data: string) {
			if (matchesKey(data, Key.enter)) done("fire");
			else if (offers.subagent && matchesKey(data, "s")) done("subagent");
			else if (matchesKey(data, "t")) done("tweak");
			else if (matchesKey(data, "e")) done("edit");
			else if (matchesKey(data, Key.escape)) done("cancel");
			else if (matchesKey(data, "w")) {
				showWhy = !showWhy;
				build();
				tui.requestRender();
			}
		},
	};
}

function plainText(result: BetterResult): string {
	return [
		`(1) ${result.professional}`,
		`(2) ${result.rawMaterial}`,
		`(3) ${result.methods}`,
		`(4) ${result.proof}`,
		`Improved prompt:\n\n${result.prompt}`,
	].join("\n\n");
}

function promptCompletions(description: string) {
	return (prefix: string) => (prefix.trim() ? null : [{ value: "", label: "<prompt>", description }]);
}

function lastAssistantText(messages: readonly unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; content?: unknown };
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n").trim();
		if (text) return text;
	}
	return undefined;
}

function failed(ctx: ExtensionContext, command: string, error: unknown): void {
	const message = `/${command} failed: ${error instanceof Error ? error.message : String(error)}. Nothing was sent.`;
	if (!ctx.hasUI) throw new Error(message);
	ctx.ui.notify(message, "error");
}

/**
 * Puts the prompt in the input box for the user to read and send. A draft already there stays, below the prompt.
 * Print and JSON mode have no editor and RPC's set_editor_text gets no reply, so outside the TUI the prompt
 * (or `posted`, when given) is posted as a message instead.
 */
function handOver(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string, posted?: { content: string; details: unknown }): void {
	if (ctx.mode !== "tui") {
		pi.sendMessage({ customType: "better", content: posted?.content ?? prompt, display: true, details: posted?.details });
		return;
	}
	const draft = ctx.ui.getEditorText().trim();
	ctx.ui.setEditorText(draft ? `${prompt}\n\n${draft}` : prompt);
	// setEditorText doesn't repaint on its own; the notice does, so the prompt shows right away.
	ctx.ui.notify(
		draft
			? "The improved prompt is in your input box, above the draft you'd typed. Edit it, then press Enter to send."
			: "The improved prompt is in your input box. Edit it, then press Enter to send.",
		"info",
	);
}

export default function (pi: ExtensionAPI) {
	const helper = () => readFileSync(new URL("./helper.md", import.meta.url), "utf8");
	let helperRegistration: { dispose(): void } | undefined;
	// Aborted at session shutdown so a pending subagent launch stops before it can touch the stale context.
	let session = new AbortController();
	let inlineRunning = false;

	/** The prompt and whether the helper can get a copy of this conversation, or undefined after telling the user why not. */
	const prepare = (command: string, args: string, ctx: ExtensionCommandContext) => {
		const prompt = args.trim();
		// A fork needs the session file, which Pi writes only once the conversation has history.
		const sessionFile = ctx.sessionManager.getSessionFile();
		const canFork = sessionFile !== undefined && existsSync(sessionFile);
		if (!prompt && !canFork) {
			ctx.ui.notify(`/${command} has no task to deepen yet; give it a prompt: /${command} <prompt>`, "error");
			return undefined;
		}
		return { prompt, canFork };
	};

	pi.on("session_start", () => {
		session = new AbortController();
	});
	pi.on("session_shutdown", () => {
		session.abort();
		helperRegistration?.dispose();
		helperRegistration = undefined;
	});

	pi.registerCommand("better-prompt", {
		description: "Deepen a prompt (or the current task) with a read-only helper, then fire, tweak, edit, run as a subagent, or cancel it",
		getArgumentCompletions: promptCompletions("The prompt to deepen. Leave it out to deepen the task in progress."),
		handler: async (args, ctx) => {
			const prepared = prepare("better-prompt", args, ctx);
			if (!prepared) return;
			const { prompt, canFork } = prepared;
			try {
				helperRegistration ??= registerHelper(pi);
			} catch (error) {
				return failed(ctx, "better-prompt", error);
			}
			let tweak: { previous: BetterResult; note: string } | undefined;
			for (;;) {
				let result: BetterResult | undefined;
				try {
					result = await runHelper(pi, ctx, buildHelperTask({ helper: helper(), prompt, returns: "structured", tweak }), canFork ? "fork" : "fresh");
				} catch (error) {
					return failed(ctx, "better-prompt", error);
				}
				if (!result) {
					ctx.ui.notify("/better-prompt cancelled", "info");
					return;
				}
				pi.appendEntry("better", { prompt, tweakNote: tweak?.note, result });

				if (ctx.mode !== "tui") {
					handOver(pi, ctx, result.prompt, { content: plainText(result), details: result });
					return;
				}
				const shown = result;
				const offers: Offers = {
					subagent: pi.getAllTools().some((tool) => tool.name === "subagent"),
				};
				let choice: Choice;
				let context: Context | undefined;
				do {
					choice = await ctx.ui.custom<Choice>((tui, theme, _keybindings, done) => resultBox(tui, theme, shown, offers, done), {
						blocked: { kind: "question", message: "Fire, tweak, edit or cancel the improved prompt" },
					});
					if (choice === "subagent") {
						const picked = await ctx.ui.select("Run the improved prompt as a subagent", canFork ? [FORKED, FRESH] : [FRESH]);
						context = picked === FORKED ? "fork" : picked === FRESH ? "fresh" : undefined;
					}
				} while (choice === "subagent" && !context);
				if (choice === "cancel") {
					ctx.ui.notify("/better-prompt cancelled; nothing was sent", "info");
					return;
				}
				if (choice === "subagent" && context) {
					try {
						await spawnSubagent(pi, ctx.cwd, result.prompt, context, session.signal);
						ctx.ui.notify(`Started a ${context === "fork" ? "forked" : "fresh"} ${SUBAGENT_AGENT} subagent; its result comes back here when it finishes.`, "info");
					} catch (error) {
						if (error instanceof Cancelled) return;
						ctx.ui.notify(`/better-prompt couldn't start the subagent: ${error instanceof Error ? error.message : String(error)}`, "error");
					}
					return;
				}
				if (choice === "tweak") {
					const note = await ctx.ui.input("What should change?", "e.g. drop the VM part (empty = edit by hand)");
					if (note === undefined) {
						ctx.ui.notify("/better-prompt cancelled; nothing was sent", "info");
						return;
					}
					if (note.trim()) {
						tweak = { previous: result, note };
						continue;
					}
				}
				if (choice === "edit" || choice === "tweak") {
					handOver(pi, ctx, result.prompt);
					return;
				}
				if (!ctx.isIdle()) await ctx.waitForIdle();
				pi.sendUserMessage(result.prompt);
				return;
			}
		},
	});

	pi.registerCommand("better", {
		description: "Deepen a prompt (or the current task) with a read-only helper, then put the improved prompt in your input box",
		getArgumentCompletions: promptCompletions("The prompt to deepen. Leave it out to deepen the task in progress."),
		handler: async (args, ctx) => {
			const prepared = prepare("better", args, ctx);
			if (!prepared) return;
			const { prompt, canFork } = prepared;
			let result: BetterResult | undefined;
			try {
				helperRegistration ??= registerHelper(pi);
				result = await runHelper(pi, ctx, buildHelperTask({ helper: helper(), prompt, returns: "structured" }), canFork ? "fork" : "fresh");
			} catch (error) {
				return failed(ctx, "better", error);
			}
			if (!result) {
				ctx.ui.notify("/better cancelled; nothing was sent", "info");
				return;
			}
			pi.appendEntry("better", { prompt, result });
			handOver(pi, ctx, result.prompt, { content: plainText(result), details: result });
		},
	});

	pi.registerCommand("better-boomerang", {
		description: "Deepen a prompt (or the current task) right here, then jump back and put the improved prompt in your input box",
		getArgumentCompletions: promptCompletions("The prompt to deepen. Leave it out to deepen the task in progress."),
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt && ctx.sessionManager.getBranch().length === 0) {
				ctx.ui.notify("/better-boomerang has no task to deepen yet; give it a prompt: /better-boomerang <prompt>", "error");
				return;
			}
			if (inlineRunning) {
				ctx.ui.notify("/better-boomerang is already running; wait for it to finish.", "error");
				return;
			}
			inlineRunning = true;
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
				const rewrite = branch.slice(branch.findIndex((entry) => entry.id === branchPoint) + 1);
				let improved: string;
				try {
					const replies = rewrite.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
					improved = parseMarkedPrompt(lastAssistantText(replies) ?? "");
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
				inlineRunning = false;
			}
		},
	});
}

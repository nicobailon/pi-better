import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CancellableLoader, Container, Key, Markdown, Spacer, Text, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { type BetterResult, RESULT_SCHEMA, boomerangSafe, buildHelperTask, parseBetterResult } from "./better.ts";

// pi-subagents' structured delegation events (pi-subagents src/api/delegation.ts).
const REQUEST_EVENT = "prompt-template:subagent:request";
const STARTED_EVENT = "prompt-template:subagent:started";
const UPDATE_EVENT = "prompt-template:subagent:update";
const RESPONSE_EVENT = "prompt-template:subagent:response";
const CANCEL_EVENT = "prompt-template:subagent:cancel";

// pi-subagents runs this request as a foreground child, which can't load extension tools; delegate lists none.
// It has edit and write, so helper.md is what keeps it read-only.
const HELPER_AGENT = "delegate";
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

type Choice = "fire" | "boomerang" | "subagent" | "tweak" | "edit" | "cancel";

type Context = "fork" | "fresh";

interface Offers {
	boomerang: boolean;
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

function spawnSubagent(pi: ExtensionAPI, cwd: string, task: string, context: Context): Promise<void> {
	const requestId = randomUUID();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			off();
			reject(new Error("pi-subagents didn't answer the launch within 30s."));
		}, 30_000);
		const off = pi.events.on(RPC_REPLY_EVENT_PREFIX + requestId, (reply: any) => {
			clearTimeout(timer);
			off();
			if (reply?.success) resolve();
			else reject(new Error(reply?.error?.message ?? "unknown error"));
		});
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
			(result) => done({ result }),
			(error) => done(error instanceof Cancelled ? {} : { error }),
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
			...(offers.boomerang ? ["b fire as /boomerang"] : []),
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
			else if (offers.boomerang && matchesKey(data, "b")) done("boomerang");
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

export default function (pi: ExtensionAPI) {
	pi.registerCommand("better", {
		description: "Deepen a prompt (or the current task) with a helper, then fire, tweak, edit, run as a subagent, or cancel it",
		handler: async (args, ctx) => {
			const helper = readFileSync(new URL("./helper.md", import.meta.url), "utf8");
			const prompt = args.trim();
			// A fork needs the session file, which Pi writes only once the conversation has history.
			const sessionFile = ctx.sessionManager.getSessionFile();
			const canFork = sessionFile !== undefined && existsSync(sessionFile);
			if (!prompt && !canFork) {
				ctx.ui.notify("/better has no task to deepen yet; give it a prompt: /better <prompt>", "error");
				return;
			}
			let tweak: { previous: BetterResult; note: string } | undefined;
			for (;;) {
				let result: BetterResult | undefined;
				try {
					result = await runHelper(pi, ctx, buildHelperTask({ helper, prompt, tweak }), canFork ? "fork" : "fresh");
				} catch (error) {
					const message = `/better failed: ${error instanceof Error ? error.message : String(error)}`;
					if (ctx.hasUI) ctx.ui.notify(message, "error");
					else throw new Error(message);
					return;
				}
				if (!result) {
					ctx.ui.notify("/better cancelled", "info");
					return;
				}
				pi.appendEntry("better", { prompt, tweakNote: tweak?.note, result });

				if (ctx.mode !== "tui") {
					pi.sendMessage({ customType: "better", content: plainText(result), display: true, details: result });
					return;
				}
				const shown = result;
				const offers: Offers = {
					boomerang: pi.getCommands().some((command) => command.name === "boomerang") && boomerangSafe(result.prompt),
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
					ctx.ui.notify("/better cancelled; nothing was sent", "info");
					return;
				}
				if (choice === "subagent" && context) {
					try {
						await spawnSubagent(pi, ctx.cwd, result.prompt, context);
						ctx.ui.notify(`Started a ${context === "fork" ? "forked" : "fresh"} ${SUBAGENT_AGENT} subagent; its result comes back here when it finishes.`, "info");
					} catch (error) {
						ctx.ui.notify(`/better couldn't start the subagent: ${error instanceof Error ? error.message : String(error)}`, "error");
					}
					return;
				}
				if (choice === "tweak") {
					const note = await ctx.ui.input("What should change?", "e.g. drop the VM part (empty = edit by hand)");
					if (note === undefined) {
						ctx.ui.notify("/better cancelled; nothing was sent", "info");
						return;
					}
					if (note.trim()) {
						tweak = { previous: result, note };
						continue;
					}
				}
				if (choice === "edit" || choice === "tweak") {
					ctx.ui.setEditorText(result.prompt);
					// setEditorText doesn't repaint on its own; the notice does, so the prompt shows right away.
					ctx.ui.notify("The improved prompt is in your input box. Edit it, then press Enter to send.", "info");
					return;
				}
				if (!ctx.isIdle()) await ctx.waitForIdle();
				if (choice === "boomerang") pi.sendUserMessage(`/boomerang ${result.prompt}`, { expandPromptTemplates: true });
				else pi.sendUserMessage(result.prompt);
				return;
			}
		},
	});
}

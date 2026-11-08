import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

// The oracle agent is read-only (no edit or write tools) and starts from a fork of this conversation.
const HELPER_AGENT = "oracle";
const HELPER_MODEL = "pi-claude/claude-opus-5-5";
const HELPER_TIMEOUT_MS = 20 * 60 * 1000;

interface Progress {
	toolCount?: number;
	currentTool?: string;
	durationMs?: number;
}

type Choice = "fire" | "boomerang" | "tweak" | "edit" | "cancel";

class Cancelled extends Error {}

function askHelper(pi: ExtensionAPI, cwd: string, task: string, signal: AbortSignal, onProgress: (progress: Progress) => void): Promise<BetterResult> {
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
			context: "fork",
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

function progressText(progress: Progress): string {
	const parts = ["Helper is reading and rewriting"];
	if (progress.toolCount) parts.push(`${progress.toolCount} tool${progress.toolCount === 1 ? "" : "s"}`);
	if (progress.currentTool) parts.push(progress.currentTool);
	if (progress.durationMs) parts.push(`${Math.round(progress.durationMs / 1000)}s`);
	return `${parts.join(" · ")} · Esc cancels`;
}

async function runHelper(pi: ExtensionAPI, ctx: ExtensionCommandContext, task: string): Promise<BetterResult | undefined> {
	if (ctx.mode !== "tui") {
		return await askHelper(pi, ctx.cwd, task, new AbortController().signal, () => {});
	}
	const outcome = await ctx.ui.custom<{ result?: BetterResult; error?: unknown }>((tui, theme, _keybindings, done) => {
		const loader = new CancellableLoader(tui, (s) => theme.fg("accent", s), (s) => theme.fg("muted", s), progressText({}));
		const box = new Container();
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		box.addChild(loader);
		box.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		askHelper(pi, ctx.cwd, task, loader.signal, (progress) => loader.setMessage(progressText(progress))).then(
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

function resultBox(tui: TUI, theme: Theme, result: BetterResult, canBoomerang: boolean, done: (choice: Choice) => void) {
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
		const keys = ["Enter fire", ...(canBoomerang ? ["b fire as /boomerang"] : []), "t tweak", "e edit", `w ${showWhy ? "hide" : "show"} why`, "Esc cancel"];
		box.addChild(new Text(theme.fg("dim", keys.join(" · ")), 1, 0));
		box.addChild(new DynamicBorder(border));
	};
	build();
	return {
		render: (width: number) => box.render(width),
		invalidate: () => box.invalidate(),
		handleInput(data: string) {
			if (matchesKey(data, Key.enter)) done("fire");
			else if (canBoomerang && matchesKey(data, "b")) done("boomerang");
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
		description: "Deepen a prompt (or the current task) with a forked helper, then fire, tweak, edit or cancel it",
		handler: async (args, ctx) => {
			const helper = readFileSync(new URL("./helper.md", import.meta.url), "utf8");
			const prompt = args.trim();
			let tweak: { previous: BetterResult; note: string } | undefined;
			for (;;) {
				let result: BetterResult | undefined;
				try {
					result = await runHelper(pi, ctx, buildHelperTask({ helper, prompt, tweak }));
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
				const canBoomerang = pi.getCommands().some((command) => command.name === "boomerang") && boomerangSafe(result.prompt);
				const shown = result;
				const choice = await ctx.ui.custom<Choice>((tui, theme, _keybindings, done) => resultBox(tui, theme, shown, canBoomerang, done), {
					blocked: { kind: "question", message: "Fire, tweak, edit or cancel the improved prompt" },
				});
				if (choice === "cancel") {
					ctx.ui.notify("/better cancelled; nothing was sent", "info");
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

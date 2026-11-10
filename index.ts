import { type ChildProcessByStdio, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Readable } from "node:stream";
import type { ExtensionAPI, ExtensionContext, JsonAgentSessionEvent, SessionEntry, SessionHeader, Theme } from "@earendil-works/pi-coding-agent";
import { Loader, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildHelperTask, HELPER_ENV, helperExitError, helperModelArgs, helperToolBlock, parseMarkedPrompt, replyProgress } from "./better.ts";

const HELPER_TIMEOUT_MS = 20 * 60 * 1000;
const WIDGET = "better";
const SHUTDOWN = "session shutdown";

class Cancelled extends Error {}

type HelperEvent = JsonAgentSessionEvent | SessionHeader;

function askHelper(cwd: string, sessionFile: string | undefined, modelArgs: string[], task: string, signal: AbortSignal, onEvent: (event: HelperEvent) => void): Promise<string> {
	// The fork goes to a temp dir so it never shows up in /resume.
	const sessionDir = sessionFile && mkdtempSync(join(tmpdir(), "pi-better-"));
	const cleanUp = () => sessionDir && rmSync(sessionDir, { recursive: true, force: true });
	const args = [
		"--mode", "json", "-p",
		...(sessionDir ? ["--fork", sessionFile, "--session-dir", sessionDir] : ["--no-session"]),
		// No --tools, --no-skills or extra system prompt: any of them would change the request's start and miss the cache.
		...modelArgs,
		task,
	];
	// Same launch as Pi's subagent example (getPiInvocation). A Bun-compiled pi runs from /$bunfs/root/ and is
	// its own executable.
	const script = process.argv[1];
	const [command, ...prefix] =
		script && !script.startsWith("/$bunfs/root/") && existsSync(script) ? [process.execPath, script]
		: /^(node|bun)(\.exe)?$/.test(basename(process.execPath).toLowerCase()) ? ["pi"]
		: [process.execPath];
	let child: ChildProcessByStdio<null, Readable, Readable>;
	try {
		child = spawn(command, [...prefix, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, [HELPER_ENV]: "1" } });
	} catch (error) {
		cleanUp();
		throw error;
	}
	return new Promise((resolve, reject) => {
		let reply = "";
		let modelError: string | undefined;
		let stderr = "";
		let buffered = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, HELPER_TIMEOUT_MS);
		const onAbort = () => child.kill();
		signal.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			const lines = (buffered + chunk).split("\n");
			buffered = lines.pop()!;
			for (const line of lines) {
				let event: HelperEvent;
				try {
					event = JSON.parse(line);
				} catch {
					continue; // an extension in the helper may print plain text
				}
				onEvent(event);
				if (event.type === "message_end" && event.message.role === "assistant") {
					// --mode json exits 0 even when the model call failed, so the failure is read from the message.
					const failedTurn = event.message.stopReason === "error" || event.message.stopReason === "aborted";
					modelError = failedTurn ? event.message.errorMessage || `request ${event.message.stopReason}` : undefined;
					const text = event.message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
					if (text.trim()) reply = text;
				}
			}
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		const settle = (error?: Error) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			cleanUp();
			if (error) reject(error);
			else resolve(reply);
		};
		child.on("error", (error) => settle(new Error(`Couldn't start pi for the helper: ${error.message}`)));
		child.on("close", (code, exitSignal) => {
			if (signal.aborted) return settle(new Cancelled());
			if (timedOut) return settle(new Error(`The helper timed out after ${HELPER_TIMEOUT_MS / 60_000} minutes`));
			if (code !== 0) return settle(new Error(helperExitError(code, exitSignal, stderr)));
			if (modelError) return settle(new Error(`The helper's model call failed: ${modelError}`));
			if (!reply.trim()) return settle(new Error("The helper finished without replying"));
			settle();
		});
	});
}

function shortPath(path: string, projectDirs: readonly string[]): string {
	for (const dir of projectDirs) {
		if (path === dir) return ".";
		if (path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
	}
	const home = homedir();
	if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	return path.startsWith("/") ? basename(path) : path;
}

function toolLabel(name: string, args: any, projectDirs: readonly string[]): string {
	let label = name;
	if (name === "bash" && typeof args?.command === "string") {
		const parts: string[] = (args.command.match(/(?:'[^']*'|"[^"]*"|(?<!&)&(?!&)|[^'"|;&\n])+/g) ?? []).map((part: string) => part.trim().replace(/^(\w+=\S*\s+)+/, ""));
		const first = parts.find((part) => part && !/^(cd\s|\w+=\S*$)/.test(part)) ?? "";
		label = first.replace(/(?<![\w.~$>:/])\/(?!dev\/)[\w.@+-]+(?:\/[\w.@+-]*)*/g, (path) => shortPath(path, projectDirs));
	} else {
		const path = typeof args?.path === "string" ? shortPath(args.path, projectDirs) : ".";
		const target = path === "." ? args?.pattern : path;
		if (typeof target === "string") label = `${name} ${target}`;
	}
	// One row: a newline or tab in a command or pattern would make the widget taller.
	return label.replace(/[\s\x00-\x1f\x7f]+/g, " ").trim() || name;
}

// One per question, in helper.md's order.
const ANSWERING = ["Working out what a pro would do", "Finding the rawest material", "Picking the methods and tools", "Deciding what would prove it right"];

// Loader's timer, which pulses the meter's current cell, also repaints the clock.
export class HelperProgress extends Loader {
	private readonly theme: Theme;
	private readonly projectDirs: readonly string[];
	private readonly startedAt: number;
	private readonly tools: { id: string; label: string; state: "running" | "ok" | "failed" }[] = [];
	private reply = "";

	constructor(tui: TUI, theme: Theme, projectDirs: readonly string[], startedAt: number) {
		super(tui, (cell) => cell, (message) => message, "", { frames: ["▰", "▱"], intervalMs: 400 });
		this.theme = theme;
		this.projectDirs = projectDirs;
		this.startedAt = startedAt;
	}

	apply(event: HelperEvent): void {
		if (event.type === "tool_execution_start") {
			this.tools.push({ id: event.toolCallId, label: toolLabel(event.toolName, event.args, this.projectDirs), state: "running" });
		} else if (event.type === "tool_execution_end") {
			const tool = this.tools.find((candidate) => candidate.id === event.toolCallId);
			if (tool) tool.state = event.isError ? "failed" : "ok";
		} else if (event.type === "message_start" && event.message.role === "assistant") {
			this.reply = "";
		} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			this.reply += event.assistantMessageEvent.delta;
		}
	}

	override render(width: number): string[] {
		const { theme } = this;
		const { answered, writingPrompt } = replyProgress(this.reply);
		const stage = writingPrompt ? 5 : answered;
		const cells = [0, 1, 2, 3, 4, 5].map((i) => (i < stage ? theme.fg("accent", "▰") : i === stage ? theme.fg("accent", this.getRenderedIndicator()) : theme.fg("dim", "▱")));
		const meter = ` ${cells.join("")}  `;
		const [full, short] =
			writingPrompt ? [theme.fg("accent", "Writing your improved prompt"), theme.fg("accent", "Writing prompt")]
			: answered ? [theme.fg("accent", ANSWERING[answered - 1]) + theme.fg("muted", ` (${answered} of 4)`), theme.fg("accent", "Thinking")]
			: [theme.fg("accent", "Reading your code and files"), theme.fg("accent", "Reading files")];
		const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
		const clock = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
		// Fixed width, so the clock and the cancel hint never shift.
		const right = `${theme.fg("muted", clock.padStart(7))}${theme.fg("dim", " · /better-cancel")} `;
		const room = width - visibleWidth(right) - 1;
		const left = visibleWidth(meter + full) <= room ? meter + full : truncateToWidth(meter + short, room, "…");
		const top = left + " ".repeat(Math.max(1, room + 1 - visibleWidth(left))) + right;

		const failed = this.tools.filter((tool) => tool.state === "failed").length;
		const count = `${this.tools.length} tool${this.tools.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;
		const chip = ({ label, state }: (typeof this.tools)[number]) => {
			const text = truncateToWidth(label, 28, "…");
			if (state === "running") return `${theme.fg("muted", "•")} ${text}`;
			return `${state === "ok" ? theme.fg("success", "✓") : theme.fg("error", "✗")} ${theme.fg("muted", text)}`;
		};
		let bottom = `   ${theme.fg("dim", "no tools yet")}`;
		if (this.tools.length) {
			const space = width - 3 - count.length - 3;
			const shown: string[] = [];
			for (let i = this.tools.length - 1; i >= 0; i--) {
				const next = chip(this.tools[i]);
				if (visibleWidth([next, ...shown].join("  ")) > space) break;
				shown.unshift(next);
			}
			const trail = shown.length ? shown.join("  ") : truncateToWidth(chip(this.tools.at(-1)!), Math.max(space, 0), "…");
			bottom = `   ${trail}${" ".repeat(Math.max(1, space + 2 - visibleWidth(trail)))}${theme.fg("dim", count)} `;
		}
		return [truncateToWidth(top, width, "…"), truncateToWidth(bottom, width, "…")];
	}

	dispose(): void {
		this.stop();
	}
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
	if (!ctx.hasUI) throw new Error(message, { cause: error });
	ctx.ui.notify(message, "error");
}

// Print and JSON mode have no editor, and RPC's getEditorText is always empty, so a draft there would be lost.
function handOver(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string, posted = prompt): void {
	if (ctx.mode !== "tui") {
		pi.sendMessage({ customType: "better", content: posted, display: true });
		return;
	}
	const draft = ctx.ui.getEditorText().trim();
	ctx.ui.setEditorText(draft ? `${prompt}\n\n${draft}` : prompt);
	// setEditorText doesn't repaint on its own; the notice does, so the prompt shows right away.
	ctx.ui.notify(`The improved prompt is in your input box${draft ? ", above the draft you'd typed" : ""}. Edit it, then press Enter to send.`, "info");
}

export default function (pi: ExtensionAPI) {
	const helper = () => readFileSync(new URL("./helper.md", import.meta.url), "utf8");
	let helperRun: AbortController | undefined;
	let boomerangRunning = false;

	if (process.env[HELPER_ENV]) pi.on("tool_call", (event) => helperToolBlock(event.toolName, pi.getActiveTools()));

	pi.on("session_shutdown", (_event, ctx) => {
		if (!helperRun) return;
		// After this the old ctx is stale, so the cancelled run must not touch it (see the SHUTDOWN checks).
		helperRun.abort(SHUTDOWN);
		ctx.ui.setWidget(WIDGET, undefined);
	});

	pi.registerCommand("better", {
		description: "Deepen a prompt (or the current task) with a read-only helper in the background, then put the improved prompt in your input box",
		getArgumentCompletions: promptCompletions,
		handler: async (args, ctx) => {
			const prompt = args.trim();
			// A fork needs the session file, which Pi writes only once the conversation has history.
			const sessionFile = ctx.sessionManager.getSessionFile();
			const fork = sessionFile !== undefined && existsSync(sessionFile) ? sessionFile : undefined;
			if (!prompt && !fork) {
				ctx.ui.notify("/better has no task to deepen yet; give it a prompt: /better <prompt>", "error");
				return;
			}
			if (helperRun) {
				ctx.ui.notify("/better is already running; /better-cancel stops it.", "error");
				return;
			}
			let modelArgs: string[];
			try {
				const chatModel = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
				modelArgs = helperModelArgs((pi.getSettings() as { better?: unknown }).better, chatModel, ctx.thinkingLevel);
			} catch (error) {
				return failed(ctx, "better", error);
			}
			// The helper reports the project by its real path (/private/tmp on macOS for /tmp). Resolved before the run
			// is registered, so a deleted working folder fails here instead of leaving /better stuck "already running".
			const projectDirs = [ctx.cwd, realpathSync(ctx.cwd)];
			const run = new AbortController();
			helperRun = run;
			let widget: HelperProgress | undefined;
			if (ctx.mode === "tui") {
				const startedAt = Date.now();
				ctx.ui.setWidget(WIDGET, (tui, theme) => (widget = new HelperProgress(tui, theme, projectDirs, startedAt)));
			}
			const finished = (async () => {
				try {
					const reply = await askHelper(ctx.cwd, fork, modelArgs, buildHelperTask(helper(), prompt), run.signal, (event) => widget?.apply(event));
					let improved: string;
					try {
						improved = parseMarkedPrompt(reply);
					} catch (error) {
						// Keep the reply, so the user can see what the helper said instead of the marked prompt.
						pi.appendEntry("better", { prompt, reply });
						const file = join(tmpdir(), `pi-better-reply-${Date.now()}.md`);
						writeFileSync(file, reply);
						throw new Error(`${(error as Error).message} The helper's whole reply is in ${file}`);
					}
					pi.appendEntry("better", { prompt, improved, reply });
					handOver(pi, ctx, improved, reply);
				} catch (error) {
					if (run.signal.reason === SHUTDOWN) return;
					if (error instanceof Cancelled) ctx.ui.notify("/better cancelled; nothing was sent", "info");
					else failed(ctx, "better", error);
				} finally {
					helperRun = undefined;
					if (run.signal.reason !== SHUTDOWN) ctx.ui.setWidget(WIDGET, undefined);
				}
			})();
			// Print and JSON mode exit once the command returns, so only the TUI and RPC run in the background.
			if (!ctx.hasUI) await finished;
		},
	});

	pi.registerCommand("better-cancel", {
		description: "Stop the /better helper that's running",
		handler: async (_args, ctx) => {
			if (!helperRun) {
				ctx.ui.notify("No /better is running.", "info");
				return;
			}
			helperRun.abort();
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

				// triggerTurn starts the turn right away, so waitForIdle waits for it.
				pi.sendMessage({ customType: "better-boomerang", content: buildHelperTask(helper(), prompt), display: false }, { triggerTurn: true });
				await ctx.waitForIdle();

				const branch = ctx.sessionManager.getBranch();
				const start = branch.findIndex((entry) => entry.id === branchPoint);
				if (start < 0) return failed(ctx, "better-boomerang", new Error("the rewrite's branch point is gone from the session"));
				let improved: string;
				try {
					improved = parseMarkedPrompt(lastAssistantText(branch.slice(start + 1)));
				} catch (error) {
					// The rewrite stays on the branch so the user can see what went wrong.
					return failed(ctx, "better-boomerang", error);
				}

				// The rewrite leaves the active context and stays reachable in /tree.
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

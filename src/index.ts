import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { BoardTheme } from "./board";
import { KanbanBoardComponent, renderListLines } from "./board";
import { buildRejectPrompt, buildTaskPrompt, findDispatchable } from "./consumer";
import type { KanbanMetaEntryData, KanbanTask, KanbanTaskEntryData } from "./state";
import {
	addTask,
	allTasks,
	createEmptyState,
	deleteTask,
	replayMetaEntry,
	replayTaskEntry,
	STATUS_LABEL,
	transitionTask,
} from "./state";

function toBoardTheme(theme: Theme): BoardTheme {
	return {
		fg: (color, text) => theme.fg(color, text),
		bold: (text) => theme.bold(text),
	};
}

export default function (pi: ExtensionAPI) {
	let state = createEmptyState();
	let activeTaskId: string | undefined;
	let board: KanbanBoardComponent | undefined;
	let lastCtx: ExtensionContext | undefined;

	const persistTask = (op: KanbanTaskEntryData["op"], task: KanbanTask) => {
		pi.appendEntry<KanbanTaskEntryData>("kanban-task", { op, task });
	};
	const persistPaused = (paused: boolean) => {
		pi.appendEntry<KanbanMetaEntryData>("kanban-meta", { paused });
	};
	const refreshBoard = () => {
		board?.invalidate();
	};

	function tasksInProgress(): KanbanTask[] {
		return allTasks(state).filter((t) => t.status === "in_progress");
	}

	const replay = (ctx: ExtensionContext) => {
		state = createEmptyState();
		activeTaskId = undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "kanban-task") {
				replayTaskEntry(state, entry.data as KanbanTaskEntryData);
			} else if (entry.customType === "kanban-meta") {
				replayMetaEntry(state, entry.data as KanbanMetaEntryData);
			}
		}
		// 崩溃恢复：残留的进行中任务回退到待完成并持久化
		for (const t of tasksInProgress()) {
			const reverted = transitionTask(state, t.id, "todo", { now: Date.now() });
			if (reverted) persistTask("update", reverted);
		}
	};

	const tryDispatch = () => {
		const ctx = lastCtx;
		if (!ctx || !ctx.isIdle()) return;
		const candidate = findDispatchable(state);
		if (!candidate) return;
		const started = transitionTask(state, candidate.id, "in_progress", { now: Date.now() });
		if (!started) return;
		persistTask("update", started);
		activeTaskId = started.id;
		refreshBoard();
		try {
			pi.sendUserMessage(buildTaskPrompt(started));
		} catch {
			activeTaskId = undefined;
			const reverted = transitionTask(state, started.id, "todo", { now: Date.now() });
			if (reverted) persistTask("update", reverted);
			refreshBoard();
		}
	};

	const approve = (id: string) => {
		const done = transitionTask(state, id, "done", { now: Date.now() });
		if (!done) return;
		persistTask("update", done);
		lastCtx?.ui.notify(`看板: #${id} 已通过`, "info");
		refreshBoard();
		tryDispatch();
	};

	const reject = (id: string, note: string) => {
		const ctx = lastCtx;
		const updated = transitionTask(state, id, "in_progress", { note, now: Date.now() });
		if (!updated) return;
		persistTask("update", updated);
		activeTaskId = id;
		refreshBoard();
		try {
			if (ctx?.isIdle()) {
				pi.sendUserMessage(buildRejectPrompt(updated));
			} else {
				pi.sendUserMessage(buildRejectPrompt(updated), { deliverAs: "followUp" });
			}
		} catch {
			ctx?.ui.notify("看板: 返工消息发送失败，将在下一轮空闲后重试", "warning");
		}
	};

	const addAndMaybeDispatch = (title: string) => {
		const created = addTask(state, title, Date.now());
		persistTask("add", created);
		refreshBoard();
		void tryDispatch();
	};

	const openBoard = async (ctx: ExtensionCommandContext) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("看板需要交互模式（tui）", "error");
			return;
		}
		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			board = new KanbanBoardComponent({
				tui,
				theme: toBoardTheme(theme),
				done,
				getState: () => state,
				getBusy: () => activeTaskId !== undefined,
				callbacks: {
					onAdd: (title) => addAndMaybeDispatch(title),
					onApprove: (id) => approve(id),
					onReject: (id, note) => reject(id, note),
					onDelete: (id) => {
						const snapshot = allTasks(state).find((t) => t.id === id);
						if (snapshot && deleteTask(state, id)) {
							persistTask("delete", snapshot);
							refreshBoard();
						}
					},
					onTogglePause: () => {
						state.paused = !state.paused;
						persistPaused(state.paused);
						refreshBoard();
					},
					onClose: () => {
						board = undefined;
						done();
					},
				},
			});
			return board;
		});
	};

	pi.registerCommand("kanban", {
		description: "看板：打开看板 / add <标题> / pause / resume / list",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const subs = ["add", "pause", "resume", "list"];
			const items = subs.map((s) => ({ value: s, label: s }));
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const trimmed = args.trim();
			const sub = trimmed.split(/\s+/)[0] ?? "";
			const rest = trimmed.slice(sub.length).trim();
			if (sub === "") {
				await openBoard(ctx);
				return;
			}
			if (sub === "add") {
				if (!rest) {
					ctx.ui.notify("用法: /kanban add <标题>", "error");
					return;
				}
				addAndMaybeDispatch(rest);
				return;
			}
			if (sub === "pause") {
				state.paused = true;
				persistPaused(true);
				refreshBoard();
				ctx.ui.notify("看板: 自动消费已暂停", "info");
				return;
			}
			if (sub === "resume") {
				state.paused = false;
				persistPaused(false);
				refreshBoard();
				ctx.ui.notify("看板: 自动消费已恢复", "info");
				void tryDispatch();
				return;
			}
			if (sub === "list") {
				pi.appendEntry<{ tasks: KanbanTask[] }>("kanban-list", { tasks: allTasks(state) });
				return;
			}
			ctx.ui.notify(`未知子命令: ${sub}`, "error");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		replay(ctx);
		refreshBoard();
		void tryDispatch();
	});

	pi.on("session_shutdown", async () => {
		board = undefined;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		lastCtx = ctx;
		if (activeTaskId !== undefined) {
			const finished = activeTaskId;
			activeTaskId = undefined;
			const moved = transitionTask(state, finished, "review", { now: Date.now() });
			if (moved) {
				persistTask("update", moved);
				if (!board && ctx.hasUI) {
					ctx.ui.notify(`看板: #${moved.id} ${moved.title} 待审核`, "info");
				}
			}
			refreshBoard();
		}
		void tryDispatch();
	});

	pi.registerEntryRenderer<KanbanTaskEntryData>("kanban-task", (entry, { expanded }, theme) => {
		const d = entry.data;
		let text: string;
		if (!d || !d.task) {
			text = "看板: (无法解析的任务条目)";
		} else if (d.op === "delete") {
			text = `看板: #${d.task.id} ${d.task.title} 已删除`;
		} else {
			text = `看板: #${d.task.id} ${d.task.title} → ${STATUS_LABEL[d.task.status]}`;
		}
		if (expanded) {
			text += `\n${theme.fg("dim", JSON.stringify(d, null, 2))}`;
		}
		return new Text(theme.fg("dim", text), 0, 0);
	});

	pi.registerEntryRenderer<KanbanMetaEntryData>("kanban-meta", (entry, _opts, theme) => {
		const label = entry.data?.paused ? "自动消费已暂停" : "自动消费已恢复";
		return new Text(theme.fg("dim", `看板: ${label}`), 0, 0);
	});

	pi.registerEntryRenderer<{ tasks: KanbanTask[] }>("kanban-list", (entry, _opts, theme) => {
		const tasks = entry.data?.tasks ?? [];
		const lines = renderListLines(tasks, 120, toBoardTheme(theme));
		return new Text(lines.join("\n"), 0, 0);
	});
}

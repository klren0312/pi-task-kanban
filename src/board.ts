import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { KanbanState, KanbanTask, TaskStatus } from "./state";
import { columnTasks } from "./state";

export const COLUMNS: Array<{ status: TaskStatus; label: string }> = [
	{ status: "todo", label: "待完成" },
	{ status: "in_progress", label: "进行中" },
	{ status: "review", label: "待审核" },
	{ status: "done", label: "已完成" },
];

export type BoardColor =
	| "accent"
	| "dim"
	| "muted"
	| "error"
	| "success"
	| "warning"
	| "text"
	| "borderMuted"
	| "toolTitle";

export interface BoardTheme {
	fg(color: BoardColor, text: string): string;
	bold(text: string): string;
}

export interface BoardSelection {
	column: number;
	cardIndex: number;
}

export type InputMode =
	| { kind: "normal" }
	| { kind: "input"; purpose: "add" | "reject"; buffer: string; taskId?: string };

export interface BoardCallbacks {
	onAdd(title: string): void;
	onApprove(id: string): void;
	onReject(id: string, note: string): void;
	onDelete(id: string): void;
	onTogglePause(): void;
	onClose(): void;
}

function padCell(cell: string, width: number): string {
	return cell + " ".repeat(Math.max(0, width - visibleWidth(cell)));
}

function cardCell(task: KanbanTask, isSelected: boolean, colWidth: number, theme: BoardTheme): string {
	const marker = isSelected ? "▸ " : "  ";
	const body = truncateToWidth(`#${task.id} ${task.title}`, Math.max(4, colWidth - marker.length));
	const text = `${marker}${body}`;
	if (isSelected) return theme.fg("accent", text);
	if (task.status === "done") return theme.fg("dim", text);
	if (task.rejects > 0) return theme.fg("warning", text);
	return theme.fg("text", text);
}

export function renderBoardLines(
	state: KanbanState,
	selection: BoardSelection,
	width: number,
	busy: boolean,
	theme: BoardTheme,
	mode: InputMode = { kind: "normal" },
): string[] {
	const lines: string[] = [];
	const statusText = state.paused ? "已暂停" : busy ? "运行中" : "空闲";
	lines.push(truncateToWidth(` 看板 ─ ${statusText} `, width));

	const colWidth = Math.max(8, Math.floor(width / COLUMNS.length));
	const columns = COLUMNS.map((col) => ({ col, tasks: columnTasks(state, col.status) }));
	const maxRows = Math.max(3, ...columns.map((c) => c.tasks.length));

	let header = "";
	for (const { col, tasks } of columns) {
		const isSelectedCol = COLUMNS[selection.column].status === col.status;
		const label = `${isSelectedCol ? "[" : " "}${col.label} (${tasks.length})${isSelectedCol ? "]" : ""}`;
		header += padCell(isSelectedCol ? theme.fg("accent", label) : theme.fg("muted", label), colWidth);
	}
	lines.push(truncateToWidth(header, width));

	for (let row = 0; row < maxRows; row++) {
		let line = "";
		for (const { col, tasks } of columns) {
			const task = tasks[row];
			const isSelectedCard = col.status === COLUMNS[selection.column].status && row === selection.cardIndex;
			line += padCell(task ? cardCell(task, isSelectedCard, colWidth, theme) : "", colWidth);
		}
		lines.push(truncateToWidth(line, width));
	}

	if (mode.kind === "input") {
		const prompt = mode.purpose === "add" ? "新任务" : `驳回 #${mode.taskId} 意见`;
		lines.push(truncateToWidth(` ${prompt}: ${mode.buffer}▌  (Enter 确认 / Esc 取消)`, width));
	} else {
		lines.push(truncateToWidth(" ←→列 ↑↓卡 a添加 A通过 R驳回 p暂停 d删除 q关闭", width));
	}
	return lines;
}

export function renderListLines(tasks: KanbanTask[], width: number, theme: BoardTheme): string[] {
	if (tasks.length === 0) return ["(空)"];
	const lines: string[] = [];
	for (const col of COLUMNS) {
		const items = tasks.filter((t) => t.status === col.status);
		lines.push(truncateToWidth(theme.fg("accent", `${col.label} (${items.length})`), width));
		for (const t of items) {
			const suffix = t.note ? theme.fg("warning", ` [驳回: ${t.note}]`) : "";
			lines.push(truncateToWidth(`  #${t.id} ${t.title}${suffix}`, width));
		}
	}
	return lines;
}

export interface BoardDeps {
	tui: { requestRender(): void };
	theme: BoardTheme;
	done(): void;
	getState(): KanbanState;
	getBusy(): boolean;
	callbacks: BoardCallbacks;
}

export class KanbanBoardComponent {
	private selection: BoardSelection = { column: 0, cardIndex: 0 };
	private mode: InputMode = { kind: "normal" };
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly deps: BoardDeps;

	constructor(deps: BoardDeps) {
		this.deps = deps;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.deps.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode.kind === "input") {
			this.handleInputKey(data);
			return;
		}

		const cols = COLUMNS.length;
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
			this.deps.callbacks.onClose();
			return;
		}
		if (matchesKey(data, "left") || data === "h") {
			this.selection.column = (this.selection.column + cols - 1) % cols;
			this.selection.cardIndex = 0;
		} else if (matchesKey(data, "right") || data === "l") {
			this.selection.column = (this.selection.column + 1) % cols;
			this.selection.cardIndex = 0;
		} else if (matchesKey(data, "up")) {
			this.selection.cardIndex = Math.max(0, this.selection.cardIndex - 1);
		} else if (matchesKey(data, "down")) {
			const len = this.currentColumnTasks().length;
			this.selection.cardIndex = Math.min(Math.max(0, len - 1), this.selection.cardIndex + 1);
		} else if (data === "a") {
			this.mode = { kind: "input", purpose: "add", buffer: "" };
		} else if (data === "A") {
			const card = this.selectedCardInReviewColumn();
			if (card) this.deps.callbacks.onApprove(card.id);
		} else if (data === "R") {
			const card = this.selectedCardInReviewColumn();
			if (card) this.mode = { kind: "input", purpose: "reject", buffer: "", taskId: card.id };
		} else if (data === "d") {
			const card = this.selectedDeletableCard();
			if (card) this.deps.callbacks.onDelete(card.id);
		} else if (data === "p") {
			this.deps.callbacks.onTogglePause();
		}
		this.deps.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedWidth !== width || !this.cachedLines) {
			this.cachedLines = renderBoardLines(
				this.deps.getState(),
				this.selection,
				width,
				this.deps.getBusy(),
				this.deps.theme,
				this.mode,
			);
			this.cachedWidth = width;
		}
		return this.cachedLines;
	}

	private currentColumnTasks(): KanbanTask[] {
		return columnTasks(this.deps.getState(), COLUMNS[this.selection.column].status);
	}

	private selectedCardInReviewColumn(): KanbanTask | undefined {
		if (COLUMNS[this.selection.column].status !== "review") return undefined;
		return this.currentColumnTasks()[this.selection.cardIndex];
	}

	private selectedDeletableCard(): KanbanTask | undefined {
		const status = COLUMNS[this.selection.column].status;
		if (status !== "todo" && status !== "done") return undefined;
		return this.currentColumnTasks()[this.selection.cardIndex];
	}

	private handleInputKey(data: string): void {
		const mode = this.mode;
		if (mode.kind !== "input") return;
		if (matchesKey(data, "escape")) {
			this.mode = { kind: "normal" };
		} else if (matchesKey(data, "return")) {
			const text = mode.buffer.trim();
			if (mode.purpose === "add") {
				if (text) this.deps.callbacks.onAdd(text);
			} else if (mode.taskId) {
				this.deps.callbacks.onReject(mode.taskId, text || "无具体意见");
			}
			this.mode = { kind: "normal" };
		} else if (matchesKey(data, "backspace") || data === "\x7f" || data === "\b") {
			mode.buffer = mode.buffer.slice(0, -1);
		} else if (data.length === 1 && data >= " ") {
			mode.buffer += data;
		}
		this.deps.tui.requestRender();
	}
}

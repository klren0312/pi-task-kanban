import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderBoardLines, renderListLines, KanbanBoardComponent } from "../src/board";
import type { BoardCallbacks } from "../src/board";
import { addTask, allTasks, createEmptyState, transitionTask } from "../src/state";
import type { KanbanState } from "../src/state";

const stubTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

describe("renderBoardLines", () => {
	it("renders all four column headers with counts", () => {
		const s = createEmptyState();
		addTask(s, "任务一", 1000);
		const lines = renderBoardLines(s, { column: 0, cardIndex: 0 }, 80, false, stubTheme);
		const text = lines.join("\n");
		expect(text).toContain("待完成");
		expect(text).toContain("进行中");
		expect(text).toContain("待审核");
		expect(text).toContain("已完成");
	});

	it("marks selected column and selected card", () => {
		const s = createEmptyState();
		addTask(s, "任务一", 1000);
		addTask(s, "任务二", 2000);
		const lines = renderBoardLines(s, { column: 0, cardIndex: 1 }, 80, false, stubTheme);
		const text = lines.join("\n");
		expect(text).toContain("[待完成 (2)]");
		expect(text).toContain("▸ #2 任务二");
		expect(text).not.toContain("▸ #1");
	});

	it("shows running and paused status in header", () => {
		const s = createEmptyState();
		expect(renderBoardLines(s, { column: 0, cardIndex: 0 }, 80, true, stubTheme)[0]).toContain("运行中");
		s.paused = true;
		expect(renderBoardLines(s, { column: 0, cardIndex: 0 }, 80, false, stubTheme)[0]).toContain("已暂停");
	});

	it("renders reworked card back in todo column", () => {
		const s = createEmptyState();
		const t = addTask(s, "返工任务", 1000);
		transitionTask(s, t.id, "in_progress", { now: 2000 });
		transitionTask(s, t.id, "review", { now: 3000 });
		transitionTask(s, t.id, "todo", { note: "修一下", now: 4000 });
		const lines = renderBoardLines(s, { column: 0, cardIndex: 0 }, 80, false, stubTheme);
		expect(lines.join("\n")).toContain("#1 返工任务");
	});

	it("input mode renders prompt line with buffer", () => {
		const s = createEmptyState();
		const lines = renderBoardLines(
			s,
			{ column: 0, cardIndex: 0 },
			80,
			false,
			stubTheme,
			{ kind: "input", purpose: "add", buffer: "新任务标题" },
		);
		expect(lines.join("\n")).toContain("新任务: 新任务标题");
	});

	it("no rendered line exceeds terminal width", () => {
		const s = createEmptyState();
		addTask(s, "一个特别特别特别特别特别特别长的任务标题".repeat(5), 1000);
		for (const line of renderBoardLines(s, { column: 0, cardIndex: 0 }, 60, false, stubTheme)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(60);
		}
	});
});

describe("renderListLines", () => {
	it("groups tasks by column with notes", () => {
		const s = createEmptyState();
		const a = addTask(s, "被驳回", 1000);
		transitionTask(s, a.id, "in_progress", { now: 2000 });
		transitionTask(s, a.id, "review", { now: 3000 });
		transitionTask(s, a.id, "todo", { note: "改文案", now: 4000 });
		const text = renderListLines(allTasks(s), 120, stubTheme).join("\n");
		expect(text).toContain("待完成 (1)");
		expect(text).toContain("[驳回: 改文案]");
	});

	it("renders placeholder for empty board", () => {
		const lines = renderListLines([], 120, stubTheme);
		expect(lines.join("\n")).toContain("(空)");
	});
});

// ---- KanbanBoardComponent 交互测试 ----

const KEY = {
	esc: "\x1b",
	return: "\r",
	backspace: "\x7f",
	left: "\x1b[D",
	right: "\x1b[C",
	up: "\x1b[A",
	down: "\x1b[B",
};

interface Recorder<T extends unknown[]> {
	fn(...args: T): void;
	calls: T[];
}

function recorder<T extends unknown[]>(): Recorder<T> {
	const calls: T[] = [];
	return {
		fn(...args: T): void {
			calls.push(args);
		},
		calls,
	};
}

function makeBoard(state: KanbanState, busy = false) {
	const callbacks = {
		onAdd: recorder<[string]>(),
		onApprove: recorder<[string]>(),
		onReject: recorder<[string, string]>(),
		onRetry: recorder<[string]>(),
		onDelete: recorder<[string]>(),
		onTogglePause: recorder<[]>(),
		onClose: recorder<[]>(),
	};
	const component = new KanbanBoardComponent({
		tui: { requestRender: () => {} },
		theme: stubTheme,
		done: () => callbacks.onClose.fn(),
		getState: () => state,
		getBusy: () => busy,
		callbacks: {
			onAdd: callbacks.onAdd.fn,
			onApprove: callbacks.onApprove.fn,
			onReject: callbacks.onReject.fn,
			onRetry: callbacks.onRetry.fn,
			onDelete: callbacks.onDelete.fn,
			onTogglePause: callbacks.onTogglePause.fn,
			onClose: callbacks.onClose.fn,
		} satisfies BoardCallbacks,
	});
	return { component, callbacks, view: () => component.render(80).join("\n") };
}

describe("KanbanBoardComponent", () => {
	it("keypresses update subsequent renders without external invalidation", () => {
		// 回归：render 缓存只按宽度失效，按键后若不清缓存，屏幕会一直显示旧内容
		const s = createEmptyState();
		addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		const { component, view } = makeBoard(s);
		component.handleInput(KEY.down);
		expect(view()).toContain("▸ #2 二");
	});

	it("arrow navigation clamps within column bounds", () => {
		const s = createEmptyState();
		addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		const { component, view } = makeBoard(s);
		component.handleInput(KEY.down);
		component.handleInput(KEY.down);
		expect(view()).toContain("▸ #2 二"); // 已在底部，不再下移
		component.handleInput(KEY.up);
		expect(view()).toContain("▸ #1 一");
		component.handleInput(KEY.up);
		expect(view()).toContain("▸ #1 一"); // 已在顶部，不再上移
	});

	it("selection clamps when the selected card leaves the column", () => {
		const s = createEmptyState();
		addTask(s, "一", 1000);
		const r1 = addTask(s, "审一", 2000);
		const r2 = addTask(s, "审二", 3000);
		for (const [t, ts] of [
			[r1, 4000],
			[r2, 6000],
		] as const) {
			transitionTask(s, t.id, "in_progress", { now: ts });
			transitionTask(s, t.id, "review", { now: ts + 1000 });
		}
		const { component, callbacks, view } = makeBoard(s);
		component.handleInput(KEY.right);
		component.handleInput(KEY.right); // 进入待审核列，cardIndex 归零
		component.handleInput(KEY.down); // 选中第二张 #3
		expect(view()).toContain("▸ #3 审二");
		component.handleInput("A");
		expect(callbacks.onApprove.calls).toEqual([[r2.id]]);
		// 模拟审核通过后的状态迁移：#3 离开待审核列
		transitionTask(s, r2.id, "done", { now: 8000 });
		component.invalidate();
		expect(view()).toContain("[待审核 (1)]");
		expect(view()).toContain("▸ #2 审一"); // 索引夹紧到剩余最后一张
	});

	it("add input mode collects text, trims on submit, and escape cancels", () => {
		const s = createEmptyState();
		const { component, callbacks, view } = makeBoard(s);
		component.handleInput("a");
		component.handleInput("修");
		component.handleInput("复");
		expect(view()).toContain("新任务: 修复");
		component.handleInput(KEY.esc);
		expect(view()).not.toContain("新任务:");
		expect(callbacks.onAdd.calls).toEqual([]);
		component.handleInput("a");
		component.handleInput(" ");
		component.handleInput("登");
		component.handleInput(" ");
		component.handleInput(KEY.return);
		expect(callbacks.onAdd.calls).toEqual([["登"]]); // 提交时去除首尾空白
	});

	it("reject flow only starts from review column; empty note falls back", () => {
		const s = createEmptyState();
		addTask(s, "待办", 1000);
		const r = addTask(s, "送审", 2000);
		transitionTask(s, r.id, "in_progress", { now: 3000 });
		transitionTask(s, r.id, "review", { now: 4000 });
		const { component, callbacks, view } = makeBoard(s);
		component.handleInput("R"); // 待完成列按 R：无效果
		expect(callbacks.onReject.calls).toEqual([]);
		expect(view()).not.toContain("驳回 #");
		component.handleInput(KEY.right);
		component.handleInput(KEY.right);
		component.handleInput("R");
		expect(view()).toContain("驳回 #2 意见");
		component.handleInput("缺测试");
		component.handleInput(KEY.return);
		expect(callbacks.onReject.calls).toEqual([[r.id, "缺测试"]]);
		component.handleInput("R");
		component.handleInput(KEY.return); // 空意见直接提交 → 默认文案
		expect(callbacks.onReject.calls).toEqual([
			[r.id, "缺测试"],
			[r.id, "无具体意见"],
		]);
	});

	it("backspace deletes whole code points so surrogate pairs stay intact", () => {
		const s = createEmptyState();
		const { component, callbacks, view } = makeBoard(s);
		component.handleInput("a");
		component.handleInput("👍");
		component.handleInput("好");
		expect(view()).toContain("新任务: 👍好");
		component.handleInput(KEY.backspace); // 删掉“好”
		expect(view()).toContain("新任务: 👍");
		component.handleInput(KEY.backspace); // 整个删掉 👍，不残留半个代理对
		expect(view()).toContain("新任务: ▌");
		component.handleInput(KEY.backspace); // 空缓冲再删无副作用
		component.handleInput(KEY.return);
		expect(callbacks.onAdd.calls).toEqual([]); // 空标题不提交
	});

	it("retry only fires for cards in the in-progress column", () => {
		const s = createEmptyState();
		addTask(s, "待办", 1000);
		const ip = addTask(s, "卡住", 2000);
		transitionTask(s, ip.id, "in_progress", { now: 3000 });
		const { component, callbacks } = makeBoard(s);
		component.handleInput("r"); // 待完成列按 r：无效果
		expect(callbacks.onRetry.calls).toEqual([]);
		component.handleInput(KEY.right); // 进行中列
		component.handleInput("r");
		expect(callbacks.onRetry.calls).toEqual([[ip.id]]);
	});

	it("action keys respect column guards, p toggles pause, q closes", () => {
		const s = createEmptyState();
		addTask(s, "可删", 1000);
		const ip = addTask(s, "进行中", 2000);
		transitionTask(s, ip.id, "in_progress", { now: 3000 });
		const done = addTask(s, "完成", 4000);
		transitionTask(s, done.id, "in_progress", { now: 5000 });
		transitionTask(s, done.id, "review", { now: 6000 });
		transitionTask(s, done.id, "done", { now: 7000 });
		const { component, callbacks } = makeBoard(s);
		component.handleInput("A"); // 待完成列无审核卡
		expect(callbacks.onApprove.calls).toEqual([]);
		component.handleInput("d"); // todo 列可删
		expect(callbacks.onDelete.calls).toEqual([["1"]]);
		component.handleInput(KEY.right); // 进行中列
		component.handleInput("d");
		expect(callbacks.onDelete.calls).toEqual([["1"]]); // 未新增删除
		component.handleInput(KEY.right); // 待审核列
		component.handleInput(KEY.right); // 已完成列
		component.handleInput("d"); // done 列也可删
		expect(callbacks.onDelete.calls).toEqual([["1"], [done.id]]);
		component.handleInput("p");
		expect(callbacks.onTogglePause.calls.length).toBe(1);
		component.handleInput("q");
		expect(callbacks.onClose.calls.length).toBe(1);
	});
});

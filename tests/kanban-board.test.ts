import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderBoardLines, renderListLines } from "../src/board";
import { addTask, allTasks, createEmptyState, transitionTask } from "../src/state";

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

	it("renders reworked card in progress column", () => {
		const s = createEmptyState();
		const t = addTask(s, "返工任务", 1000);
		transitionTask(s, t.id, "in_progress", { now: 2000 });
		transitionTask(s, t.id, "review", { now: 3000 });
		transitionTask(s, t.id, "in_progress", { note: "修一下", now: 4000 });
		const lines = renderBoardLines(s, { column: 1, cardIndex: 0 }, 80, false, stubTheme);
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
		const a = addTask(s, "已审完", 1000);
		transitionTask(s, a.id, "in_progress", { now: 2000 });
		transitionTask(s, a.id, "review", { now: 3000 });
		transitionTask(s, a.id, "in_progress", { note: "改文案", now: 4000 });
		const text = renderListLines(allTasks(s), 120, stubTheme).join("\n");
		expect(text).toContain("进行中 (1)");
		expect(text).toContain("[驳回: 改文案]");
	});

	it("renders placeholder for empty board", () => {
		const lines = renderListLines([], 120, stubTheme);
		expect(lines.join("\n")).toContain("(空)");
	});
});

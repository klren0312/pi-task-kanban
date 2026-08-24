import { describe, expect, it } from "vitest";
import { buildRejectPrompt, buildTaskPrompt, findDispatchable } from "../src/consumer";
import { addTask, columnTasks, createEmptyState, transitionTask } from "../src/state";

describe("findDispatchable", () => {
	it("returns first todo when idle and gate is clear", () => {
		const s = createEmptyState();
		addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		const pick = findDispatchable(s);
		expect(pick?.title).toBe("一");
	});

	it("returns undefined when paused", () => {
		const s = createEmptyState();
		addTask(s, "一", 1000);
		s.paused = true;
		expect(findDispatchable(s)).toBeUndefined();
	});

	it("returns undefined when a task is in progress", () => {
		const s = createEmptyState();
		const a = addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		transitionTask(s, a.id, "in_progress", { now: 3000 });
		expect(findDispatchable(s)).toBeUndefined();
	});

	it("returns undefined when review gate blocks", () => {
		const s = createEmptyState();
		const a = addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		transitionTask(s, a.id, "in_progress", { now: 3000 });
		transitionTask(s, a.id, "review", { now: 4000 });
		expect(findDispatchable(s)).toBeUndefined();
	});

	it("returns undefined when no todo tasks", () => {
		const s = createEmptyState();
		expect(findDispatchable(s)).toBeUndefined();
	});
});

describe("prompts", () => {
	it("task prompt contains id and title", () => {
		const s = createEmptyState();
		const t = addTask(s, "修复登录", 1000);
		const text = buildTaskPrompt(t);
		expect(text).toContain("[看板任务 #1]");
		expect(text).toContain("修复登录");
		// 固定发车指令行全文，防止提示词被意外改动
		const [, instruction] = text.split("\n");
		expect(instruction).toBe(
			"请完整实现该任务，包括必要的测试。完成后直接结束本轮，系统会自动将任务转入「待审核」。",
		);
	});

	it("reject prompt contains note fallback when empty", () => {
		const s = createEmptyState();
		const t = addTask(s, "修复登录", 1000);
		t.note = "边界情况没覆盖";
		expect(buildRejectPrompt(t)).toContain("边界情况没覆盖");
		delete t.note;
		expect(buildRejectPrompt(t)).toContain("请检查实现是否完整");
	});
});

it("full pipeline keeps serial order across rework", () => {
	const s = createEmptyState();
	const a = addTask(s, "一", 1000);
	const b = addTask(s, "二", 2000);
	transitionTask(s, a.id, "in_progress", { now: 3000 });
	transitionTask(s, a.id, "review", { now: 4000 });
	transitionTask(s, a.id, "in_progress", { note: "返工", now: 5000 });
	transitionTask(s, a.id, "review", { now: 6000 });
	transitionTask(s, a.id, "done", { now: 7000 });
	const next = findDispatchable(s);
	expect(next?.id).toBe(b.id);
	expect(columnTasks(s, "done").map((t) => t.id)).toEqual([a.id]);
});

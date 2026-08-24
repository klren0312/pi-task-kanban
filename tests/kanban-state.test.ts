import { describe, expect, it } from "vitest";
import {
	addTask,
	allTasks,
	columnTasks,
	createEmptyState,
	deleteTask,
	replayMetaEntry,
	replayTaskEntry,
	transitionTask,
} from "../src/state";

describe("kanban state", () => {
	it("createEmptyState returns four empty columns and not paused", () => {
		const s = createEmptyState();
		expect(allTasks(s)).toEqual([]);
		expect(s.paused).toBe(false);
	});

	it("addTask assigns sequential ids in insertion order", () => {
		const s = createEmptyState();
		const a = addTask(s, "任务A", 1000);
		const b = addTask(s, "任务B", 2000);
		expect(a.id).toBe("1");
		expect(b.id).toBe("2");
		expect(a.status).toBe("todo");
		expect(a.rejects).toBe(0);
		expect(columnTasks(s, "todo").map((t) => t.title)).toEqual(["任务A", "任务B"]);
	});

	it("addTask returns a snapshot independent of later mutation", () => {
		const s = createEmptyState();
		const snap = addTask(s, "任务", 1000);
		transitionTask(s, snap.id, "in_progress", { now: 2000 });
		expect(snap.status).toBe("todo");
	});

	it("allows legal transitions per the table", () => {
		const s = createEmptyState();
		const t = addTask(s, "任务", 1000);
		expect(transitionTask(s, t.id, "in_progress", { now: 2000 })?.status).toBe("in_progress");
		expect(transitionTask(s, t.id, "review", { now: 3000 })?.status).toBe("review");
		expect(transitionTask(s, t.id, "done", { now: 4000 })?.status).toBe("done");
	});

	it("rejects illegal transitions", () => {
		const s = createEmptyState();
		const t = addTask(s, "任务", 1000);
		expect(transitionTask(s, t.id, "review", { now: 2000 })).toBeUndefined();
		expect(transitionTask(s, t.id, "done", { now: 2000 })).toBeUndefined();
		expect(transitionTask(s, "999", "in_progress", { now: 2000 })).toBeUndefined();
	});

	it("reject with note increments rejects and stores note", () => {
		const s = createEmptyState();
		const t = addTask(s, "任务", 1000);
		transitionTask(s, t.id, "in_progress", { now: 2000 });
		transitionTask(s, t.id, "review", { now: 3000 });
		const back = transitionTask(s, t.id, "in_progress", { note: "没写测试", now: 4000 });
		expect(back?.rejects).toBe(1);
		expect(back?.note).toBe("没写测试");
		// 正常领取（无 note）不增加 rejects
		transitionTask(s, t.id, "review", { now: 5000 });
		const again = transitionTask(s, t.id, "in_progress", { now: 6000 });
		expect(again?.rejects).toBe(1);
	});

	it("deleteTask only allows todo and done", () => {
		const s = createEmptyState();
		const a = addTask(s, "可删", 1000);
		const b = addTask(s, "不可删", 2000);
		transitionTask(s, b.id, "in_progress", { now: 3000 });
		expect(deleteTask(s, a.id)).toBe(true);
		expect(deleteTask(s, b.id)).toBe(false);
		expect(deleteTask(s, "999")).toBe(false);
		expect(columnTasks(s, "todo")).toEqual([]);
	});

	it("replayTaskEntry folds add/update/delete in order", () => {
		const s = createEmptyState();
		replayTaskEntry(s, {
			op: "add",
			task: { id: "1", title: "任务", status: "todo", rejects: 0, createdAt: 1000, updatedAt: 1000 },
		});
		replayTaskEntry(s, {
			op: "update",
			task: { id: "1", title: "任务", status: "review", rejects: 0, createdAt: 1000, updatedAt: 2000 },
		});
		replayTaskEntry(s, {
			op: "add",
			task: { id: "2", title: "任务2", status: "todo", rejects: 0, createdAt: 3000, updatedAt: 3000 },
		});
		expect(allTasks(s).map((t) => t.id)).toEqual(["1", "2"]);
		expect(columnTasks(s, "review").map((t) => t.id)).toEqual(["1"]);
		replayTaskEntry(s, {
			op: "delete",
			task: { id: "2", title: "任务2", status: "todo", rejects: 0, createdAt: 3000, updatedAt: 3000 },
		});
		expect(allTasks(s).map((t) => t.id)).toEqual(["1"]);
	});

	it("replayMetaEntry restores paused flag", () => {
		const s = createEmptyState();
		replayMetaEntry(s, { paused: true });
		expect(s.paused).toBe(true);
		replayMetaEntry(s, { paused: false });
		expect(s.paused).toBe(false);
	});
});

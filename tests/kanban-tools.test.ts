import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KanbanTask } from "../src/state";
import { createAddTaskTool } from "../src/tools";

// 工具桩参数：execute/renderCall 的 signal、onUpdate、ctx、context 在被测逻辑中不会用到
const UNUSED = undefined as never;

const fakeTask = (id: string, title: string): KanbanTask => ({
	id,
	title,
	status: "todo",
	rejects: 0,
	createdAt: 1000,
	updatedAt: 1000,
});

// 测试桩：工具渲染只用到 fg/bold，其余 Theme 成员不会被触达
const stubTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

function makeTool(captured: { titles: string[] }) {
	return createAddTaskTool({
		addTask: (title) => {
			captured.titles.push(title);
			return fakeTask("7", title);
		},
	});
}

describe("createAddTaskTool", () => {
	it("registers under name add_task with a title parameter schema", () => {
		const tool = makeTool({ titles: [] });
		expect(tool.name).toBe("add_task");
		expect(tool.label).toBe("Add Task");
		expect(tool.description.length).toBeGreaterThan(0);
		expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
	});

	it("passes trimmed title to addTask and reports the task id", async () => {
		const captured: { titles: string[] } = { titles: [] };
		const tool = makeTool(captured);
		const result = await tool.execute!("t1", { title: "  写登录测试  " }, UNUSED, UNUSED, UNUSED);
		expect(captured.titles).toEqual(["写登录测试"]);
		const text = result.content[0];
		expect(text.type).toBe("text");
		expect((text as { type: "text"; text: string }).text).toContain("#7");
		expect((text as { type: "text"; text: string }).text).toContain("写登录测试");
		expect(result.details).toEqual({ taskId: "7" });
	});

	it("rejects whitespace-only titles without calling addTask", async () => {
		const captured: { titles: string[] } = { titles: [] };
		const tool = makeTool(captured);
		await expect(tool.execute!("t2", { title: "   " }, UNUSED, UNUSED, UNUSED)).rejects.toThrow();
		expect(captured.titles).toEqual([]);
	});

	it("renderCall shows tool name and raw title argument", () => {
		const tool = makeTool({ titles: [] });
		const comp = tool.renderCall?.({ title: "修复bug" }, stubTheme, UNUSED);
		const lines = comp!.render(120).join("");
		expect(lines).toContain("add_task");
		expect(lines).toContain("修复bug");
	});
});

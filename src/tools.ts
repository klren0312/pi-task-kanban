import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { KanbanTask } from "./state";

const AddTaskParams = Type.Object({
	title: Type.String({ description: "任务标题（一句话描述要做什么）" }),
});

export interface AddTaskToolDeps {
	addTask(title: string): KanbanTask;
}

const ADD_TASK_GUIDELINE =
	"当用户一次交给多项工作、或你计划分多步完成一件事时，用 add_task 把每项/每步作为独立任务加入看板待完成队列，而不是在同一轮里直接全部做完。入队后结束本轮，看板会自动逐个领取执行。";

export function createAddTaskTool(deps: AddTaskToolDeps): ToolDefinition<typeof AddTaskParams> {
	return {
		name: "add_task",
		label: "Add Task",
		description: "将一个任务加入看板「待完成」列，由看板流水线自动串行执行",
		promptSnippet: "将任务加入看板待完成队列，由流水线串行执行",
		promptGuidelines: [ADD_TASK_GUIDELINE],
		parameters: AddTaskParams,
		async execute(_toolCallId, params) {
			const title = params.title.trim();
			if (!title) {
				throw new Error("add_task: title 不能为空");
			}
			const created = deps.addTask(title);
			return {
				content: [{ type: "text", text: `已加入看板待完成列：#${created.id} ${created.title}` }],
				details: { taskId: created.id },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("add_task ")) + theme.fg("muted", args.title), 0, 0);
		},
	};
}

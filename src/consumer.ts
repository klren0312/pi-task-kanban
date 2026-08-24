import type { KanbanState, KanbanTask } from "./state";
import { columnTasks } from "./state";

// 发车条件：未暂停 && 无进行中 && 无待审核（人工审核是闸门），取队首待完成。
export function findDispatchable(state: KanbanState): KanbanTask | undefined {
	if (state.paused) return undefined;
	if (columnTasks(state, "in_progress").length > 0) return undefined;
	if (columnTasks(state, "review").length > 0) return undefined;
	return columnTasks(state, "todo")[0];
}

export function buildTaskPrompt(task: KanbanTask): string {
	return [
		`[看板任务 #${task.id}] ${task.title}`,
		"请完整实现该任务，包括必要的测试。完成后直接结束本轮，系统会自动将任务转入「待审核」。",
	].join("\n");
}

export function buildRejectPrompt(task: KanbanTask): string {
	const note = task.note ?? "无具体意见，请检查实现是否完整";
	return [
		`[看板返工 #${task.id}] ${task.title}`,
		`驳回意见：${note}`,
		"请根据驳回意见修复问题。完成后直接结束本轮，系统会自动将任务重新转入「待审核」。",
	].join("\n");
}

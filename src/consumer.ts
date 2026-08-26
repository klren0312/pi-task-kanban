import type { KanbanState, KanbanTask } from "./state";
import { columnTasks } from "./state";

// 发车条件：未暂停 && 无进行中（pi 单会话，同一时刻至多跑一个），待审核不阻塞发车。
// 待完成列内返工任务（rejects>0）优先于普通任务，同组按入队顺序。
// 注意：优先级必须是纯判定，不得移动 state.order——顺序不在任务快照里，移动会破坏重放一致性。
export function findDispatchable(state: KanbanState): KanbanTask | undefined {
	if (state.paused) return undefined;
	if (columnTasks(state, "in_progress").length > 0) return undefined;
	const todos = columnTasks(state, "todo");
	return todos.find((t) => t.rejects > 0) ?? todos[0];
}

// agent_settled 事件不携带结果载荷，需据最后一轮 assistant 消息的 stopReason 判定去向：
// error/aborted 视为本轮失败，任务留在进行中等待人工重试；其余照常转待审核。
export function resolveSettledTarget(stopReason: string | undefined): "review" | undefined {
	if (stopReason === "error" || stopReason === "aborted") return undefined;
	return "review";
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

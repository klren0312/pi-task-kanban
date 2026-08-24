export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface KanbanTask {
	id: string;
	title: string;
	status: TaskStatus;
	note?: string;
	rejects: number;
	createdAt: number;
	updatedAt: number;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
	todo: "待完成",
	in_progress: "进行中",
	review: "待审核",
	done: "已完成",
};

// todo → in_progress：自动消费；in_progress → review：一轮结束；
// review → done/in_progress：审核通过/驳回；in_progress → todo：崩溃恢复回退。
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	todo: ["in_progress"],
	in_progress: ["review", "todo"],
	review: ["done", "in_progress"],
	done: [],
};

export interface KanbanState {
	tasks: Map<string, KanbanTask>;
	order: string[];
	paused: boolean;
}

export function createEmptyState(): KanbanState {
	return { tasks: new Map(), order: [], paused: false };
}

function nextTaskId(state: KanbanState): string {
	let max = 0;
	for (const id of state.tasks.keys()) {
		const n = Number.parseInt(id, 10);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return String(max + 1);
}

export function addTask(state: KanbanState, title: string, now: number): KanbanTask {
	const task: KanbanTask = {
		id: nextTaskId(state),
		title,
		status: "todo",
		rejects: 0,
		createdAt: now,
		updatedAt: now,
	};
	state.tasks.set(task.id, task);
	state.order.push(task.id);
	return { ...task };
}

export function transitionTask(
	state: KanbanState,
	id: string,
	to: TaskStatus,
	options: { note?: string; now: number },
): KanbanTask | undefined {
	const task = state.tasks.get(id);
	if (!task) return undefined;
	if (!ALLOWED_TRANSITIONS[task.status].includes(to)) return undefined;
	task.status = to;
	if (to === "in_progress" && options.note !== undefined) {
		task.rejects += 1;
		task.note = options.note;
	}
	task.updatedAt = options.now;
	return { ...task };
}

export function deleteTask(state: KanbanState, id: string): boolean {
	const task = state.tasks.get(id);
	if (!task) return false;
	if (task.status !== "todo" && task.status !== "done") return false;
	state.tasks.delete(id);
	state.order = state.order.filter((x) => x !== id);
	return true;
}

export interface KanbanTaskEntryData {
	op: "add" | "update" | "delete";
	task: KanbanTask;
}

export interface KanbanMetaEntryData {
	paused: boolean;
}

export function replayTaskEntry(state: KanbanState, data: KanbanTaskEntryData): void {
	if (data.op === "delete") {
		state.tasks.delete(data.task.id);
		state.order = state.order.filter((x) => x !== data.task.id);
		return;
	}
	if (!state.tasks.has(data.task.id)) state.order.push(data.task.id);
	state.tasks.set(data.task.id, { ...data.task });
}

export function replayMetaEntry(state: KanbanState, data: KanbanMetaEntryData): void {
	state.paused = data.paused === true;
}

export function columnTasks(state: KanbanState, status: TaskStatus): KanbanTask[] {
	return state.order
		.map((id) => state.tasks.get(id))
		.filter((t): t is KanbanTask => t !== undefined && t.status === status);
}

export function allTasks(state: KanbanState): KanbanTask[] {
	return state.order
		.map((id) => state.tasks.get(id))
		.filter((t): t is KanbanTask => t !== undefined)
		.map((t) => ({ ...t }));
}

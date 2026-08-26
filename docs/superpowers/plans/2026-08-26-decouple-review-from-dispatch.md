# 审核与发车解勾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除「待审核阻塞发车」闸门：任务完成即发车下一个，待审核列可累积；驳回任务回待完成队列并享返工优先。

**Architecture:** 三处改动——state.ts 流转白名单加 review→todo 边并调整驳回记账条件；consumer.ts 的 findDispatchable 删闸门并以纯判定实现返工优先（不动 order 数组，保证重放一致）；index.ts 胶水简化 reject 为流转+tryDispatch。规格见 `docs/superpowers/specs/2026-08-26-decouple-review-from-dispatch-design.md`。

**Tech Stack:** TypeScript（erasable only）、vitest、无运行时依赖。

## Global Constraints

- Tab 缩进；erasable TypeScript only（禁 enum / namespace / 参数属性，tsconfig 已强制）
- UI 文案中文，代码标识符英文
- 每个任务完成后 `npm run check`（tsc --noEmit + 全量 vitest）必须全绿
- 提交信息前缀 `feat:` / `fix:` / `docs:`；git add 显式列出所改文件
- 测试放 `tests/`，相对路径导入 `../src/*`；board 组件与 index.ts 胶水不做自动化测试
- 事件溯源不变量：每个任务变更必须同时更新内存态（经 state.ts 函数）并 persistTask 追加条目；本计划不改条目格式
- 单测命令模板：`npx vitest run tests/<file>.test.ts`

---

### Task 1: state.ts —— 新增 review→todo 流转边与驳回记账调整

**Files:**
- Modify: `src/state.ts:20-27`（注释与 ALLOWED_TRANSITIONS）、`src/state.ts:72`（记账条件）
- Test: `tests/kanban-state.test.ts:54-66`（重写驳回记账测试）、追加新测试

**Interfaces:**
- Consumes: 现有 `transitionTask(state, id, to, options: { note?: string; now: number })` 签名不变。
- Produces: `ALLOWED_TRANSITIONS.review === ["done", "todo"]`；带 note 的任意合法流转执行 `rejects += 1` 并写入 `task.note`。后续 Task 2、3 依赖 review→todo 合法。

- [ ] **Step 1: 重写失败测试**

替换 `tests/kanban-state.test.ts` 中现有的 `it("reject with note increments rejects and stores note", ...)` 整个测试块为：

```ts
	it("reject back to todo increments rejects and stores note", () => {
		const s = createEmptyState();
		const t = addTask(s, "任务", 1000);
		transitionTask(s, t.id, "in_progress", { now: 2000 });
		transitionTask(s, t.id, "review", { now: 3000 });
		const back = transitionTask(s, t.id, "todo", { note: "没写测试", now: 4000 });
		expect(back?.status).toBe("todo");
		expect(back?.rejects).toBe(1);
		expect(back?.note).toBe("没写测试");
		// 正常领取（无 note）不增加 rejects
		const again = transitionTask(s, t.id, "in_progress", { now: 5000 });
		expect(again?.rejects).toBe(1);
	});

	it("review can only go to done, not back to in_progress", () => {
		const s = createEmptyState();
		const t = addTask(s, "任务", 1000);
		transitionTask(s, t.id, "in_progress", { now: 2000 });
		transitionTask(s, t.id, "review", { now: 3000 });
		expect(transitionTask(s, t.id, "in_progress", { now: 4000 })).toBeUndefined();
		expect(transitionTask(s, t.id, "done", { now: 4000 })).toBeDefined();
	});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/kanban-state.test.ts`
Expected: FAIL —— `reject back to todo increments rejects and stores note` 中 `back` 为 undefined（当前 review→todo 非法）；`review can only go to done, not back to in_progress` 第一条断言失败（当前 review→in_progress 仍合法）。

- [ ] **Step 3: 最小实现**

`src/state.ts` 第 20-21 行注释与白名单改为：

```ts
// todo → in_progress：自动消费；in_progress → review：一轮结束；
// review → done/todo：审核通过/驳回归队（返工优先级见 consumer.findDispatchable）；
// in_progress → todo：崩溃恢复回退。
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	todo: ["in_progress"],
	in_progress: ["review", "todo"],
	review: ["done", "todo"],
	done: [],
};
```

第 72 行记账条件从：

```ts
	if (to === "in_progress" && options.note !== undefined) {
```

改为：

```ts
	if (options.note !== undefined) {
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/kanban-state.test.ts`
Expected: PASS 全部用例

- [ ] **Step 5: 全量检查**

Run: `npm run check`
Expected: tsc 无错误，全部测试通过（此时 index.ts 旧 reject 走 review→in_progress 会静默无效，属预期中间态，Task 3 修复）

- [ ] **Step 6: 提交**

```bash
git add src/state.ts tests/kanban-state.test.ts
git commit -m "feat: rejected tasks return to todo queue"
```

---

### Task 2: consumer.ts —— 删审核闸门与返工优先选序

**Files:**
- Modify: `src/consumer.ts:4-10`
- Test: `tests/kanban-consumer.test.ts:34-41`（替换闸门测试）、`:90-102`（重写全链路测试）、文件末尾 describe 块内追加返工优先测试

**Interfaces:**
- Consumes: Task 1 的 review→todo 合法流转与 rejects 记账。
- Produces: `findDispatchable(state): KanbanTask | undefined` —— 条件为「未暂停 && 无进行中」，待完成列内 `rejects > 0` 者按入队顺序优先于普通任务。Task 3 的 tryDispatch 直接复用，无需改动调用方式。

- [ ] **Step 1: 更新失败测试**

替换 `tests/kanban-consumer.test.ts` 中 `it("returns undefined when review gate blocks", ...)` 为：

```ts
	it("dispatches next todo while another task awaits review", () => {
		const s = createEmptyState();
		const a = addTask(s, "一", 1000);
		addTask(s, "二", 2000);
		transitionTask(s, a.id, "in_progress", { now: 3000 });
		transitionTask(s, a.id, "review", { now: 4000 });
		expect(findDispatchable(s)?.title).toBe("二");
	});
```

替换文件末尾 `it("full pipeline keeps serial order across rework", ...)` 为：

```ts
it("full pipeline keeps serial order across rework", () => {
	const s = createEmptyState();
	const a = addTask(s, "一", 1000);
	const b = addTask(s, "二", 2000);
	transitionTask(s, a.id, "in_progress", { now: 3000 });
	transitionTask(s, a.id, "review", { now: 4000 });
	transitionTask(s, a.id, "todo", { note: "返工", now: 5000 });
	transitionTask(s, a.id, "in_progress", { now: 6000 });
	transitionTask(s, a.id, "review", { now: 7000 });
	transitionTask(s, a.id, "done", { now: 8000 });
	const next = findDispatchable(s);
	expect(next?.id).toBe(b.id);
	expect(columnTasks(s, "done").map((t) => t.id)).toEqual([a.id]);
});
```

在 `describe("findDispatchable", ...)` 块末尾（`returns undefined when no todo tasks` 之后）追加两个测试：

```ts
	it("prefers reworked todo over plain queue head", () => {
		const s = createEmptyState();
		addTask(s, "一", 1000);
		const b = addTask(s, "二", 2000);
		addTask(s, "三", 2500);
		transitionTask(s, b.id, "in_progress", { now: 3000 });
		transitionTask(s, b.id, "review", { now: 4000 });
		transitionTask(s, b.id, "todo", { note: "返工", now: 5000 });
		expect(findDispatchable(s)?.id).toBe(b.id);
	});

	it("picks the earliest rework when several exist", () => {
		const s = createEmptyState();
		const a = addTask(s, "一", 1000);
		const b = addTask(s, "二", 2000);
		for (const t of [a, b]) {
			transitionTask(s, t.id, "in_progress", { now: 3000 });
			transitionTask(s, t.id, "review", { now: 4000 });
			transitionTask(s, t.id, "todo", { note: "返工", now: 5000 });
		}
		expect(findDispatchable(s)?.id).toBe(a.id);
	});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/kanban-consumer.test.ts`
Expected: FAIL —— `dispatches next todo while another task awaits review` 得到 undefined（旧闸门拦截）；两个返工优先测试得到队首普通任务而非返工任务。

- [ ] **Step 3: 最小实现**

`src/consumer.ts` 第 4-10 行改为：

```ts
// 发车条件：未暂停 && 无进行中（pi 单会话，同一时刻至多跑一个），待审核不阻塞发车。
// 待完成列内返工任务（rejects>0）优先于普通任务，同组按入队顺序。
// 注意：优先级必须是纯判定，不得移动 state.order——顺序不在任务快照里，移动会破坏重放一致性。
export function findDispatchable(state: KanbanState): KanbanTask | undefined {
	if (state.paused) return undefined;
	if (columnTasks(state, "in_progress").length > 0) return undefined;
	const todos = columnTasks(state, "todo");
	return todos.find((t) => t.rejects > 0) ?? todos[0];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/kanban-consumer.test.ts`
Expected: PASS 全部用例

- [ ] **Step 5: 全量检查**

Run: `npm run check`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add src/consumer.ts tests/kanban-consumer.test.ts
git commit -m "feat: dispatch ignores pending reviews"
```

---

### Task 3: index.ts 胶水 —— reject 回队首与发车提示词选择

**Files:**
- Modify: `src/index.ts:87-106`（tryDispatch 提示词选择）、`src/index.ts:117-137`（reject 重写）

**Interfaces:**
- Consumes: Task 1 的 review→todo；Task 2 的 findDispatchable 返工优先；现有 `buildRejectPrompt(task)` / `buildTaskPrompt(task)`（均已在 import 列表）。
- Produces: `reject(id, note)` 行为——流转 review→todo（带 note）→ persistTask("update") → notify → tryDispatch()。不再操作 activeTaskId、不直接 sendUserMessage。

- [ ] **Step 1: 重写 reject 函数**

`src/index.ts` 中整个 `const reject = (id: string, note: string) => {...}` 替换为：

```ts
	const reject = (id: string, note: string) => {
		// 审核解勾：驳回回待完成队列，返工统一走消费循环，不直接注入消息
		const queued = transitionTask(state, id, "todo", { note, now: Date.now() });
		if (!queued) return;
		persistTask("update", queued);
		lastCtx?.ui.notify(`看板: #${id} 已驳回，回到待完成（返工优先）`, "info");
		refreshBoard();
		tryDispatch();
	};
```

- [ ] **Step 2: tryDispatch 按返工标记选提示词**

`tryDispatch` 内的发送语句从：

```ts
			pi.sendUserMessage(buildTaskPrompt(started));
```

改为：

```ts
			pi.sendUserMessage(started.rejects > 0 ? buildRejectPrompt(started) : buildTaskPrompt(started));
```

- [ ] **Step 3: 全量检查**

Run: `npm run check`
Expected: 全绿

- [ ] **Step 4: 终端手测清单（真实 pi 会话）**

1. `/kanban` 打开看板，`add` 两个任务 A、B → A 自动进进行中。
2. 等 A 一轮结束转待审核 → 观察 B **立即**自动进进行中（旧行为是等待审核）。
3. 审核期间 B 在跑，选中 A 按驳回并填意见 → A 出现在待完成列且通知「返工优先」；B 不受影响。
4. B 结束后 → A 被自动重新发车，提示词含 `[看板返工]` 与驳回意见。
5. 重启 pi 会话 → 看板状态复原（A 若在进行中则回退待完成），顺序与驳回标记不丢失。
6. `/kanban pause` 后加任务 → 不发车；`resume` → 恢复发车。

- [ ] **Step 5: 提交**

```bash
git add src/index.ts
git commit -m "feat: route rework through dispatch loop"
```

---

### Task 4: 文档同步 —— AGENTS.md 不变量与 pi 主仓库设计文档

**Files:**
- Modify: `AGENTS.md`（不变量 2 段落）
- Create: `D:\1project\pi\docs\superpowers\specs\2026-08-24-kanban-extension-design.md`（AGENTS.md 引用的跨仓库文档此前不存在，按引用路径创建）

**Interfaces:**
- Consumes: Task 1-3 落地后的最终状态机与发车规则。
- Produces: 无代码接口；仅文档。

- [ ] **Step 1: 更新本仓库 AGENTS.md 不变量 2**

将：

```
2. **串行流水线**：同一时刻至多一个进行中任务；「待审核」列非空时禁止发车。发车判定的唯一入口是 findDispatchable。`activeTaskId` 标记的正确性依赖 agent_settled 语义（重试、压缩、followUp 全部结束才触发）。
```

改为：

```
2. **串行流水线**：同一时刻至多一个进行中任务；「待审核」不阻塞发车，人工审核与消费循环解耦。驳回走 review→todo 回队，返工优先由 findDispatchable 纯判定实现（勿移动 order 数组——顺序不在任务快照里）。发车判定的唯一入口是 findDispatchable。`activeTaskId` 标记的正确性依赖 agent_settled 语义（重试、压缩、followUp 全部结束才触发）。
```

- [ ] **Step 2: 创建 pi 主仓库设计文档**

新建 `D:\1project\pi\docs\superpowers\specs\2026-08-24-kanban-extension-design.md`，内容：

```markdown
# pi 看板扩展设计（跨仓库镜像文档）

pi-kanban 扩展的状态机与流水线设计。权威规格在 pi-kanban 仓库
`docs/superpowers/specs/`，本文档按 pi-kanban AGENTS.md 约定同步关键不变量。

## 状态机（2026-08-26 起）

	todo        → in_progress    自动消费领取
	in_progress → review         一轮正常结束（agent_settled 且 stopReason 非 error/aborted）
	in_progress → todo           崩溃恢复回退（session_start 重放后统一处理）
	review      → done           人工审核通过
	review      → todo           人工审核驳回（记 note、rejects+1，返工优先）

## 流水线不变量

- pi 单会话单线程：同一时刻至多一个进行中任务。
- 「待审核」不阻塞发车：任务完成立即发车下一个，待审核列可累积，人工异步审核。
- 驳回任务回待完成队列并享返工优先：findDispatchable 以纯判定选取（rejects>0 者
  按入队顺序优先），不移动 order 数组，保证会话条目重放一致性。
- 发车判定的唯一入口是 pi-kanban src/consumer.ts 的 findDispatchable。
```

- [ ] **Step 3: 双仓库分别提交**

```bash
git add AGENTS.md
git commit -m "docs: update pipeline invariant for decoupled review"
```

然后在 pi 主仓库（workdir `D:\1project\pi`）：

```bash
git add docs/superpowers/specs/2026-08-24-kanban-extension-design.md
git commit -m "docs: add kanban extension design mirror with decoupled review"
```

- [ ] **Step 4: 最终验证**

Run: `npm run check`（workdir `D:\1project\pi-kanban`）
Expected: 全绿

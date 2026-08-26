# 设计：审核与发车解勾（review 不阻塞 dispatch）

日期：2026-08-26
状态：已与用户确认

## 背景与问题

现行流水线把人工审核当作发车闸门：`findDispatchable` 要求「无进行中 && 无待审核」才发车。后果是任务 A 完成转待审核后，pi 空闲干等，直到人工审核 A 才发车 B——审核节奏卡死消费节奏。

用户诉求：审核跟进行不要挂勾。任务完成即发车下一个；待审核列允许累积多个任务，人工异步审核。

约束：pi 是单会话单线程，同一时刻物理上只能跑一个任务。「一起执行」指审核不阻塞发车，不是多 worker 并发。

## 目标行为

1. 任务完成转待审核后，pi 立即发车下一个待完成任务。
2. 待审核列可累积多个任务；通过（review→done）与驳回都不打断当前进行中任务。
3. 驳回的任务回到待完成列并享有返工优先权：pi 下次空闲时优先重新发车它（带驳回意见）。
4. 不变量保持：同一时刻至多一个进行中任务；暂停仍冻结发车。

## 方案选型

- **方案 A（采纳）：最小改动** —— 删闸门 + 新增 review→todo 流转边 + 发车判定内实现返工优先。复用现有快照字段（rejects/note），不加状态、不改事件格式。
- 方案 B（否）：任务加 reworkQueued 显式标记。排序与标记双轨，重放逻辑变复杂，收益不明显。
- 方案 C（否）：驳回先记账不流转，等 agent_settled 再统一流转+发车。多一个隐藏中间态，时序耦合更重。

## 详细设计

### 1. 状态机（src/state.ts）

- `ALLOWED_TRANSITIONS.review`：`["done", "in_progress"]` → **`["done", "todo"]`**。驳回不再直接进进行中，统一回队列排队。
- `transitionTask` 驳回记账条件从「to === "in_progress" 且带 note」改为「**带 note 即记账**」（rejects++、写 note）。目前只有驳回会传 note，语义等价且覆盖新边。
- `KanbanTask` 快照结构不变，`replayTaskEntry` 无需改动（status/rejects/note 本就在全量快照里）。

### 2. 发车逻辑（src/consumer.ts）

`findDispatchable`：

- 删除「待审核非空禁止发车」检查。
- 保留两条检查：paused、存在进行中任务。
- 返工优先作为纯判定：todo 列内若有 rejects > 0 的任务，取 order 最靠前的一个；否则取原队首 todo[0]。

**关键点：不移动 order 数组实现优先级。** order 顺序不在任务快照里，运行时移动会导致重启重放后顺序还原，违反事件溯源一致性。纯判定从快照字段推导，重放天然正确。

### 3. 提示词（src/consumer.ts）

发车处按 `candidate.rejects > 0` 选择提示词：返工用现有 `buildRejectPrompt`（含驳回意见回显），新任务用 `buildTaskPrompt`。文案不改。

### 4. 胶水层（src/index.ts）

- `reject()` 简化：流转 review→todo（带 note）→ persistTask → tryDispatch()。删除 activeTaskId 操作与 sendUserMessage / followUp 注入及其失败回退分支——返工统一走消费循环，「忙碌时 followUp」特殊路径不复存在。
- `approve()`、`agent_settled` 处理、崩溃恢复（in_progress 回退 todo）、`retry`、pause/resume 全部不变。

## 行为示例

A 完成转待审核 → pi 立即发车 B。此时审 A：
- 通过：A→done，不影响 B。
- 驳回（带意见）：A→todo（rejects+1），B 结束后 A 以返工优先位重新发车。

## 测试计划

- tests/state.test.ts：review→todo 允许、review→in_progress 禁止；带 note 流转记账 rejects/note。
- tests/consumer.test.ts：删除「待审核非空不发车」断言改为仍发车；新增返工优先选序断言（含多返工取 order 靠前者、有进行中时不发车）。
- board 组件与 index.ts 胶水按仓库约定不做自动化测试，`npm run check` 全绿 + 终端手测兜底。

## 文档同步

- 本仓库 AGENTS.md 不变量 2 改写（串行流水线描述更新）。
- pi 主仓库设计文档 `docs/superpowers/specs/2026-08-24-kanban-extension-design.md` 同步新增流转边说明（跨仓库路径，AGENTS.md 约定）。

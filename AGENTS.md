# AGENTS.md

pi 的看板扩展（独立插件仓库）。终端四列看板：待完成 → 进行中 → 待审核 → 已完成；pi 空闲时自动串行消费任务，人工审核与消费循环解耦（待审核不阻塞发车）。

## 命令

- `npm run check`：tsc --noEmit + 全量 vitest。每次代码改动后必须全绿才算完成。
- 定向跑单个测试文件：`npx vitest run tests/<file>.test.ts`
- 发版：改 `package.json` 的 `version` 并提交 → `git tag vX.Y.Z && git push origin vX.Y.z`（tag 触发 CI：check 门禁 → OIDC 免 token 发布 npm → 建 GitHub Release）。tag 指向的提交里 version 必须与 tag 一致。

## 架构与不变量

模块分层，依赖单向向下：

- `src/state.ts` 纯状态机：流转校验、增删改、条目重放。零外部依赖。
- `src/consumer.ts` 纯函数：发车闸门判定（findDispatchable）、任务/返工提示词构建。
- `src/board.ts` 看板布局纯函数（renderBoardLines 等）+ KanbanBoardComponent 键盘交互组件。
- `src/tools.ts` LLM 工具定义（add_task），deps 注入便于单测。
- `src/index.ts` 装配胶水：命令、事件监听、持久化、消费循环。

改动前先确认三条不变量：

1. **事件溯源一致性**：每个任务变更必须同时做两件事——经 state.ts 的增删改函数更新内存态，且 `persistTask` 追加一条含全量快照的会话条目。`replayTaskEntry` 必须能从条目流单独复原全部状态：给 KanbanTask 加字段时快照自动携带，但重放逻辑若有分支需同步。
2. **串行流水线**：同一时刻至多一个进行中任务；「待审核」不阻塞发车，人工审核与消费循环解耦。驳回走 review→todo 回队，返工优先由 findDispatchable 纯判定实现（勿移动 order 数组——顺序不在任务快照里）。发车判定的唯一入口是 findDispatchable。`activeTaskId` 标记的正确性依赖 agent_settled 语义（重试、压缩、followUp 全部结束才触发）。
3. **状态流转走白名单**：一切状态变更经 `ALLOWED_TRANSITIONS` 校验。

## 平台陷阱（踩过的坑，勿重蹈）

- pi-tui 的 `truncateToWidth` 截断时会追加 ANSI 省略号序列：判断渲染行是否超宽用 `visibleWidth`，字符串 `.length` 在带 ANSI 时是错的。
- `pi.sendUserMessage`（ExtensionAPI 上）是同步 void 函数，agent 流式运行期间不带 `deliverAs` 调用会直接 throw：发送前用 `ctx.isIdle()` 守卫；忙碌时用 `{ deliverAs: "followUp" }`；发送失败的 catch 里必须把任务回退到合法状态并持久化（参考 reject 的处理）。
- 会话条目重放按 `entry.type === "custom"` 加 customType 过滤，entry.data 需要 `as` 类型断言——这是仓库里唯一允许断言的位置。
- pi 进程中途被杀会残留 in_progress 任务：session_start 重放完成后统一把 in_progress 回退 todo 并持久化（崩溃恢复，见 index.ts replay）。
- `agent_settled` 事件不带成功/失败载荷：API 报错收场（如上游断流）与正常完成触发同一事件，不能直接按 settled 转待审核。判定成败需从会话尾部回溯最后一条 assistant 消息读 `stopReason`（`error`/`aborted` 为失败），纯判定在 consumer.ts 的 `resolveSettledTarget`；失败任务按设计留在进行中（看板 r 键重试、重启走崩溃恢复自动重新发车）。

## 约定

- UI 文案中文，代码标识符英文；Tab 缩进；erasable TypeScript only（tsconfig 的 erasableSyntaxOnly 已强制，勿绕过）。
- 测试遵循红-绿节奏：state / consumer / board 布局函数必须有单测；board 交互组件与 index.ts 胶水不做自动化测试，靠 `npm run check` 加真实终端手测兜底。
- 测试文件放 `tests/`，直接相对路径导入 `../src/*`；测试桩主题对象用结构化窄接口加 `as unknown as Theme` 断言。
- 提交信息前缀 `feat:` / `fix:` / `docs:` / `ci:` / `chore:`；git add 显式列出自己改的文件。

# pi-task-kanban

[中文](#中文) | [English](#english)

Kanban board extension for [pi](https://github.com/earendil-works/pi-mono).

---

## 中文

终端内四列看板管理任务队列，pi 自主消费任务。

```
待完成 → 进行中 → 待审核 → 已完成
```

- 你往「待完成」加任务，pi 空闲时自动串行领取执行
- 任务完成后进入「待审核」，人工把关：通过或驳回（驳回自动带意见返工）
- 审核是闸门：有待审核任务时流水线暂停
- 任务随会话持久化，重启 / fork 不丢

### 安装

```bash
# npm 包
pi install npm:pi-task-kanban

# 或 git
pi install git:github.com/klren0312/pi-task-kanban

# 或本地开发直接加载
pi -e /path/to/pi-task-kanban/src/index.ts
```

### 使用

| 命令 | 说明 |
|------|------|
| `/kanban` | 打开看板 |
| `/kanban add <标题>` | 添加任务到待完成 |
| `/kanban pause` / `resume` | 暂停/恢复自动消费 |
| `/kanban list` | 在对话里打印任务摘要 |

看板内按键：

| 键 | 作用 |
|----|------|
| `←` `→` / `h` `l` | 切换列 |
| `↑` `↓` | 选择卡片 |
| `a` | 添加任务 |
| `A` | 通过（待审核列） |
| `R` | 驳回并输入意见（待审核列） |
| `p` | 暂停/恢复自动消费 |
| `d` | 删除卡片（仅待完成/已完成） |
| `q` / `Esc` | 关闭看板 |

### 发布

版本更新流程：修改 `package.json` 的 `version` → 提交 → 打 tag 推送：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

CI 自动跑检查、通过 OIDC trusted publishing 发布 npm 并创建 GitHub Release（无需配置 token）。

## English

A four-column kanban board in your terminal that manages your task queue — pi consumes tasks autonomously.

```
Todo → In Progress → Review → Done
```

- Add tasks to "Todo"; pi picks them up automatically and works through them serially when idle
- Finished tasks enter "Review" for human approval: approve, or reject with feedback (rejection sends pi back to work automatically)
- Review is a gate: the pipeline pauses while any task awaits review
- Tasks are persisted per session and survive restarts and forks

### Install

```bash
# From npm
pi install npm:pi-task-kanban

# Or from git
pi install git:github.com/klren0312/pi-task-kanban

# Or load locally during development
pi -e /path/to/pi-task-kanban/src/index.ts
```

### Usage

| Command | Description |
|---------|-------------|
| `/kanban` | Open the board |
| `/kanban add <title>` | Add a task to Todo |
| `/kanban pause` / `resume` | Pause/resume auto-consumption |
| `/kanban list` | Print a task summary into the conversation |

Board keys:

| Key | Action |
|-----|--------|
| `←` `→` / `h` `l` | Switch column |
| `↑` `↓` | Select card |
| `a` | Add task |
| `A` | Approve (Review column) |
| `R` | Reject with feedback (Review column) |
| `p` | Pause/resume auto-consumption |
| `d` | Delete card (Todo/Done only) |
| `q` / `Esc` | Close board |

### Releasing

Bump `version` in `package.json`, commit, then push a tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

CI runs checks, publishes to npm via OIDC trusted publishing (no token needed), and creates a GitHub Release.

## License

MIT

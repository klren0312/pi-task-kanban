# pi-task-kanban

[pi](https://github.com/earendil-works/pi-mono) 看板扩展：终端内四列看板管理任务队列，pi 自主消费任务。

```
待完成 → 进行中 → 待审核 → 已完成
```

- 你往「待完成」加任务，pi 空闲时自动串行领取执行
- 任务完成后进入「待审核」，人工把关：通过或驳回（驳回自动带意见返工）
- 审核是闸门：有待审核任务时流水线暂停
- 任务随会话持久化，重启 / fork 不丢

## 安装

```bash
# npm 包
pi install npm:pi-task-kanban

# 或 git
pi install git:github.com/klren0312/pi-task-kanban

# 或本地开发直接加载
pi -e /path/to/pi-task-kanban/src/index.ts
```

## 使用

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

## 发布

版本更新流程：修改 `package.json` 的 `version` → 提交 → 打 tag 推送：

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI 自动跑检查、发布 npm 并创建 GitHub Release。npm 发布需要在仓库 Secrets 配置 `NPM_TOKEN`。

## License

MIT

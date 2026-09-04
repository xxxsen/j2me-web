# j2me-web AI Agent 实施规范

## 项目目标

`j2me-web` 是可独立集成和部署的开源 J2ME 浏览器运行时。修改应保持宿主无关、可复现构建、稳定公共 API 和向前可验证的存档格式。

## 开始实施前

- 先检查工作区和当前分支，保留用户的已有修改。
- 根据任务阅读对应文档：
  - 运行时分层与公共契约：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  - 宿主集成：[`docs/HOST_INTEGRATION.md`](docs/HOST_INTEGRATION.md)
  - 存档语义与格式：[`docs/CHECKPOINTS.md`](docs/CHECKPOINTS.md)
  - 测试范围与本地样本：[`docs/TESTING.md`](docs/TESTING.md)
  - 依赖、分支和发布：[`docs/MAINTENANCE.md`](docs/MAINTENANCE.md)

## 实施原则

- 行为修改先增加能在旧实现上失败的聚焦测试，再实现修复。
- 公共能力从 `web/runtime-api.js` 进入，生命周期和操作串行化不得绕过 `web/runtime-controller.js`。
- `web/app.js` 只是公共 API 的 Demo 宿主，不得直接读写 Emscripten `Module`、`FS`、IDBFS 或核心私有状态。
- 存档编解码只在 `web/checkpoint-codec.js` 实现；格式或 ABI 变化必须同步 manifest、文档、测试和版本。
- 第三方 fork 必须固定到完整提交，不得使用浮动分支、`latest` 或未记录的本机产物。
- 只运行与改动风险相匹配的测试；发布前按 `docs/TESTING.md` 执行完整验证。
- 公共 API、兼容性、存档或固定依赖改变时，同步更新对应 `docs/` 文档和 `runtime-manifest.json`。

## 仓库卫生

- 不提交第三方游戏、`fixture/`、构建缓存、`public/runtime/*`、`release/`、凭据或本机绝对路径。
- 一个可独立说明的功能或修复使用一个提交，不混入无关格式化。
- 修改第三方 fork 时，先提交并验证 fork，再更新主仓库的固定提交。
- 分支、tag 和发布细则以 `docs/MAINTENANCE.md` 为准；不移动、覆盖或复用已发布 tag。

## 交付前

- 检查 `git diff --check`、工作区状态和实际运行过的验证。
- 说明变更结果、验证范围、提交及仍存的限制；不得把未验证路径描述为已完整兼容。

# 维护与发布

## 分支

- `j2me-web`、`miniJVM`、`freej2meOnMinijvm` 和 `freej2me-plus` 的长期维护分支均为 `main`。
- fork 的 GitHub 默认分支必须设置为 `main`，开发提交直接基于该分支向前维护。
- 合并上游时先记录上游基线提交或 tag，再解决冲突并重新执行完整构建和兼容性烟测。

## 提交

一个可独立说明的功能或 bugfix 使用一个提交。三个 fork 的提交先完成并推送，再更新 `scripts/build-runtime.sh` 中的完整提交哈希；最后提交 `j2me-web` 的集成变化，保证任何主仓库提交都能从远端复现构建。

## Tag

fork 使用：

```text
j2me-web-{upstream_commit_or_tag}-{revision}
```

例如基于上游提交 `ac94e627...` 的第一次 j2me-web 发布为 `j2me-web-ac94e627-1`。同一上游基线继续发布时递增 revision；切换上游 tag/提交后 revision 从 1 重新开始。tag 应使用 annotated tag，并在说明中写明完整上游基线和当前提交。

主仓库使用语义化版本 tag：

```text
vX.Y.Z
```

首个版本为 `v0.0.1`。

## 发布检查

1. 确认四个仓库工作区干净且位于 `main`。
2. 运行 `npm run check`。
3. 仅使用远端默认地址运行 `npm run build:runtime`，验证固定提交均可拉取。
4. 至少烟测《仙剑奇侠传》《魔塔》《钻石狂潮》，检查画面、按键、MIDI 和 Web Audio 状态。
5. 更新 `docs/COMPATIBILITY.md`，明确通过路径与未验证范围。
6. 推送 fork 的 `main` 和规范 tag，再推送 `j2me-web` 的 `main` 和版本 tag。

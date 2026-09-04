# 维护与发布

## 依赖

`scripts/build-runtime.sh` 中的 miniJVM、freej2meOnMinijvm 和 FreeJ2ME Plus 必须固定到完整提交。更新 fork 时，先在 fork 中完成提交、构建和推送，再更新主仓库的固定哈希、README 与 `THIRD_PARTY_NOTICES.md`。

freej2meOnMinijvm 的顶层授权仍需明确；在授权问题解决前，不得删除现有风险说明或把组合产物笼统声明为 MIT。

## 分支与提交

`j2me-web`、`miniJVM`、`freej2meOnMinijvm` 和 `freej2me-plus` 的长期维护分支均为 `main`。一个可独立说明的功能或 bugfix 使用一个提交，不混入无关格式化。

## Tag

fork 使用 annotated tag：

```text
j2me-web-{upstream_commit_or_tag}-{revision}
```

同一上游基线递增 revision，切换基线后从 1 开始。tag 说明必须记录完整上游基线和当前 fork 提交。

主仓库使用 annotated 语义化版本 tag：

```text
vX.Y.Z
```

公共 API 或 save ABI 的破坏性变更升级 major。已发布 tag 不移动、覆盖或复用。

## 发布顺序

1. 确认四个仓库工作区干净且均位于 `main`。
2. 按 [TESTING.md](TESTING.md) 完成与本次版本匹配的验证。
3. 推送已修改 fork 的 `main` 和规范 tag；未修改的 fork 不创建新 tag。
4. 使用远程默认地址完整构建主仓库，确认固定提交可达。
5. 更新版本、`runtime-manifest.json`、兼容性、依赖与第三方声明。
6. 运行 `RELEASE_TAG=vX.Y.Z npm run release:build`，核对 `j2me-runtime-release.json`。
7. 推送主仓库 `main` 和版本 tag。`v*` tag 会创建包含不可变资产与 metadata 的 GitHub Release。

Release 失败时修复问题并发布新版本，不覆盖旧 tag 或旧资产。

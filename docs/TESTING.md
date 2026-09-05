# 测试与本地样本

## 开源检出

不依赖第三方游戏的基础检查为：

```bash
npm ci
npm run check
npm run build:runtime
```

`npm run check` 包含 JavaScript 语法检查和单元测试。`build:runtime` 会从固定的开源依赖构建 Wasm 资产。

构建还会将仓库自有的 `test/java/org/j2me/test/LifecycleMidlet.java` 编译到被忽略的 `.cache/test-runtime/lifecycle.jar`，不加入运行时或 Release。安装 Chrome 后运行 `npm run test:lifecycle`，可独立于商业游戏验证真实 JVM 暂停/恢复、跨 frame 输入、截图尺寸、RMS checkpoint、IDBFS 游戏隔离、加载取消、运行期故障和转码器内存稳定性。

## 维护者本地回归

仓库及 Release 不包含商业游戏或测试 JAR。真实游戏回归依赖维护者合法取得的本地样本，因此不属于全新检出后即可运行的公开测试。

这些样本只允许保存在被 Git 忽略的本地 `fixture/` 目录中，不得提交原始文件、下载链接或派生数据。相关 `test:*` 脚本属于维护者回归工具；运行条件和可覆盖样本以脚本自身为准，公开贡献者无需猜测或寻找仓库中不存在的 JAR。

修改输入、音频、媒体、3D、GC 或生命周期时，维护者应运行对应的真实 Wasm/Chrome 回归，不得用 DOM 映射或日志字符串测试取代 MIDlet 实际接收路径。

## 发布前

发布前要求：

- 运行所有单元测试和与改动相关的真实浏览器回归；
- 运行 `npm run test:lifecycle`，验证自有 MIDlet 的公共运行时契约；
- 从远程固定提交完成一次全量 `build:runtime`；
- 在 Chrome 中覆盖启动、输入、音频、暂停/恢复、截图、GC 和 checkpoint 恢复；
- 运行 `npm run release:build`，核对 ZIP、`.sha256` 与 metadata，并确认 ZIP 中只有一个版本化根目录；
- 运行 `npm run test:release`，在 Chrome 中确认 `j2me-runtime.js` 可导入、cross-origin isolation 生效，且内嵌 glue 的音频 worker 可以初始化；
- 维护者可通过 `J2ME_RELEASE_TEST_JAR=/path/to/game.jar npm run test:release` 使用合法本地 JAR 追加完整启动和首帧验证；
- 解压后确认 manifest 所列的 Wasm、worker 和数据资产全部存在。

具体发布顺序见 [MAINTENANCE.md](MAINTENANCE.md)。

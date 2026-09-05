# Checkpoint 与存储

## 当前语义

当前 save ABI 为 `j2me-rms-v1`，checkpoint 格式为 `j2me-rms-bundle-v1`。它保存当前实例的完整 RMS 文件树，并绑定游戏 JAR 的 SHA-256。

这是游戏存档数据，不是 miniJVM 执行快照。恢复后，MIDlet 可能仍会显示标题画面或要求用户在游戏菜单中读档。

## 二进制封装

`j2me-rms-bundle-v1` 包含：

1. 魔数与格式版本；
2. 32 字节游戏 SHA-256；
3. 文件数；
4. 按路径排序的相对路径、字节长度与原始文件内容。

恢复必须在 MIDlet 启动前完成。解码会拒绝跨游戏 payload、绝对路径、路径穿越、重复路径、截断/尾随数据、未知版本和超过 2 MiB 的 payload。

## 模式隔离

`HOST` 模式只使用宿主显式传入的 checkpoint。`BROWSER` 模式挂载 Demo 的 IDBFS。两种模式不应隐式互通，不同游戏也不能共用 RMS 树。

从 v0.3.3 起，BROWSER 按小写 JAR SHA-256 使用独立的 IDBFS 数据库。导入只替换该游戏的文件树。旧版本共用目录中的数据保持原样，不自动归属给任何游戏；需要迁移时，应在旧版本显式导出目标 checkpoint，再由宿主导入。仅凭旧共享数据库无法可靠识别文件所属的 JAR。

创建 checkpoint 时，运行时会暂时将 JVM 挂起到安全点，再读取 RMS 文件树；完成后恢复调用前的运行或暂停状态。可用性轮询只检查文件元信息，不读取文件内容。格式与 save ABI 均保持 v1。

## 格式演进

- 改变 save ABI 时必须更新 `runtime-manifest.json`、README、格式文档与回归测试。
- 只有旧数据已通过真实恢复验证时，才能将旧 ABI 保留在 `readableSaveAbis`。
- 不兼容变更使用新的格式名和语义化 major/minor 版本，不重新解释 v1。
- 如需新实例直接恢复 Java 执行点，必须在 miniJVM/FreeJ2ME 层实现堆、线程、Wasm 调用栈和媒体状态的一致性序列化；不能用截图或原始 Wasm memory 拷贝伪装。

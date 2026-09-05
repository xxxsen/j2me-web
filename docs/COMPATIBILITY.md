# 兼容性与已知限制

J2ME 生态包含大量机型差异、厂商扩展和非标准媒体格式。本项目的“可用”只表示已覆盖的路径，不等于任意 JAR 都能完整运行。

仓库不分发商业 JAR，因此下列状态是维护者使用本地合法样本得到的能力结论，而不是开源检出内容所附带的游戏认证列表。

## 当前能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| CLDC/MIDP 2D | 可用 | 已覆盖多种 2D 分辨率、Canvas 绘制和基础 UI |
| 非标准画布 | 可用 | 逻辑 viewport 可按内容摘要配置，显示层保持宽高比 |
| 低分辨率缩放 | 可用 | 支持整数倍最近邻、锐利铺满和 Scale2x |
| 键盘/触摸/Gamepad | 可用 | 覆盖方向、确认、软键、数字与多指长按 |
| RMS 持久化 | 可用 | IDBFS 按 JAR 摘要隔离，嵌入式宿主可导入/导出 RMS checkpoint |
| 暂停/恢复 | 可用 | 等待 JVM 安全点确认，暂停期间屏蔽输入与音频激活 |
| MIDI | 可用 | TinySoundFont + SoundFont 渲染并由 Web Audio 播放 |
| PCM/WAV | 可用 | 使用浏览器原生 Web Audio 解码 |
| AMR/AAC/MP3 | 可用 | 原生解码失败时由独立 FFmpeg Wasm worker 转为 PCM |
| M3G/Mascot 3D | 部分 | 提供 WebGL2 后端和软件回退，游戏级覆盖仍需扩大 |
| Wasm GC | 可用 | pthread 构建已启用 GC 与 safepoint 协调 |
| 厂商扩展 | 部分 | FreeJ2ME Plus 提供较广 API 面，具体行为需按游戏验证 |

## 已知限制

- 当前 checkpoint 只保存 RMS 文件树，不是 Java 堆、线程或执行点快照。
- v0.3.3 的浏览器存档隔离不自动迁移旧共享数据库，迁移方式见 [CHECKPOINTS.md](CHECKPOINTS.md)。
- 暂停不调整游戏使用的墙上时钟，恢复时游戏自己的计时器可能跳变。
- 当前媒体转码器不包含视频解码和渲染。
- 网络、短信、蓝牙和更多厂商专有 API 尚未形成系统兼容性保证。
- WebAssembly 线性内存的高水位不会归还给浏览器，但已释放块可被后续分配复用。
- 当前持续集成主要以 Google Chrome 为浏览器基线；其他浏览器需要额外验证。

## 兼容档案

`web/compatibility-profiles.js` 通过 JAR SHA-256 绑定分辨率、机型、旋转、输入、音频、3D 和启动策略。新增档案时应记录来源、仅保存内容摘要与必要配置，不提交原始 JAR。

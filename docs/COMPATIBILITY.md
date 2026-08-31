# 兼容性报告

本报告对应 `j2me-web 0.0.1` 及 README 中固定的三个 fork 提交。测试环境为 Linux x86_64、Chromium、WebAssembly pthread、软件 WebGL2 和 44.1 kHz Web Audio。结果只代表实际走过的路径，不代表整个游戏已通关。

## 样本结果

| 游戏 | 启动/画面 | 输入 | 音频 | 结论 |
| --- | --- | --- | --- | --- |
| 仙剑奇侠传 | 通过；实际 128×144 区域可完整裁取并铺满显示区 | 通过 | MIDI 经 SoundFont 渲染并以 44.1 kHz 播放 | 通过当前烟测 |
| 魔塔 | 通过；240×320 | 通过 | 背景 MIDI 清晰播放 | 通过当前烟测 |
| 钻石狂潮（Diamond Rush） | 通过；240×320 | 通过 | 多段 MIDI 音效成功渲染和播放 | 通过当前烟测；首次运行的 RMS not found 属于建档流程 |
| 都市摩天楼 | 通过至语言选择界面；240×320 | 通过基础按键 | 该路径未触发音频 | 部分通过；JAR 声明使用 M3G，3D 游戏场景尚未确认 |
| 宠物王国5-彩虹二次BT版 | 通过至游戏的声音设置界面；240×320 | 通过基础按键 | 尚未进入实际播放场景 | 部分通过，需深度游戏测试 |
| 超级玛丽.jar | 未测试 | 未测试 | 未测试 | fixture 实际是 Symbian SIS，不是 JAR；页面现会在启动前拒绝 |

`fixture/J2ME` 中其他有效 JAR 仅完成了文件格式检查，尚不能列为兼容。

## 能力分层

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| CLDC/MIDP 2D | 可用 | 多个 2D 样本可启动、渲染和响应输入 |
| 非标准画布尺寸 | 可用 | 支持自动/手动裁取并等比铺满，已验证 128×144 与 240×320 |
| RMS 持久化 | 已接入 | `/home/web_user` 使用 IDBFS `autoPersist`；仍需补充跨版本迁移工具 |
| MIDI | 可用 | TinySoundFont + TimGM6mb 离线渲染，miniaudio/Web Audio 播放 |
| PCM/WAV | 已接入 | miniaudio 文件解码路径可用；样本覆盖少于 MIDI |
| M3G / Mascot 3D | 部分 | FreeJ2ME Plus 有 API 实现，但 miniJVM WebGL 后端尚未完成全量回归 |
| AMR、AAC、MP3、视频 | 未完成 | 尚无与 freej2me-web FFmpeg Wasm 等价的媒体桥 |
| 厂商扩展 | 部分 | FreeJ2ME Plus 提供较广 API 面，实际游戏路径仍需逐项验证 |
| 网络、短信、蓝牙 | 未验证 | 浏览器权限与传输桥尚未系统测试 |
| 长时运行 | 风险项 | Emscripten 构建暂时禁用 miniJVM GC，需监控内存增长 |

## 与 freej2me-web 对比

对比基线为 `zb3/freej2me-web@c19416e75cbc15f9a27f7e967ee81cb108761e30`。

| 维度 | j2me-web | freej2me-web |
| --- | --- | --- |
| Java 运行时 | 自维护 miniJVM Wasm，可固定源码与离线部署 | CheerpJ，接入成熟但运行时不由项目维护 |
| 模拟器核心 | FreeJ2ME Plus fork | zb3 的 FreeJ2ME fork |
| 2D 画面 | NanoVG/WebGL 模拟器画面后再裁取 LCD | JavaScript Canvas 2D 直接帧缓冲桥，浏览器集成更直接 |
| 3D | API 存在，Web 回归不完整 | M3G 与 Mascot Capsule WebGL2 路径更成熟 |
| MIDI | TinySoundFont + SoundFont + miniaudio | 精简 FluidSynth Wasm + AudioWorklet |
| 其他媒体 | WAV/PCM 为主 | FFmpeg Wasm，可处理 AMR 等格式并桥接 video |
| 存档 | IDBFS 自动持久化 | IndexedDB，并有按游戏数据导入/导出流程 |
| 游戏配置 | 当前仅画面区域和基本运行控制 | 屏幕尺寸、手机型号、兼容开关、旋转、全屏等按游戏配置 |
| 移动端输入 | 指针映射与模拟器按键 | 响应式触控键盘、多点触控、按键重复更完善 |
| 构建可控性 | JVM、适配层、核心均固定到 fork 提交 | 项目代码可构建，但依赖专有 CheerpJ 运行链路 |

后续兼容性工作的优先级应为：恢复可用的 Wasm GC；完成 M3G/Mascot WebGL 路径；补充 AMR/MP3/视频；增加按游戏配置与 RMS 导入导出；最后完善移动端多点触控和按键重复。

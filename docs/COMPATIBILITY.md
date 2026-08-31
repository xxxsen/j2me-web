# 兼容性报告

本报告对应 `j2me-web 0.1.0` 及 README 中固定的三个 fork 提交。测试环境为 Linux x86_64、Chromium、WebAssembly pthread、软件 WebGL2 和 44.1 kHz Web Audio。结果只代表实际走过的路径，不代表整个游戏已通关。

## 样本结果

| 游戏 | 启动/画面 | 输入 | 音频 | 结论 |
| --- | --- | --- | --- | --- |
| 仙剑奇侠传 | 通过；实际 128×144 区域可完整裁取并铺满显示区 | 通过 | MIDI 经 SoundFont 渲染并以 44.1 kHz 播放 | 通过当前烟测 |
| 魔塔 | 通过；240×320 | 通过；含左右软键 | 背景 MIDI 清晰播放 | 启动、推进、两轮存档/读取及恢复后继续运行通过 |
| 钻石狂潮（Diamond Rush） | 通过；240×320 | 通过 | 多段 MIDI 音效成功渲染和播放 | 通过当前烟测；首次建档可正常替换尚不存在的 RMS |
| 都市摩天楼 | 通过至语言选择界面；240×320 | 通过基础按键 | 该路径未触发音频 | 部分通过；JAR 声明使用 M3G，3D 游戏场景尚未确认 |
| 宠物王国5-彩虹二次BT版 | 通过至游戏的声音设置界面；240×320 | 通过基础按键 | 尚未进入实际播放场景 | 部分通过，需深度游戏测试 |
| 超级玛丽.jar | 未测试 | 未测试 | 未测试 | fixture 实际是 Symbian SIS，不是 JAR；页面现会在启动前拒绝 |

`fixture/J2ME` 中其他有效 JAR 仅完成了文件格式检查，尚不能列为兼容。

## 能力分层

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| CLDC/MIDP 2D | 可用 | 多个 2D 样本可启动、渲染和响应输入 |
| 非标准画布尺寸 | 可用 | 支持自动/手动裁取并等比铺满，已验证 128×144 与 240×320 |
| RMS 持久化 | 已验证 | `/appdata/freej2meonminijvm.jar/rms/rms` 使用 IDBFS `autoPersist`；首次存档、页面重载、读取和恢复后运行均通过，仍需补充导入/导出及跨版本迁移工具 |
| Retrom 公共生命周期 | 已验证 | 模块化实例可启动；状态/进度/READY 事件、暂停/继续、截图入口、退出清理与 checkpoint 可用性由统一 controller 管理 |
| 标准手柄 | 已接入 | 标准映射覆盖方向、A 确认、B 取消、X/Start 菜单并在暂停/退出时释放；仍需真实手柄矩阵回归 |
| 宿主 checkpoint | 部分 | RMS 文件树可导出为绑定游戏摘要且不超过 2 MiB 的 `j2me-rms-bundle-v1`，并可在新页面实例启动前恢复；它不是 miniJVM 执行状态快照 |
| MIDI | 可用 | TinySoundFont + TimGM6mb 离线渲染，miniaudio/Web Audio 播放 |
| PCM/WAV | 已接入 | miniaudio 文件解码路径可用；样本覆盖少于 MIDI |
| M3G / Mascot 3D | 部分 | FreeJ2ME Plus 有 API 实现，但 miniJVM WebGL 后端尚未完成全量回归 |
| AMR、AAC、MP3、视频 | 未完成 | 尚无与 freej2me-web FFmpeg Wasm 等价的媒体桥 |
| 厂商扩展 | 部分 | FreeJ2ME Plus 提供较广 API 面，实际游戏路径仍需逐项验证 |
| 网络、短信、蓝牙 | 未验证 | 浏览器权限与传输桥尚未系统测试 |
| 长时运行 | 风险项 | Emscripten 构建暂时禁用 miniJVM GC，需监控内存增长 |

## 存档回归

《魔塔》使用全新浏览器配置完成了实际游戏流程，而不是只验证文件系统 API：推进到可控制角色的场景，在右侧格首次存档；刷新页面并读取后恢复到右侧格。随后移动到左侧格再次存档，再移动回右侧格制造进度差异；读取最新存档后角色准确恢复到左侧格，并可继续向右移动。恢复后持续观察 12 秒，运行状态和 Web Audio 保持正常，未出现崩溃、卡死或新的 RMS 异常。

第二次存档后共生成 8 个 RMS 文件，总大小为 **922 B**。该数据远低于 2 MiB 阈值，因此当前不增加压缩层；这样可以避免为很小的数据引入格式版本、失败恢复和额外 CPU 开销。后续若单游戏存档实际超过 2 MiB，再在导出/导入边界增加带版本标识的压缩格式，不改变游戏看到的 RecordStore 数据。

`0.1.0` 的公共 API 另用同一组文件导出了 1202 B 的 `j2me-rms-bundle-v1`（额外字节为魔数、游戏 SHA-256、路径和长度元数据），并在新的页面/runtime 实例中于 MIDlet 启动前成功导入。需要强调：该结果证明了宿主保存数据的跨实例传递，不代表任意 MIDlet 都会跳过自身标题/读档菜单自动回到保存画面。

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

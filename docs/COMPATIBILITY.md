# 兼容性报告

本报告对应 `j2me-web 0.2.2` 及 README 中固定的三个 fork 提交。测试环境为 Linux x86_64、Chromium、WebAssembly pthread、软件 WebGL2 和 Web Audio。结果只代表实际走过的路径，不代表整个游戏已通关。

## 样本结果

| 游戏 | 启动/画面 | 输入 | 音频 | 结论 |
| --- | --- | --- | --- | --- |
| 仙剑奇侠传 | 通过；实际 128×144 区域可完整裁取并铺满，RGBA 色序正确；“按任意键继续”可进入主菜单 | 端到端确认键通过 | 未确认“新的历程”且未进入地图时，打包 MIDI 已恢复并渲染为 32.94 秒/1,452,654 B 单声道 PCM，Web Audio 自动开始播放 | 通过主菜单音频自动化烟测 |
| 魔塔 | 通过加载并进入可控制角色场景；240×320 | 通过；含左右软键 | 背景 MIDI 实测输出 RMS 0.127、峰值 0.368，Web Audio 保持运行 | 启动、推进、两轮存档/读取及恢复后继续运行通过 |
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
| 低分辨率缩放 | 可用 | `SHARP_FIT`、整数倍最近邻和 CPU Scale2x；逻辑坐标、截图与指针映射仍以原始 viewport 为准 |
| RMS 持久化 | 已验证 | `/appdata/freej2meonminijvm.jar/rms/rms` 使用 IDBFS `autoPersist`；首次存档、页面重载、读取和恢复后运行均通过，仍需补充导入/导出及跨版本迁移工具 |
| Retrom 公共生命周期 | 已验证 | 模块化实例可启动；状态/进度/READY 事件、暂停/继续、截图入口、退出清理与 checkpoint 可用性由统一 controller 管理 |
| 标准手柄 | 已接入 | 标准映射覆盖方向、A 确认、B 取消、X/Start 菜单并在暂停/退出时释放；仍需真实手柄矩阵回归 |
| 游戏兼容档案 | 已接入 | 按 JAR SHA-256 选择分辨率、机型、旋转、输入、音频及 3D 策略；宿主可使用同一严格结构覆盖，不依赖文件名 |
| 移动端输入 | 已自动化 | 公共 `setInput()` 与响应式触屏键盘覆盖 19 个手机键、多点触控、长按重复以及失焦/暂停释放；Chrome 测试在 MIDlet 队列断言最终键值 |
| 宿主 checkpoint | 部分 | RMS 文件树可导出为绑定游戏摘要且不超过 2 MiB 的 `j2me-rms-bundle-v1`，并可在新页面实例启动前恢复；它不是 miniJVM 执行状态快照 |
| 输入契约 | 已自动化 | 无头 Chromium 向真实 Wasm 发送 21 个键，并在 FreeJ2ME 的 MIDlet 事件队列入口断言方向、确认、软键和 0–9 最终键值 |
| Wasm GC | 已自动化 | miniJVM GC 已在 pthread 构建启用；`J2ME_GC_V1` 记录堆前后、回收量、锁等待和真实 STW，测试同时检查帧推进与 GC 后输入 |
| MIDI | 可用 | TinySoundFont + TimGM6mb 以 22.05 kHz 单声道离线渲染、同内容缓存、Web Audio 直连播放；支持恢复损坏派生流中的结构化 MIDI |
| 主菜单音频时序 | 已自动化 | 《仙剑奇侠传》只接收一次离开启动提示的确认键；不选择新游戏、不进入地图，断言 MIDI 已解码且 Web Audio 正在运行 |
| PCM/WAV | 已接入 | 浏览器 `decodeAudioData` 路径可用；样本覆盖少于 MIDI |
| M3G / Mascot 3D | 部分 | FreeJ2ME Plus 有 API 实现，但 miniJVM WebGL 后端尚未完成全量回归 |
| AMR、AAC、MP3 | 已自动化 | Chrome 原生解码失败时懒加载 FFmpeg 7.1.1 音频专用 Wasm，在独立 Worker 转为 PCM WAV；无网络、无 GPL/x264 |
| 视频媒体 | 未完成 | 当前转码器刻意不包含视频解码/渲染，避免给游戏主循环和发布体积引入不受控开销 |
| 厂商扩展 | 部分 | FreeJ2ME Plus 提供较广 API 面，实际游戏路径仍需逐项验证 |
| 网络、短信、蓝牙 | 未验证 | 浏览器权限与传输桥尚未系统测试 |
| 长时运行 | 初步通过 | 《魔塔》6 轮 GC 后 Java 堆约 34–36 MiB，未持续增长；仍需小时级、多场景和多浏览器 soak |

## 存档回归

《魔塔》使用全新浏览器配置完成了实际游戏流程，而不是只验证文件系统 API：推进到可控制角色的场景，在右侧格首次存档；刷新页面并读取后恢复到右侧格。随后移动到左侧格再次存档，再移动回右侧格制造进度差异；读取最新存档后角色准确恢复到左侧格，并可继续向右移动。恢复后持续观察 12 秒，运行状态和 Web Audio 保持正常，未出现崩溃、卡死或新的 RMS 异常。

第二次存档后共生成 8 个 RMS 文件，总大小为 **922 B**。该数据远低于 2 MiB 阈值，因此当前不增加压缩层；这样可以避免为很小的数据引入格式版本、失败恢复和额外 CPU 开销。后续若单游戏存档实际超过 2 MiB，再在导出/导入边界增加带版本标识的压缩格式，不改变游戏看到的 RecordStore 数据。

`0.2.2` 的公共 API（checkpoint ABI 自 `0.1.0` 未变）沿用同一组 1202 B `j2me-rms-bundle-v1` 回归证据（额外字节为魔数、游戏 SHA-256、路径和长度元数据），可在新的页面/runtime 实例中于 MIDlet 启动前导入。需要强调：该结果证明了宿主保存数据的跨实例传递，不代表任意 MIDlet 都会跳过自身标题/读档菜单自动回到保存画面。

## GC 回归

miniJVM fork `a2dd48c1cea0b4bcd4fccc2cf843be2686a6d2a0` 保留了 Emscripten GC 与 safepoint 修复，并进一步保证被抑制的类解析/初始化异常不会残留在共享操作数栈中。此前 `Manager` 首次初始化留下的 `ClassNotFoundException` 会覆盖《仙剑奇侠传》播放器赋值表达式中的对象引用，最终在 `Player.realize()` 前表现为空指针；修复后类初始化严格恢复调用者栈边界。

无头 Chromium 实测《魔塔》6 轮累计回收 105,448,203 B，GC 后 Java 堆依次为 34,381,260、35,318,894、35,348,638、36,030,538、35,937,243、35,936,551 B，已形成平台。`0.2.2` 发布候选再次验证《魔塔》3 轮，累计回收 106,302,454 B，GC 后 Java 堆为 34,450,910、35,314,315、35,551,726 B，最大真实 STW 87 ms；此前《仙剑奇侠传》2 轮最大真实 STW 为 97 ms。每轮前后帧计数增长，GC 后确认键仍到达 MIDlet。长类初始化造成的 GC 锁等待与真正 STW 分开记录，不能把 mutator 仍在运行的等待时间误报为画面冻结。

## 主菜单音频回归

`npm run test:audio` 使用无头 Chromium 启动真实 Wasm 和《仙剑奇侠传》，在启动提示停留 25 秒后只按住一次 Enter 750 ms，并由 `J2ME_INPUT_V1` 确认 MIDlet 收到 `-5`。测试随后不再发送任何输入，因此不会确认“新的历程”或进入地图；它等待 32.94 秒菜单 MIDI 完成 SoundFont 渲染，断言 Web Audio item 已缓冲、请求播放并处于 running，同时画面帧继续推进且日志中没有 `Sound : ...Exception`。修复前同一路径稳定在 `Player.realize()` 前抛出 `NullPointerException`，没有创建 Web Audio item。

`npm run test:media` 在无头 Chrome 中逐一把 AMR-NB、AAC-LC/ADTS 和真实游戏内 MP3 交给发布版 Worker/Wasm，要求三者均输出有效 RIFF PCM、可被 Web Audio 解码、时长大于 100 ms 且非静音。`J2ME_MEDIA_V1` 同时公开原生解码失败、回退开始/成功/失败与 Worker 请求统计，便于宿主和浸泡测试确认没有静默丢音。

## 与 freej2me-web 对比

对比基线为 `zb3/freej2me-web@c19416e75cbc15f9a27f7e967ee81cb108761e30`。

| 维度 | j2me-web | freej2me-web |
| --- | --- | --- |
| Java 运行时 | 自维护 miniJVM Wasm，可固定源码与离线部署 | CheerpJ，接入成熟但运行时不由项目维护 |
| 模拟器核心 | FreeJ2ME Plus fork | zb3 的 FreeJ2ME fork |
| 2D 画面 | NanoVG/WebGL 模拟器画面后再裁取 LCD | JavaScript Canvas 2D 直接帧缓冲桥，浏览器集成更直接 |
| 3D | API 存在，Web 回归不完整 | M3G 与 Mascot Capsule WebGL2 路径更成熟 |
| MIDI | TinySoundFont + SoundFont + 直连 Web Audio | 精简 FluidSynth Wasm + AudioWorklet |
| 其他媒体 | AMR-NB/WB、AAC、MP3 由 LGPL 音频专用 FFmpeg Wasm 回退，WAV/PCM 走 Chrome 原生路径；尚无视频 | FFmpeg Wasm，可处理 AMR 等格式并桥接 video |
| 存档 | IDBFS 自动持久化 | IndexedDB，并有按游戏数据导入/导出流程 |
| 游戏配置 | SHA-256 绑定档案覆盖屏幕、手机、旋转、输入、音频和 3D，并允许宿主覆盖 | 屏幕尺寸、手机型号、兼容开关、旋转、全屏等按游戏配置 |
| 移动端输入 | 响应式触控键盘、多点触控、长按重复和公共虚拟键 API | 响应式触控键盘、多点触控、按键重复 |
| 构建可控性 | JVM、适配层、核心均固定到 fork 提交 | 项目代码可构建，但依赖专有 CheerpJ 运行链路 |

后续兼容性工作的优先级应为：扩大 Wasm GC 的小时级与多浏览器 soak；完成 M3G/Mascot WebGL 路径；补充 AMR/MP3/视频；增加按游戏配置与 RMS 导入导出；最后完善移动端多点触控和按键重复。

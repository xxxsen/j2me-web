# j2me-web

`j2me-web` 是一个不依赖 CheerpJ 的浏览器 J2ME 运行时。它把 miniJVM 编译为 WebAssembly，以 FreeJ2ME Plus 提供 MIDP/厂商 API 实现，并通过一个轻量页面加载 fixture 或本地 JAR。

当前版本为 `0.0.1`，定位是可复现的兼容性基线：2D 游戏、键盘/指针输入、浏览器存档以及 MIDI 音频链路均已跑通；3D、厂商扩展和更多媒体编码仍需持续补齐。详细结果见 [兼容性报告](docs/COMPATIBILITY.md)。

## 快速开始

构建需要 Node.js 18+、Docker、Git 和 curl。浏览器需要支持 WebAssembly threads、`SharedArrayBuffer`、WebGL2 与 Web Audio。

```bash
npm run build:runtime
npm run dev
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)，选择 `fixture/J2ME` 中的游戏或上传本地 `.jar`，然后点击“启动游戏”。生成的运行时位于 `public/runtime`，下载缓存位于 `.cache/upstream`；两者都不会提交到 Git。

可用查询参数：

```text
?autostart=1&fixture=魔塔.jar
?autostart=1&fixture=魔塔
?autostart=1&fixture=0
```

`fixture` 可使用完整文件名、文件名片段或下拉列表索引，适合浏览器自动化烟测。

## 使用说明

- 默认只显示并等比放大游戏 LCD；“显示模拟按键”可切回 miniJVM 的完整模拟器窗口。
- 画面区域默认是 240×320。《仙剑奇侠传》会自动裁取其实际使用的 128×144 区域，也可以手动选择其他尺寸。
- 全屏模式保持游戏原始宽高比，以像素风格缩放填满可用空间。
- 键盘支持方向键、WASD、Enter 和数字键；放大画面上的指针事件会映射回模拟器 LCD。
- 首次启动游戏的点击会尝试解锁 Web Audio；浏览器仍阻止自动播放时，点击“启用声音”。
- RMS 和运行配置写入 `/home/web_user`，该目录通过 IDBFS 持久化到浏览器存储。
- 当前一次页面生命周期只运行一个 JAR；切换游戏请重新加载页面。

页面会先检查 ZIP/JAR 文件签名，避免把扩展名错误的 SIS、HTML 下载页等文件交给虚拟机。

## 运行架构

```text
fixture / 本地 JAR
        │
        ▼
Emscripten MEMFS (/game.jar) + IDBFS (/home/web_user)
        │
        ▼
miniJVM.wasm ── WebLauncher ── freej2meOnMinijvm
        │                              │
        │                              ▼
        │                       FreeJ2ME Plus / MIDlet
        │                              │
        ├── NanoVG + WebGL2 ───────────┤──► Canvas
        │                              │
        └── TinySoundFont + miniaudio ─┘──► Web Audio
```

音频资源会在 FreeJ2ME Plus 的资源流边界稳定化，再以临时文件交给 miniJVM。MIDI 由 TinySoundFont 和 TimGM6mb SoundFont 离线渲染，PCM 通过 miniaudio 播放；pthread 工作线程内的 Web Audio 操作会代理到浏览器主线程。这条链路修复了此前的噪音、沙沙声和浑浊问题。

`server.mjs` 会为全部响应设置以下头部，部署到其他静态服务器时必须等价保留：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

## 依赖仓库与固定版本

构建默认只使用维护在 `xxxsen` 下的三个 fork，并固定到完整提交，避免上游变化导致不可复现构建：

| 层 | 仓库 | 固定提交 | 上游基线 |
| --- | --- | --- | --- |
| JVM/Wasm | [xxxsen/miniJVM](https://github.com/xxxsen/miniJVM) | `1778bd07fea64213d5e4d3061a489044abf458e7` | `digitalgust/miniJVM@ac94e62781deda037875ff69d78f272a327a72bc` |
| miniJVM 适配 | [xxxsen/freej2meOnMinijvm](https://github.com/xxxsen/freej2meOnMinijvm) | `a9d5e8b1296088ba44d94dd71571cac5751947ea` | `digitalgust/freej2meOnMinijvm@c6af07fffde51fe1b1959f584376dec8d912d456` |
| 模拟器核心 | [xxxsen/freej2me-plus](https://github.com/xxxsen/freej2me-plus) | `6e48b3ff3544b143890e9132efeb4a64b63412cf` | `TASEmulators/freej2me-plus@f68a12052532487f9606ba566b981aff19cc8887` |

此外固定使用 TinySoundFont `853a0a171759f1ddba0de1442133a75912bbeffa`、TimGM6mb SoundFont（SHA-256 `c5378b62028c920cb11e4803327983fee2f2cdff5dc89c708e39da417e51c854`）、Emscripten 3.1.46 和 Eclipse Temurin 8。

如需验证尚未推送的本地 fork，可覆盖仓库地址：

```bash
MINIJVM_REPOSITORY=/path/to/miniJVM \
FREEJ2ME_REPOSITORY=/path/to/freej2meOnMinijvm \
FREEJ2ME_PLUS_REPOSITORY=/path/to/freej2me-plus \
npm run build:runtime
```

分支、提交与发布 tag 规则见 [维护说明](docs/MAINTENANCE.md)，第三方授权信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 与 freej2me-web 的关系

本项目参考并吸收了 [zb3/freej2me-web](https://github.com/zb3/freej2me-web) 的浏览器端经验，包括持久化文件系统、按游戏加载、响应式画面、输入转发以及浏览器原生音频思路，但没有复制其 CheerpJ 运行链路。

当前项目的优势是 JVM、模拟器核心和 WebAssembly 构建都能自行维护、固定版本并离线部署。`freej2me-web` 目前在 WebGL 2 的 M3G/Mascot 3D、按游戏配置与数据导入导出、移动端触控键盘、按键重复以及 FFmpeg/AMR/视频媒体方面更成熟。这些差距被保留在兼容性报告中，不把“能够启动”表述成“完整兼容”。

## 开发检查

```bash
npm run check
npm run build:runtime
```

当前 Emscripten pthread 构建为规避 stop-the-world 死锁禁用了 miniJVM GC，长时间运行时内存可能持续增长；正式服务还应增加长时游戏、反复场景切换和多浏览器回归。

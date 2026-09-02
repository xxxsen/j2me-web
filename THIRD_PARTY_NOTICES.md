# Third-party notices

本项目的构建产物组合了以下第三方组件：

- [xxxsen/miniJVM](https://github.com/xxxsen/miniJVM)，固定到 `1533f6f9d858cdd67f3262811f2410b1a42a7255`（tag `j2me-web-ac94e627-6`），基于 `digitalgust/miniJVM@ac94e62781deda037875ff69d78f272a327a72bc`。其顶层 LICENSE 声明 `/minijvm/java/` 为 GPL-2.0，其余部分为 MIT License；分发时不能把整个仓库笼统视为 MIT。
- [xxxsen/freej2meOnMinijvm](https://github.com/xxxsen/freej2meOnMinijvm)，固定到 `b72d9606fe11e57559ef56ace528c6104537ea34`（tag `j2me-web-c6af07fffde5-7`），基于 `digitalgust/freej2meOnMinijvm@c6af07fffde51fe1b1959f584376dec8d912d456`。上游和当前 fork 均未附带顶层 LICENSE，公开分发前应向原作者确认适配层授权。
- [xxxsen/freej2me-plus](https://github.com/xxxsen/freej2me-plus)，固定到 `df5aed202aed01ea744d9e5f918a905634508169`（tag `j2me-web-f68a120-7`），基于 `TASEmulators/freej2me-plus@f68a12052532487f9606ba566b981aff19cc8887`。FreeJ2ME 声明为 GPL-3.0-or-later，并包含采用 ObjectWeb ASM License 的 ASM 代码。
- [TinySoundFont](https://github.com/schellingb/TinySoundFont)，固定到 `853a0a171759f1ddba0de1442133a75912bbeffa`，MIT License。构建使用其 `tsf.h` 与 `tml.h`。
- [TimGM6mb.sf2](https://github.com/musescore/musescore-old/blob/0c1f25dc3cdd2f9332118fa221a344eb8f6ee702/mscore/share/sound/TimGM6mb.sf2)，取自 MuseScore old 固定提交；MuseScore 文档将其标注为 GNU GPL v2。该文件被打包进 `runtime.data`。
- [Emscripten](https://github.com/emscripten-core/emscripten) 3.1.46 编译工具链及其运行时输出。
- [FFmpeg](https://github.com/FFmpeg/FFmpeg) 固定到 `db69d06eeeab4f46da15030a80d539efb4503ca8`（n7.1.1）。音频转码器只启用 libavformat、libavcodec、libavutil、libswresample 与 AMR/AAC/MP3 解码，不启用 GPL 组件、x264、网络或视频编码，构建报告为 LGPL-2.1-or-later。
- `scripts/verify-media.mjs` 的 250 ms AMR-NB 回归向量截取自 [freej2me-web](https://github.com/zb3/freej2me-web) 的 `web/libmedia/test/d3theme.amr`，仅用于测试，不进入发布资产。

`public/runtime/runtime.data` 会包含 miniJVM Java 运行库、FreeJ2ME Plus、miniJVM 适配层以及 TimGM6mb.sf2；`audio-transcoder.wasm` 包含上述裁剪后的 FFmpeg 库。公开提供构建产物时，应一并提供/指向相应源码，完整保留版权和许可证文本并满足 GPL/LGPL 对应源代码义务。由于 `freej2meOnMinijvm` 缺少明确许可证，在授权确认前不应把本说明理解为公开再分发许可。

本文件仅记录依赖来源与已发现的授权信息，不构成法律意见。

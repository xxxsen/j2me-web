# j2me-web Agent 实施规范

本仓库维护供 `retrom-runtime` 聚合的 J2ME/miniJVM 浏览器核心，同时保留一个人工与自动化烟测页面。核心目标是宿主无关、可复现构建、稳定生命周期和可向前验证的存档 ABI；不得把 Retrom 产品侧的用户、数据库、上传、审核、HTTP 路由或权限逻辑写入本仓库。

## 仓库边界

- `web/runtime-api.js` 是宿主公共入口，公开 `createRuntime`、`mountRuntime`、`describeRuntime`、配置校验和能力描述。
- `web/runtime-controller.js` 维护与 `retrom-runtime` 一致的状态、事件和操作串行化；adapter 行为不能绕开 controller。
- `web/checkpoint-codec.js` 是 `j2me-rms-bundle-v1` 的唯一编解码实现。格式、上限或兼容性变化必须同步更新 `runtime-manifest.json`、测试、README 与版本号。
- `web/app.js` 只是 Demo 宿主，必须只调用公共 API；禁止重新直接读写 `Module`、`FS`、IDBFS、运行时 canvas 或核心私有状态。
- `scripts/build-runtime.sh` 只从固定提交构建 miniJVM、freej2meOnMinijvm 与 FreeJ2ME Plus。不得使用浮动分支、`latest` 或未记录的本机产物。
- 不修改 `retrom-runtime` 来掩盖本核心的缺失能力。需要宿主变化时，先把本仓库的稳定契约、资产与证据准备完整，再在独立任务中接入。
- 不提交第三方游戏、构建缓存、生成的 `public/runtime/*`、`release/`、凭据或本机绝对路径。

## 公共运行时契约

- 生命周期必须保持 `CREATED → LOADING → RUNNING/PAUSED/CHECKPOINTING → EXITING → EXITED`，失败进入 `FAILED`。同一实例只允许调用一次 `mount()`，`exit()` 必须幂等。
- 宿主可在 `mount()` 前订阅 `LOAD_PROGRESS`、`READY`、`STATE_CHANGED`、`CHECKPOINT_AVAILABILITY_CHANGED`、`FATAL_ERROR` 与 `EXIT_REQUESTED`。
- 配置必须显式提供 `J2ME_JAR_V1` URL、精确字节数和 SHA-256；下载长度、JAR 签名和摘要不一致时失败关闭，不得静默继续。
- 每个 session 使用宿主提供的 frame/window。运行时需要 WebAssembly threads、`SharedArrayBuffer`、WebGL2 与 Web Audio；宿主必须提供 COOP/COEP。
- 标准手柄至少覆盖方向键、确认、取消和菜单，并在暂停、退出或手柄断开时释放全部按键。不能把键盘可用当成手柄已验证。
- `pause()`/`resume()`、`screenshot()`、`getCanvas()`、帧计数和核心主动退出必须走公共接口。运行时清理后不得留下可交互 canvas 或继续允许 checkpoint。
- `HOST` 存储由宿主传入/取走 checkpoint；`BROWSER` 仅供 Demo 的 IDBFS 持久化。不得让 Retrom session 意外读取 Demo 或另一游戏的浏览器存档。

## Checkpoint 规则

- 当前 save ABI 是 `j2me-rms-v1`，checkpoint 格式是 `j2me-rms-bundle-v1`，内容为该实例的完整 RMS 文件树并绑定游戏 SHA-256。
- 恢复必须在 MIDlet 启动前完成；跨游戏 payload、路径穿越、重复路径、损坏数据和超过 2 MiB 的 payload 必须使用稳定错误码拒绝。
- 不得把空 RMS、仅截图或未验证的 Wasm 内存拷贝描述为可恢复 checkpoint。若某游戏需要在自身菜单手动读档，兼容性证据必须明确说明，不能声称为任意时刻即时状态。
- 若要满足更强的“新实例直接恢复当前执行点”语义，必须先在 miniJVM/FreeJ2ME fork 实现可暂停的一致性序列化，并用真实游戏完成不同实例恢复与恢复后输入验证；禁止在 Web adapter 中伪造。
- save ABI 变化时升级 `saveAbi`，并只在真实回归通过后把旧 ABI 留在 `readableSaveAbis`。格式不兼容时使用新格式名和新 major/minor 版本。

## 修改流程与门禁

1. 修改行为前先补能在旧行为失败的聚焦测试。
2. 一个可独立说明的功能或 bugfix 使用一个提交，不混入无关格式化。
3. 修改公共 API、checkpoint、输入或退出行为后，至少运行：

```bash
npm ci
npm run check
npm run build:runtime
npm run release:build
```

4. 浏览器烟测至少覆盖一个 240×320 游戏和《仙剑奇侠传》的 128×144 裁取；检查键盘、标准手柄、音频、暂停/恢复、截图、checkpoint 导出、不同页面实例恢复和恢复后继续输入。
5. `runtime-manifest.json`、README、兼容性报告、第三方声明和固定依赖提交必须与代码同步。
6. 发布前确认四个仓库工作区干净且均位于 `main`，并确认固定提交和 tag 已在远端可达。

## 分支、提交与 Tag

- `j2me-web`、`miniJVM`、`freej2meOnMinijvm` 与 `freej2me-plus` 的长期维护和 GitHub 默认分支均为 `main`；本项目的发布提交必须落在 `main`。
- `j2me-web` 使用 annotated tag `vX.Y.Z`，例如 `v0.1.0`。tag 不移动、不覆盖；公共 API 或 save ABI 破坏性变化必须升级 major。
- fork 使用 annotated tag `j2me-web-{upstream_commit_or_tag}-{revision}`。同一上游基线递增 revision，切换基线后从 1 开始；tag 说明必须记录完整上游基线和当前提交。
- 修改 fork 时先在对应 `main` 完成功能提交与构建验证，依次推送 fork 的 `main` 和规范 tag，再更新本仓库完整提交哈希。未修改的 fork 不创建新 tag。
- 主仓库 tag 前必须从远端默认地址完成完整构建，运行 `release:build` 并核对 `j2me-runtime-release.json` 中的 commit、tag、资产大小与 SHA-256。
- `v*` tag 触发 GitHub Release，发布的资产和 metadata 都是不可变兼容边界；失败的 workflow 修复后发布新版本，不能覆盖旧 tag 或旧资产。

## 授权与发布

- `THIRD_PARTY_NOTICES.md` 必须与固定提交同步。Release 必须包含该文件，并保留各依赖的许可证与对应源码指向。
- freej2meOnMinijvm 的顶层授权仍需明确；在授权问题解决前，不得删除现有风险说明或把组合产物笼统声明为 MIT。

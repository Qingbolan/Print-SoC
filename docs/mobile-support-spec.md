# 手机端实施规格（准备稿）

日期：2026-11-09。状态：已完成源码审计，以下为待实现设计与验收门槛，不代表已有 Android/iOS 支持。功能依据见 [上游对照表](upstream-feature-audit.md)。

## 产品路径

首要用例：学生在手机文件管理器、浏览器或聊天 App 中选中 PDF，分享到 Print@SoC，登录 SoC Unix，确认纸张/页码/队列后提交，并在离开 App 再返回时知道任务是否已被服务器接收。

建议先做 Android 的端到端验证，同时保持共享 Rust 核心可供 iOS 使用；随后完成 iOS 文件导入与分享扩展。第一可用里程碑是 PDF 原样打印，最终功能对齐必须覆盖 Office 格式、页码和 1/2/4/6/8-up。图片转换可复用已有 Rust 逻辑，但仍需手机内存验收。

采用现有 Tauri 2 + React + Rust，保留桌面公共命令和响应结构。原生适配只处理文件、凭据、生命周期和系统入口，业务状态和打印逻辑由共享核心所有。现有 UI 已有手机导航抽屉，优先打通文件到打印链路。

纯浏览器目前没有真实后端通路，不能把 Vite 页面或 PWA 宣称为可打印手机端。引入公网网关会增加账号、文件托管和运维边界，本阶段不纳入默认方案。

## 已确认的阻塞点

| 阻塞 | 当前位置 | 需要完成的工作 |
| --- | --- | --- |
| 无原生工程 | `app/src-tauri` 无 `gen/android`、`gen/apple` | 用仓库锁定的 Tauri CLI 初始化，记录实际 SDK/NDK/JDK/Xcode 与 Rust target；验收可启动的 Debug 包 |
| 外部进程布局 | `pdf_service.rs::create_print_layout` 调用 pdfjam | 以共享、进程内 PDF 布局实现替换；不要保留两套页码/网格算法 |
| Office 外部进程 | `document_service.rs` 调用 soffice | 首版明确只接收已支持的移动格式；完整版本须另行实现并验证 Office 转换 |
| 文件路径假设 | `documents.ts` 选择路径后传 `document_prepare`；后端 `Path`/`Document::load` | Android content URI、iOS 授权 URL 先由原生适配复制到应用沙箱；不要把 URI 当文件路径 |
| 数据目录假设 | `storage_service.rs` 用 `dirs::data_dir()` | 将平台解析的数据目录注入存储服务；移动使用应用私有目录，桌面继续原位置 |
| 凭据平台差异 | `credential_service.rs`、Cargo keyring features | Android 实现 Keystore 支持的加密凭据存储；iOS 验证 Keychain。加密内容与密钥生命周期分别处理 |
| SSH 交叉编译 | `ssh2` 及 libssh2/OpenSSL 依赖 | Android 和 iOS 各做真实链接/握手验证，不能仅依赖桌面 cargo check |
| SSH 主机身份 | `ssh_service.rs` 握手后直接认证 | 建立主机指纹信任与变更拒绝流程；首次信任与后续重连由一个连接服务管理 |
| 桌面集成无目标隔离 | `lib.rs` 无条件注册 shell/process、MCP 分支和集成命令 | 按目标隔离桌面启动与集成；移动界面按实际能力展示操作，不能假报 MCP/CUPS 可用 |
| 窗口事件不能代表手机生命周期 | `lib.rs` CloseRequested、`useBackgroundMonitor.ts` 定时器 | 前后台事件控制轮询与重连；关键状态转移立即持久化，不能只靠关闭事件 |
| 权限针对桌面目录 | `tauri.conf.json` 的 HOME/DOCUMENT scope | 移动只授予选择文件与私有副本所需权限；验证导入后预览读取权限 |
| 缺真实设备布局验收 | `index.html` viewport、AppShell、预览与弹窗 | safe-area、软键盘、返回键、触控、横竖屏和大字体逐项验证 |

环境预检：本机能找到 Xcode、`aarch64-apple-ios-sim` Rust target、桌面 pdfjam 与 soffice；PATH 中未找到 adb，已安装 Rust targets 未包含 Android。这里只记录发现，未据此判断 Android SDK 是否安装，也未验证 Xcode 平台/模拟器完整性。桌面转换工具存在不代表手机可用。

## 模块责任

只在对应迁移任务中引入以下对象/trait，并立即把调用方迁入，避免先堆未使用的抽象。

| 所有者 | 责任 | 不应承担 |
| --- | --- | --- |
| `DocumentImporter` + 平台 source adapter | 接收路径/URI/分享附件，校验格式与大小，流式复制、原子落盘，返回应用拥有的文档标识 | 执行 SSH、自动打印 |
| `DocumentRepository` | 私有文档路径、元数据、引用关系、清理与重启恢复 | 假设外部 URI 永久有效 |
| `DocumentConverter` | 输入文档到标准 PDF，声明支持格式和缺失依赖 | 静默上传到外部服务或更换转换方式 |
| `PdfLayoutService` | 页码验证、顺序、网格与输出 PDF；预览与提交使用同一产物 | 在 UI 再维护一套布局规则 |
| `CredentialStore` 平台实现 | 按 host/port/user 隔离保存、读取、删除凭据 | 把密码返回 webview 或存入 localStorage |
| `SshSession` | 主机校验、连接生命周期、串行命令/上传、超时 | 判断打印业务成功或自动重发 lpr |
| `PrintJobService` | 任务状态机、取消、远端回执、恢复与持久化 | 接触 UI 组件或平台分享 API |
| `QueueService` | 队列发现、配额、原始诊断、远端任务及取消结果 | 要求所有远端任务都有本地历史 |

保留现有桌面 invoke 命令的公共行为，内部委托这些服务。新能力采用增量接口；内部旧实现迁移完成即删除，不新增仅用于旧架构的 fallback。`extract_page_range` 等未使用占位逻辑随所属模块迁移移除。

平台能力应描述“能导入哪些格式、能否生成布局、能否安全保存密码、能否管理桌面集成”，不能以屏幕宽度判断操作系统。`useIsMobile` 只负责布局。

## 生命周期与重复打印

### 文档导入

`Received → Copying → Validating → Ready`，失败进入 `Failed`，取消进入 `Cancelled`。

- 选择器与系统分享共用同一个导入服务；取消选择器不显示错误。
- URI 授权有效期内复制到临时文件，完成校验后原子提交；不完整副本不进入 Ready。
- 冷启动分享先保存待处理导入，登录完成后恢复预览；不能依赖单次 JS 事件一定被监听到。
- 重复递送用导入回执去重；同一个文档允许用户显式再次打印，不以内容哈希全局禁止重印。
- 首版限定单文件分享，多个附件明确提示选择一个；多文件批量是独立扩展，不是该上游已确认能力。

### 打印作业

新内部状态模型（待实现，不能直接把现有持久化枚举改名）：

`Draft → Preparing → Uploading → Submitting → Queued → NoLongerQueued`

提交前可进入 `Cancelled` 或 `Failed`；提交已发出但响应丢失进入 `SubmissionUnknown`。队列任务取消经过 `CancelRequested`，根据远端结果确认，不能先乐观宣称已取消。

- Preparing/Uploading 的取消必须传到实际工作并在 lpr 前检查，避免“UI 已取消，后台仍打印”。
- 发送 lpr 前持久化作业关联标识；收到回执后持久化远端 ID。提交结果不明时先查询/提示用户核对，**禁止自动重发**。
- 从 lpq 消失只说明不再排队；没有额外证据不宣称实体打印成功。
- App 进入后台暂停轮询；恢复前台先检查连接，再协调本地状态与服务器队列。未完成原生后台任务实现前，不承诺锁屏持续上传。
- 状态扩展需要兼容旧历史读取及现有公共响应；历史缺少回执时保留不确定性，不能推断成功。

## Office 与布局的决策

PDF 页码与 n-up 属于共享核心能力，目标为进程内生成可打印 PDF，随后预览这个确切产物。验收必须覆盖 CropBox/MediaBox、旋转、字体与资源引用、混合页面尺寸、空白尾面，不能只验证生成文件存在。

Office 是独立决策：原项目把转换放在 SSH 服务器，当前项目放在桌面 LibreOffice。手机不能沿用本机 soffice 命令。完整对齐前先验证以下候选：

1. 经确认可用的学校服务器转换工具：需能力探测、隔离临时目录、超时与清理，转换结果下载后预览；不能假定服务器允许安装软件。
2. 可嵌入手机的转换引擎：先核对六种文件的实际保真度、体积、许可和维护成本，再确定依赖。

在选定并验证之前，手机 PDF 首版明确提示用户从原 App 导出 PDF；这是已声明的阶段范围，不是完整 Office 支持。禁止静默把私人文档交给第三方转换服务，也不复制上游旧 HTTP 下载 JAR 的机制。

## 可执行任务与验收

| 任务 | 依赖 | 交付及验收门槛 |
| --- | --- | --- |
| M0 原生可运行基线 | 无 | Android debug、iOS simulator 可启动；ssh2/凭据/插件逐项记录通过或失败；桌面仍能构建 |
| M1 文件与凭据适配 | M0 | 文件选择及 Android 分享、iOS 分享/打开入口；冷启动登录后可恢复；外部文件移除后私有副本仍可预览；凭据退出删除 |
| M2 PDF 打印闭环 | M1 | 真实设备直接 SSH 上传 PDF，返回队列 ID；失败不伪报成功；从桌面提交的本人队列任务也可查看 |
| M3 恢复、进度、取消 | M2 | 上传百分比、阶段事件；转换/上传取消；提交响应丢失无重复打印；后台/杀进程后恢复状态 |
| M4 页码与布局统一 | M2 | 不依赖 pdfjam；全页、连续及离散页码；1/2/4/6/8-up，保留当前 9-up；预览和打印一致；桌面调用同步迁移 |
| M5 队列功能对齐 | M2 | 配额有普通入口；自定义队列；缺纸/暂停信息；取消选中及全部本人的远端任务，每队列展示结果 |
| M6 Office 完整对齐 | 转换方案验证、M1/M2 | DOC/DOCX/PPT/PPTX/ODT 各有手机样本，预览转换结果后提交；离线/缺工具/超时明确报错 |
| M7 发布准备 | M0–M6、设备验收 | Android 签名包、iOS 签名包及相应发布流程；版本继续由 Tide 投影；跨平台保留同一 source-commit receipt |

M2 可作为明确标注 PDF-only 的内部验证版；M7 的完整对齐不能跳过 M4–M6。Booklet 是本项目已有宣传与实现不一致的问题，另行修复或修正文案，不借此次上游对齐扩大为首个手机里程碑。

设备验收至少覆盖：Android 真机、iPhone 真机、320/375/430 CSS px、横屏、键盘展开、大字体、刘海/底部手势区、文件授权撤回、空文件/损坏 PDF、大小限制、低内存、VPN 断线、切网、锁屏和进程终止。格式/页码/打印回执测试用固定样本；真实打印须使用测试队列及明确数量。

M5 的取消验证必须包含服务器拒绝取消其他人的任务、任务已离开队列、部分队列失败和无本地历史，不使用跨用户的管理员取消命令。

## 版本与公共接口约束

遵循 [VERSIONING.md](../VERSIONING.md)。不另建 Android/iOS 的手工版本计数器。若 Android versionCode 或 iOS build number 需要数值映射，由 `scripts/version.py` 统一拥有，并以各平台实际限制验证单调性和溢出，CI 消费同一提交回执。初始化工程后检查模板版本是否被统一投影覆盖，禁止提交独立硬编码版本。

本准备阶段不修改依赖、不初始化生成工程、不改发布流程；上述任务按依赖推进时分别完成可审查的实现和相应验证。

## 技术依据

- [Tauri 前置环境要求](https://v2.tauri.app/start/prerequisites/)：按目标配置 Android/iOS 工具链。
- [Tauri Dialog](https://v2.tauri.app/plugin/dialog/)：核对各平台选择器行为，不能假设返回值都是普通路径。
- [Tauri 移动插件开发](https://v2.tauri.app/develop/plugins/develop-mobile/)：原生 Android/iOS 适配与共享 Rust 的边界。

以上官方文档于 2026-11-09 查阅；项目已安装版本与在线文档可能不同，最终以锁文件版本的构建和设备行为验收。

# nus-soc-print 功能对照

后续实施状态与尚未通过的验收见 [实施验收记录](implementation-verification.md)。下文保留首次审计证据。

审计日期：2026-11-09。范围是功能核查与手机端开发准备，不代表移动应用已经实现。

上游固定为 [yeokm1/nus-soc-print @ 127a777](https://github.com/yeokm1/nus-soc-print/tree/127a77774e250c6ac918165ce736bc1e109e8b7c)。核对了 README、AndroidManifest、应用 Java 源码、资源文件以及 `user-dev-guide/NUS SOC Print Dev Guide - Android.docx`。未把手册的 Future Work 当作已实现功能，也未把第三方库的方法当作产品功能。

本仓库基线为 `b98d18694260a746047b9be3cc821aed294e8095` **加审计时工作区未提交修改**，尤其包括文档转换、凭据存储、预览与打印链路；仅 checkout 该提交不能复现本表。“具备”表示找到调用链，不表示已在校园打印机实测。未使用账号登录、发送打印任务或删除队列任务。上游历史代码也不证明其服务器和下载地址目前可用。

> 后续实现更新：已接入实时队列诊断、真实字节上传进度、提交前协作取消与队列状态显示，见 [打印机状态与进度实现](printer-observability.md)。下表保留首次审计基线。

## 功能覆盖

上游源码路径均相对 `app/src/main/`；Java 应用类位于 `java/com/yeokm1/nussocprintandroid/`。

| 用户用例 | 上游实现证据 | 当前实现证据 | 判定与缺口 |
| --- | --- | --- | --- |
| 选择本地 PDF | `fragments/PrintFragment.java`、文件选择器 | `app/src/lib/documents.ts`、`document_service.rs` | 桌面具备；手机的 URI 导入未接通 |
| 打印 DOC/DOCX/PPT/PPTX/ODT | `PrintingActivity.java` 在 SSH 服务器运行文档转换器；Manifest 列出六种格式 | `app/src-tauri/src/document_service.rs` 本地 LibreOffice 转 PDF | 桌面有条件具备；手机无等价转换路径 |
| 从其他 App 分享文件进来 | `AndroidManifest.xml` 的 `ACTION_SEND`；`MainActivity.java` 接收文件 | 目前为选择器与 `useNativeFileDrop.ts` | 缺失 Android 分享接收和 iOS 分享扩展；拖放不是系统分享 |
| 全部页面、连续页码范围 | `PrintFragment.java`、`PrintingActivity.java` 的 Ghostscript 裁页 | `PreviewPage.tsx`、`pdf_service.rs::create_print_layout` | 有条件具备；非全部页依赖本机 `pdfjam`，手机不可直接复用 |
| 每面 1/2/4/6/8 页 | `res/values/strings.xml::printer_page_sheet_options` | `pdf_service.rs::layout_arguments` 为 1/2/4/6/9 | 缺 8-up；9-up 不等价于 8-up；现有多页布局依赖 `pdfjam` |
| 通过队列选择单面或双面 | 上游 `printer_names` 的普通队列与 `-sx` 队列 | `data/printers.ts`、`ssh_service.rs` 的 `sides` 参数 | 具备，并增加显式长边/短边选择；真实服务器对参数的支持仍需验收 |
| 内置打印机列表 | `strings.xml`、`core/Storage.java` | `data/printers.ts`、`print_list_queues` | 具备；不应照搬上游历史队列名称 |
| 自定义实验室打印机 | `fragment_settings.xml`、`Storage.getPrinterList()` | 学生端过滤为公共队列；职员端可展示发现的队列 | 部分具备；缺用户显式添加并验证自定义队列的入口 |
| 自定义 SSH 服务器 | `SettingsFragment.java`、自定义服务器偏好 | `SettingsPage.tsx` Host/Port 配置；登录入口为 stu/stf | 具备配置入口；网络预检仍固定探测 stu/stf，自定义服务器应独立验证 |
| 保存账号及密码 | `core/Storage.java` 的 SharedPreferences | `credential_service.rs`、`credentials.ts`、登录记住选项 | 桌面具备系统密码存储；Android/iOS 持久凭据尚未验证 |
| 查询剩余配额 | `QuotaFragment.java` 登录 MySoC 并解析 HTML，独立配额页 | `ssh_service.rs::ssh_get_print_quota` 使用 PTY + `pusage`；DebugPage 和 MCP 可调用 | **普通用户 UI 缺失**；存在 API 不代表已实现配额页。两种数据源的字段与单位尚未对照实测 |
| 查看所有已配置打印机队列 | `StatusActivity.RefreshStatusTask` 逐个 `lpq` | `useBackgroundMonitor.ts`、打印机详情、`print_check_printer_status` | 具备队列列表和轮询 |
| 查看缺纸等打印机提示 | 上游状态页显示原始 `lpq` 输出 | `parse_lpq_jobs` 只保留可解析任务行；成功查询映射为 Online | 部分缺失；空任务列表不应掩盖设备错误，需保留队列级诊断 |
| 删除自己的所有待打印任务 | `StatusActivity.DeleteTask` 遍历队列运行 `lprm -P <queue> -` | `print_cancel_job` 接收本地 job ID，再查远端回执 | 部分具备；缺无本地历史任务的取消与跨队列“取消我的任务”。上游也不承诺取消 NUSNET/Samba 提交的任务 |
| 上传和转换阶段进度 | `PrintingActivity.java` 阶段列表与 SFTP 字节回调 | 粗粒度 Uploading/Queued 等状态 | 缺字节进度、明确转换阶段和可恢复的操作事件 |
| 打印准备过程中取消 | `PrintingActivity.onFinishButtonPress`、任务取消检查 | 本地任务取消不等于传输/转换协作取消 | 缺贯穿转换、上传、提交边界的取消令牌；应防止显示取消后仍提交 |
| 首次转换器准备、缓存与清理 | `PrintingActivity.java` 上传/下载远端转换器并检查文件；远端临时目录清理 | `document_service.rs` 缓存转换结果；SSH 提交清理临时文件 | 用户目的部分覆盖，部署模型不同；不必复刻旧 JAR 下载流程 |
| 蜂窝网络首次大下载提醒 | 用户手册描述；本次对应 Java 中未找到等价提醒分支 | 未找到计费网络策略 | 上游为“手册声称、源码未确认”，不算已确认功能缺口；移动版按实际上传体积设计提示 |
| 找回 Unix 凭据 | `SettingsFragment.java` 打开 MySoC 账号管理 | Help 页面有 DocHub，但无专门找回账号入口 | 缺入口；Help 中 NUSNET 表述需与实际 SoC Unix 登录要求统一 |
| 使用帮助与反馈 | `HelpFragment.java`：说明、源码链接、附设备信息的邮件草稿 | `HelpPage.tsx`：说明、FAQ、DocHub、Technical Services 邮件链接 | 帮助部分覆盖；缺应用问题诊断导出与应用源码/问题入口，不应把应用缺陷一律发给学校 |
| Android 安装运行 | Manifest、Gradle 与应用生命周期 | 仅 Tauri `mobile_entry_point` 标记和移动图标，无生成的 Android/iOS 工程 | 缺可构建、已验收的手机应用；响应式网页不等于手机打印支持 |
| Android 2.1 兼容 | 上游 README 与手册的历史支持目标 | 当前 Tauri 2 技术栈 | 有意不对齐历史 OS；最低系统版本须随实际工具链验证确定 |

## 本项目已有扩展及应避免的误判

- 当前增加静态图片、更多 Office/文本格式导入；桌面转换依赖和限制见 README，手机支持不能由扩展名列表推导。
- 当前增加预览、份数、显式双面翻转边、A3/A4、离散页码选择、历史与备份、地图、CLI、MCP 和桌面虚拟打印机。它们不是上游缺口。
- 上游手册把实时布局预览、多份打印、长/短边翻转和 Android 系统打印 API 列为未来工作。不能宣称这些都是上游既有功能。
- **Booklet 不是该上游的对齐项。** 当前 README 宣称支持，但 `pdf_service.rs` 实际返回未实现；应另列产品一致性问题。
- `extract_page_range` 仍是复制原文件的未使用占位函数；实际提交走 `create_print_layout`。迁移布局服务时直接移除该死代码，不能把它当作可复用裁页实现。
- 当前从 `lpq` 消失就标记 Completed，不能证明纸张已打印成功。手机断线恢复应区分“离开队列”和“已确认完成”。

## 优先顺序

1. **P0，手机主路径**：原生工程与依赖验证；系统文件选择/分享；沙箱持久导入；直接 SSH；PDF 提交；前后台恢复与提交结果不明处理。
2. **P1，上游功能对齐**：普通用户配额入口、8-up 和不依赖外部进程的页码/布局、自定义队列、远端任务取消、设备状态诊断、阶段进度与准备阶段取消。
3. **P1，完整文档支持**：明确 Office 转换方案并完成六种原格式的移动端验收。PDF 首版必须标注只是子集，不能标为完整对齐。
4. **P2，辅助体验**：找回账号、诊断导出、应用反馈入口、计费网络提示。

实施边界、任务依赖和验收标准见 [手机端实施规格](mobile-support-spec.md)。

## 验证记录

- 已执行 `npm run lint && npm test`：TypeScript、设计约束检查通过，7 个现有前端测试通过。
- 本次只新增审计和实施文档，没有改变运行代码、版本、构建和发布逻辑。
- 未执行 Rust/mobile 构建、设备 UI 测试或真实服务器打印；现有检查通过不能证明上表远端功能可用。

## 证据入口

- [上游 README](https://github.com/yeokm1/nus-soc-print/blob/127a77774e250c6ac918165ce736bc1e109e8b7c/README.md)
- [上游应用源码](https://github.com/yeokm1/nus-soc-print/tree/127a77774e250c6ac918165ce736bc1e109e8b7c/app/src/main/java/com/yeokm1/nussocprintandroid)
- [上游资源与功能选项](https://github.com/yeokm1/nus-soc-print/blob/127a77774e250c6ac918165ce736bc1e109e8b7c/app/src/main/res/values/strings.xml)
- [上游 Manifest](https://github.com/yeokm1/nus-soc-print/blob/127a77774e250c6ac918165ce736bc1e109e8b7c/app/src/main/AndroidManifest.xml)
- [上游用户/开发手册](https://github.com/yeokm1/nus-soc-print/tree/127a77774e250c6ac918165ce736bc1e109e8b7c/user-dev-guide)

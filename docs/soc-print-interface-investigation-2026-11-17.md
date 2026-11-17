# SoC 打印接口：官方文档与实测

核查日期：2026-11-17，Asia/Singapore。目的地 psc111。本文记录调查结果，不代表相关解析与界面调整已经实现。

本文保留修复前的调查基线。后续 Rust 驱动安装、长格式任务跟踪、Word 短边双面及 GUI 预览已实机验证，见[后续修复与验收记录](repair-validation-2026-11-17.md)。

## 核心结论

1. 当前 SoC 登录主机暴露 BSD 风格的 lpr/lpq/lprm/lpc；不能把它当成完整 CUPS 客户端环境。
2. 一次真实提交中 lpr 返回 0，stdout/stderr 均为空，未给出任务编号。
3. 同一次任务的 lpq 短格式把文件名显示成 `...`，lpq -l 才提供完整远端路径。现有按短格式文件名匹配 attempt UUID 的算法会失败。
4. 已观察到队列等待、active、打印机面板 printing 信息和最终 no entries。用户确认收到同一张纸正反两页，默认双面链路通过。
5. 本次未验证短边翻页、颜色、纸盒、A3 或多份的远端参数语义；不能把参数写进命令等同于设备执行。

## 官方来源

以下 SoC 页面通过用户登录后的内置浏览器实际阅读，未绕过访问限制：

- [Unix 打印指南](https://dochub.comp.nus.edu.sg/cf/guides/printing/stf-stu)，页面标记修改日期 2026-03-18。
- [打印机与队列](https://dochub.comp.nus.edu.sg/cf/guides/printing/print-queues)，页面标记修改日期 2026-10-24。
- [删除打印任务](https://dochub.comp.nus.edu.sg/cf/guides/printing/removing-jobs)。
- [故障排查](https://dochub.comp.nus.edu.sg/cf/guides/printing/troubleshooting)。

学校确认的基本接口是 `lpr -P QUEUE FILE`、`lpq -P QUEUE`、`lprm -P QUEUE JOB_ID`，并指向 `/etc/printcap`。Unix 路径接收 PDF、PostScript、ASCII；Office 和图片应先转换。多版排版示例使用 pdfjam 预处理。学校要求取消后重新查询队列核实。

psc111 位于 COM1-01-11，型号 LEXMARK MS810DN，A4，无封面页，属于受限访问队列。学校说明黑白 PostScript 队列无后缀默认双面，`-sx` 为单面；彩色队列无后缀默认单面，不能共用一种后缀推断规则。

本机读取到对应 printcap 条目：

```text
psc111:rm=lpdhost:rp=psc111:sd=/var/spool/lpd/psc111:mx#1000000:
psc111-sx:rm=lpdhost:rp=psc111-sx:sd=/var/spool/lpd/psc111-sx:mx#1000000:
```

没有发现 psc111-dx；这不表示其他打印机没有 -dx 队列。队列选择应以实际目录和官方语义共同决定，不应一律拼接后缀。

## 标准文档与适用边界

- [CUPS lpr](https://www.cups.org/doc/man-lpr.html)：描述 `-o media`、`-o sides` 等 CUPS 选项。该文档不能证明 SoC 自定义 lpr 支持这些选项。
- [CUPS lp](https://www.cups.org/doc/man-lp.html)：支持返回任务 ID，`-s` 抑制输出；当前 SoC PATH 没有此程序，不能直接迁移命令。
- [CUPS lpq](https://www.cups.org/doc/man-lpq.html)：短/长队列查询。当前 SoC 帮助显示更窄的参数集合，不能假定 `-h/-U/-a/+interval` 均可用。
- [OpenBSD lpq](https://man.openbsd.org/lpq.1)：短格式行宽有限，长格式展开任务文件；可按用户或编号过滤。它是格式解释参考，不是当前 SoC 二进制版本证明。
- [RFC 1179](https://www.rfc-editor.org/rfc/rfc1179.html)：LPD 短/长队列查询、接收任务、删除任务。它没有提供 IPP 式的统一历史完成属性。传统任务编号存在复用风险，不能当成全局唯一身份。
- [RFC 8011](https://www.rfc-editor.org/rfc/rfc8011.html)：IPP 的 Get-Jobs/Get-Job-Attributes 可提供 job-state、job-state-reasons，以及可选的 number-of-intervening-jobs、job-impressions-completed 等。尚未验证当前 SoC 对用户开放这些 IPP 接口；客户端没有 ipptool 也不等于服务器不支持 IPP。

## 命令探测

| 探测 | 实际结果 | 结论 |
|---|---|---|
| command -v lpr/lpq/lprm/lpc | 均为 /usr/local/bin 下程序 | 程序可用 |
| command -v lp/lpstat/lpoptions/ipptool/printquota | 无输出 | 当前 PATH 不可用；不推断整台主机绝对未安装 |
| man -w 与 man lpr/lpq | exit 16 | 当前未找到本机手册 |
| lpq -P psc111 | exit 0, no entries（空闲时） | 短格式查询可用 |
| lpq -l -P psc111 | exit 0, no entries（空闲时） | 长格式查询可用 |
| lpq -P 不存在队列 | exit 1, unknown printer | 不可当成空队列 |
| lpq --help | exit 1，输出 usage | 支持说明见下方 |
| lpc help | exit 0，列出 status 及管理命令 | 仅读取帮助，未执行管理动作 |
| lpc status psc111 | enabled / no entries / no daemon present | 空闲时本机无 daemon 不能直接推断物理打印机离线 |
| lpr --help / -o 参数，搭配不存在队列和文件 | unknown printer | 未发生打印；无法证明 -o 的语义支持 |

实际 lpq usage：

```text
lpq [-l] [-Pprinter] [user ...] [job ...]
```

禁止把 `lprm` 无编号调用当作帮助探测，它可能取消当前任务。此次没有执行任何删除任务、停机、启停队列、调整优先级操作。

## 一次真实打印的观测记录

使用不含个人信息的两页测试 PDF；一次提交、一份，未自动重试。命令仅使用学校文档明确支持的基本形式：

```sh
lpr -P psc111 /tmp/print-soc-verification-<UUID>.pdf
```

提交结果：exit 0，标准输出和标准错误均为空。测试文件暂存在远端 /tmp，提交后已删除；私有本机诊断记录保留。

短格式（账号与 UUID 已匿名化）：

```text
Rank   Owner        Job  Files       Total Size
active <test-owner> 3    ...         3049 bytes
```

长格式先后观察到：

```text
<test-owner>: 1st       [job 003stu1]
    /tmp/print-soc-verification-<UUID>.pdf 3049 bytes

<test-owner>: active    [job 003stu1.comp.nus.edu.sg]
    /tmp/print-soc-verification-<UUID>.pdf 3049 bytes
```

服务器另有面板诊断区域：

```text
Owner        Job  File            Status   Console-Panel-Message
<test-owner> 003  print-soc-veri   printing Printing page 1/1, copy 1/1
```

还观察到发送到打印机的 100% 进度条。该百分比不是物理出纸进度；面板中的页数也不应直接除以输入 PDF 的页数（本次 PDF 为两页，面板出现 1/1）。后续查询返回 `no entries`。

用户明确确认：已收到，同一张纸正反两页。它证明默认双面出纸；未确认短边装订方向。测试 PDF 上的设置说明不能替代实际提交参数：本次实际命令没有传递短边选项。

第一次并行查询出现短格式为空、长格式已有任务，说明两条命令不是原子快照。不能把不同采样时刻的行号直接拼成一个“准确队列位置”。

## 对算法和接口的具体要求

- 主身份关联使用长格式的账号、完整文件路径中的 attempt UUID、队列；保留远端任务数字 ID 与来源主机，数字 ID 统一处理前导零。
- 长格式需要独立的分块解析器（任务头 + 一个或多个文件行），不能复用现有单行 Rank 表解析器。
- 短格式里的 `...`、截断文件名只能用于展示，不能用来证明“不存在该任务”。
- `jobs_ahead` 只能从同一完整快照的调度顺序计算，并明确范围是某个逻辑队列。没有证据时返回 null；不能返回 0。
- 本次只观察了一个真实任务；多用户排队、跨逻辑队列合并顺序和暂停任务排序尚未实测。
- `active` 是 spooler 状态；面板消息另设可选字段，例如 device_message 与来源、时间。没有验证字段含义前，不转换为精确物理百分比。
- 新鲜、完整且匹配的队列观测用于更新 queued/processing/left_queue；实体完成依据单独记录为用户确认或可信设备回执。
- 取消必须指定精确队列和本人任务编号，返回成功后重新查询核实；不以 lprm 退出成功直接声称纸张已停止。
- 对外跟踪结果应含 job_id、attempt_id、remote_job_id、state、evidence、queue_position、jobs_ahead、checked_at、stale、tracking_error 和可选 device_message。
- 活动任务轮询应与完整打印机目录刷新分离；目前二者串行会拉长状态更新时间。

## 本轮边界

本轮完成官方资料核查、只读探测和一次真实的远端打印/离队/实物确认。未修改业务代码，未替换本机旧 CUPS 驱动，未验证系统对话框到 Rust 后端、GUI 预览、短边翻页、A3 或多份输出。这些属于前面仍待完成的整机验收，不以本轮 SSH 基线测试代替。

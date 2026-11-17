import { useI18n } from '@/lib/i18n'
import type { PrinterStatus } from '@/types/printer'

const copy = {
  en: {
    queue: 'Print queue', refresh: 'Refresh', updating: 'Updating', updated: 'Updated',
    waiting: 'waiting', empty: 'No jobs in the queue', emptyHint: 'Your next document can start here.',
    unavailable: 'Queue unavailable', retryHint: 'Refresh to try again.', unknown: 'Status unavailable',
    details: 'Technical details', noResponse: 'No response from the server.', active: 'Processing',
    position: 'Position', document: 'Document', owner: 'Account', mine: 'You',
    mono: 'Black & white', color: 'Colour', duplex: 'Double-sided', simplex: 'Single-sided',
    printerInfo: 'Location & printer', directions: 'Directions', locate: 'Use my location', locating: 'Locating…',
    model: 'Model', banner: 'Cover page', included: 'Included', none: 'None',
    defaultPrinter: 'Default printer', setDefault: 'Set as default', usePrinter: 'Use this printer',
    queueChoice: 'Print mode', preparing: 'Preparing document', cancel: 'Cancel', cancelling: 'Cancelling…',
    upload: 'Uploading', progressError: 'Unable to update progress', cancelError: 'Unable to cancel',
    confirmed: 'You confirmed receiving the printed document.',
    departed: 'No longer in the queue. Check the printer for your document.',
    uncertain: 'Check the queue before sending this document again.',
    unresolved: 'The server accepted this document without a queue ID. We will check for an empty queue; if you already have the paper, confirm below.',
    checked: 'I checked both the queue and the printed output.',
    received: 'Output received', notPrinted: 'Not queued or printed',
    historyOnly: 'These actions update history only. They do not print another copy.',
    olderJob: 'This older job has no recorded account. Confirm that the connected account originally submitted it to resume tracking.',
    originalAccount: 'This job belongs to the connected account.', linkAccount: 'Resume tracking',

    jobId: 'Job', queued: 'Queued', size: 'Size', previewNotice: 'Preview data',
  },
  zh: {
    queue: '打印队列', refresh: '刷新', updating: '更新中', updated: '更新于',
    waiting: '个排队任务', empty: '暂无排队任务', emptyHint: '可以提交下一份文档。',
    unavailable: '暂时无法查看队列', retryHint: '请刷新重试。', unknown: '状态暂不可用',
    details: '技术详情', noResponse: '服务器未返回信息。', active: '处理中',
    position: '顺序', document: '文档', owner: '账号', mine: '你',
    mono: '黑白', color: '彩色', duplex: '双面', simplex: '单面',
    printerInfo: '位置与设备', directions: '路线', locate: '使用我的位置', locating: '定位中…',
    model: '型号', banner: '封面页', included: '包含', none: '无',
    defaultPrinter: '默认打印机', setDefault: '设为默认', usePrinter: '使用此打印机',
    queueChoice: '打印模式', preparing: '正在准备文档', cancel: '取消', cancelling: '取消中…',
    upload: '正在上传', progressError: '暂时无法更新进度', cancelError: '暂时无法取消',
    confirmed: '你已确认收到打印文档。',
    departed: '任务已离开队列，请到打印机确认文档。',
    uncertain: '请先检查队列，再决定是否重新提交。',
    unresolved: '服务器已接收文档，但未返回队列编号。系统会继续检查队列；如果你已经拿到纸张，可以在下方确认完成。',
    checked: '我已检查打印队列和实际纸张。',
    received: '已收到打印结果', notPrinted: '未排队且未打印',
    historyOnly: '这些操作只更新历史记录，不会重新打印。',
    olderJob: '这条旧记录未保存账号信息。请确认最初提交它的是当前连接的账号，再恢复跟踪。',
    originalAccount: '此任务由当前连接的账号提交。', linkAccount: '恢复跟踪',

    jobId: '任务', queued: '排队中', size: '大小', previewNotice: '预览数据',
  },
}

export function usePrintCopy() {
  const { locale } = useI18n()
  return { text: copy[locale], locale }
}

export function printerStatusLabel(status: PrinterStatus, locale: 'en' | 'zh') {
  const labels = {
    Online: ['Ready', '就绪'], Busy: ['Queue active', '队列处理中'],
    OutOfPaper: ['Out of paper', '缺纸'], Offline: ['Offline', '离线'],
    Error: ['Needs attention', '需要处理'], Unknown: ['Status unavailable', '状态暂不可用'],
  }
  return labels[status][locale === 'zh' ? 1 : 0]
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

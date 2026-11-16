import type { PrintJob } from '@/types/printer'

export function jobStatusLabel(job: PrintJob, locale: 'en' | 'zh' = 'en'): string {
  const label = jobLabel(job)
  if (locale === 'en') return label
  const translated: Record<string, string> = {
    Cancelled: '已取消', Failed: '未成功', 'No longer queued': '已离开队列',
    Processing: '处理中', 'Preparing document': '准备文档', Uploading: '上传中',
    'Preparing to print': '准备打印', Submitting: '提交中',
    'Check submission': '请确认提交结果', Queued: '排队中', Submitted: '已提交', Pending: '待提交',
  }
  return translated[label] || label
}

function jobLabel(job: PrintJob): string {
  if (job.status === 'Cancelled') return 'Cancelled'
  if (job.status === 'Failed') return 'Failed'
  if (job.status === 'Completed') return 'No longer queued'
  if (job.status === 'Printing') return 'Processing'
  switch (job.progress?.stage) {
    case 'Preparing': return 'Preparing document'
    case 'Uploading': return 'Uploading'
    case 'Formatting': return 'Preparing to print'
    case 'Submitting': return 'Submitting'
    case 'SubmissionUnknown': return 'Check submission'
    case 'Accepted': return job.lpq_job_id ? 'Queued' : 'Submitted'
    case 'LeftQueue': return 'No longer queued'
    default: return job.status
  }
}

export function uploadPercent(job: PrintJob): number | undefined {
  const progress = job.progress
  if (job.status !== 'Uploading' || progress?.stage !== 'Uploading' || progress.total_bytes <= 0) return undefined
  return Math.min(100, Math.max(0, Math.floor(progress.bytes_sent / progress.total_bytes * 100)))
}

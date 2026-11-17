import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/lib/job-progress.ts', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
const { jobStatusLabel, uploadPercent } = exports

test('percentage belongs only to the byte transfer, not server or physical printing', () => {
  const job = { status: 'Uploading', progress: { stage: 'Uploading', bytes_sent: 25, total_bytes: 100 } }
  assert.equal(uploadPercent(job), 25)
  for (const stage of ['Preparing', 'Formatting', 'Submitting', 'Accepted', 'SubmissionUnknown', 'LeftQueue']) {
    assert.equal(uploadPercent({ ...job, progress: { ...job.progress, stage } }), undefined)
  }
  assert.equal(uploadPercent({ ...job, status: 'Cancelled' }), undefined)
  assert.equal(uploadPercent({ ...job, progress: { ...job.progress, total_bytes: 0 } }), undefined)
})

test('receipt, active spooler and departure are distinct from printing success', () => {
  assert.equal(jobStatusLabel({ status: 'Completed' }), 'No longer queued')
  assert.equal(jobStatusLabel({ status: 'Printing' }), 'Processing')
  assert.equal(jobStatusLabel({ status: 'Queued', progress: { stage: 'Accepted' } }), 'Awaiting confirmation')
  assert.equal(jobStatusLabel({ status: 'Queued', lpq_job_id: '123', progress: { stage: 'Accepted' } }), 'Queued')
  assert.equal(jobStatusLabel({ status: 'Queued', progress: { stage: 'SubmissionUnknown' } }), 'Check submission')
  assert.equal(jobStatusLabel({ status: 'Cancelled', progress: { stage: 'Uploading' } }), 'Cancelled')
})

test('confirmed physical output differs from inferred queue departure', () => {
  const job = { status: 'Completed', progress: { stage: 'OutputConfirmed' } }
  assert.equal(jobStatusLabel(job), 'Output confirmed')
  assert.equal(jobStatusLabel(job, 'zh'), '已完成（已确认出纸）')
  assert.equal(jobStatusLabel({ status: 'Queued', progress: { stage: 'Accepted' } }, 'zh'), '等待确认')
})

test('queue position is explicit and stale positions are not shown as current', () => {
  const { queuePositionLabel } = exports
  const now = Date.now()
  const job = { status: 'Queued', tracking: { checked_at: new Date(now).toISOString(), jobs_ahead: 2, stale: false } }
  assert.equal(queuePositionLabel(job, 'zh', now), '前面还有 2 个任务')
  assert.equal(queuePositionLabel({ ...job, tracking: { ...job.tracking, jobs_ahead: 0 } }, 'en', now), '0 jobs ahead')
  assert.equal(queuePositionLabel({ ...job, tracking: { ...job.tracking, jobs_ahead: null } }, 'en', now), 'Queue position unavailable')
  assert.equal(queuePositionLabel(job, 'en', now + 16000), 'Queue status needs refresh')
  assert.equal(queuePositionLabel({ ...job, status: 'Completed' }, 'en', now), undefined)
})

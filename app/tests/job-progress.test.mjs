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
  assert.equal(jobStatusLabel({ status: 'Queued', progress: { stage: 'Accepted' } }), 'Submitted')
  assert.equal(jobStatusLabel({ status: 'Queued', lpq_job_id: '123', progress: { stage: 'Accepted' } }), 'Queued')
  assert.equal(jobStatusLabel({ status: 'Queued', progress: { stage: 'SubmissionUnknown' } }), 'Check submission')
  assert.equal(jobStatusLabel({ status: 'Cancelled', progress: { stage: 'Uploading' } }), 'Cancelled')
})

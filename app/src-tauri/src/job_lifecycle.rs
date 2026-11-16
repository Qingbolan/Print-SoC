//! State transitions shared by live workers and recovery. Public status values
//! remain stable; progress records the irreversible submission boundary.
use crate::types::{PrintJob, PrintJobStatus as Status, PrintProgress, PrintStage as Stage};
use chrono::Utc;

/// The identity checked before sending lprm must still own the local job when
/// the asynchronous response arrives.
pub(crate) struct RemoteCancellation {
    attempt: crate::types::SubmissionAttempt,
    printer: String,
    queue_id: String,
}

impl RemoteCancellation {
    pub(crate) fn command(&self) -> String {
        format!("lprm -P {} {}", self.printer, self.queue_id)
    }
}

impl PrintJob {
    pub(crate) fn remote_cancellation(
        &self,
        account: &crate::types::SSHIdentity,
    ) -> Result<RemoteCancellation, String> {
        if !matches!(self.status, Status::Queued | Status::Printing) {
            return Err("This job is no longer active".into());
        }
        let attempt = self.submission.as_ref().ok_or(
            "Link this older job to its original account before cancelling it",
        )?;
        if &attempt.account != account {
            return Err("Connect to the account that submitted this job before cancelling it".into());
        }
        crate::ssh_service::validate_print_queue_name(&self.printer)?;
        let queue_id = self.lpq_job_id.as_deref()
            .map(crate::ssh_service::normalize_lpq_job_id)
            .ok_or("Cannot cancel remote job before queue ID is known")?;
        if queue_id.is_empty()
            || !queue_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!("Invalid queue job ID: {}", queue_id));
        }
        Ok(RemoteCancellation {
            attempt: attempt.clone(),
            printer: self.printer.clone(),
            queue_id,
        })
    }

    pub(crate) fn complete_remote_cancellation(&mut self, request: &RemoteCancellation) -> bool {
        let same_attempt = self.submission.as_ref().is_some_and(|attempt| {
            attempt.id == request.attempt.id && attempt.account == request.attempt.account
        });
        let same_queue = self.printer == request.printer
            && self.lpq_job_id.as_deref().map(crate::ssh_service::normalize_lpq_job_id)
                .as_deref() == Some(request.queue_id.as_str());
        if !same_attempt || !same_queue || !matches!(self.status, Status::Queued | Status::Printing) {
            return false;
        }
        self.status = Status::Cancelled;
        self.error = None;
        self.updated_at = Utc::now();
        true
    }

    pub(crate) fn adopt_account(
        &mut self,
        account: crate::types::SSHIdentity,
    ) -> Result<(), String> {
        if self.submission.is_some() || !matches!(self.status, Status::Queued | Status::Printing) {
            return Err(
                "Only older active history without an account identity can be linked".into(),
            );
        }
        uuid::Uuid::parse_str(&self.id).map_err(|_| "Invalid historical job identity")?;
        // Before attempt IDs existed, the job UUID was the remote filename.
        self.submission = Some(crate::types::SubmissionAttempt {
            id: self.id.clone(),
            account,
        });
        self.updated_at = Utc::now();
        Ok(())
    }

    pub(crate) fn request_status(
        &mut self,
        next: Status,
        error: Option<String>,
    ) -> Result<(), String> {
        if next == self.status {
            self.error = error;
            return Ok(());
        }
        let allowed = match (&self.status, &next) {
            (Status::Pending, Status::Failed | Status::Cancelled)
            | (Status::Failed, Status::Pending | Status::Cancelled) => true,
            (Status::Uploading, Status::Cancelled) => self
                .progress
                .as_ref()
                .is_some_and(|p| p.stage.cancellable()),
            _ => false,
        };
        if !allowed {
            return Err("This transition requires the submission, queue reconciliation or cancellation operation".into());
        }
        self.status = next;
        self.error = error;
        self.updated_at = Utc::now();
        Ok(())
    }

    pub(crate) fn can_delete(&self) -> bool {
        matches!(
            self.status,
            Status::Pending | Status::Failed | Status::Cancelled | Status::Completed
        )
    }

    pub(crate) fn resolve_review(&mut self, printed: bool) -> Result<(), String> {
        if self.status != Status::Queued || self.lpq_job_id.is_some() {
            return Err("Only submissions without a queue receipt can be resolved manually".into());
        }
        self.status = if printed {
            Status::Completed
        } else {
            Status::Failed
        };
        self.error = Some(if printed {
            "User confirmed the printed output after checking the queue."
        } else {
            "User confirmed this job is not queued and no output was printed. No retry was sent."
        }.into());
        self.updated_at = Utc::now();
        Ok(())
    }

    pub(crate) fn transition(&mut self, next: Stage) -> Result<(), String> {
        if self.status != Status::Uploading {
            return Err("The print worker is no longer active".into());
        }
        let previous = self.progress.as_ref().map(|p| &p.stage);
        let allowed = matches!(
            (previous, &next),
            (Some(Stage::Preparing), Stage::Uploading)
                | (Some(Stage::Uploading), Stage::Formatting)
                | (Some(Stage::Formatting), Stage::Submitting)
                | (Some(Stage::Submitting), Stage::SubmissionUnknown)
        );
        if !allowed {
            return Err(format!(
                "Invalid print transition: {:?} -> {:?}",
                previous, next
            ));
        }
        let progress = self.progress.as_mut().ok_or("Missing print progress")?;
        progress.stage = next;
        self.updated_at = Utc::now();
        Ok(())
    }

    pub(crate) fn accept_receipt(&mut self, receipt: &crate::submission_receipt::Receipt) {
        if receipt.code != 0 {
            self.status = Status::Failed;
            self.error = Some(format!(
                "Print server rejected this job: {}",
                receipt.output
            ));
            return;
        }
        self.lpq_job_id = crate::print_service::parse_lpr_job_id(&receipt.output);
        self.progress = Some(PrintProgress {
            stage: Stage::Accepted,
            bytes_sent: 0,
            total_bytes: 0,
        });
        self.error = None;
    }

    pub(crate) fn observe_queue(&mut self, snapshot: &crate::types::QueueSnapshot) {
        if !matches!(self.status, Status::Queued | Status::Printing) {
            return;
        }
        // A unique attempt filename and owner can recover silent lpr receipts.
        if self.lpq_job_id.is_none() {
            if let Some(attempt) = &self.submission {
                let names = [
                    format!("{}.pdf", attempt.id),
                    format!("{}.pdf.scaled.pdf", attempt.id),
                ];
                let candidates: Vec<_> = snapshot
                    .jobs
                    .iter()
                    .filter(|row| {
                        row.owner == attempt.account.username
                            && std::path::Path::new(&row.file)
                                .file_name()
                                .and_then(|p| p.to_str())
                                .is_some_and(|name| names.iter().any(|expected| expected == name))
                    })
                    .collect();
                if candidates.len() == 1 {
                    self.lpq_job_id = Some(candidates[0].job_id.clone());
                    self.progress = Some(PrintProgress {
                        stage: Stage::Accepted,
                        bytes_sent: 0,
                        total_bytes: 0,
                    });
                    self.error = None;
                }
            }
        }
        let Some(id) = &self.lpq_job_id else {
            return;
        };
        match snapshot
            .jobs
            .iter()
            .find(|row| {
                crate::print_service::lpq_job_id_matches(row, id)
                    && self.submission.as_ref().is_none_or(|attempt| row.owner == attempt.account.username)
            })
        {
            Some(row) => {
                self.status = if row.rank.eq_ignore_ascii_case("active") {
                    Status::Printing
                } else {
                    Status::Queued
                }
            }
            None if snapshot.jobs_complete => {
                self.status = Status::Completed;
                self.progress = Some(PrintProgress {
                    stage: Stage::LeftQueue,
                    bytes_sent: 0,
                    total_bytes: 0,
                });
            }
            _ => {}
        }
    }

    /// Called only when loading persisted jobs, before workers exist. Never
    /// restart a worker or infer remote rejection from a local interruption.
    pub(crate) fn recover_interrupted(&mut self) -> bool {
        if self.status != Status::Uploading {
            return false;
        }
        let safe_to_retry = self
            .progress
            .as_ref()
            .is_some_and(|p| p.stage.cancellable());
        if safe_to_retry {
            self.status = Status::Failed;
            self.error = Some(
                "Preparation was interrupted before submission. You can print this document again."
                    .into(),
            );
        } else {
            self.status = Status::Queued;
            self.progress = Some(PrintProgress {
                stage: Stage::SubmissionUnknown,
                bytes_sent: 0,
                total_bytes: 0,
            });
            self.error = Some(
                "Submission not confirmed after restart. Check the queue before printing again."
                    .into(),
            );
        }
        self.updated_at = Utc::now();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job(stage: Option<Stage>) -> PrintJob {
        let mut job: PrintJob = serde_json::from_value(serde_json::json!({
            "id":"test", "name":"test.pdf", "file_path":"test.pdf", "printer":"psts-dx",
            "settings":{"copies":1,"duplex":"DuplexLongEdge","orientation":"Portrait","page_range":{"type":"All"},"pages_per_sheet":1,"booklet":false,"paper_size":"A4"},
            "status":"Uploading", "created_at":Utc::now(), "updated_at":Utc::now(), "error":null,"lpq_job_id":null
        })).unwrap();
        job.progress = stage.map(|stage| PrintProgress {
            stage,
            bytes_sent: 0,
            total_bytes: 100,
        });
        job
    }
    #[test]
    fn restart_distinguishes_preparation_from_possible_remote_acceptance() {
        for stage in [Stage::Preparing, Stage::Uploading, Stage::Formatting] {
            let mut job = job(Some(stage));
            assert!(job.recover_interrupted());
            assert_eq!(job.status, Status::Failed);
            assert!(!job.recover_interrupted());
        }
        for stage in [
            None,
            Some(Stage::Submitting),
            Some(Stage::SubmissionUnknown),
        ] {
            let mut job = job(stage);
            assert!(job.recover_interrupted());
            assert_eq!(job.status, Status::Queued);
            assert_eq!(job.progress.unwrap().stage, Stage::SubmissionUnknown);
        }
    }
    #[test]
    fn unknown_submission_requires_positive_evidence_and_exact_owner() {
        use crate::types::{SSHIdentity, SubmissionAttempt};
        let mut job = job(Some(Stage::Submitting));
        job.recover_interrupted();
        job.submission = Some(SubmissionAttempt {
            id: "unique-attempt".into(),
            account: SSHIdentity {
                host: "stu".into(),
                port: 22,
                username: "alice".into(),
            },
        });
        job.observe_queue(&crate::queue_status::parse("no entries"));
        assert_eq!(job.status, Status::Queued);
        assert!(job.lpq_job_id.is_none());
        job.observe_queue(&crate::queue_status::parse("Rank Owner Job Files Total Size\nactive bob 42 unique-attempt.pdf.scaled.pdf 100 bytes"));
        assert!(job.lpq_job_id.is_none());
        job.observe_queue(&crate::queue_status::parse("Rank Owner Job Files Total Size\nactive alice 42 unique-attempt.pdf.scaled.pdf 100 bytes"));
        assert_eq!(job.lpq_job_id.as_deref(), Some("42"));
        assert_eq!(job.status, Status::Printing);
        job.observe_queue(&crate::queue_status::parse("printer offline\nno entries"));
        assert_eq!(job.status, Status::Printing);
        job.observe_queue(&crate::queue_status::parse("no entries"));
        assert_eq!(job.status, Status::Completed);
    }

    #[test]
    fn recovered_receipt_distinguishes_rejection_from_accepted_job() {
        let mut accepted = job(Some(Stage::Submitting));
        accepted.recover_interrupted();
        accepted.accept_receipt(&crate::submission_receipt::Receipt {
            code: 0,
            output: "request id is psts-123 (1 file(s))".into(),
        });
        accepted.observe_queue(&crate::queue_status::parse("no entries"));
        assert_eq!(accepted.status, Status::Completed);
        let mut rejected = job(Some(Stage::Submitting));
        rejected.recover_interrupted();
        rejected.accept_receipt(&crate::submission_receipt::Receipt {
            code: 1,
            output: "queue disabled".into(),
        });
        rejected.observe_queue(&crate::queue_status::parse("no entries"));
        assert_eq!(rejected.status, Status::Failed);
    }

    #[test]
    fn external_updates_and_history_deletion_cannot_bypass_the_worker() {
        let mut preparing = job(Some(Stage::Preparing));
        assert!(!preparing.can_delete());
        preparing.request_status(Status::Cancelled, None).unwrap();
        assert!(preparing.can_delete());
        let mut submitting = job(Some(Stage::Submitting));
        for next in [
            Status::Pending,
            Status::Failed,
            Status::Cancelled,
            Status::Completed,
        ] {
            assert!(submitting.request_status(next, None).is_err());
        }
        submitting.recover_interrupted();
        assert!(!submitting.can_delete());
        submitting.resolve_review(false).unwrap();
        assert!(submitting.can_delete());
        assert!(submitting.resolve_review(true).is_err());
    }

    #[test]
    fn legacy_history_can_be_linked_once_without_changing_remote_job_identity() {
        let mut old = job(Some(Stage::Submitting));
        old.id = uuid::Uuid::new_v4().to_string();
        old.recover_interrupted();
        let account = crate::types::SSHIdentity {
            host: "stu".into(),
            port: 22,
            username: "alice".into(),
        };
        old.adopt_account(account.clone()).unwrap();
        assert_eq!(old.submission.as_ref().unwrap().id, old.id);
        assert_eq!(old.submission.as_ref().unwrap().account, account);
        assert!(old.adopt_account(account).is_err());
        assert_eq!(old.status, Status::Queued);
        assert!(old.lpq_job_id.is_none());
    }

    fn queued_job() -> PrintJob {
        let mut queued = job(Some(Stage::Accepted));
        queued.status = Status::Queued;
        queued.lpq_job_id = Some("psts-42".into());
        queued.submission = Some(crate::types::SubmissionAttempt {
            id: "attempt-one".into(),
            account: crate::types::SSHIdentity { host: "stu".into(), port: 22, username: "alice".into() },
        });
        queued
    }

    #[test]
    fn cancellation_requires_known_original_account_and_queue_id() {
        let mut queued = queued_job();
        let account = queued.submission.as_ref().unwrap().account.clone();
        assert_eq!(queued.remote_cancellation(&account).unwrap().command(), "lprm -P psts-dx 42");
        let mut other = account.clone();
        other.username = "bob".into();
        assert!(queued.remote_cancellation(&other).is_err());
        queued.lpq_job_id = Some(String::new());
        assert!(queued.remote_cancellation(&account).is_err());
        queued.lpq_job_id = Some("42".into());
        queued.submission = None;
        assert!(queued.remote_cancellation(&account).is_err());
    }

    #[test]
    fn delayed_cancellation_preserves_terminal_states_and_new_attempts() {
        let mut queued = queued_job();
        let request = queued.remote_cancellation(&queued.submission.as_ref().unwrap().account).unwrap();
        for status in [Status::Completed, Status::Failed, Status::Cancelled] {
            queued.status = status.clone();
            assert!(!queued.complete_remote_cancellation(&request));
            assert_eq!(queued.status, status);
        }
        queued.status = Status::Queued;
        queued.submission.as_mut().unwrap().id = "attempt-two".into();
        assert!(!queued.complete_remote_cancellation(&request));
        assert_eq!(queued.status, Status::Queued);
        queued.submission.as_mut().unwrap().id = "attempt-one".into();
        assert!(queued.complete_remote_cancellation(&request));
        assert_eq!(queued.status, Status::Cancelled);
    }

    #[test]
    fn recycled_queue_id_cannot_track_another_owners_job() {
        let mut queued = queued_job();
        queued.observe_queue(&crate::queue_status::parse(
            "Rank Owner Job Files Total Size\nactive bob 42 another.pdf 100 bytes",
        ));
        assert_eq!(queued.status, Status::Completed);
        assert_eq!(queued.progress.unwrap().stage, Stage::LeftQueue);
    }

    #[test]
    fn worker_cannot_skip_submission_boundary_or_continue_after_cancel() {
        let mut job = job(Some(Stage::Preparing));
        assert!(job.transition(Stage::Submitting).is_err());
        job.transition(Stage::Uploading).unwrap();
        job.transition(Stage::Formatting).unwrap();
        job.status = Status::Cancelled;
        assert!(job.transition(Stage::Submitting).is_err());
        job.status = Status::Uploading;
        job.transition(Stage::Submitting).unwrap();
        assert!(!job.progress.as_ref().unwrap().stage.cancellable());
        job.transition(Stage::SubmissionUnknown).unwrap();
        assert!(job.transition(Stage::Uploading).is_err());
    }
}

use crate::core::error::{ObjectBuilderError, Result};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

/// Smallest gap between two events pushed to the dialog. The scan reports every
/// 128 sprites, which on a cached archive is thousands of events per second —
/// more than the progress bar can paint and enough to keep the UI thread busy.
const EMIT_INTERVAL: Duration = Duration::from_millis(60);

/// One step of an optimization run, in the order they happen.
///
/// The dialog shows the stage the run is actually in instead of a single
/// "analyzing" label: the passes have wildly different costs, and the two that
/// read the SPR are the ones that make a run take minutes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptimizationStage {
    Indexing,
    HashingOverrides,
    ComparingOverrides,
    ReadingChecksums,
    DecodingSprites,
    Grouping,
    StagingRemovals,
    RewritingReferences,
    RebuildingIndex,
}

impl OptimizationStage {
    /// Machine key the dialog translates. The English `status` travels with it
    /// only as the fallback for a stage the frontend does not know yet.
    pub const fn key(self) -> &'static str {
        match self {
            Self::Indexing => "indexing",
            Self::HashingOverrides => "hashingOverrides",
            Self::ComparingOverrides => "comparingOverrides",
            Self::ReadingChecksums => "readingChecksums",
            Self::DecodingSprites => "decodingSprites",
            Self::Grouping => "grouping",
            Self::StagingRemovals => "stagingRemovals",
            Self::RewritingReferences => "rewritingReferences",
            Self::RebuildingIndex => "rebuildingIndex",
        }
    }

    pub const fn status(self) -> &'static str {
        match self {
            Self::Indexing => "Indexing the sprite table",
            Self::HashingOverrides => "Hashing edited sprites",
            Self::ComparingOverrides => "Comparing edited sprites against the archive",
            Self::ReadingChecksums => "Reading cached sprite checksums",
            Self::DecodingSprites => "Decoding sprites from the archive",
            Self::Grouping => "Grouping matching checksums",
            Self::StagingRemovals => "Staging sprite removals",
            Self::RewritingReferences => "Rewriting object references",
            Self::RebuildingIndex => "Rebuilding the sprite usage index",
        }
    }

    /// What the stage counts. A pass over the object table is not measured in
    /// sprites, and showing "12 / 40 sprites" while objects are being rewritten
    /// is exactly the kind of number that makes the whole bar untrustworthy.
    pub const fn unit(self) -> &'static str {
        match self {
            Self::Indexing | Self::ReadingChecksums | Self::DecodingSprites => "sprites",
            Self::HashingOverrides | Self::ComparingOverrides => "overrides",
            Self::Grouping => "groups",
            Self::StagingRemovals => "removals",
            Self::RewritingReferences | Self::RebuildingIndex => "objects",
        }
    }

    /// Cost of one unit of this stage relative to hashing one sprite that is
    /// already in memory. Decoding a block out of the SPR is what dominates a
    /// run, so a bar that gave every unit the same weight would sprint through
    /// the cached passes and then sit still for minutes.
    ///
    /// These are ratios, not durations: the ETA divides the cost that is
    /// actually done by the time it took, so a slow disk stretches the estimate
    /// on its own as long as the passes keep their proportions.
    const fn unit_cost(self) -> f64 {
        match self {
            Self::Indexing => 0.01,
            Self::HashingOverrides => 1.0,
            // Serial decode of one block plus its hash.
            Self::ComparingOverrides => 6.0,
            Self::ReadingChecksums => 0.02,
            // Same decode, spread over up to eight workers.
            Self::DecodingSprites => 1.5,
            Self::Grouping => 0.05,
            Self::StagingRemovals => 0.05,
            Self::RewritingReferences => 0.6,
            Self::RebuildingIndex => 0.6,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationProgress {
    pub stage: &'static str,
    pub status: &'static str,
    pub unit: &'static str,
    /// 1-based position of the stage in the plan, so the dialog can say which
    /// step of how many is running.
    pub stage_index: usize,
    pub stage_count: usize,
    pub processed: usize,
    pub total: usize,
    pub stage_percent: f64,
    pub percent: f64,
    pub eta_seconds: Option<u64>,
}

struct StageProgress {
    stage: OptimizationStage,
    total: usize,
    processed: usize,
    finished: bool,
}

impl StageProgress {
    fn cost(&self) -> f64 {
        self.total as f64 * self.stage.unit_cost()
    }

    fn done_cost(&self) -> f64 {
        if self.finished {
            self.cost()
        } else {
            self.processed.min(self.total) as f64 * self.stage.unit_cost()
        }
    }
}

#[derive(Default)]
struct TrackerState {
    stages: Vec<StageProgress>,
    /// Stages already registered at the end of the plan — the apply pass, which
    /// is known before the scan that precedes it.
    tail_len: usize,
    current: usize,
    /// Until every stage is known the overall percentage stays at zero: a bar
    /// computed over half a plan races to the end and then falls back.
    sealed: bool,
    last_emit: Option<Instant>,
    last_percent: f64,
}

/// Reports what an optimization run is doing, weighted by how much work each
/// stage really carries, and answers cancellation on the same calls.
///
/// Every reporting call also checks the cancellation flag, so a stage that
/// reports is a stage that can be cancelled — the passes that stayed silent
/// used to keep the whole archive decoding after the dialog was closed.
pub struct OptimizationProgressTracker {
    channel: Option<Channel<OptimizationProgress>>,
    cancellation: Option<Arc<AtomicBool>>,
    started: Instant,
    state: Mutex<TrackerState>,
}

impl OptimizationProgressTracker {
    pub fn new(channel: Channel<OptimizationProgress>, cancellation: Arc<AtomicBool>) -> Self {
        Self {
            channel: Some(channel),
            cancellation: Some(cancellation),
            started: Instant::now(),
            state: Mutex::new(TrackerState::default()),
        }
    }

    /// A tracker that neither reports nor cancels, for the callers that only
    /// want the computation.
    #[cfg(test)]
    pub fn silent() -> Self {
        Self {
            channel: None,
            cancellation: None,
            started: Instant::now(),
            state: Mutex::new(TrackerState::default()),
        }
    }

    /// A tracker whose flag is already raised, for the test that proves a
    /// cancelled run gives up before it reads the archive.
    #[cfg(test)]
    pub fn cancelled() -> Self {
        Self {
            channel: None,
            cancellation: Some(Arc::new(AtomicBool::new(true))),
            started: Instant::now(),
            state: Mutex::new(TrackerState::default()),
        }
    }

    /// Registers the stages that run after everything else — the apply pass,
    /// whose sizes are known from the workspace before the scan starts.
    pub fn plan_tail(&self, stages: &[(OptimizationStage, usize)]) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.tail_len += stages.len();
        state.stages.extend(stages.iter().map(new_stage));
    }

    /// Registers stages in front of the tail, in the order they will run.
    pub fn plan(&self, stages: &[(OptimizationStage, usize)]) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let at = state.stages.len() - state.tail_len;
        state.stages.splice(at..at, stages.iter().map(new_stage));
    }

    /// The plan is complete; the overall percentage may start moving.
    pub fn seal(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.sealed = true;
        }
    }

    /// Corrects the size of a stage whose work is only counted once the stage
    /// before it produced its result.
    pub fn set_total(&self, stage: OptimizationStage, total: usize) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(entry) = state.stages.iter_mut().find(|entry| entry.stage == stage) {
                entry.total = total;
            }
        }
    }

    /// Makes `stage` the running one and closes every stage before it.
    pub fn begin(&self, stage: OptimizationStage) -> Result<()> {
        self.ensure_active()?;
        let Ok(mut state) = self.state.lock() else {
            return Ok(());
        };
        let Some(index) = state.stages.iter().position(|entry| entry.stage == stage) else {
            return Ok(());
        };
        for entry in state.stages.iter_mut().take(index) {
            entry.finished = true;
        }
        state.current = index;
        self.emit(&mut state, true);
        Ok(())
    }

    /// Reports how many units of `stage` are done. Parallel workers report out
    /// of order, so the highest count wins.
    pub fn advance(&self, stage: OptimizationStage, processed: usize) -> Result<()> {
        self.ensure_active()?;
        let Ok(mut state) = self.state.lock() else {
            return Ok(());
        };
        let Some(entry) = state.stages.iter_mut().find(|entry| entry.stage == stage) else {
            return Ok(());
        };
        entry.processed = entry.processed.max(processed);
        self.emit(&mut state, false);
        Ok(())
    }

    /// Closes `stage` at its full size, whatever it last reported.
    ///
    /// A stage closed without ever having begun — an apply pass the run had no
    /// work for — still becomes the current one, so the event carries the stage
    /// the percentage just credited instead of the one before it.
    pub fn finish(&self, stage: OptimizationStage) -> Result<()> {
        self.ensure_active()?;
        let Ok(mut state) = self.state.lock() else {
            return Ok(());
        };
        let Some(index) = state.stages.iter().position(|entry| entry.stage == stage) else {
            return Ok(());
        };
        if index > state.current {
            state.current = index;
        }
        for entry in state.stages.iter_mut().take(index + 1) {
            entry.processed = entry.total;
            entry.finished = true;
        }
        self.emit(&mut state, true);
        Ok(())
    }

    fn ensure_active(&self) -> Result<()> {
        match &self.cancellation {
            Some(flag) if flag.load(Ordering::Relaxed) => Err(
                ObjectBuilderError::OperationCancelled("sprite analysis".into()),
            ),
            _ => Ok(()),
        }
    }

    fn emit(&self, state: &mut TrackerState, force: bool) {
        let Some(channel) = self.channel.as_ref() else {
            return;
        };
        let now = Instant::now();
        if !force
            && state
                .last_emit
                .is_some_and(|last| now.duration_since(last) < EMIT_INTERVAL)
        {
            return;
        }
        let Some(current) = state.stages.get(state.current) else {
            return;
        };
        let stage = current.stage;
        let processed = current.processed.min(current.total);
        let total = current.total;
        let stage_percent = ratio(processed as f64, total as f64);
        let total_cost = state.stages.iter().map(StageProgress::cost).sum::<f64>();
        let done_cost = state
            .stages
            .iter()
            .map(StageProgress::done_cost)
            .sum::<f64>();
        // A stage registered with an unknown size grows the plan when its size
        // arrives. Never walking the percentage back keeps that correction from
        // reading as work being undone.
        let percent = if state.sealed {
            ratio(done_cost, total_cost).max(state.last_percent)
        } else {
            0.0
        };
        let elapsed = self.started.elapsed().as_secs_f64();
        // Measured against the cost that is done, so the estimate answers with
        // this machine's speed on this archive instead of a fixed guess.
        let eta_seconds = (state.sealed && done_cost > 0.0 && elapsed > 0.5 && percent < 100.0)
            .then(|| {
                ((total_cost - done_cost) * elapsed / done_cost)
                    .ceil()
                    .max(0.0) as u64
            });
        state.last_percent = percent;
        state.last_emit = Some(now);
        let stage_count = state.stages.len();
        let stage_index = state.current + 1;
        let _ = channel.send(OptimizationProgress {
            stage: stage.key(),
            status: stage.status(),
            unit: stage.unit(),
            stage_index,
            stage_count,
            processed,
            total,
            stage_percent,
            percent,
            eta_seconds,
        });
    }
}

fn new_stage((stage, total): &(OptimizationStage, usize)) -> StageProgress {
    StageProgress {
        stage: *stage,
        total: *total,
        processed: 0,
        finished: false,
    }
}

fn ratio(done: f64, total: f64) -> f64 {
    if total <= 0.0 {
        100.0
    } else {
        (done * 100.0 / total).clamp(0.0, 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tauri::ipc::InvokeResponseBody;

    fn tracker() -> (OptimizationProgressTracker, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock()
                    .expect("event sink")
                    .push(serde_json::from_str(&json).expect("progress payload"));
            }
            Ok(())
        });
        (
            OptimizationProgressTracker::new(channel, Arc::new(AtomicBool::new(false))),
            events,
        )
    }

    fn last(events: &Arc<Mutex<Vec<Value>>>) -> Value {
        events
            .lock()
            .expect("event sink")
            .last()
            .cloned()
            .expect("progress event")
    }

    #[test]
    fn the_percentage_weighs_a_stage_by_what_its_units_cost() {
        let (tracker, events) = tracker();
        tracker.plan(&[
            (OptimizationStage::HashingOverrides, 100),
            (OptimizationStage::DecodingSprites, 100),
        ]);
        tracker.seal();

        tracker
            .begin(OptimizationStage::HashingOverrides)
            .expect("begin");
        assert_eq!(last(&events)["percent"], 0.0);

        tracker
            .finish(OptimizationStage::HashingOverrides)
            .expect("finish");
        // 100 hashes against 100 decodes worth 1.5 each: the cheap pass is 40%
        // of the run, not half of it.
        assert_eq!(last(&events)["percent"], 40.0);

        tracker
            .begin(OptimizationStage::DecodingSprites)
            .expect("begin");
        let event = last(&events);
        assert_eq!(event["stageIndex"], 2);
        assert_eq!(event["stageCount"], 2);
        assert_eq!(event["stage"], "decodingSprites");
        assert_eq!(event["unit"], "sprites");

        tracker
            .finish(OptimizationStage::DecodingSprites)
            .expect("finish");
        assert_eq!(last(&events)["percent"], 100.0);
    }

    #[test]
    fn the_percentage_waits_for_the_whole_plan_before_it_moves() {
        let (tracker, events) = tracker();
        tracker.plan(&[(OptimizationStage::Indexing, 10)]);

        tracker.begin(OptimizationStage::Indexing).expect("begin");
        tracker.finish(OptimizationStage::Indexing).expect("finish");

        // The stage is done, but the stages after it are not registered yet: a
        // run that reported 100% here would fall back on the next event.
        let event = last(&events);
        assert_eq!(event["percent"], 0.0);
        assert_eq!(event["stagePercent"], 100.0);
        assert!(event["etaSeconds"].is_null());
    }

    #[test]
    fn the_apply_pass_keeps_its_share_of_the_bar_while_the_scan_runs() {
        let (tracker, events) = tracker();
        tracker.plan_tail(&[(OptimizationStage::RewritingReferences, 100)]);
        tracker.plan(&[(OptimizationStage::HashingOverrides, 60)]);
        tracker.seal();

        tracker
            .finish(OptimizationStage::HashingOverrides)
            .expect("finish");

        // 60 hashes against 100 objects worth 0.6 each: finishing the scan is
        // half the run, and the bar says so instead of sitting at 100%.
        let event = last(&events);
        assert_eq!(event["percent"], 50.0);
        assert_eq!(event["stageCount"], 2);
    }

    #[test]
    fn a_stage_closed_without_running_reports_itself() {
        let (tracker, events) = tracker();
        tracker.plan(&[
            (OptimizationStage::RewritingReferences, 10),
            (OptimizationStage::RebuildingIndex, 10),
        ]);
        tracker.seal();

        tracker
            .finish(OptimizationStage::RewritingReferences)
            .expect("finish");
        tracker
            .finish(OptimizationStage::RebuildingIndex)
            .expect("finish");

        let event = last(&events);
        assert_eq!(event["stage"], "rebuildingIndex");
        assert_eq!(event["unit"], "objects");
        assert_eq!(event["percent"], 100.0);
    }

    #[test]
    fn a_cancelled_run_stops_reporting_and_says_so() {
        let (tracker, _events) = tracker();
        tracker.plan(&[(OptimizationStage::DecodingSprites, 10)]);
        tracker.seal();
        tracker
            .begin(OptimizationStage::DecodingSprites)
            .expect("begin");

        tracker
            .cancellation
            .as_ref()
            .expect("cancellation flag")
            .store(true, Ordering::Relaxed);

        assert!(matches!(
            tracker.advance(OptimizationStage::DecodingSprites, 5),
            Err(ObjectBuilderError::OperationCancelled(_))
        ));
    }
}

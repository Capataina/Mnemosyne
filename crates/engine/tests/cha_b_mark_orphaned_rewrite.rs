//! Code-health-audit proof (seat B) — finding: `mark_orphaned`'s
//! unconditional reset UPDATE rewrites every row of the root on every
//! rescan.
//!
//! `crates/engine/src/db/notes_orphans.rs::mark_orphaned` opens with
//! `UPDATE images SET orphaned = 0 WHERE root_id = ?1` — no `orphaned`
//! predicate. SQLite does not skip no-op updates: an UPDATE that sets a
//! column to the value it already holds still rewrites the row and emits
//! its page as a WAL frame (confirmed against the SQLite forum thread
//! "Shortcut to change a non changing update ... in a noop",
//! https://sqlite.org/forum/info/03c59d5bca647046). Since almost every
//! row is `orphaned = 0` almost always, a steady-state watcher rescan —
//! fired after every 5s debounce window — rewrites the whole root's rows
//! into the WAL for zero state change. Under `wal_autocheckpoint = 0`
//! those frames sit until the next manual checkpoint.
//!
//! Proposed replacement (behaviour-identical):
//!   `UPDATE images SET orphaned = 0 WHERE root_id = ?1 AND orphaned = 1`
//! Rows already 0 are untouched (same final state, page never dirtied);
//! rows at 1 flip exactly as before. The second pass and the returned
//! orphan-mark count are unchanged.
//!
//! This suite proves:
//!   1. EQUIVALENCE — final `(id, orphaned)` state and return count are
//!      identical between the current implementation and the predicated
//!      variant across the interesting scenarios (returned file, steady
//!      state, deletions, empty-alive branch).
//!   2. MECHANISM/COST — WAL bytes appended by a steady-state
//!      `mark_orphaned` at 10k rows: the current implementation appends
//!      the whole root's pages; the predicated variant appends ~none.
//!      Numbers print to stderr; assertions are on state equality and on
//!      the direction of the WAL delta (current > proposed), which is a
//!      structural property, not a timing.

use std::collections::BTreeMap;
use std::collections::HashSet;

use mnemosyne::db::ImageDatabase;

fn file_db(dir: &tempfile::TempDir, name: &str) -> (ImageDatabase, String) {
    let path = dir.path().join(name).to_string_lossy().into_owned();
    let db = ImageDatabase::new(&path).unwrap();
    db.initialize().unwrap();
    (db, path)
}

/// The proposed mark_orphaned, expressed over a raw sibling connection:
/// identical to the production method except the reset UPDATE carries
/// `AND orphaned = 1`. Returns the orphan-mark count, like production.
fn mark_orphaned_predicated(
    db_path: &str,
    root_id: i64,
    alive_paths: &[String],
) -> usize {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.execute(
        "UPDATE images SET orphaned = 0 WHERE root_id = ?1 AND orphaned = 1",
        [root_id],
    )
    .unwrap();

    if alive_paths.is_empty() {
        return conn
            .execute("UPDATE images SET orphaned = 1 WHERE root_id = ?1", [root_id])
            .unwrap();
    }

    let mut stmt = conn
        .prepare("SELECT id, path FROM images WHERE root_id = ?1")
        .unwrap();
    let rows: Vec<(i64, String)> = stmt
        .query_map([root_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    let alive: HashSet<&str> = alive_paths.iter().map(|s| s.as_str()).collect();
    let to_orphan: Vec<i64> = rows
        .iter()
        .filter(|(_, p)| !alive.contains(p.as_str()))
        .map(|(id, _)| *id)
        .collect();

    let mut updated = 0;
    for chunk in to_orphan.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let sql = format!("UPDATE images SET orphaned = 1 WHERE id IN ({placeholders})");
        updated += conn
            .execute(&sql, rusqlite::params_from_iter(chunk))
            .unwrap();
    }
    updated
}

fn orphan_state(db_path: &str) -> BTreeMap<i64, i64> {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    let mut stmt = conn.prepare("SELECT id, orphaned FROM images").unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<BTreeMap<i64, i64>>>()
        .unwrap()
}

/// Build two identical fixtures and run one scenario through both
/// implementations; final state and return count must match.
fn assert_scenario_equivalent(seed_paths: &[&str], pre_orphan_alive: Option<&[&str]>, alive: &[&str]) {
    let dir = tempfile::tempdir().unwrap();
    let (db_a, path_a) = file_db(&dir, "current.db");
    let (db_b, path_b) = file_db(&dir, "proposed.db");

    let root_a = db_a.add_root("/r".into(), None).unwrap();
    let root_b = db_b.add_root("/r".into(), None).unwrap();
    let batch_a: Vec<(String, Option<i64>)> =
        seed_paths.iter().map(|p| (p.to_string(), Some(root_a.id))).collect();
    let batch_b: Vec<(String, Option<i64>)> =
        seed_paths.iter().map(|p| (p.to_string(), Some(root_b.id))).collect();
    db_a.add_images_batch(&batch_a).unwrap();
    db_b.add_images_batch(&batch_b).unwrap();

    // Optional pre-pass to set up existing orphans (the returned-file
    // scenario): both sides use the PRODUCTION method so the starting
    // states are identical by construction.
    if let Some(pre) = pre_orphan_alive {
        let pre: Vec<String> = pre.iter().map(|s| s.to_string()).collect();
        db_a.mark_orphaned(root_a.id, &pre).unwrap();
        db_b.mark_orphaned(root_b.id, &pre).unwrap();
    }

    let alive_owned: Vec<String> = alive.iter().map(|s| s.to_string()).collect();
    let n_current = db_a.mark_orphaned(root_a.id, &alive_owned).unwrap();
    let n_proposed = mark_orphaned_predicated(&path_b, root_b.id, &alive_owned);

    assert_eq!(
        n_current, n_proposed,
        "returned orphan-mark count must be identical"
    );
    assert_eq!(
        orphan_state(&path_a),
        orphan_state(&path_b),
        "final (id, orphaned) state must be identical"
    );
}

#[test]
fn predicated_reset_is_state_identical_across_scenarios() {
    let all = ["/r/a.jpg", "/r/b.jpg", "/r/c.jpg"];

    // Steady state: everything alive, nothing changes.
    assert_scenario_equivalent(&all, None, &all);
    // Deletions: two files vanish.
    assert_scenario_equivalent(&all, None, &["/r/a.jpg"]);
    // Returned file: orphan b+c first, then b comes back.
    assert_scenario_equivalent(&all, Some(&["/r/a.jpg"]), &["/r/a.jpg", "/r/b.jpg"]);
    // Empty-alive branch: the whole folder emptied.
    assert_scenario_equivalent(&all, None, &[]);
}

#[test]
fn steady_state_rescan_wal_cost_current_vs_predicated() {
    const N: usize = 10_000;

    let dir = tempfile::tempdir().unwrap();
    let (db_a, path_a) = file_db(&dir, "wal_current.db");
    let (db_b, path_b) = file_db(&dir, "wal_proposed.db");

    let root_a = db_a.add_root("/lib".into(), None).unwrap();
    let root_b = db_b.add_root("/lib".into(), None).unwrap();
    let paths: Vec<String> = (0..N).map(|i| format!("/lib/img_{i:06}.jpg")).collect();
    let batch_a: Vec<(String, Option<i64>)> =
        paths.iter().map(|p| (p.clone(), Some(root_a.id))).collect();
    let batch_b: Vec<(String, Option<i64>)> =
        paths.iter().map(|p| (p.clone(), Some(root_b.id))).collect();
    db_a.add_images_batch(&batch_a).unwrap();
    db_b.add_images_batch(&batch_b).unwrap();

    // Drain + truncate both WALs so the deltas below are attributable to
    // the steady-state rescan alone. TRUNCATE through a sibling
    // connection; the writer connection holds no open transaction here.
    let truncate = |p: &str| {
        let conn = rusqlite::Connection::open(p).unwrap();
        conn.pragma_update(None, "wal_checkpoint", "TRUNCATE").unwrap();
    };
    let wal_size = |p: &str| -> u64 {
        std::fs::metadata(format!("{p}-wal")).map(|m| m.len()).unwrap_or(0)
    };
    truncate(&path_a);
    truncate(&path_b);
    let base_a = wal_size(&path_a);
    let base_b = wal_size(&path_b);

    // Steady-state rescan: every path alive, zero state change intended.
    let t = std::time::Instant::now();
    let n_current = db_a.mark_orphaned(root_a.id, &paths).unwrap();
    let t_current = t.elapsed();
    let t = std::time::Instant::now();
    let n_proposed = mark_orphaned_predicated(&path_b, root_b.id, &paths);
    let t_proposed = t.elapsed();

    let delta_current = wal_size(&path_a).saturating_sub(base_a);
    let delta_proposed = wal_size(&path_b).saturating_sub(base_b);

    assert_eq!(n_current, 0);
    assert_eq!(n_proposed, 0);
    assert_eq!(orphan_state(&path_a), orphan_state(&path_b));

    eprintln!(
        "[cha_b_mark_orphaned] steady-state rescan at N={N}: \
         current WAL delta = {delta_current} bytes ({t_current:?}), \
         predicated WAL delta = {delta_proposed} bytes ({t_proposed:?})"
    );

    // Structural assertion: the unconditional reset writes the whole
    // root's pages; the predicated reset writes (near) nothing. If
    // SQLite ever learns to skip no-op updates this assertion fails and
    // the finding self-retires.
    assert!(
        delta_current > delta_proposed.saturating_mul(5).max(4096),
        "expected the unconditional reset to append far more WAL than the \
         predicated one (current {delta_current} vs proposed {delta_proposed})"
    );
}

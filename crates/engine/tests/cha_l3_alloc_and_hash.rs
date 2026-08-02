//! Code-health audit (L3 performance lane, seat A) — allocation-churn
//! and I/O-buffer diagnostics for the indexing hot path.
//!
//! Same discipline as `cha_l3_db_waste.rs`: deterministic equivalence
//! assertions keep the suite green; timings are printed, never asserted.
//! Run with `-- --nocapture` for the numbers.
//!
//! Findings covered:
//!
//! 5. `images_query.rs::aggregate_image_rows` evaluates every column of
//!    every joined row eagerly and hands the values to
//!    `HashMap::entry().or_insert(...)` — for an image with T tags, its
//!    path/thumbnail Strings are allocated T times and T-1 copies are
//!    dropped on the floor. A lazy variant that only reads the string
//!    columns when the entry is vacant produces identical output. Both
//!    variants are replicated here against the same SQL row shape so
//!    the equivalence and the cost delta are measured directly.
//!
//! 6. `content_hash::hash_file` streams through a 64 KiB buffer (via a
//!    redundant 8 KiB BufReader that large reads bypass). BLAKE3's own
//!    guidance is that ≥16 KiB feeds full SIMD, so a bigger buffer only
//!    buys fewer syscalls — this benchmark measures whether 256 KiB /
//!    1 MiB is actually worth anything before anyone "optimises" it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::{Duration, Instant};

fn time_min<R>(reps: usize, mut f: impl FnMut() -> R) -> (Duration, R) {
    let mut best = Duration::MAX;
    let mut out = None;
    for _ in 0..reps {
        let t = Instant::now();
        let r = f();
        best = best.min(t.elapsed());
        out = Some(r);
    }
    (best, out.unwrap())
}

// ── Finding 5: eager vs lazy entry population in the tag roll-up ──────

type Row = (i64, String, Vec<(i64, String)>, Option<String>);

const AGG_SQL: &str = "SELECT images.id AS img_id, images.path AS img_path,
    images.thumbnail_path,
    tags.id AS tag_id, tags.name AS tag_name
    FROM images
    LEFT JOIN images_tags ON images.id = images_tags.image_id
    LEFT JOIN tags ON tags.id = images_tags.tag_id";

/// Replica of the production loop's allocation pattern: every column is
/// read (allocating its Strings) on every joined row, and `or_insert`
/// discards the duplicates for rows whose image is already present.
fn aggregate_eager(conn: &rusqlite::Connection) -> Vec<Row> {
    let mut stmt = conn.prepare(AGG_SQL).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut map: HashMap<i64, (String, Vec<(i64, String)>, Option<String>)> =
        HashMap::new();
    while let Some(row) = rows.next().unwrap() {
        let img_id: i64 = row.get("img_id").unwrap();
        let img_path: String = row.get("img_path").unwrap();
        let thumbnail_path: Option<String> = row.get("thumbnail_path").unwrap();
        let tag_id_opt: Option<i64> = row.get("tag_id").unwrap();
        let entry = map
            .entry(img_id)
            .or_insert((img_path, Vec::new(), thumbnail_path));
        if let Some(tag_id) = tag_id_opt {
            entry.1.push((tag_id, row.get("tag_name").unwrap()));
        }
    }
    let mut out: Vec<Row> = map
        .into_iter()
        .map(|(id, (p, t, tp))| (id, p, t, tp))
        .collect();
    out.sort_by_key(|r| r.0);
    for r in &mut out {
        r.2.sort();
    }
    out
}

/// Proposed variant: identical output, but the string columns are only
/// read (and allocated) when the image id is seen for the first time.
fn aggregate_lazy(conn: &rusqlite::Connection) -> Vec<Row> {
    let mut stmt = conn.prepare(AGG_SQL).unwrap();
    let mut rows = stmt.query([]).unwrap();
    let mut map: HashMap<i64, (String, Vec<(i64, String)>, Option<String>)> =
        HashMap::new();
    while let Some(row) = rows.next().unwrap() {
        let img_id: i64 = row.get("img_id").unwrap();
        let entry = match map.entry(img_id) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(v) => {
                let img_path: String = row.get("img_path").unwrap();
                let thumbnail_path: Option<String> =
                    row.get("thumbnail_path").unwrap();
                v.insert((img_path, Vec::new(), thumbnail_path))
            }
        };
        let tag_id_opt: Option<i64> = row.get("tag_id").unwrap();
        if let Some(tag_id) = tag_id_opt {
            entry.1.push((tag_id, row.get("tag_name").unwrap()));
        }
    }
    let mut out: Vec<Row> = map
        .into_iter()
        .map(|(id, (p, t, tp))| (id, p, t, tp))
        .collect();
    out.sort_by_key(|r| r.0);
    for r in &mut out {
        r.2.sort();
    }
    out
}

#[test]
fn lazy_entry_aggregation_is_equivalent_to_eager() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("agg.db").to_string_lossy().into_owned();
    let db = mnemosyne::db::ImageDatabase::new(&db_path).unwrap();
    db.initialize().unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    let n_images: i64 = 20_000;
    let n_tags: i64 = 3;
    let tx = conn.unchecked_transaction().unwrap();
    {
        let mut img = tx
            .prepare("INSERT INTO images (path, thumbnail_path) VALUES (?1, ?2)")
            .unwrap();
        for i in 0..n_images {
            img.execute(rusqlite::params![
                format!("/lib/a-fairly-typical-length/img{i:06}.jpg"),
                format!("/thumbs/root_1/img{i:06}.jpg"),
            ])
            .unwrap();
        }
        let mut tag = tx
            .prepare("INSERT INTO tags (name, color) VALUES (?1, '#fff')")
            .unwrap();
        for t in 0..n_tags {
            tag.execute(rusqlite::params![format!("tag{t}")]).unwrap();
        }
        let mut link = tx
            .prepare("INSERT INTO images_tags (image_id, tag_id) VALUES (?1, ?2)")
            .unwrap();
        for i in 1..=n_images {
            for t in 1..=n_tags {
                link.execute(rusqlite::params![i, t]).unwrap();
            }
        }
    }
    tx.commit().unwrap();

    let (t_eager, eager) = time_min(3, || aggregate_eager(&conn));
    let (t_lazy, lazy) = time_min(3, || aggregate_lazy(&conn));

    assert_eq!(eager.len() as i64, n_images);
    assert_eq!(
        eager, lazy,
        "reading the string columns only on first sight of an image id \
         must produce the identical aggregate"
    );

    eprintln!(
        "[cha-F5] tag roll-up over {} joined rows ({} images x {} tags): \
         eager column reads = {:?}, lazy-on-vacant = {:?}",
        n_images * n_tags,
        n_images,
        n_tags,
        t_eager,
        t_lazy
    );
}

// ── Finding 6: hash_file buffer size ──────────────────────────────────

fn hash_with_buffer(path: &std::path::Path, buf_len: usize) -> ([u8; 32], u64) {
    let mut file = std::fs::File::open(path).unwrap();
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; buf_len];
    let mut size = 0u64;
    loop {
        let n = file.read(&mut buf).unwrap();
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        size += n as u64;
    }
    (*hasher.finalize().as_bytes(), size)
}

#[test]
fn hash_file_buffer_sizes_agree_and_are_benchmarked() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.bin");

    // 32 MiB of deterministic pseudo-random bytes (xorshift64 — no seed
    // dependence on the rand crate's version stability).
    let mut state = 0x2545F4914F6CDD1Du64;
    let mut data = Vec::with_capacity(32 * 1024 * 1024);
    while data.len() < 32 * 1024 * 1024 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        data.extend_from_slice(&state.to_le_bytes());
    }
    std::fs::File::create(&path)
        .unwrap()
        .write_all(&data)
        .unwrap();

    // Ground truth: one-shot blake3 over the in-memory bytes.
    let reference = *blake3::hash(&data).as_bytes();

    // Warm the page cache so the timings compare buffer strategy, not
    // first-touch disk latency.
    let _ = mnemosyne::content_hash::hash_file(&path).unwrap();

    let (t_prod, (h_prod, s_prod)) =
        time_min(3, || mnemosyne::content_hash::hash_file(&path).unwrap());
    let (t_64k, (h_64k, _)) = time_min(3, || hash_with_buffer(&path, 64 * 1024));
    // Attribution variants: is any delta the BufReader wrapper or the
    // stack-vs-heap buffer? (BufReader is expected to delegate reads
    // larger than its 8 KiB internal buffer straight to the File, so a
    // real difference here would be surprising and worth knowing.)
    let (t_bufreader, (h_bufreader, _)) = time_min(3, || {
        let file = std::fs::File::open(&path).unwrap();
        let mut reader = std::io::BufReader::new(file);
        let mut hasher = blake3::Hasher::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut size = 0u64;
        loop {
            let n = reader.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            size += n as u64;
        }
        (*hasher.finalize().as_bytes(), size)
    });
    let (t_stack, (h_stack, _)) = time_min(3, || {
        let mut file = std::fs::File::open(&path).unwrap();
        let mut hasher = blake3::Hasher::new();
        let mut buf = [0u8; 64 * 1024];
        let mut size = 0u64;
        loop {
            let n = file.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            size += n as u64;
        }
        (*hasher.finalize().as_bytes(), size)
    });
    let (t_256k, (h_256k, _)) =
        time_min(3, || hash_with_buffer(&path, 256 * 1024));
    let (t_1m, (h_1m, _)) =
        time_min(3, || hash_with_buffer(&path, 1024 * 1024));

    assert_eq!(h_prod, reference, "production hash must match one-shot blake3");
    assert_eq!(s_prod, data.len() as u64);
    assert_eq!(h_64k, reference);
    assert_eq!(h_256k, reference);
    assert_eq!(h_1m, reference);
    assert_eq!(h_bufreader, reference);
    assert_eq!(h_stack, reference);

    eprintln!(
        "[cha-F6] hash_file over 32 MiB (page-cache warm): \
         production (BufReader + 64 KiB stack) = {:?}, raw heap 64 KiB = {:?}, \
         256 KiB = {:?}, 1 MiB = {:?}; attribution: BufReader + heap 64 KiB = {:?}, \
         raw stack 64 KiB = {:?}",
        t_prod, t_64k, t_256k, t_1m, t_bufreader, t_stack
    );
}

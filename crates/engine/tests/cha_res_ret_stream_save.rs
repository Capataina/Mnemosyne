//! CHA resolver proof — C3: streamed `save_store_to` (cosine/cache.rs).
//!
//! Claim under test: writing the store as header + section `write_all`
//! calls straight into the temp file produces a BYTE-IDENTICAL file to
//! the current shape (assemble everything into one `vec![0u8; total]`,
//! then `fs::write`) while eliminating the full-store transient buffer
//! (~300 MB at 100k × 768 per encoder persist), and preserves the
//! temp-file + atomic-rename contract.
//!
//! Equivalence structure: `FlatStore`'s section accessors are
//! `pub(crate)`, so an integration test cannot read the sections
//! directly. Instead the production `save_store_to` writes the file, and
//! the replica obtains its section BYTES by parsing that file's header
//! and slicing the sections back out. This is sound, not circular: the
//! current writer `copy_from_slice`s each section verbatim
//! (cache.rs:114-116), so sections-in-file are bit-identical to
//! sections-in-memory by the current code's own contract, and the
//! streamed replica reconstructs every offset, the header, and the
//! inter-section zero padding itself — nothing about the file's global
//! assembly is reused. Byte-identity of the replica's output against the
//! production file therefore proves header replication (incl. the FNV
//! encoder hash), offset arithmetic, padding, and payload all at once.
//!
//! The padding case is exercised deliberately: row counts are chosen so
//! `64 + rows*12` is NOT 64-aligned, making the zero pad non-empty.
//!
//! `gen_token` note: a hand-built index (`add_image`) carries token 0 and
//! the field is `pub(crate)` — so the header-token bytes exercised here
//! are the zero token. The token write is byte 32..40 either way; the
//! replica reads whatever token the production header carries and must
//! reproduce it, so a nonzero token changes nothing structural.
//!
//! Benchmarks print with `--nocapture`; protocol: `--release
//! --test-threads=1`, min-of-3.

use mnemosyne::cosine_similarity::CosineIndex;
use ndarray::Array1;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

const HEADER_LEN: usize = 64;
const MAGIC: [u8; 8] = *b"LYNEMB01";

#[cfg(debug_assertions)]
const BENCH_ROWS: usize = 2_001; // keep the default (debug) suite fast
#[cfg(not(debug_assertions))]
const BENCH_ROWS: usize = 50_001; // ~100 MB block at dim 512; 64+50_001*12 ≡ 12 (mod 64) → real padding
const BENCH_DIM: usize = 512;

fn min_of_3_ms<F: FnMut()>(mut f: F) -> f64 {
    (0..3)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .fold(f64::INFINITY, f64::min)
}

#[inline]
fn round_up_64(n: usize) -> usize {
    (n + 63) & !63
}

/// Replica of the private `fnv1a_str` (cache.rs:48-55). Verified
/// implicitly: the replica writes this hash into its header, and the
/// full-file byte comparison against the production header would fail on
/// any divergence.
fn fnv1a_str(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The sections of a production-written store file, sliced back out by
/// reconstructing the offsets exactly as the loader does.
struct Sections {
    dim: usize,
    rows: usize,
    gen_token: u64,
    id_bytes: Vec<u8>,
    norm_bytes: Vec<u8>,
    block_bytes: Vec<u8>,
}

fn parse_sections(path: &Path) -> Sections {
    let bytes = fs::read(path).expect("production store file must exist");
    assert_eq!(&bytes[0..8], &MAGIC, "magic must match");
    let dim = u32::from_le_bytes(bytes[24..28].try_into().unwrap()) as usize;
    let rows = u32::from_le_bytes(bytes[28..32].try_into().unwrap()) as usize;
    let gen_token = u64::from_le_bytes(bytes[32..40].try_into().unwrap());
    let id_off = HEADER_LEN;
    let id_len = rows * 8;
    let norm_off = id_off + id_len;
    let norm_len = rows * 4;
    let block_off = round_up_64(norm_off + norm_len);
    let block_len = rows * dim * 4;
    assert_eq!(
        bytes.len(),
        block_off + block_len,
        "file length must equal the reconstructed layout"
    );
    Sections {
        dim,
        rows,
        gen_token,
        id_bytes: bytes[id_off..norm_off].to_vec(),
        norm_bytes: bytes[norm_off..norm_off + norm_len].to_vec(),
        block_bytes: bytes[block_off..block_off + block_len].to_vec(),
    }
}

/// The streamed candidate: header + sections + padding written straight
/// into the temp file via `write_all`, then the same atomic rename. Peak
/// extra memory: the 64-byte header array and a ≤63-byte pad buffer,
/// instead of a full-file assembly Vec.
fn save_store_streamed(s: &Sections, path: &Path, encoder_id: &str) -> std::io::Result<()> {
    let norm_end = HEADER_LEN + s.id_bytes.len() + s.norm_bytes.len();
    let pad = round_up_64(norm_end) - norm_end;

    let mut header = [0u8; HEADER_LEN];
    header[0..8].copy_from_slice(&MAGIC);
    header[8..12].copy_from_slice(&1u32.to_le_bytes()); // FORMAT_VERSION
    header[16..24].copy_from_slice(&fnv1a_str(encoder_id).to_le_bytes());
    header[24..28].copy_from_slice(&(s.dim as u32).to_le_bytes());
    header[28..32].copy_from_slice(&(s.rows as u32).to_le_bytes());
    header[32..40].copy_from_slice(&s.gen_token.to_le_bytes());

    let tmp = path.with_extension("tmp");
    let write_streamed = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&header)?;
        f.write_all(&s.id_bytes)?;
        f.write_all(&s.norm_bytes)?;
        f.write_all(&[0u8; 63][..pad])?;
        f.write_all(&s.block_bytes)?;
        Ok(())
    };
    match write_streamed().and_then(|_| fs::rename(&tmp, path)) {
        Ok(()) => Ok(()),
        Err(e) => {
            // Same failure contract as production: never leave a torn tmp.
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn build_index(rows: usize, dim: usize) -> CosineIndex {
    let mut idx = CosineIndex::new();
    for r in 0..rows {
        // Deterministic non-trivial values; every byte pattern in the
        // block participates in the comparison.
        let v: Array1<f32> = Array1::from_iter(
            (0..dim).map(|d| ((r * 31 + d * 7) % 997) as f32 * 0.013 + 0.001),
        );
        idx.add_image(r as i64 + 1, v);
    }
    idx
}

/// Byte-identity across three shapes: real padding (rows*12 not
/// 64-aligned), zero padding (rows*12 ≡ 0 mod 64 with 64+... aligned),
/// and a single-row store.
#[test]
fn streamed_save_is_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    // (rows, dim): 3 rows → 64+36=100 → 28 pad bytes; 16 rows → 64+192=256
    // → 0 pad; 1 row → 64+12=76 → 52 pad.
    for (rows, dim) in [(3usize, 5usize), (16, 8), (1, 4)] {
        let idx = build_index(rows, dim);
        let prod_path = dir.path().join(format!("prod_{rows}x{dim}.bin"));
        idx.save_store_to(&prod_path, "clip_vit_b_32");

        let sections = parse_sections(&prod_path);
        assert_eq!(sections.rows, rows);
        assert_eq!(sections.dim, dim);

        let stream_path = dir.path().join(format!("stream_{rows}x{dim}.bin"));
        save_store_streamed(&sections, &stream_path, "clip_vit_b_32").unwrap();

        let prod_bytes = fs::read(&prod_path).unwrap();
        let stream_bytes = fs::read(&stream_path).unwrap();
        assert_eq!(
            prod_bytes, stream_bytes,
            "streamed file must be byte-identical ({rows}x{dim})"
        );

        // Atomicity contract: the temp file must not survive a successful
        // save (production removes it via the rename; a leftover .tmp is
        // the torn-write hazard the contract exists to prevent).
        assert!(
            !stream_path.with_extension("tmp").exists(),
            "no .tmp may remain after a successful streamed save"
        );
        assert!(
            !prod_path.with_extension("tmp").exists(),
            "no .tmp may remain after a successful production save"
        );
    }
}

/// The failure path keeps the contract: a write into an unwritable target
/// leaves no partial artefacts behind and never touches the final path.
#[test]
fn streamed_save_failure_leaves_no_artefacts() {
    let dir = tempfile::tempdir().unwrap();
    let idx = build_index(3, 5);
    let prod_path = dir.path().join("seed.bin");
    idx.save_store_to(&prod_path, "clip_vit_b_32");
    let sections = parse_sections(&prod_path);

    let missing_dir = dir.path().join("no_such_dir");
    let target = missing_dir.join("store.bin");
    let err = save_store_streamed(&sections, &target, "clip_vit_b_32");
    assert!(err.is_err(), "write into a missing directory must fail");
    assert!(!target.exists(), "final path must not exist after failure");
    assert!(
        !target.with_extension("tmp").exists(),
        "tmp must be cleaned up after failure"
    );
}

/// The settling benchmark: production `save_store_to` (assemble + write)
/// vs the streamed replica, same payload, same tempdir filesystem.
/// The quantified memory claim needs no timer: the assembly buffer is
/// exactly `total` bytes (header+ids+norms+pad+block), printed below —
/// that allocation simply does not exist in the streamed shape.
#[test]
fn streamed_save_bench() {
    let dir = tempfile::tempdir().unwrap();
    let idx = build_index(BENCH_ROWS, BENCH_DIM);
    let prod_path = dir.path().join("bench_prod.bin");
    idx.save_store_to(&prod_path, "clip_vit_b_32");
    let sections = parse_sections(&prod_path);
    let total = fs::metadata(&prod_path).unwrap().len();

    let prod_ms = min_of_3_ms(|| {
        idx.save_store_to(&prod_path, "clip_vit_b_32");
    });
    let stream_path = dir.path().join("bench_stream.bin");
    let stream_ms = min_of_3_ms(|| {
        save_store_streamed(&sections, &stream_path, "clip_vit_b_32").unwrap();
    });
    assert_eq!(
        fs::read(&prod_path).unwrap(),
        fs::read(&stream_path).unwrap(),
        "bench artefacts must remain byte-identical"
    );

    println!("=== cha_res_ret C3: streamed save ({BENCH_ROWS} rows x {BENCH_DIM}d, {:.1} MB file) ===", total as f64 / 1e6);
    println!("production (assemble {:.1} MB buffer + fs::write): {prod_ms:.2} ms", total as f64 / 1e6);
    println!("streamed   (64 B header + section write_all):      {stream_ms:.2} ms ({:+.0}%)", 100.0 * (stream_ms - prod_ms) / prod_ms);
    println!("transient allocation eliminated: {} bytes per persist (scales to ~300 MB at 100k x 768)", total);
}

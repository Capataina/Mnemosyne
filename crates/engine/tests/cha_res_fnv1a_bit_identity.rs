//! Code-health-audit resolver proof (L2-engine C1) — FNV-1a bit-identity
//! regression guard.
//!
//! The crate hand-rolls 64-bit FNV-1a twice with the same constants:
//!
//! - `crates/engine/src/db/images_query.rs:617-626` —
//!   `embedding_generation_token` folds three little-endian i64s
//!   (count, sum(rowid), max(rowid)) — offset basis
//!   `0xcbf2_9ce4_8422_2325`, prime `0x0000_0100_0000_01b3`,
//!   xor-byte-then-multiply, fields in [count, sum, max] order.
//! - `crates/engine/src/cosine/cache.rs:48-55` — `fnv1a_str` folds the
//!   encoder id's UTF-8 bytes with the identical basis/prime/order; its
//!   output is PERSISTED into every `embstore_*.bin` header (bytes
//!   16..24, written at cache.rs:110, checked on load at cache.rs:144).
//!
//! The extraction candidate died (a shared helper would have exactly 2
//! call sites — under the 3-site floor), but this guard independently
//! earns its keep: the existing cache tests compute their expected
//! header hash by calling `fnv1a_str` itself, so an accidental change
//! to the algorithm passes them while silently invalidating every
//! user's on-disk store (load falls back to a full DB repopulate) and
//! every freshness token. This file pins BOTH implementations, through
//! their public surfaces, to one in-test reference validated against
//! the published FNV-1a 64-bit test vectors — proving in passing that
//! the two implementations are bit-identical over a shared byte-stream
//! algorithm (same basis, same prime, same fold order), i.e. a future
//! extraction CAN preserve bit-identity.

use mnemosyne::cosine::CosineIndex;
use mnemosyne::db::ImageDatabase;

/// Reference 64-bit FNV-1a: xor the byte in, then multiply by the
/// prime. Byte-for-byte the algorithm at images_query.rs:619-624 and
/// cache.rs:49-54.
fn fnv1a_ref(bytes: impl IntoIterator<Item = u8>) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The reference must match the published FNV-1a 64 vectors (Noll's
/// test suite) — this is what makes the other two tests independent
/// pins rather than self-referential tautologies.
#[test]
fn reference_matches_published_fnv1a_vectors() {
    assert_eq!(fnv1a_ref("".bytes()), 0xcbf2_9ce4_8422_2325); // empty = offset basis
    assert_eq!(fnv1a_ref("a".bytes()), 0xaf63_dc4c_8601_ec8c);
    assert_eq!(fnv1a_ref("foobar".bytes()), 0x8594_4171_f739_67e8);
}

/// Cache side, via the public surface: `save_store_to` writes
/// `fnv1a_str(encoder_id)` into header bytes 16..24 little-endian.
/// Corpus covers empty input, the real slug, multi-byte unicode, and a
/// long string.
#[test]
fn store_header_encoder_hash_is_fnv1a_of_the_id() {
    let long = "x".repeat(4096);
    let corpus: [&str; 4] = ["", "clip_vit_b_32", "énc🦀ödér — ハッシュ", &long];
    let dir = tempfile::tempdir().unwrap();

    for (i, enc) in corpus.iter().enumerate() {
        let mut idx = CosineIndex::new();
        // One real row so the store has a defined dim; irrelevant to
        // the header hash under test.
        idx.add_image(1, ndarray::Array1::from(vec![1.0_f32, 0.0]));
        let path = dir.path().join(format!("store_{i}.bin"));
        idx.save_store_to(&path, enc);

        let bytes = std::fs::read(&path).unwrap();
        let got = u64::from_le_bytes(bytes[16..24].try_into().unwrap());
        assert_eq!(
            got,
            fnv1a_ref(enc.bytes()),
            "header encoder hash diverged from reference FNV-1a for id {enc:?}"
        );
    }
}

/// DB side, via the public surface: `embedding_generation_token` must
/// equal the reference FNV-1a over the le-bytes of (count, sum(rowid),
/// max(rowid)) from its own SELECT — re-run here through an independent
/// rusqlite connection with the SQL copied verbatim from
/// images_query.rs:603-611.
#[test]
fn generation_token_is_fnv1a_of_count_sum_max() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("cha_res_fnv.db");
    let db = ImageDatabase::new(db_path.to_str().unwrap()).unwrap();
    db.initialize().unwrap();

    // Three images; two embedded for enc_a, one for enc_b — so the two
    // encoders produce different (count, sum, max) triples.
    for p in ["/a.jpg", "/b.jpg", "/c.jpg"] {
        db.add_image(p.to_string(), None).unwrap();
    }
    let ids: Vec<i64> = ["/a.jpg", "/b.jpg", "/c.jpg"]
        .iter()
        .map(|p| db.get_image_id_by_path(p).unwrap())
        .collect();
    db.upsert_embedding(ids[0], "enc_a", &[0.1_f32, 0.2]).unwrap();
    db.upsert_embedding(ids[2], "enc_a", &[0.3_f32, 0.4]).unwrap();
    db.upsert_embedding(ids[1], "enc_b", &[0.5_f32, 0.6]).unwrap();

    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for enc in ["enc_a", "enc_b"] {
        let (count, sum, max): (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(e.rowid), 0), COALESCE(MAX(e.rowid), 0)
                 FROM embeddings e
                 JOIN images i ON i.id = e.image_id
                 WHERE e.encoder_id = ?1
                   AND i.orphaned = 0
                   AND (
                       i.root_id IS NULL
                       OR i.root_id IN (SELECT id FROM roots WHERE enabled = 1)
                   )",
                [enc],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let expected = fnv1a_ref(
            [count, sum, max].into_iter().flat_map(i64::to_le_bytes),
        );
        assert_eq!(
            db.embedding_generation_token(enc).unwrap(),
            expected,
            "generation token diverged from reference FNV-1a for {enc}"
        );
    }

    // Empty input: an encoder with no rows folds (0, 0, 0) — 24 zero
    // bytes through the same reference.
    assert_eq!(
        db.embedding_generation_token("enc_never").unwrap(),
        fnv1a_ref([0_u8; 24]),
        "empty-population token must be FNV-1a of 24 zero bytes"
    );
}

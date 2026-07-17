use ndarray::Array1;

/// Comparator for `(usize, f32)` similarity tuples — sorts by score
/// descending, NaN-tolerant. Pulled out as a free function so the
/// three retrieval methods + `select_nth_unstable_by` and `sort_by`
/// both reference one definition (was previously triplicated inline).
///
/// NaN is treated as smaller than every real number — a NaN score is
/// never preferred over a real score. Two NaNs compare equal.
pub(crate) fn score_cmp_desc(a: &(usize, f32), b: &(usize, f32)) -> std::cmp::Ordering {
    match (b.1.is_nan(), a.1.is_nan()) {
        (true, true) => std::cmp::Ordering::Equal,
        (true, false) => std::cmp::Ordering::Greater, // b is NaN, a wins
        (false, true) => std::cmp::Ordering::Less,    // a is NaN, b wins
        (false, false) => b.1.partial_cmp(&a.1).unwrap(),
    }
}

/// Sequential f32 dot product over two equal-length slices.
///
/// Deliberately a plain sequential fold rather than an ndarray/BLAS
/// reduction: the flat-store scan (`score_all`) and the serial
/// equivalence reference both go through this one function, so the
/// summation order is identical and their scores are bit-for-bit equal
/// — the ranking-equivalence guarantee T3-2 rests on. Callers guarantee
/// `a.len() == b.len()`.
#[inline]
pub(crate) fn dot_slice(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Inverse L2 norm (`1/|v|`) of a vector, or `0.0` for a zero vector.
/// Precomputed once per cached row (T1-4 cached norms, absorbed into
/// the flat store) so the hot scan multiplies by it instead of paying
/// a `sqrt` per candidate. Real norm, never assumed 1.0 — legacy
/// pre-normalise CLIP rows are not unit vectors.
#[inline]
pub(crate) fn inv_norm(v: &[f32]) -> f32 {
    let sq = dot_slice(v, v);
    if sq == 0.0 {
        0.0
    } else {
        1.0 / sq.sqrt()
    }
}

/// Cosine similarity from two slices, computing both norms fresh. This
/// is the reference formula (`dot / (|a| |b|)`); the flat scan uses the
/// cached-inverse-norm form `dot * inv_a * inv_b`, which is FP-equal to
/// this to well within the 1e-6 equivalence tolerance.
pub(crate) fn cosine_similarity_slice(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        tracing::warn!(
            "cosine_similarity dim mismatch: query={} cache={}; returning 0.0",
            a.len(),
            b.len()
        );
        return 0.0;
    }
    let dot_product = dot_slice(a, b);
    let norm_a = dot_slice(a, a).sqrt();
    let norm_b = dot_slice(b, b).sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot_product / (norm_a * norm_b)
}

// Function to compute cosine similarity between two embeddings.
//
// Thin `Array1` wrapper over `cosine_similarity_slice` so the public
// `CosineIndex::cosine_similarity(&a, &b)` path (tests, the startup
// sanity check, the integration test) shares the one implementation the
// flat scan uses. `as_slice` is `Some` for contiguous standard-layout
// arrays, which every embedding here is; the `unwrap_or` fallback
// materialises a contiguous copy for the pathological non-contiguous
// case rather than panicking.
pub(crate) fn cosine_similarity(a: &Array1<f32>, b: &Array1<f32>) -> f32 {
    match (a.as_slice(), b.as_slice()) {
        (Some(sa), Some(sb)) => cosine_similarity_slice(sa, sb),
        _ => cosine_similarity_slice(
            &a.to_vec(),
            &b.to_vec(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::super::CosineIndex;
    use ndarray::{array, Array1};

    #[test]
    fn test_cosine_similarity_identical_vectors() {
        // Two identical vectors should have similarity of 1.0
        let a = array![1.0, 2.0, 3.0, 4.0];
        let b = array![1.0, 2.0, 3.0, 4.0];

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            (similarity - 1.0).abs() < 1e-6,
            "Identical vectors should have similarity ~1.0, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_orthogonal_vectors() {
        // Orthogonal vectors (perpendicular) should have similarity of 0.0
        let a = array![1.0, 0.0, 0.0];
        let b = array![0.0, 1.0, 0.0];

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            similarity.abs() < 1e-6,
            "Orthogonal vectors should have similarity ~0.0, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_opposite_vectors() {
        // Opposite vectors should have similarity of -1.0
        let a = array![1.0, 2.0, 3.0];
        let b = array![-1.0, -2.0, -3.0];

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            (similarity - (-1.0)).abs() < 1e-6,
            "Opposite vectors should have similarity ~-1.0, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_parallel_vectors_different_magnitude() {
        // Parallel vectors with different magnitudes should still have similarity ~1.0
        let a = array![1.0, 2.0, 3.0];
        let b = array![2.0, 4.0, 6.0]; // Same direction, double magnitude

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            (similarity - 1.0).abs() < 1e-6,
            "Parallel vectors should have similarity ~1.0 regardless of magnitude, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_45_degree_vectors() {
        // Two vectors at 45 degrees should have similarity of ~0.707 (cos(45°) = √2/2)
        let a = array![1.0, 0.0];
        let b = array![1.0, 1.0]; // 45 degrees from x-axis

        let similarity = CosineIndex::cosine_similarity(&a, &b);
        let expected = 1.0 / 2.0_f32.sqrt(); // cos(45°) = 1/√2 ≈ 0.707

        assert!(
            (similarity - expected).abs() < 1e-6,
            "45-degree vectors should have similarity ~0.707, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_high_dimensional() {
        // Test with 512-dimensional vectors (same as CLIP embeddings)
        let a = Array1::from_vec(vec![1.0; 512]);
        let b = Array1::from_vec(vec![1.0; 512]);

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            (similarity - 1.0).abs() < 1e-6,
            "High-dimensional identical vectors should have similarity ~1.0, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_high_dimensional_orthogonal() {
        // Create two orthogonal 512-dimensional vectors
        let mut vec_a = vec![0.0; 512];
        vec_a[0] = 1.0;
        let mut vec_b = vec![0.0; 512];
        vec_b[1] = 1.0;

        let a = Array1::from_vec(vec_a);
        let b = Array1::from_vec(vec_b);

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        assert!(
            similarity.abs() < 1e-6,
            "High-dimensional orthogonal vectors should have similarity ~0.0, got {}",
            similarity
        );
    }

    #[test]
    fn test_cosine_similarity_normalized_vectors() {
        // Test with pre-normalized vectors (unit vectors)
        let a = array![0.6, 0.8]; // length = 1
        let b = array![0.8, 0.6]; // length = 1

        let similarity = CosineIndex::cosine_similarity(&a, &b);

        // For normalized vectors, cosine similarity equals dot product
        let expected_dot = 0.6 * 0.8 + 0.8 * 0.6;
        assert!(
            (similarity - expected_dot).abs() < 1e-6,
            "Normalized vectors: similarity should equal dot product, got {}",
            similarity
        );
    }
}

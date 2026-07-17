# clip-text-encoder

*Maturity: comprehensive · Stability: code stable since `b58dd46` (2026-07-15) — the I/O contract (input name, dtype, no attention_mask) this document describes was corrected in this pass to match code that had already been fixed; the drift was in the docs, not the running app*

## Scope / Purpose

Encodes a text query into the same 512-dimensional embedding space as `clip-image-encoder` (`systems/clip-image-encoder.md`) so cosine similarity between a text embedding and image embeddings retrieves semantically matching images; feeds `systems/multi-encoder-fusion.md`'s text-image RRF fusion alongside SigLIP-2's text branch. Uses **OpenCLIP LAION-2B ViT-B/32 (English-only, MIT-licensed)** via the separate `textual/model.onnx` from `immich-app/ViT-B-32__laion2b-s34b-b79k`, with byte-level BPE tokenization via the HuggingFace `tokenizers` crate (vocab still mirrored from `Xenova/clip-vit-base-patch32`'s tokenizer.json — see Durable Notes).

The previous text encoder used the multilingual distillation `clip-ViT-B-32-multilingual-v1`. Even though that model nominally outputs into "the same 512-d CLIP space," its embedding distribution is materially different from OpenAI CLIP's image branch — distilled cross-lingual training shifted the text-side representations. The result was effectively-random text-to-image rankings (the "blue fish → Tristana" failure mode). Switching to OpenAI English fixes that at the cost of dropping multilingual support. (That 2026-04-26 swap predates and is distinct from the 2026-07 OpenAI→OpenCLIP weights-only licensing swap described in Durable Notes.)

**Verified drift fix (this pass): the 2026-07 OpenCLIP weights swap changed the I/O contract this document previously described as unchanged.** The immich-app OpenCLIP export renamed the text input node from `input_ids` to `text` and changed its dtype from int64 to int32 (attention_mask was already absent — a separate, earlier fix, `63d8a00`, had found the old Xenova export rejected it too). Neither the rename nor the dtype change was caught by the swap's own commit, so every text query silently failed until `b58dd46` (2026-07-15) fixed it. Every section below (Tokenizer, Encode flow, Key Interfaces) now describes the POST-fix reality: single `text` input, int32, no attention_mask.

## Boundaries / Ownership

- **Owns:** ONNX session lifecycle (CPU-only), HF `tokenizers` crate integration (load BPE from tokenizer.json), pad/truncate to 77 tokens with id 49407 (int32, no attention mask — see below), multi-output-name extraction with fallback, L2-normalize at output, the `tokenizer_for_diagnostic()` accessor used by the `tokenizer_output` perf diagnostic.
- **Does not own:** the in-memory similarity index (delegates to `cosine-similarity`), the lazy-init lifecycle (lives in `tauri-commands` via `TextEncoderState`), the pre-warm path (lives in `indexing.rs::run_pipeline_inner`), the model file on disk (delegates to `paths::models_dir()` + `model_download::CLIP_TEXT_FILENAME` / `CLIP_TOKENIZER_FILENAME`).
- **Public API:** `ClipTextEncoder::new(model_path, tokenizer_path)`, `encode(text) -> Result<Vec<f32>>`, `encode_batch(texts)`, `inspect_model`, `tokenizer_for_diagnostic() -> &Tokenizer`, `max_seq_length() -> usize`. Implements the `TextEncoder` trait.

## Current Implemented Reality

### Submodule layout

```
apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/
├── mod.rs        — pub mod encoder + pooling; pub use encoder::ClipTextEncoder
├── encoder.rs    — ClipTextEncoder struct, new(), encode(), encode_batch(), tokenize_and_pad,
│                    all encoder tests; CoreML-disabled rationale comments
└── pooling.rs    — normalize (LIVE, used by every encoder in this project), plus
                    try_extract_single_embedding + mean_pool (VERIFIED DEAD — grepped
                    the whole crate: neither is called anywhere outside pooling.rs's
                    own definitions; they date from the pre-OpenAI multilingual
                    DistilBERT encoder's mean-pooling extraction and were never wired
                    into the closure-based extraction the current encoders use — see
                    Encode flow below)
```

The pre-2026-04-26 `tokenizer.rs` (custom WordPiece + case-fallback for the multilingual vocab) was deleted when the OpenAI BPE swap landed — the `tokenizers` crate handles BPE/WordPiece/SentencePiece uniformly via tokenizer.json, removing the need for custom Rust tokenizer code in this project. The crate had been a dependency since the SigLIP-2 work but is now used by both text encoders.

### Tokenizer (HuggingFace `tokenizers` crate, BPE byte-level)

Loads `clip_tokenizer.json` via `Tokenizer::from_file`. The JSON carries the full normalization + special-tokens contract:
- NFC + collapse-whitespace + lowercase normalizers
- BPE byte-level model with 49408-entry vocab
- RobertaProcessing post-processor wraps with `<|startoftext|>` (id 49406) ... `<|endoftext|>` (id 49407)
- `<|endoftext|>` doubles as both pad and unk token

Padding is NOT done by the tokenizer — the encoder's `tokenize_and_pad` truncates or extends to exactly 77 tokens, padding with id 49407 (`CLIP_PAD_TOKEN_ID`). **There is no attention_mask at all** — the OpenCLIP `textual/model.onnx` export (unlike the old Xenova export) does not accept one as an input; the causal/padding information is baked into the graph from the token positions themselves (positions after the first EOS/49407 are treated as padding internally):

```rust
fn tokenize_and_pad(&self, text: &str) -> Result<Vec<i32>, Box<dyn Error>> {
    let encoded = self.tokenizer.encode(text, true)?;       // adds BOS/EOS
    let mut ids: Vec<i32> = encoded.get_ids().iter().map(|&i| i as i32).collect();
    if ids.len() > self.max_seq_length {
        ids.truncate(self.max_seq_length);
    } else {
        let pad_count = self.max_seq_length - ids.len();
        ids.extend(std::iter::repeat_n(self.pad_token_id, pad_count));  // pad_token_id: i32 = 49407
    }
    Ok(ids)
}
```

**Dtype is `i32`, not `i64`.** The OpenCLIP `textual/model.onnx` export's `text` input is `tensor(int32)`; the old Xenova export's `input_ids` was `tensor(int64)`. Passing an int64 tensor errors at `session.run` with "Unexpected input data type" — confirmed against the real downloaded model, not assumed from the export label. This, the input-name rename, and the dropped attention_mask are three of the bugs `b58dd46` fixed (see Scope/Purpose above).

### Encoder session — CoreML disabled

```rust
Session::builder()
    // CoreML EP intentionally NOT used. Transformer ops on CoreML produce
    // runtime inference errors. CPU is the only supported EP for the text encoder.
    .commit_from_file(model_path)
```

The text encoder loads in 1–2 s on first construction and is held for the lifetime of the app. Pre-warm by the indexing pipeline avoids paying this cost on the user's first semantic search.

### Encode flow

```text
encode(text: &str) -> Result<Vec<f32>>:
    input_ids = tokenize_and_pad(text)                     // Vec<i32>, length 77, NO attention_mask
    
    outputs = ort.session.run(text: int32[1,77])           // ONLY input is named "text"
    
    // Try output names in order; return first match's vector:
    for name in ["embedding", "text_embeds", "pooler_output", "sentence_embedding"]:
        if let Some(out) = outputs.get(name):
            raw = out.try_extract_tensor::<f32>().to_vec()   // expected length 512
            break
    
    return Err("CLIP text: no recognised output name (expected embedding)") if no match
    return normalize(raw)                                    // L2-normalize
```

The current OpenCLIP export's primary output name is `embedding` (renamed from the old Xenova export's `text_embeds`). The remaining three names in the fallback chain (`text_embeds`, `pooler_output`, `sentence_embedding`) are legacy/defensive — kept so a future export swap degrades to a clear error instead of a silent one, per the same reasoning as SigLIP-2's and DINOv2's output-name fallbacks. `encode_batch`'s fallback chain is shorter — `["embedding", "text_embeds", "pooler_output"]`, no `sentence_embedding` — the two call sites drifted slightly and were not reconciled; harmless today since the primary export always hits `embedding` on the first try, but worth knowing if a future export needs the `sentence_embedding` fallback in the batch path too.

### Pre-warm

```rust
// indexing.rs::run_pipeline_inner Phase 1b
let text_encoder_state = app.state::<TextEncoderState>();
if let Ok(mut lock) = text_encoder_state.encoder.lock() {
    if lock.is_none() {
        let model_path = models_dir.join(model_download::CLIP_TEXT_FILENAME);
        let tokenizer_path = models_dir.join(model_download::CLIP_TOKENIZER_FILENAME);
        if model_path.exists() && tokenizer_path.exists() {
            match ClipTextEncoder::new(&model_path, &tokenizer_path) {
                Ok(encoder) => *lock = Some(encoder),
                Err(e) => warn!("text encoder pre-warm failed: {e}"),
            }
        }
    }
}
```

The user's first semantic search doesn't pay 1–2 s of model-load time. Pre-warm runs as soon as the indexing pipeline confirms both files exist on disk; the lazy-init path in `commands::semantic` is preserved as a fallback for the case where pre-warm failed (model still downloading on a fresh first launch).

### `tokenizer_for_diagnostic()`

The semantic_search command (in `commands::semantic`) calls this accessor to expose the tokenizer for the `tokenizer_output` perf diagnostic. The diagnostic captures the raw query + its decoded tokens + attention mask sum BEFORE running ONNX inference, so the on-exit profiling report can show "user typed 'blue fish' → tokens [`<|startoftext|>`, `blue</w>`, `fish</w>`, `<|endoftext|>`], 4 real tokens out of 77 max" — pinpoints tokenizer breakage (everything → `<unk>`, query truncated mid-content, vocab mismatch) without needing a separate logging hook in the encoder.

## Key Interfaces / Data Flow

```text
commands::semantic::semantic_search:
    text_encoder_state.encoder.lock()
        if pre-warmed: skip init
        else if model + tokenizer files exist: ClipTextEncoder::new(...)
        else: return ApiError::TextModelMissing(path) or ApiError::TokenizerMissing(path)
    
    // Diagnostic emission BEFORE inference (cost: microseconds):
    let tok = encoder.tokenizer_for_diagnostic();
    let encoded = tok.encode(query, true)?;
    perf::record_diagnostic("tokenizer_output", json!({...}))
    
    encoder.encode(query) → Vec<f32> length 512
    
        ┌──────── encoder.rs::tokenize_and_pad ────┐
        │ Tokenizer::encode (BPE byte-level)       │
        │ pad/truncate to 77 with id 49407 (i32)   │
        │ NO attention_mask produced                │
        └──────────────────────────────────────────┘
        
        ┌──────── encoder.rs ────────────────────┐
        │ ort.session.run                        │
        │   inputs: text (int32[1,77]) ONLY      │
        └────────────────────────────────────────┘
        
        ┌──────── encoder.rs (extract closure) ──────────────────────────┐
        │ try output names: embedding → text_embeds → pooler_output → ...│
        │ normalize (L2, via pooling::normalize)                         │
        └──────────────────────────────────────────────────────────────────┘
    
    → Vec<f32> length 512
    → fed to cosine.get_similar_images_sorted as Array1::from_vec(...)
```

## Implemented Outputs / Artifacts

- `<app_data_dir>/models/clip_text.onnx` (~254 MB) loaded at first construction.
- `<app_data_dir>/models/clip_tokenizer.json` (~2 MB) parsed at first construction.
- `Vec<f32>` length 512 per `encode(query)` call (L2-normalised).
- Encoder unit tests in `encoder.rs`.

## Known Issues / Active Risks

| Risk | Triggered by | Downstream impact |
|------|--------------|-------------------|
| English-only — multilingual queries fall back to BPE chunking and produce poor embeddings | User typing in non-English | Embeddings are still produced but quality is poor for the chosen language. Documented trade-off vs the prior multilingual model's misalignment problem. SigLIP-2 (which has a 256k Gemma vocab) is the better pick for non-English; tracked in `notes/preprocessing-spatial-coverage.md`. |
| CoreML EP cannot be used | macOS attempt to enable it for performance | Silent inference errors. CPU-only is documented in source comments and not to be reverted. |
| Model load is 1–2 s | First semantic search on a launch where pre-warm failed | Lazy fallback covers it; user sees a brief loading state on first query of the session. |
| `max_seq_length = 77` truncation | Long queries (>~12 words) lose meaning past 77 tokens including BOS/EOS | This is CLIP's training-time cap, unchanged by the OpenCLIP LAION-2B weights swap (same 77-token context); raising it would require re-training the projection. Acceptable for typical "find sunset photos" queries. |
| Mutex around `Option<ClipTextEncoder>` serialises every semantic search | Concurrent UI semantic queries | Today's UI doesn't generate parallel semantic searches. |
| Unknown model output names produce a hard error | Swapping in a model variant with a non-standard output name | Encoder errors on first encode with `ApiError::Encoder("CLIP text: no recognised output name (expected embedding)")`. |
| Mutex poison (panic during encode) | Any panic in the encode path | `ApiError::Cosine("mutex poisoned: ...")` returned via `From<PoisonError>`. The naming is misleading but the recovery path is the same: restart. |
| `encode` and `encode_batch` carry slightly different output-name fallback chains | A future model export that only produces `sentence_embedding` | `encode` tries `embedding → text_embeds → pooler_output → sentence_embedding`; `encode_batch` tries `embedding → text_embeds → pooler_output` only, no `sentence_embedding`. Harmless today (the live export always hits `embedding` first) but the two call sites drifted apart and were never reconciled — see Encode flow above. |

## Partial / In Progress

None.

## Planned / Missing / Likely Changes

- **Re-add multilingual support via SigLIP-2's text branch** — SigLIP-2 uses a Gemma 256k SentencePiece vocab and has materially better cross-lingual coverage. The runtime can dispatch text queries to whichever encoder the user picked; the picker UI already supports per-direction encoder selection.
- **Smart per-query encoder routing** — long-term, route descriptive/scenery queries to SigLIP-2 (better English-text alignment + full-image coverage) and short concept queries to CLIP. Open architectural concern in `notes/preprocessing-spatial-coverage.md`.
- **Better unknown-output diagnostic** — list which output names were tried in the error message, so swapping in a new model surfaces the issue immediately.

## Durable Notes / Discarded Approaches

- **Multilingual distillation is gone because its embedding space was misaligned with the image branch.** The model's training distilled cross-lingual representations on top of a frozen-but-shifted text projection, producing 512-d vectors that nominally lived in "CLIP space" but in practice ranked text→image cosines essentially randomly. Verified by the report.md diagnostic dumps that motivated the swap.
- **HF `tokenizers` crate over custom Rust WordPiece.** The custom WordPiece tokenizer worked for the multilingual vocab but couldn't handle BPE's merge tables. Pulling the `tokenizers` crate as a dependency (already present for SigLIP-2's SentencePiece) eliminates ~150 lines of custom code and handles all three tokenizer families uniformly.
- **CoreML is disabled because transformer ops produce wrong outputs, not crashes.** Re-enabling without verifying every op is silent corruption waiting to happen.
- **L2-normalize at output is required** — the OpenCLIP `textual/model.onnx` export (like the Xenova export it replaced) outputs the post-projection embedding without normalization. Cosine works without it but pre-normalising makes the embeddings interchangeable.
- **Pad token 49407 = `<|endoftext|>` = EOS.** CLIP reuses the EOS token id for padding — a convention preserved by the current OpenCLIP LAION-2B weights. This is a deliberate quirk of the trained model — using a separate pad token would produce embeddings the model was never trained on.
- **2026-07 commercial-licensing swap: OpenAI CLIP (Xenova export, non-commercial research licence) → OpenCLIP LAION-2B ViT-B/32 (`immich-app/ViT-B-32__laion2b-s34b-b79k`, MIT).** Same tokenizer vocab (49408-entry BPE, 77-token context, pad id 49407), same 512-d L2-normalised output space, same on-disk filename (`clip_text.onnx`), no `CURRENT_PIPELINE_VERSION` bump. But the ONNX graph's I/O contract DID change and the swap's own commit (`00ee2fa`) didn't catch it: the new export renamed the input node `input_ids` → `text`, changed its dtype int64 → int32, and dropped the `attention_mask` input the old export never actually used either (the mask was always baked into the graph from token positions — passing it errored even before this swap). The encoder kept calling the new export with the old contract, so every text query failed silently until `b58dd46` (2026-07-15, same day) fixed the input name (`input_ids` → `text`) and `tokenize_and_pad`'s return dtype (`Vec<i64>` → `Vec<i32>`; the attention_mask-carrying tuple return had already been dropped in an earlier fix, `63d8a00`, when the old Xenova export was first found to reject that input too). See `systems/model-download.md` and `notes/clip-preprocessing-decisions.md` for the full swap rationale; see this document's Tokenizer and Encode-flow sections above for the current (post-fix) contract.
- **Lazy + pre-warm coexistence** is intentional — pre-warm covers the common case, lazy covers the edge cases (pre-warm failed because the model was still downloading). The double-init protection costs nothing because the lock check `is_none()` short-circuits when pre-warm succeeded.

## Obsolete / No Longer Relevant

The 647-line single-file `encoder_text.rs` is gone (split during the audit). The custom `SimpleTokenizer` (WordPiece + case-fallback) is gone. The multilingual `clip-ViT-B-32-multilingual-v1` model and its vocab — invalidated by the embedding-pipeline migration (DB version 2). The `[Backend]` println logging convention — replaced by `tracing` during Phase 6.

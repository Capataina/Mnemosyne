# apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/

The CLIP text encoder — the text half of text→image semantic search for the CLIP
family. Tokenisation is byte-level BPE via the HuggingFace `tokenizers` crate
(loaded from `clip_tokenizer.json`, which carries the full normalisation +
special-tokens contract); the same crate handles SentencePiece for SigLIP-2, whose
text encoder lives in the sibling `encoder_siglip2.rs`, not here. A custom
`SimpleTokenizer` (WordPiece) died with the multilingual→OpenAI CLIP switch.

## Map

```
encoder_text/
├── mod.rs        module doc + re-export of ClipTextEncoder
├── encoder.rs    ClipTextEncoder: tokenizer load, tuned ORT session (CPU-only on
│                 macOS by measurement), encode/encode_batch
└── pooling.rs    output-shape classification → single 512-d embedding, L2 normalize,
                  mean_pool fallback
```

## The model contract — every item verified against the real export

The weights are OpenCLIP ViT-B/32 (`immich-app/ViT-B-32__laion2b-s34b-b79k`, MIT —
the App-Store-viable swap from OpenAI's non-commercial weights). The ONNX I/O
contract differs from the old Xenova/OpenAI export in ways that only fail at
`session.run` time behind a green compile:

- Input node is `text` `[1, 77]` **int32** — the old export's `input_ids` was int64.
  Wrong name → "Invalid input name"; wrong dtype → "Unexpected input data type".
- There is **no attention_mask input**; the causal/padding mask is baked into the
  graph from pad positions (pad token 49407 = `<|endoftext|>`/EOS, positions after
  the first EOS treated as padding). `tokenize_and_pad` pads/truncates to exactly
  77 — the tokenizer itself never pads. EOS-as-pad is a trained-model quirk
  preserved by the OpenCLIP weights; a separate pad token would produce
  embeddings the model was never trained on. 77 is CLIP's training-time context
  cap (unchanged by the weights swap); longer queries truncate with no UI warning.
- `clip_tokenizer.json` carries the whole tokenisation contract: NFC +
  collapse-whitespace + lowercase normalisers, byte-level BPE with a 49408-entry
  vocab, RobertaProcessing wrapping with `<|startoftext|>` (49406) …
  `<|endoftext|>` (49407, doubling as pad and unk).
- Output node is `embedding` `[1, 512]` (was `text_embeds`), post-projection,
  post-LN; L2-normalised before returning. Extraction tries a defensive
  output-name chain so a future export swap degrades to a clear error, not a
  silent one — but the two call sites drifted: `encode` tries
  `embedding → text_embeds → pooler_output → sentence_embedding`, `encode_batch`
  stops at `pooler_output`. Harmless while the live export hits `embedding`
  first; reconcile if a future export needs the last fallback.
- `tokenizer_for_diagnostic()` exposes the tokenizer so `commands::semantic` can
  emit the `tokenizer_output` perf diagnostic (query → decoded tokens) before
  inference — pinpoints tokenizer breakage without a logging hook in the encoder.

The regression pin for exactly this class of bug is
`tests/audit_openclip_io_names_diagnostic.rs` (real inference, `--ignored`, needs
models on disk). Run it after any change to node names, dtypes, or padding.

## Traps

- **CoreML is deliberately skipped for text on macOS.** Transformer node coverage is
  poor and CoreML session-create (6-15s) dominates inference; plain CPU via the
  shared `ort_session::build_tuned_session` creates in ~1-2s and is faster
  end-to-end. The image encoders' rationale differs — don't copy accelerator code
  between the two.
- **Do not switch back to a multilingual text model** without swapping the image
  encoder into the same embedding space: the multilingual distillation lives in a
  different space, and using it for text→image produced effectively-random rankings
  (the "blue fish → Tristana" bug class).
- `pooling.rs`'s docstrings still describe the retired multilingual/DistilBERT
  export shapes (`[1, seq, 768]` mean-pool, first-512 truncation). Against the
  current export only the exact `[1, 512]` branch fires; the rest is defensive
  fallback, kept because output-shape drift across re-exports is the observed
  failure mode here.

## Place in the whole

Loaded lazily into `TextEncoderState.encoder` (lib.rs) on first CLIP semantic
search and kept resident so picker switches are free. Dispatched via the
`TextEncoder` trait in `../encoders.rs`; its 512-d output must share CLIP's image
embedding space (`../encoder.rs`) for the cosine ranking in the fusion slots to
mean anything.

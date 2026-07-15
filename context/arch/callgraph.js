/* ============================================================
   callgraph.js - written by upkeep-context callgraph_scan.py
   schema: cg1
   Script-owned file: re-runs regenerate it wholesale.
   ============================================================ */
window.CALLGRAPH = JSON.parse(`{
  "schema": "cg1",
  "lang": "rust",
  "scope": "entry: main · rust · 53 files · 247 functions · also detected python: 10 fns",
  "stats": [
    [
      "functions",
      "247",
      "",
      "in scope"
    ],
    [
      "call edges",
      "716",
      "",
      "static"
    ],
    [
      "resolved",
      "320",
      "ok",
      "45%"
    ],
    [
      "ambiguous",
      "0",
      "warn",
      "0%"
    ],
    [
      "external",
      "396",
      "dim",
      "collapsed"
    ],
    [
      "dynamic",
      "0",
      "violet",
      "0%"
    ]
  ],
  "legend": [
    [
      "resolved",
      "unique static target"
    ],
    [
      "trait",
      "via trait/interface method"
    ],
    [
      "ambiguous",
      "n candidate targets"
    ],
    [
      "dynamic",
      "call site kept · target unknown"
    ],
    [
      "external",
      "outside the analysed source"
    ]
  ],
  "typesLabel": "types in scope",
  "types": [
    "ApiError",
    "ClipImageEncoder",
    "ClipTextEncoder",
    "Dinov2ImageEncoder",
    "EncoderInfo",
    "ImageEncoder",
    "ImageScanner",
    "ImageSearchResult"
  ],
  "nodes": [
    {
      "id": "apps_lynceus_src_tauri_src_main_rs_main_7",
      "name": "main()",
      "meta": "apps/lynceus/src-tauri/src/main.rs:7",
      "cert": "resolved",
      "row": 0,
      "entry": true
    },
    {
      "id": "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "name": "run()",
      "meta": "apps/lynceus/src-tauri/src/lib.rs:231",
      "cert": "resolved",
      "row": 1
    },
    {
      "id": "crates_engine_src_paths_rs_app_data_dir_81",
      "name": "app_data_dir()",
      "meta": "crates/engine/src/paths.rs:81",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×9 sites"
    },
    {
      "id": "crates_engine_src_paths_rs_ensure_dir_200",
      "name": "ensure_dir()",
      "meta": "crates/engine/src/paths.rs:200",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×5 sites"
    },
    {
      "id": "crates_engine_src_perf_rs_flush_to_file_393",
      "name": "flush_to_file()",
      "meta": "crates/engine/src/perf.rs:393",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×4 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "get_fused_semantic_search()",
      "meta": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs:73",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "get_similar_images()",
      "meta": "apps/lynceus/src-tauri/src/commands/similarity.rs:479",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "name": "get_tiered_similar_images()",
      "meta": "apps/lynceus/src-tauri/src/commands/similarity.rs:324",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "name": "is_profiling_enabled()",
      "meta": "crates/engine/src/perf.rs:105",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×8 sites"
    },
    {
      "id": "crates_engine_src_paths_rs_models_dir_156",
      "name": "models_dir()",
      "meta": "crates/engine/src/paths.rs:156",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×8 sites"
    },
    {
      "id": "crates_engine_src_perf_rs_record_diagnostic_272",
      "name": "record_diagnostic()",
      "meta": "crates/engine/src/perf.rs:272",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×13 sites"
    },
    {
      "id": "crates_engine_src_perf_report_rs_render_session_",
      "name": "render_session_report()",
      "meta": "crates/engine/src/perf_report.rs:48",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "semantic_search()",
      "meta": "apps/lynceus/src-tauri/src/commands/semantic.rs:40",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "name": "try_spawn_pipeline()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:127",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×4 sites"
    },
    {
      "id": "crates_engine_src_perf_report_rs_build_markdown_",
      "name": "build_markdown()",
      "meta": "crates/engine/src/perf_report.rs:95",
      "cert": "resolved",
      "row": 3
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_reciprocal_rank_",
      "name": "reciprocal_rank_fusion()",
      "meta": "crates/engine/src/cosine/rrf.rs:103",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×8 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "name": "resolve_image_id_for_cosine_path()",
      "meta": "apps/lynceus/src-tauri/src/commands/mod.rs:92",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×5 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "name": "run_pipeline_inner()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:178",
      "cert": "resolved",
      "row": 3
    },
    {
      "id": "crates_engine_src_perf_rs_snapshot_546",
      "name": "snapshot()",
      "meta": "crates/engine/src/perf.rs:546",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×4 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "name": "download_models_if_missing()",
      "meta": "apps/lynceus/src-tauri/src/model_download.rs:114",
      "cert": "resolved",
      "row": 4
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_ms_human",
      "name": "format_ms_human()",
      "meta": "crates/engine/src/perf_report.rs:710",
      "cert": "resolved",
      "row": 4,
      "badge": "◇ ×6 sites"
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_us_human",
      "name": "format_us_human()",
      "meta": "crates/engine/src/perf_report.rs:695",
      "cert": "resolved",
      "row": 4,
      "badge": "◇ ×8 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_trait",
      "name": "run_trait_encoder()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:872",
      "cert": "resolved",
      "row": 4
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_header_",
      "name": "section_header()",
      "meta": "crates/engine/src/perf_report.rs:141",
      "cert": "resolved",
      "row": 4
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_outlier",
      "name": "section_outliers()",
      "meta": "crates/engine/src/perf_report.rs:271",
      "cert": "resolved",
      "row": 4,
      "badge": "◇ ×3 sites"
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_112",
      "name": "thumbnails_dir()",
      "meta": "crates/engine/src/paths.rs:112",
      "cert": "resolved",
      "row": 4,
      "badge": "◇ ×3 sites"
    },
    {
      "id": "ext_core_collect",
      "name": "core::collect",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 69 call sites reach it."
    },
    {
      "id": "ext_core_map",
      "name": "core::map",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 51 call sites reach it."
    },
    {
      "id": "ext_mnemosyne_fresh_db",
      "name": "mnemosyne::fresh_db",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 41 call sites reach it."
    }
  ],
  "edges": [
    [
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "crates_engine_src_cosine_rrf_rs_reciprocal_rank_",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r",
      "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r",
      "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "crates_engine_src_paths_rs_models_dir_156",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "crates_engine_src_paths_rs_thumbnails_dir_112",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_trait",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "apps_lynceus_src_tauri_src_commands_similarity_r",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "crates_engine_src_paths_rs_models_dir_156",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "crates_engine_src_perf_report_rs_render_session_",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_main_rs_main_7",
      "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "crates_engine_src_paths_rs_models_dir_156",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_app_data_dir_81",
      "crates_engine_src_paths_rs_ensure_dir_200",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_models_dir_156",
      "crates_engine_src_paths_rs_app_data_dir_81",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_models_dir_156",
      "crates_engine_src_paths_rs_ensure_dir_200",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_thumbnails_dir_112",
      "crates_engine_src_paths_rs_app_data_dir_81",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_thumbnails_dir_112",
      "crates_engine_src_paths_rs_ensure_dir_200",
      "resolved"
    ],
    [
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_build_markdown_",
      "crates_engine_src_perf_report_rs_section_header_",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_build_markdown_",
      "crates_engine_src_perf_report_rs_section_outlier",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_render_session_",
      "crates_engine_src_perf_rs_flush_to_file_393",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_render_session_",
      "crates_engine_src_perf_rs_snapshot_546",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_render_session_",
      "crates_engine_src_perf_report_rs_build_markdown_",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_section_header_",
      "crates_engine_src_perf_report_rs_format_ms_human",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_section_header_",
      "crates_engine_src_perf_report_rs_format_us_human",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_section_outlier",
      "crates_engine_src_perf_report_rs_format_ms_human",
      "resolved"
    ],
    [
      "crates_engine_src_perf_report_rs_section_outlier",
      "crates_engine_src_perf_report_rs_format_us_human",
      "resolved"
    ]
  ],
  "tree": [
    {
      "pre": "",
      "tog": "▾",
      "name": "main()",
      "meta": ":7",
      "hot": true
    },
    {
      "pre": "├─ ",
      "tog": "▾",
      "name": "run()",
      "meta": ":231",
      "hot": true
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_enabled_encoders()",
      "meta": ":129"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "list_available_encoders()",
      "meta": ":57"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▾",
      "name": "set_enabled_encoders()",
      "meta": ":143"
    },
    {
      "pre": "│  │  └─ ",
      "tog": "◇",
      "name": "decide_enabled_write()",
      "meta": "×6 call sites",
      "multi": true
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_images()",
      "meta": ":9"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_pipeline_stats()",
      "meta": ":30"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_image_notes()",
      "meta": ":10"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "set_image_notes()",
      "meta": ":20"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▾",
      "name": "export_perf_snapshot()",
      "meta": ":47"
    },
    {
      "pre": "│  │  ├─ ",
      "tog": "▸",
      "name": "exports_dir()",
      "meta": ":194"
    },
    {
      "pre": "│  │  └─ ",
      "tog": "◇",
      "name": "snapshot()",
      "meta": "×4 call sites",
      "multi": true
    },
    {
      "pre": "│  ├─ ",
      "tog": "▾",
      "name": "get_perf_snapshot()",
      "meta": ":17"
    },
    {
      "pre": "│  │  └─ ",
      "tog": "↺",
      "name": "snapshot()",
      "meta": ":546",
      "note": "revisited - expansion blocked",
      "rec": true
    },
    {
      "pre": "│  ├─ ",
      "tog": "▾",
      "name": "is_profiling_enabled()",
      "meta": ":10"
    }
  ],
  "fns": [
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "list_available_encoders",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 57,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "is_known_encoder",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 65,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_write",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 88,
      "in": 6,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "get_enabled_encoders",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 129,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "set_enabled_encoders",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 143,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_rejects_unknown_id",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 163,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_rejects_empty_list",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 174,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_short_circuits_on_set_equality",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 188,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_proceeds_on_set_change",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 199,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_encoders_rs_",
      "name": "decide_enabled_dedupes_input",
      "file": "apps/lynceus/src-tauri/src/commands/encoders.rs",
      "line": 212,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_ser",
      "name": "serialises_with_kind_and_details",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 134,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_ser",
      "name": "serialises_db_kind",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 143,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_rus",
      "name": "rusqlite_no_rows_becomes_not_found",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 150,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_rus",
      "name": "rusqlite_other_becomes_db",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 156,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_dis",
      "name": "display_includes_kind_label",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 164,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_images",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 9,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_pipeline_stats",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 30,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_mod_rs_resol",
      "name": "resolve_image_id_for_cosine_path",
      "file": "apps/lynceus/src-tauri/src/commands/mod.rs",
      "line": 92,
      "in": 5,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_notes_rs_get",
      "name": "get_image_notes",
      "file": "apps/lynceus/src-tauri/src/commands/notes.rs",
      "line": 10,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_notes_rs_set",
      "name": "set_image_notes",
      "file": "apps/lynceus/src-tauri/src/commands/notes.rs",
      "line": 20,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_profiling_rs",
      "name": "is_profiling_enabled",
      "file": "apps/lynceus/src-tauri/src/commands/profiling.rs",
      "line": 10,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_profiling_rs",
      "name": "get_perf_snapshot",
      "file": "apps/lynceus/src-tauri/src/commands/profiling.rs",
      "line": 17,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_profiling_rs",
      "name": "reset_perf_stats",
      "file": "apps/lynceus/src-tauri/src/commands/profiling.rs",
      "line": 24,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_profiling_rs",
      "name": "record_user_action",
      "file": "apps/lynceus/src-tauri/src/commands/profiling.rs",
      "line": 39,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_profiling_rs",
      "name": "export_perf_snapshot",
      "file": "apps/lynceus/src-tauri/src/commands/profiling.rs",
      "line": 47,
      "in": 1,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_get",
      "name": "get_scan_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 17,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_set",
      "name": "set_scan_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 30,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_lis",
      "name": "list_roots",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 74,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_add",
      "name": "add_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 82,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_rem",
      "name": "remove_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 113,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_set",
      "name": "set_root_enabled",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 146,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "semantic_search",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 40,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "encode_with_clip",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 218,
      "in": 1,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "encode_with_siglip2",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 256,
      "in": 1,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "record_clip_tokenizer_diagnostic",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 308,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "get_fused_semantic_search",
      "file": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs",
      "line": 73,
      "in": 1,
      "out": 4
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "encode_query",
      "file": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs",
      "line": 252,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "_force_pathbuf_used",
      "file": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs",
      "line": 295,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "run_cross_encoder_comparison",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 29,
      "in": 2,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "get_fused_similar_images",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 147,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "name": "get_tiered_similar_images",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 324,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "get_similar_images",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 479,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_get_",
      "name": "get_tags",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 9,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_crea",
      "name": "create_tag",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 15,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_dele",
      "name": "delete_tag",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 24,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_add_",
      "name": "add_tag_to_image",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 29,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_remo",
      "name": "remove_tag_from_image",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 38,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_filesystem_rs_is_supp",
      "name": "is_supported_image",
      "file": "apps/lynceus/src-tauri/src/filesystem.rs",
      "line": 5,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_filesystem_rs_test_su",
      "name": "test_supported_extensions",
      "file": "apps/lynceus/src-tauri/src/filesystem.rs",
      "line": 56,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "name": "try_spawn_pipeline",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 127,
      "in": 4,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "name": "run_pipeline_inner",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 178,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_encod",
      "name": "run_encoder_phase",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 573,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_clip_",
      "name": "run_clip_encoder_with_intra",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 759,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_trait",
      "name": "run_trait_encoder",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 872,
      "in": 1,
      "out": 4
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_prep",
      "name": "emit_preprocessing_sample",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 975,
      "in": 2,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_1016",
      "name": "emit",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1016,
      "in": 4,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_indexing_",
      "name": "indexing_state_default_not_running",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1041,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_phase_ser",
      "name": "phase_serialises_kebab_case",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1047,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_ready_pha",
      "name": "ready_phase_serialises",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1062,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_single_fl",
      "name": "single_flight_first_acquire_succeeds",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1076,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_single_fl",
      "name": "single_flight_releases_after_clear",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1094,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_indexing_",
      "name": "indexing_error_displays_human_readable_message",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1107,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_all_phase",
      "name": "all_phases_serialise_to_kebab_case",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1117,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_lib_rs_run_231",
      "name": "run",
      "file": "apps/lynceus/src-tauri/src/lib.rs",
      "line": 231,
      "in": 1,
      "out": 35
    },
    {
      "id": "apps_lynceus_src_tauri_src_main_rs_main_7",
      "name": "main",
      "file": "apps/lynceus/src-tauri/src/main.rs",
      "line": 7,
      "in": 0,
      "out": 6
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "name": "download_models_if_missing",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 114,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_hea",
      "name": "head_content_length",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 244,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "name": "download_to_file",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 260,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_fil",
      "name": "file_size",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 341,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_url_constants_are_well_formed",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 353,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_filenames_are_distinct",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 367,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_progress_signature_compiles",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 381,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_ass",
      "name": "assert_fn",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 383,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_defa",
      "name": "test_default_has_no_scan_root",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 136,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_roun",
      "name": "test_round_trip_with_scan_root",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 142,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_prio",
      "name": "test_priority_encoder_round_trip",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 153,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_prio",
      "name": "test_priority_encoder_default_is_none",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 164,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_unkn",
      "name": "test_unknown_fields_dont_break_parse",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 172,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_miss",
      "name": "test_missing_field_uses_default",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 181,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_falls_back_to_default",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 188,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_honours_user_pick",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 195,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_strips_empty_strings",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 205,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_empty_list_falls_back",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 215,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "try_extract_single_embedding",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/pooling.rs",
      "line": 18,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "normalize",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/pooling.rs",
      "line": 36,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "mean_pool",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoder_text/pooling.rs",
      "line": 52,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "encode",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 44,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "encode_batch",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 49,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "embedding_dim",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 58,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "id",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 65,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "encode",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 76,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "embedding_dim",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 81,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "id",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/encoders.rs",
      "line": 84,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "build_tuned_session",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/ort_session.rs",
      "line": 64,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "build_tuned_session_with_intra",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/ort_session.rs",
      "line": 83,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_similarity_and_semant",
      "name": "fast_resize_rgb8",
      "file": "apps/lynceus/src-tauri/src/similarity_and_semantic_search/preprocess.rs",
      "line": 41,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_landscape",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 365,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_portrait",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 376,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_no_upscale",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 387,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_wide",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 398,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_get_thumbnail_path",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 409,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_watcher_rs_start_52",
      "name": "start",
      "file": "apps/lynceus/src-tauri/src/watcher.rs",
      "line": 52,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_cache_save_and",
      "name": "cache_save_and_load_round_trip",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 121,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_cache_refuses_",
      "name": "cache_refuses_stale_cache_when_db_is_newer",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 148,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_cache_returns_",
      "name": "cache_returns_false_when_file_missing",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 169,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_cache_handles_",
      "name": "cache_handles_corrupt_file_gracefully",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 181,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_cache_overwrit",
      "name": "cache_overwrites_on_resave",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 197,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_embeddin",
      "name": "embedding_stats",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 44,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_pairwise",
      "name": "pairwise_distance_distribution",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 151,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_self_sim",
      "name": "self_similarity_check",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 220,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_score_di",
      "name": "score_distribution_stats",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 240,
      "in": 3,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_add_image",
      "name": "test_add_image",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 494,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_add_multi",
      "name": "test_add_multiple_images",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 507,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_returns_most_similar",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 520,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_with_many_candidates",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 561,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_request_more_than_available",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 592,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_empty_ind",
      "name": "test_empty_index",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 610,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_score_cmp_desc_",
      "name": "score_cmp_desc",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 10,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_cosine_similari",
      "name": "cosine_similarity",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 20,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_identical_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 56,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_orthogonal_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 71,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_opposite_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 86,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_parallel_vectors_different_magnitude",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 101,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_45_degree_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 116,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_high_dimensional",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 132,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_high_dimensional_orthogonal",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 147,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_normalized_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 167,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_reciprocal_rank_",
      "name": "reciprocal_rank_fusion",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 103,
      "in": 8,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_p_149",
      "name": "p",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 149,
      "in": 5,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_empty_lists_prod",
      "name": "empty_lists_produce_empty_output",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 154,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_top_n_zero_produ",
      "name": "top_n_zero_produces_empty_output",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 159,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_single_encoder_p",
      "name": "single_encoder_preserves_order",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 168,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_consensus_image_",
      "name": "consensus_image_outranks_one_encoder_winner",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 188,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_k_rrf_changes_lo",
      "name": "k_rrf_changes_lone_vs_consensus_score_ratio",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 229,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_truncation_retur",
      "name": "truncation_returns_top_n",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 299,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_basic",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 355,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_round_trip",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 395,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_overwrite",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 433,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_nonexistent_image",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 461,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_empty_embedding",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 487,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_update_i",
      "name": "test_update_image_embedding_large_embedding",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 506,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_test_get_imag",
      "name": "test_get_image_embedding_before_update",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 525,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_get_all_embed",
      "name": "get_all_embeddings_returns_only_populated_rows",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 544,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_get_all_embed",
      "name": "get_all_embeddings_is_empty_when_nothing_encoded",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 566,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_get_all_embed",
      "name": "get_all_embeddings_excludes_disabled_root_images",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 574,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_get_all_embed",
      "name": "get_all_embeddings_excludes_orphaned_images",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 607,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_embeddings_rs_get_all_embed",
      "name": "get_all_embeddings_for_excludes_disabled_and_orphaned",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 626,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_aggregate_i",
      "name": "aggregate_image_rows",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 80,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_databa",
      "name": "test_database_operations",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 527,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_empty_db",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 538,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_counts_each_stage_independently",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 550,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_counts_orphaned_separately",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 585,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_preven",
      "name": "test_prevent_duplicate_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 600,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_empty_",
      "name": "test_empty_database",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 612,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_grid_query_",
      "name": "grid_query_excludes_disabled_root_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 624,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_grid_query_",
      "name": "grid_query_includes_null_root_id_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 647,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_setup_tagge",
      "name": "setup_tagged_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 661,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_or_filter_m",
      "name": "or_filter_matches_any_selected_tag",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 681,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_images_query_rs_and_filter_",
      "name": "and_filter_requires_all_selected_tags",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 697,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_mod_rs_initialize_is_idempo",
      "name": "initialize_is_idempotent",
      "file": "crates/engine/src/db/mod.rs",
      "line": 348,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_marks_missing_paths",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 142,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_unmarks_returned_files",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 161,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_empty_alive_set_orphans_everything_in_root",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 182,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_does_not_affect_other_roots",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 193,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_chunks_handle_large_libraries",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 210,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_roun",
      "name": "notes_round_trip",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 228,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_get_",
      "name": "notes_get_returns_none_when_unset",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 247,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_pers",
      "name": "notes_persist_across_reads",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 255,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_add_root_creates_r",
      "name": "add_root_creates_row_with_enabled_true",
      "file": "crates/engine/src/db/roots.rs",
      "line": 148,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_add_root_rejects_d",
      "name": "add_root_rejects_duplicate_path",
      "file": "crates/engine/src/db/roots.rs",
      "line": 157,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_list_roots_orders_",
      "name": "list_roots_orders_by_added_at_ascending",
      "file": "crates/engine/src/db/roots.rs",
      "line": 169,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_remove_root_cascad",
      "name": "remove_root_cascades_to_images",
      "file": "crates/engine/src/db/roots.rs",
      "line": 182,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_remove_root_does_n",
      "name": "remove_root_does_not_affect_other_roots_images",
      "file": "crates/engine/src/db/roots.rs",
      "line": 199,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_set_root_enabled_r",
      "name": "set_root_enabled_round_trips",
      "file": "crates/engine/src/db/roots.rs",
      "line": 212,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_migrate_legacy_sca",
      "name": "migrate_legacy_scan_root_inserts_and_backfills",
      "file": "crates/engine/src/db/roots.rs",
      "line": 225,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_migrate_legacy_sca",
      "name": "migrate_legacy_scan_root_is_idempotent",
      "file": "crates/engine/src/db/roots.rs",
      "line": 261,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_get_root_id_by_pat",
      "name": "get_root_id_by_path_returns_some_when_known",
      "file": "crates/engine/src/db/roots.rs",
      "line": 274,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_get_root_id_by_pat",
      "name": "get_root_id_by_path_returns_none_when_unknown_or_null",
      "file": "crates/engine/src/db/roots.rs",
      "line": 282,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_wipe_images_for_ne",
      "name": "wipe_images_for_new_root_preserves_tags",
      "file": "crates/engine/src/db/roots.rs",
      "line": 292,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_strip_windows_extende",
      "name": "strip_windows_extended_prefix",
      "file": "crates/engine/src/paths.rs",
      "line": 47,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_app_data_dir_81",
      "name": "app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 81,
      "in": 9,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_database_path_106",
      "name": "database_path",
      "file": "crates/engine/src/paths.rs",
      "line": 106,
      "in": 2,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_112",
      "name": "thumbnails_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 112,
      "in": 3,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_for_ro",
      "name": "thumbnails_dir_for_root",
      "file": "crates/engine/src/paths.rs",
      "line": 133,
      "in": 2,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_models_dir_156",
      "name": "models_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 156,
      "in": 8,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_settings_path_171",
      "name": "settings_path",
      "file": "crates/engine/src/paths.rs",
      "line": 171,
      "in": 2,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_cosine_cache_path_183",
      "name": "cosine_cache_path",
      "file": "crates/engine/src/paths.rs",
      "line": 183,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_exports_dir_194",
      "name": "exports_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 194,
      "in": 2,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_ensure_dir_200",
      "name": "ensure_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 200,
      "in": 5,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_test_app_data_dir_liv",
      "name": "test_app_data_dir_lives_under_platform_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 212,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_test_paths_are_under_",
      "name": "test_paths_are_under_app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 233,
      "in": 0,
      "out": 5
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_for_ro",
      "name": "thumbnails_dir_for_root_creates_subfolder",
      "file": "crates/engine/src/paths.rs",
      "line": 242,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_cosine_cache_path_is_",
      "name": "cosine_cache_path_is_under_app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 254,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_test_filenames_are_st",
      "name": "test_filenames_are_stable",
      "file": "crates/engine/src/paths.rs",
      "line": 264,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_rs_stats_map_83",
      "name": "stats_map",
      "file": "crates/engine/src/perf.rs",
      "line": 83,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_set_profiling_enabled_",
      "name": "set_profiling_enabled",
      "file": "crates/engine/src/perf.rs",
      "line": 99,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "name": "is_profiling_enabled",
      "file": "crates/engine/src/perf.rs",
      "line": 105,
      "in": 8,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_raw_events_buf_211",
      "name": "raw_events_buf",
      "file": "crates/engine/src/perf.rs",
      "line": 211,
      "in": 4,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_init_session_222",
      "name": "init_session",
      "file": "crates/engine/src/perf.rs",
      "line": 222,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_session_dir_235",
      "name": "session_dir",
      "file": "crates/engine/src/perf.rs",
      "line": 235,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_session_ms_242",
      "name": "session_ms",
      "file": "crates/engine/src/perf.rs",
      "line": 242,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_record_user_action_251",
      "name": "record_user_action",
      "file": "crates/engine/src/perf.rs",
      "line": 251,
      "in": 1,
      "out": 3
    },
    {
      "id": "crates_engine_src_perf_rs_record_diagnostic_272",
      "name": "record_diagnostic",
      "file": "crates/engine/src/perf.rs",
      "line": 272,
      "in": 13,
      "out": 3
    },
    {
      "id": "crates_engine_src_perf_rs_push_event_287",
      "name": "push_event",
      "file": "crates/engine/src/perf.rs",
      "line": 287,
      "in": 3,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_rs_spawn_system_sampler_t",
      "name": "spawn_system_sampler_thread",
      "file": "crates/engine/src/perf.rs",
      "line": 317,
      "in": 1,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_rs_spawn_flush_thread_369",
      "name": "spawn_flush_thread",
      "file": "crates/engine/src/perf.rs",
      "line": 369,
      "in": 1,
      "out": 3
    },
    {
      "id": "crates_engine_src_perf_rs_flush_to_file_393",
      "name": "flush_to_file",
      "file": "crates/engine/src/perf.rs",
      "line": 393,
      "in": 4,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_rs_percentile_529",
      "name": "percentile",
      "file": "crates/engine/src/perf.rs",
      "line": 529,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_snapshot_546",
      "name": "snapshot",
      "file": "crates/engine/src/perf.rs",
      "line": 546,
      "in": 4,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_rs_reset_593",
      "name": "reset",
      "file": "crates/engine/src/perf.rs",
      "line": 593,
      "in": 2,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_rs_span_stats_records_min",
      "name": "span_stats_records_min_max_correctly",
      "file": "crates/engine/src/perf.rs",
      "line": 604,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_span_stats_ringbuffer_",
      "name": "span_stats_ringbuffer_caps_at_max",
      "file": "crates/engine/src/perf.rs",
      "line": 616,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_percentile_handles_edg",
      "name": "percentile_handles_edges",
      "file": "crates/engine/src/perf.rs",
      "line": 630,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_rs_snapshot_returns_empty",
      "name": "snapshot_returns_empty_when_no_spans_recorded",
      "file": "crates/engine/src/perf.rs",
      "line": 642,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_rs_raw_event_span_seriali",
      "name": "raw_event_span_serialises_with_kind_tag",
      "file": "crates/engine/src/perf.rs",
      "line": 652,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_raw_event_user_seriali",
      "name": "raw_event_user_serialises_with_payload_object",
      "file": "crates/engine/src/perf.rs",
      "line": 669,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_rs_flush_to_file_writes_j",
      "name": "flush_to_file_writes_jsonl_and_drains_buffer",
      "file": "crates/engine/src/perf.rs",
      "line": 682,
      "in": 0,
      "out": 3
    },
    {
      "id": "crates_engine_src_perf_rs_flush_to_file_is_noop_",
      "name": "flush_to_file_is_noop_when_buffer_empty",
      "file": "crates/engine/src/perf.rs",
      "line": 735,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_report_rs_render_session_",
      "name": "render_session_report",
      "file": "crates/engine/src/perf_report.rs",
      "line": 48,
      "in": 1,
      "out": 4
    },
    {
      "id": "crates_engine_src_perf_report_rs_read_timeline_7",
      "name": "read_timeline",
      "file": "crates/engine/src/perf_report.rs",
      "line": 74,
      "in": 3,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_build_markdown_",
      "name": "build_markdown",
      "file": "crates/engine/src/perf_report.rs",
      "line": 95,
      "in": 2,
      "out": 11
    },
    {
      "id": "crates_engine_src_perf_report_rs_event_ts_121",
      "name": "event_ts",
      "file": "crates/engine/src/perf_report.rs",
      "line": 121,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_event_is_span_1",
      "name": "event_is_span",
      "file": "crates/engine/src/perf_report.rs",
      "line": 129,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_event_is_user_1",
      "name": "event_is_user",
      "file": "crates/engine/src/perf_report.rs",
      "line": 133,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_header_",
      "name": "section_header",
      "file": "crates/engine/src/perf_report.rs",
      "line": 141,
      "in": 1,
      "out": 5
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_top_by_",
      "name": "section_top_by_total",
      "file": "crates/engine/src/perf_report.rs",
      "line": 191,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_hotspot",
      "name": "section_hotspots",
      "file": "crates/engine/src/perf_report.rs",
      "line": 238,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_outlier",
      "name": "section_outliers",
      "file": "crates/engine/src/perf_report.rs",
      "line": 271,
      "in": 3,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_action_",
      "name": "section_action_timeline",
      "file": "crates/engine/src/perf_report.rs",
      "line": 334,
      "in": 1,
      "out": 3
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_per_spa",
      "name": "section_per_span_table",
      "file": "crates/engine/src/perf_report.rs",
      "line": 422,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_stall_a",
      "name": "section_stall_analysis",
      "file": "crates/engine/src/perf_report.rs",
      "line": 464,
      "in": 1,
      "out": 2
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_resourc",
      "name": "section_resource_trends",
      "file": "crates/engine/src/perf_report.rs",
      "line": 552,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_percentile_summ",
      "name": "percentile_summary",
      "file": "crates/engine/src/perf_report.rs",
      "line": 608,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_diagnos",
      "name": "section_diagnostics",
      "file": "crates/engine/src/perf_report.rs",
      "line": 621,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_footer_",
      "name": "section_footer",
      "file": "crates/engine/src/perf_report.rs",
      "line": 678,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_us_human",
      "name": "format_us_human",
      "file": "crates/engine/src/perf_report.rs",
      "line": 695,
      "in": 8,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_ms_human",
      "name": "format_ms_human",
      "file": "crates/engine/src/perf_report.rs",
      "line": 710,
      "in": 6,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_payload_",
      "name": "format_payload",
      "file": "crates/engine/src/perf_report.rs",
      "line": 725,
      "in": 3,
      "out": 0
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_us_human",
      "name": "format_us_human_picks_appropriate_unit",
      "file": "crates/engine/src/perf_report.rs",
      "line": 752,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_ms_human",
      "name": "format_ms_human_picks_appropriate_unit",
      "file": "crates/engine/src/perf_report.rs",
      "line": 761,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_payload_",
      "name": "format_payload_renders_key_value_pairs",
      "file": "crates/engine/src/perf_report.rs",
      "line": 768,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_format_payload_",
      "name": "format_payload_handles_empty_object",
      "file": "crates/engine/src/perf_report.rs",
      "line": 776,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_outlier_section",
      "name": "outlier_section_correlates_user_action_with_following_span",
      "file": "crates/engine/src/perf_report.rs",
      "line": 781,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_outlier_section",
      "name": "outlier_section_drops_correlation_outside_window",
      "file": "crates/engine/src/perf_report.rs",
      "line": 806,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_build_markdown_",
      "name": "build_markdown_includes_every_section_header",
      "file": "crates/engine/src/perf_report.rs",
      "line": 837,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_read_timeline_r",
      "name": "read_timeline_returns_empty_when_file_missing",
      "file": "crates/engine/src/perf_report.rs",
      "line": 856,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_perf_report_rs_read_timeline_s",
      "name": "read_timeline_skips_malformed_lines",
      "file": "crates/engine/src/perf_report.rs",
      "line": 869,
      "in": 0,
      "out": 1
    }
  ]
}`);

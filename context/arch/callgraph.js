/* ============================================================
   callgraph.js - written by upkeep-context callgraph_scan.py
   schema: cg1
   Script-owned file: re-runs regenerate it wholesale.
   ============================================================ */
window.CALLGRAPH = JSON.parse(`{
  "schema": "cg1",
  "lang": "rust",
  "scope": "entry: main · rust · 56 files · 304 functions · also detected python: 14 fns",
  "stats": [
    [
      "functions",
      "304",
      "",
      "in scope"
    ],
    [
      "call edges",
      "885",
      "",
      "static"
    ],
    [
      "resolved",
      "372",
      "ok",
      "42%"
    ],
    [
      "ambiguous",
      "0",
      "warn",
      "0%"
    ],
    [
      "external",
      "513",
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
    "EncodeProgress",
    "EncoderInfo",
    "FeedDeltaBatch",
    "FeedDeltaRow"
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
      "id": "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "name": "run()",
      "meta": "apps/lynceus/src-tauri/src/lib.rs:289",
      "cert": "resolved",
      "row": 1
    },
    {
      "id": "crates_engine_src_paths_rs_app_data_dir_82",
      "name": "app_data_dir()",
      "meta": "crates/engine/src/paths.rs:82",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×10 sites"
    },
    {
      "id": "crates_engine_src_paths_rs_ensure_dir_293",
      "name": "ensure_dir()",
      "meta": "crates/engine/src/paths.rs:293",
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
      "meta": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs:72",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "get_similar_images()",
      "meta": "apps/lynceus/src-tauri/src/commands/similarity.rs:387",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "name": "get_tiered_similar_images()",
      "meta": "apps/lynceus/src-tauri/src/commands/similarity.rs:281",
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
      "id": "crates_engine_src_paths_rs_models_dir_204",
      "name": "models_dir()",
      "meta": "crates/engine/src/paths.rs:204",
      "cert": "resolved",
      "row": 2,
      "badge": "◇ ×9 sites"
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
      "meta": "apps/lynceus/src-tauri/src/commands/semantic.rs:39",
      "cert": "resolved",
      "row": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "name": "try_spawn_pipeline()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:174",
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
      "id": "crates_engine_src_paths_rs_database_path_107",
      "name": "database_path()",
      "meta": "crates/engine/src/paths.rs:107",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×4 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_1329",
      "name": "emit()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:1329",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×5 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
      "name": "hydrate_search_results()",
      "meta": "apps/lynceus/src-tauri/src/commands/mod.rs:88",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×5 sites"
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_reciprocal_rank_",
      "name": "reciprocal_rank_fusion()",
      "meta": "crates/engine/src/cosine/rrf.rs:102",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×8 sites"
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "name": "run_pipeline_inner()",
      "meta": "apps/lynceus/src-tauri/src/indexing.rs:225",
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
      "id": "crates_engine_src_paths_rs_thumbnails_dir_113",
      "name": "thumbnails_dir()",
      "meta": "crates/engine/src/paths.rs:113",
      "cert": "resolved",
      "row": 3,
      "badge": "◇ ×4 sites"
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
      "id": "crates_engine_src_paths_rs_model_path_for_244",
      "name": "model_path_for()",
      "meta": "crates/engine/src/paths.rs:244",
      "cert": "resolved",
      "row": 4,
      "badge": "◇ ×7 sites"
    },
    {
      "id": "crates_engine_src_perf_report_rs_section_header_",
      "name": "section_header()",
      "meta": "crates/engine/src/perf_report.rs:141",
      "cert": "resolved",
      "row": 4
    },
    {
      "id": "ext_core_collect",
      "name": "core::collect",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 88 call sites reach it."
    },
    {
      "id": "ext_core_map",
      "name": "core::map",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 75 call sites reach it."
    },
    {
      "id": "ext_mnemosyne_fresh_db",
      "name": "mnemosyne::fresh_db",
      "meta": "external",
      "cert": "external",
      "ext": true,
      "row": 0,
      "doc": "Outside the analysed source; 57 call sites reach it."
    }
  ],
  "edges": [
    [
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
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
      "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
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
      "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
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
      "apps_lynceus_src_tauri_src_indexing_rs_emit_1329",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "crates_engine_src_paths_rs_model_path_for_244",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "crates_engine_src_paths_rs_models_dir_204",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "crates_engine_src_paths_rs_thumbnails_dir_113",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "apps_lynceus_src_tauri_src_indexing_rs_emit_1329",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "apps_lynceus_src_tauri_src_commands_similarity_r",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "crates_engine_src_paths_rs_models_dir_204",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "crates_engine_src_perf_rs_is_profiling_enabled_1",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "crates_engine_src_perf_rs_record_diagnostic_272",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "crates_engine_src_perf_report_rs_render_session_",
      "resolved"
    ],
    [
      "apps_lynceus_src_tauri_src_main_rs_main_7",
      "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_app_data_dir_82",
      "crates_engine_src_paths_rs_ensure_dir_293",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_database_path_107",
      "crates_engine_src_paths_rs_app_data_dir_82",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_model_path_for_244",
      "crates_engine_src_paths_rs_models_dir_204",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_models_dir_204",
      "crates_engine_src_paths_rs_app_data_dir_82",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_models_dir_204",
      "crates_engine_src_paths_rs_ensure_dir_293",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_thumbnails_dir_113",
      "crates_engine_src_paths_rs_app_data_dir_82",
      "resolved"
    ],
    [
      "crates_engine_src_paths_rs_thumbnails_dir_113",
      "crates_engine_src_paths_rs_ensure_dir_293",
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
      "meta": ":289",
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
      "name": "get_feed_manifest()",
      "meta": ":53"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_image_details()",
      "meta": ":73"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_images()",
      "meta": ":28"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_pipeline_stats()",
      "meta": ":89"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▾",
      "name": "get_thumbnail()",
      "meta": ":110"
    },
    {
      "pre": "│  │  ├─ ",
      "tog": "◇",
      "name": "thumbnails_dir()",
      "meta": "×4 call sites",
      "multi": true
    },
    {
      "pre": "│  │  └─ ",
      "tog": "◇",
      "name": "thumbnails_dir_for_root()",
      "meta": "×3 call sites",
      "multi": true
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "set_manual_col_span()",
      "meta": ":206"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "set_manual_order()",
      "meta": ":195"
    },
    {
      "pre": "│  ├─ ",
      "tog": "▸",
      "name": "get_image_notes()",
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
      "line": 136,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_ser",
      "name": "serialises_db_kind",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 145,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_rus",
      "name": "rusqlite_no_rows_becomes_not_found",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 152,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_rus",
      "name": "rusqlite_other_becomes_db",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 158,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_error_rs_dis",
      "name": "display_includes_kind_label",
      "file": "apps/lynceus/src-tauri/src/commands/error.rs",
      "line": 166,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_images",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 28,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_feed_manifest",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 53,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_image_details",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 73,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_pipeline_stats",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 89,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_ge",
      "name": "get_thumbnail",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 110,
      "in": 1,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_se",
      "name": "set_manual_order",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 195,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_images_rs_se",
      "name": "set_manual_col_span",
      "file": "apps/lynceus/src-tauri/src/commands/images.rs",
      "line": 206,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_mod_rs_hydra",
      "name": "hydrate_search_results",
      "file": "apps/lynceus/src-tauri/src/commands/mod.rs",
      "line": 88,
      "in": 5,
      "out": 0
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
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_lis",
      "name": "list_roots",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 87,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_add",
      "name": "add_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 95,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_rem",
      "name": "remove_root",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 135,
      "in": 1,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_roots_rs_set",
      "name": "set_root_enabled",
      "file": "apps/lynceus/src-tauri/src/commands/roots.rs",
      "line": 178,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "semantic_search",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 39,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "encode_with_clip",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 182,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "encode_with_siglip2",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 226,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_rs_",
      "name": "record_clip_tokenizer_diagnostic",
      "file": "apps/lynceus/src-tauri/src/commands/semantic.rs",
      "line": 281,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "get_fused_semantic_search",
      "file": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs",
      "line": 72,
      "in": 1,
      "out": 4
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_semantic_fus",
      "name": "encode_query",
      "file": "apps/lynceus/src-tauri/src/commands/semantic_fused.rs",
      "line": 225,
      "in": 1,
      "out": 2
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
      "line": 145,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r_1",
      "name": "get_tiered_similar_images",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 281,
      "in": 1,
      "out": 5
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_similarity_r",
      "name": "get_similar_images",
      "file": "apps/lynceus/src-tauri/src/commands/similarity.rs",
      "line": 387,
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
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_get_",
      "name": "get_tag_counts",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 19,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_crea",
      "name": "create_tag",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 25,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_dele",
      "name": "delete_tag",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 34,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_add_",
      "name": "add_tag_to_image",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 39,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_commands_tags_rs_remo",
      "name": "remove_tag_from_image",
      "file": "apps/lynceus/src-tauri/src/commands/tags.rs",
      "line": 48,
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
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_feed",
      "name": "emit_feed_delta",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 131,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_try_spawn",
      "name": "try_spawn_pipeline",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 174,
      "in": 4,
      "out": 2
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_pipel",
      "name": "run_pipeline_inner",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 225,
      "in": 1,
      "out": 7
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_encod",
      "name": "run_encoder_phase",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 800,
      "in": 1,
      "out": 4
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_clip_",
      "name": "run_clip_encoder_with_intra",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1044,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_run_trait",
      "name": "run_trait_encoder",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1179,
      "in": 1,
      "out": 4
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_prep",
      "name": "emit_preprocessing_sample",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1288,
      "in": 2,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_emit_1329",
      "name": "emit",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1329,
      "in": 5,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_indexing_",
      "name": "indexing_state_default_not_running",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1354,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_phase_ser",
      "name": "phase_serialises_kebab_case",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1360,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_ready_pha",
      "name": "ready_phase_serialises",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1375,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_single_fl",
      "name": "single_flight_first_acquire_succeeds",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1389,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_single_fl",
      "name": "single_flight_releases_after_clear",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1407,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_indexing_",
      "name": "indexing_error_displays_human_readable_message",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1420,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_all_phase",
      "name": "all_phases_serialise_to_kebab_case",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1430,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_encode_pr",
      "name": "encode_progress_emits_per_image_at_interval_one",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1455,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_encode_pr",
      "name": "encode_progress_interval_caps_emits_but_hits_terminal",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1468,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_indexing_rs_encode_pr",
      "name": "encode_progress_never_regresses_under_concurrent_encoders",
      "file": "apps/lynceus/src-tauri/src/indexing.rs",
      "line": 1480,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_lib_rs_spawn_cache_wa",
      "name": "spawn_cache_warm",
      "file": "apps/lynceus/src-tauri/src/lib.rs",
      "line": 252,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_lib_rs_run_289",
      "name": "run",
      "file": "apps/lynceus/src-tauri/src/lib.rs",
      "line": 289,
      "in": 1,
      "out": 44
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
      "line": 119,
      "in": 1,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_hea",
      "name": "head_content_length",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 249,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_dow",
      "name": "download_to_file",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 265,
      "in": 1,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_fil",
      "name": "file_size",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 346,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_url_constants_are_well_formed",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 358,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_filenames_are_distinct",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 372,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_tes",
      "name": "test_progress_signature_compiles",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 386,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_model_download_rs_ass",
      "name": "assert_fn",
      "file": "apps/lynceus/src-tauri/src/model_download.rs",
      "line": 388,
      "in": 1,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_security_scope_rs_cre",
      "name": "create_bookmark",
      "file": "apps/lynceus/src-tauri/src/security_scope.rs",
      "line": 86,
      "in": 3,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_security_scope_rs_sta",
      "name": "start_accessing",
      "file": "apps/lynceus/src-tauri/src/security_scope.rs",
      "line": 120,
      "in": 2,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_security_scope_rs_sto",
      "name": "stop_accessing",
      "file": "apps/lynceus/src-tauri/src/security_scope.rs",
      "line": 163,
      "in": 2,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_security_scope_rs_boo",
      "name": "bookmark_round_trips_to_the_same_path_outside_a_sandbox",
      "file": "apps/lynceus/src-tauri/src/security_scope.rs",
      "line": 196,
      "in": 0,
      "out": 3
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_defa",
      "name": "test_default_has_no_scan_root",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 158,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_roun",
      "name": "test_round_trip_with_scan_root",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 164,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_prio",
      "name": "test_priority_encoder_round_trip",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 175,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_prio",
      "name": "test_priority_encoder_default_is_none",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 186,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_unkn",
      "name": "test_unknown_fields_dont_break_parse",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 194,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_miss",
      "name": "test_missing_field_uses_default",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 203,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_falls_back_to_default",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 210,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_honours_user_pick",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 217,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_strips_empty_strings",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 227,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_settings_rs_test_reso",
      "name": "test_resolved_enabled_encoders_empty_list_falls_back",
      "file": "apps/lynceus/src-tauri/src/settings.rs",
      "line": 237,
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
      "name": "size_for_width",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 511,
      "in": 4,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_landscape",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 539,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_portrait",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 550,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_no_upscale",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 563,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_calculate_thumbnail_size_wide",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 574,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "test_get_thumbnail_path",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 585,
      "in": 0,
      "out": 0
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "size_for_width_hits_exact_bucket_width_when_source_is_larger",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 601,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "size_for_width_never_upscales_past_source_width",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 611,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "size_for_width_survives_degenerate_dimensions",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 618,
      "in": 0,
      "out": 1
    },
    {
      "id": "apps_lynceus_src_tauri_src_thumbnail_generator_r",
      "name": "size_for_width_handles_large_sources_without_overflow",
      "file": "apps/lynceus/src-tauri/src/thumbnail/generator.rs",
      "line": 627,
      "in": 0,
      "out": 1
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
      "id": "crates_engine_src_cosine_cache_rs_fnv1a_str_48",
      "name": "fnv1a_str",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 48,
      "in": 3,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_embstore_path_",
      "name": "embstore_path",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 60,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_round_up_64_69",
      "name": "round_up_64",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 69,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_load_flat_stor",
      "name": "load_flat_store",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 168,
      "in": 8,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_write_fixture_",
      "name": "write_fixture",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 249,
      "in": 6,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_round_tr",
      "name": "store_round_trip_ids_norms_embeddings",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 261,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_rejected",
      "name": "store_rejected_on_token_mismatch",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 284,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_rejected",
      "name": "store_rejected_on_encoder_mismatch",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 294,
      "in": 0,
      "out": 3
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_rejected",
      "name": "store_rejected_on_bad_magic",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 304,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_rejected",
      "name": "store_rejected_on_version_mismatch",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 314,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_rejected",
      "name": "store_rejected_on_corrupt_dim_length",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 324,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_store_missing_",
      "name": "store_missing_file_returns_none",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 336,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_cache_rs_mapped_block_s",
      "name": "mapped_block_scores_identically_to_owned",
      "file": "crates/engine/src/cosine/cache.rs",
      "line": 343,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_embeddin",
      "name": "embedding_stats",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 43,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_pairwise",
      "name": "pairwise_distance_distribution",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 150,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_self_sim",
      "name": "self_similarity_check",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 217,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_diagnostics_rs_score_di",
      "name": "score_distribution_stats",
      "file": "crates/engine/src/cosine/diagnostics.rs",
      "line": 235,
      "in": 3,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_rows_of_425",
      "name": "rows_of",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 425,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_add_image",
      "name": "test_add_image",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 433,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_add_multi",
      "name": "test_add_multiple_images",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 443,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_returns_most_similar",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 453,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_with_many_candidates",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 468,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_get_simil",
      "name": "test_get_similar_images_request_more_than_available",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 486,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_test_empty_ind",
      "name": "test_empty_index",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 497,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_clear_resets_t",
      "name": "clear_resets_to_empty",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 504,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_parallel_scori",
      "name": "parallel_scoring_matches_serial_reference",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 515,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_legacy_off_uni",
      "name": "legacy_off_unit_norm_row_scores_via_cached_norm",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 563,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_refresh_if_sta",
      "name": "refresh_if_stale_repopulates_only_on_population_change",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 590,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_index_rs_parallel_scori",
      "name": "parallel_scoring_excludes_query_id",
      "file": "crates/engine/src/cosine/index.rs",
      "line": 630,
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
      "id": "crates_engine_src_cosine_math_rs_dot_slice_28",
      "name": "dot_slice",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 28,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_inv_norm_38",
      "name": "inv_norm",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 38,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_math_rs_cosine_similari",
      "name": "cosine_similarity_slice",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 51,
      "in": 3,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_math_rs_cosine_similari",
      "name": "cosine_similarity",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 78,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_identical_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 94,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_orthogonal_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 109,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_opposite_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 124,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_parallel_vectors_different_magnitude",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 139,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_45_degree_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 154,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_high_dimensional",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 170,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_high_dimensional_orthogonal",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 185,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_math_rs_test_cosine_sim",
      "name": "test_cosine_similarity_normalized_vectors",
      "file": "crates/engine/src/cosine/math.rs",
      "line": 205,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_reciprocal_rank_",
      "name": "reciprocal_rank_fusion",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 102,
      "in": 8,
      "out": 0
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_empty_lists_prod",
      "name": "empty_lists_produce_empty_output",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 158,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_top_n_zero_produ",
      "name": "top_n_zero_produces_empty_output",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 163,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_single_encoder_p",
      "name": "single_encoder_preserves_order",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 172,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_consensus_image_",
      "name": "consensus_image_outranks_one_encoder_winner",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 188,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_k_rrf_changes_lo",
      "name": "k_rrf_changes_lone_vs_consensus_score_ratio",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 216,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_cosine_rrf_rs_truncation_retur",
      "name": "truncation_returns_top_n",
      "file": "crates/engine/src/cosine/rrf.rs",
      "line": 280,
      "in": 0,
      "out": 1
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
      "id": "crates_engine_src_db_embeddings_rs_clip_needs_se",
      "name": "clip_needs_set_reads_per_encoder_table_not_legacy_column",
      "file": "crates/engine/src/db/embeddings.rs",
      "line": 649,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_aggregate_i",
      "name": "aggregate_image_rows",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 118,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_basename_of",
      "name": "basename_of",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 771,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_metadata_fo",
      "name": "metadata_for_ids_hydrates_and_bundles_thumbnail",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 949,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_metadata_fo",
      "name": "metadata_for_ids_empty_and_missing",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 981,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_generation_",
      "name": "generation_token_moves_on_population_change",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 999,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_databa",
      "name": "test_database_operations",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1038,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_empty_db",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1049,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_counts_each_stage_independently",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1061,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_pipeline_st",
      "name": "pipeline_stats_counts_orphaned_separately",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1096,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_preven",
      "name": "test_prevent_duplicate_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1111,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_test_empty_",
      "name": "test_empty_database",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1123,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_grid_query_",
      "name": "grid_query_excludes_disabled_root_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1135,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_grid_query_",
      "name": "grid_query_includes_null_root_id_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1158,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_setup_tagge",
      "name": "setup_tagged_images",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1172,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_or_filter_m",
      "name": "or_filter_matches_any_selected_tag",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1192,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_images_query_rs_and_filter_",
      "name": "and_filter_requires_all_selected_tags",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1208,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_images_query_rs_exclude_tag",
      "name": "exclude_tag_filter_removes_images_carrying_an_excluded_tag",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1236,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_get_tag_cou",
      "name": "get_tag_counts_matches_grid_visibility_predicate",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1274,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_manifest_me",
      "name": "manifest_membership_matches_legacy_query",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1317,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_manifest_in",
      "name": "manifest_includes_unthumbnailed_rows_and_carries_thumbnail_fields",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1384,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_details_by_",
      "name": "details_by_ids_hydrates_tags_and_respects_visibility",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1418,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_images_query_rs_details_by_",
      "name": "details_by_ids_chunks_batches_beyond_the_bind_limit",
      "file": "crates/engine/src/db/images_query.rs",
      "line": 1461,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_manual_layout_rs_set_manual",
      "name": "set_manual_order_rewrites_positions_for_listed_ids",
      "file": "crates/engine/src/db/manual_layout.rs",
      "line": 55,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_manual_layout_rs_set_manual",
      "name": "set_manual_col_span_persists_and_clears",
      "file": "crates/engine/src/db/manual_layout.rs",
      "line": 78,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_manual_layout_rs_untouched_",
      "name": "untouched_images_keep_null_manual_order_and_span",
      "file": "crates/engine/src/db/manual_layout.rs",
      "line": 97,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_mod_rs_initialize_is_idempo",
      "name": "initialize_is_idempotent",
      "file": "crates/engine/src/db/mod.rs",
      "line": 369,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_mod_rs_initialize_creates_r",
      "name": "initialize_creates_reverse_tag_index",
      "file": "crates/engine/src/db/mod.rs",
      "line": 382,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_dump_paths",
      "name": "dump_paths",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 205,
      "in": 2,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_add_images",
      "name": "add_images_batch_matches_per_row_inserts",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 223,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_add_images",
      "name": "add_images_batch_falls_back_per_row_on_batch_failure",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 263,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_marks_missing_paths",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 309,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_unmarks_returned_files",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 328,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_empty_alive_set_orphans_everything_in_root",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 349,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_does_not_affect_other_roots",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 360,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_mark_orpha",
      "name": "mark_orphaned_chunks_handle_large_libraries",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 377,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_roun",
      "name": "notes_round_trip",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 395,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_get_",
      "name": "notes_get_returns_none_when_unset",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 414,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_notes_orphans_rs_notes_pers",
      "name": "notes_persist_across_reads",
      "file": "crates/engine/src/db/notes_orphans.rs",
      "line": 422,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_add_root_creates_r",
      "name": "add_root_creates_row_with_enabled_true",
      "file": "crates/engine/src/db/roots.rs",
      "line": 190,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_add_root_rejects_d",
      "name": "add_root_rejects_duplicate_path",
      "file": "crates/engine/src/db/roots.rs",
      "line": 199,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_list_roots_orders_",
      "name": "list_roots_orders_by_added_at_ascending",
      "file": "crates/engine/src/db/roots.rs",
      "line": 211,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_remove_root_cascad",
      "name": "remove_root_cascades_to_images",
      "file": "crates/engine/src/db/roots.rs",
      "line": 224,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_remove_root_does_n",
      "name": "remove_root_does_not_affect_other_roots_images",
      "file": "crates/engine/src/db/roots.rs",
      "line": 241,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_set_root_enabled_r",
      "name": "set_root_enabled_round_trips",
      "file": "crates/engine/src/db/roots.rs",
      "line": 254,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_migrate_legacy_sca",
      "name": "migrate_legacy_scan_root_inserts_and_backfills",
      "file": "crates/engine/src/db/roots.rs",
      "line": 267,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_migrate_legacy_sca",
      "name": "migrate_legacy_scan_root_is_idempotent",
      "file": "crates/engine/src/db/roots.rs",
      "line": 303,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_get_root_id_by_pat",
      "name": "get_root_id_by_path_returns_some_when_known",
      "file": "crates/engine/src/db/roots.rs",
      "line": 316,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_get_root_id_by_pat",
      "name": "get_root_id_by_path_returns_none_when_unknown_or_null",
      "file": "crates/engine/src/db/roots.rs",
      "line": 324,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_db_roots_rs_wipe_images_for_ne",
      "name": "wipe_images_for_new_root_preserves_tags",
      "file": "crates/engine/src/db/roots.rs",
      "line": 334,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_strip_windows_extende",
      "name": "strip_windows_extended_prefix",
      "file": "crates/engine/src/paths.rs",
      "line": 48,
      "in": 0,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_app_data_dir_82",
      "name": "app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 82,
      "in": 10,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_database_path_107",
      "name": "database_path",
      "file": "crates/engine/src/paths.rs",
      "line": 107,
      "in": 4,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_113",
      "name": "thumbnails_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 113,
      "in": 4,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_for_ro",
      "name": "thumbnails_dir_for_root",
      "file": "crates/engine/src/paths.rs",
      "line": 134,
      "in": 3,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_set_bundled_resource_",
      "name": "set_bundled_resource_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 179,
      "in": 1,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_models_dir_204",
      "name": "models_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 204,
      "in": 9,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_model_path_for_244",
      "name": "model_path_for",
      "file": "crates/engine/src/paths.rs",
      "line": 244,
      "in": 7,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_settings_path_264",
      "name": "settings_path",
      "file": "crates/engine/src/paths.rs",
      "line": 264,
      "in": 2,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_cosine_cache_path_276",
      "name": "cosine_cache_path",
      "file": "crates/engine/src/paths.rs",
      "line": 276,
      "in": 1,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_exports_dir_287",
      "name": "exports_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 287,
      "in": 2,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_ensure_dir_293",
      "name": "ensure_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 293,
      "in": 5,
      "out": 0
    },
    {
      "id": "crates_engine_src_paths_rs_test_app_data_dir_liv",
      "name": "test_app_data_dir_lives_under_platform_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 305,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_model_path_for_falls_",
      "name": "model_path_for_falls_back_to_fp32_when_quantized_variant_missing",
      "file": "crates/engine/src/paths.rs",
      "line": 326,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_model_path_for_prefer",
      "name": "model_path_for_prefers_quantized_variant_when_present",
      "file": "crates/engine/src/paths.rs",
      "line": 339,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_test_paths_are_under_",
      "name": "test_paths_are_under_app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 359,
      "in": 0,
      "out": 5
    },
    {
      "id": "crates_engine_src_paths_rs_thumbnails_dir_for_ro",
      "name": "thumbnails_dir_for_root_creates_subfolder",
      "file": "crates/engine/src/paths.rs",
      "line": 368,
      "in": 0,
      "out": 1
    },
    {
      "id": "crates_engine_src_paths_rs_cosine_cache_path_is_",
      "name": "cosine_cache_path_is_under_app_data_dir",
      "file": "crates/engine/src/paths.rs",
      "line": 380,
      "in": 0,
      "out": 2
    },
    {
      "id": "crates_engine_src_paths_rs_test_filenames_are_st",
      "name": "test_filenames_are_stable",
      "file": "crates/engine/src/paths.rs",
      "line": 390,
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

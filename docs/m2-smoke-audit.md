# M2 end-to-end smoke audit

M2.6 was verified on **2026-11-02**, reusing the actual M1 recording, M2.2
conversion, M2.4 Muse response and M2.5 stored report. No new recording, upload,
inference or remote cleanup request was made for this audit. The existing response
is sufficient; repeating a paid request is not necessary to verify local storage.

This is a real Godot Movie Maker **calibration/smoke capture**, generated through
the GUI harness with visible beacon events. It is not a human bug/clean evaluation
session or autonomous AI gameplay. M4's six-session evaluation remains pending.

## Recorded evidence chain

Session: `aa2e6b72-7387-4a75-88f8-c8789f9051dd`.
Preparation: `274c9745-c863-483c-89c5-90470b7feff8`.

The retained local package is under
`artifacts/editor capture-mAGzwr/sessions/SESSION_UUID/`; it is deliberately ignored
by Git and **will not exist in a fresh checkout**. Keep the original package and
its stages together for offline verification. Do not substitute fixtures and call
them real inference if these local artifacts are unavailable.

| Stage | Retained files / observed result |
| --- | --- |
| Capture | `session.json`, `events.jsonl`, `recording.avi`, runtime/launch markers: complete, five events, six seconds, 960×540 at 30 fps |
| Timing | `synchronization-7e6459e9-405a-464d-97e2-e0a4088a78c4/`: original manifest backup and measured visible-event mapping; earlier M1 evidence, not remeasured today |
| Conversion/context | `preparations/PREPARATION_UUID/{started.json,preparation.json,context.json,clip.mp4}`: requested source start 723 ms, measured start 733.333333 ms, 3,200-ms clip, two original event IDs at clip times 233/2,233 ms; combined uncertainty 39 ms |
| Muse | `analysis/{started.json,upload-attempt.json,upload.json,request.json,inference-attempt.json,response.json,proposal.json,api-result.json}`: one actual Standard `muse-spark-1.3` response completed on 2026-10-30; schema-valid empty proposal |
| Cleanup/completion | `analysis/{cleanup.json,completed.json}`: upload deletion was confirmed in the original run; saved status checked, no new remote query |
| Offline report | `analysis/{findings.json,report-completed.json}`: schema/policy v1, `analyzed_no_findings`, zero accepted/quarantined candidates; source/stage consistency revalidated |

The selected upload was **19,473 video bytes + 1,738 context bytes**. Reported
usage remains 2,634 input + 1,043 output = **3,677 total tokens**, including 836
reasoning tokens in the output total. Dollar cost is unknown (`null`), not zero;
consult Meta billing. No extra tokens were requested during this audit.

Observed on 2026-11-02:

- Original AVI fully decoded without error: MJPEG, 180 video frames, 6.000 s,
  5,978,934 bytes. Prepared MP4 fully decoded without error: H.264/yuv420p,
  96 frames, 3.200 s. Both 960×540/30 fps.
- Production inspection returned complete, measured synchronization, no diagnostics.
  Production report loading rechecked source/preparation/request/response/report
  hashes and context, not merely JSON shape. All 12 saved analysis files retained
  identical hashes after the read-only audit.
- Report remains 4,283 bytes, SHA-256
  `b153c1e08e8cdf1242fa71c191c35007a3711dfc8c554178ad7a9716b6f35c41`.
- CLI inspection/report-read succeeded with the API key unset. A separate loader
  check with `fetch` replaced by a throwing function observed **zero network calls**.
- `nix develop -c just pipeline-test`: **38 passed**. `nix develop -c just check`:
  **111 passed**, gameplay smoke passed, zero type errors/warnings/hints, build passed.
  Just formatting and Git whitespace checks passed. Tests use mocked API failures,
  not fabricated empirical model performance or new live error calls.

## Owner M2 exit check — no spending required

From the repository root, for this existing local package:

```sh
nix develop
export POSTPLAY_SESSION_ROOT="$PWD/artifacts/editor capture-mAGzwr/sessions"
session_id=aa2e6b72-7387-4a75-88f8-c8789f9051dd
preparation_id=274c9745-c863-483c-89c5-90470b7feff8
MODEL_API_KEY= just session-inspect "$session_id"
MODEL_API_KEY= just session-report-read "$session_id" "$preparation_id"
just pipeline-test
```

These inspection/report commands are read-only and do not upload or require a key.
In the report inspect `status`, `analysis`, `provenance`, `timing`, `limitations`
and both `findings`/`quarantined`. Inspect `response.json` and `api-result.json`
under that preparation's `analysis/` for the saved actual response/usage.

To repeat the full video decode checks (no output file is written):

```sh
ffmpeg -v error -xerror -i "$POSTPLAY_SESSION_ROOT/$session_id/recording.avi" -map 0:v:0 -an -f null -
ffmpeg -v error -xerror -i "$POSTPLAY_SESSION_ROOT/$session_id/preparations/$preparation_id/clip.mp4" -map 0:v:0 -an -f null -
```

`pipeline-test` includes explicit assertions for valid empty reports, all-quarantined
`needs_review` outcomes, mocked failed API calls with saved `failure.json`, and
the absence of successful reports for those failures. Its named tests make that
distinction observable without deliberately making an invalid-key request to Meta.
Inspect [report states/policy](findings-reports.md) for details; **failed is not empty**.

For new recordings use the [capture](editor-capture.md),
[timing](synchronization.md), [preparation](session-preparation.md),
[explicit upload](session-analysis.md) and [report](findings-reports.md) guides.
Only explicit submission uploads or spends credits. This audit adds no automatic
workflow, inference retries, or scenario-specific detection rules.

The owner must explicitly approve the M2 exit gate after reviewing these results.
This smoke demonstrates the real file/API/report path, **not** bug-detection
quality, semantic truth, frame-perfect alignment, a browser dashboard, or a clean
game. M3 dashboard inspection and M4 empirical performance remain separate work.

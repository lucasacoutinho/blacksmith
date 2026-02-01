# Plan: Line View + Hot Path Overlay

## Goal
Add a blame-style line view in the editor that shows hot paths/costs directly on code, starting with function-level annotations and an optional hot-path overlay. Keep a clear path to true per-line/call-site heatmaps as a follow-up.

## Phase 1: Function-Line View + Hot Path Overlay (no parser changes)
1. [x] **Extension-side profile context**
   - Cache latest parsed profile data in the extension process.
   - Build indices: `file -> [functions]`, `line -> function`, `functionId -> stats`.
   - Track active metric index (default 0), optionally sync from webview.

2. [x] **Line View decorations**
   - Create `TextEditorDecorationType` instances:
     - Inline blame-like text (self/total cost, % total, calls).
     - Background heat color for the line.
     - Overview ruler marker for quick scanning.
   - Apply decorations to visible editors only when a profile is loaded.
   - Provide toggle command to enable/disable.

3. [x] **Hot Path overlay**
   - Compute a “hottest path” chain from call graph edges (greedy by total cost).
   - Add distinct decoration for hot-path functions (e.g., brighter background + label).
   - Optional: focus hot path from the selected function in the webview.

4. **Messaging + commands**
   - Add message type to sync selected metric and selected function (if desired).
   - Commands:
     - `Blacksmith: Toggle Line View`
     - `Blacksmith: Toggle Hot Path Overlay`
   - Update `package.json` contributions and quick docs.

5. **Docs**
   - Document the feature and shortcuts in `README.md`.

## Phase 2: True Per-Line / Call-Site Heatmaps (parser work)
1. Extend OCaml parser to emit per-line costs and call-site line numbers.
2. Update TS types and serialization to include line-level metrics.
3. Render per-line heatmap and call-site annotations in editor.
4. Optional: add inline mini sparklines or per-line call counts.

## Validation
- Manual test with a sample callgrind file:
  - Load profile, toggle line view, see annotations at function lines.
  - Toggle hot path overlay; verify only hot chain highlights.
  - Switch metric; verify values update.

# Tasks

## Handoff Plan: Refactor Webview Renderer and Add E2E UI Coverage

### Current Status
- Completed work has been moved to `Done.md`.
- No active high-priority implementation tasks remain for this handoff plan.

### Goal
- Dismantle the massive `src/webview/htmlRenderer.ts` file into maintainable webview UI modules.
- Replace fragile HTML string concatenation with a declarative frontend layer.
- Add real VS Code integration coverage that activates the extension, runs `aivisualizer.refresh`, and verifies webview message payloads.

### Recommendation
- Use Svelte for the webview UI.
- Keep the extension bundle on the existing esbuild pipeline.
- Add a separate Vite/Svelte build for webview assets only.
- Use `@vscode/test-electron` as the primary E2E/integration test harness.
- Defer Playwright unless DOM-level webview interaction or visual regression testing is needed later.

### Next Implementation Slice
- None. This handoff plan is complete.

### Acceptance Criteria
- `src/webview/htmlRenderer.ts` is reduced to a small webview HTML shell.
- Webview UI is implemented as Svelte components and supporting TypeScript modules.
- The extension still loads the activity-bar webview and window-mode panel.





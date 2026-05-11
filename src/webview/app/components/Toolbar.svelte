<script lang="ts">
	export let windowModeActive = false;
	export let onNew = () => {};
	export let onPopout = () => {};
	export let onSettings = () => {};
	export let onRefresh = () => {};
</script>

<div class="toolbar">
	<h2>Copilot AI Customization Visualizer</h2>
	<div class="toolbar-actions">
		<button class="icon-button" type="button" title="Create a new instruction agent prompt or skill" aria-label="Create a new instruction agent prompt or skill" onclick={onNew}>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"></path></svg>
		</button>
		<button class="window-mode-button" type="button" title={windowModeActive ? 'Close Window-mode and reactivate this view' : 'Open visualizer in a separate VS Code window'} role="switch" aria-checked={windowModeActive ? 'true' : 'false'} onclick={onPopout}>
			<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
			<span class="switch-label">{windowModeActive ? 'Exit Window-mode' : 'Window-mode'}</span>
		</button>
		<button class="icon-button" type="button" title="Visualizer settings" aria-label="Visualizer settings" onclick={onSettings}>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.7 7.7 0 0 0-1.69-.98L15 3h-4l-.36 2.93c-.6.24-1.16.56-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65 2 3.46 2.49-1c.53.41 1.09.74 1.69.98L11 21h4l.36-2.93c.6-.24 1.16-.56 1.69-.98l2.49 1 2-3.46zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"></path></svg>
		</button>
		<button class="icon-button" type="button" title="Refresh graph" aria-label="Refresh graph" onclick={onRefresh}>
			<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 5.08h-2.13A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h8V3z"></path></svg>
		</button>
	</div>
</div>
<script lang="ts">
	export let windowModeActive = false;
	export let onNew = () => {};
	export let onPopout = () => {};
	export let onAbout = () => {};
	export let onSettings = () => {};
	export let onRefresh = () => {};
</script>

<div class="toolbar">
	<h2>Copilot AI Customization Visualizer</h2>
	<div class="toolbar-actions">
		<button class="icon-button" type="button" title="Create a new instruction agent prompt or skill" aria-label="Create a new instruction agent prompt or skill" onclick={onNew}>+</button>
		<button class="window-mode-button" type="button" title={windowModeActive ? 'Close Window-mode and reactivate this view' : 'Open visualizer in a separate VS Code window'} role="switch" aria-checked={windowModeActive ? 'true' : 'false'} onclick={onPopout}>
			<span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
			<span class="switch-label">{windowModeActive ? 'Exit Window-mode' : 'Window-mode'}</span>
		</button>
		<button class="icon-button" type="button" title="About Copilot AI Customization Visualizer" aria-label="About Copilot AI Customization Visualizer" onclick={onAbout}>?</button>
		<button class="icon-button" type="button" title="Visualizer settings" aria-label="Visualizer settings" onclick={onSettings}>S</button>
		<button class="icon-button" type="button" title="Refresh graph" aria-label="Refresh graph" onclick={onRefresh}>R</button>
	</div>
</div>
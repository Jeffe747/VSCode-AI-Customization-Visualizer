<script lang="ts">
	import type { AvailableModel } from '../../../mapper';
	import type { VisualizerColorDefinition, VisualizerSettings } from '../../settings';
	import type { WebviewBootstrapData } from '../protocol';

	export let open = false;
	export let initialData: WebviewBootstrapData;
	export let settings: VisualizerSettings;
	export let availableModels: AvailableModel[] = [];
	export let onClose = () => {};
	export let onUpdate: (settings: VisualizerSettings) => void = () => {};

	$: title = initialData.isWindowModeView ? 'Window-mode Extension Settings' : 'Extension Settings';
	$: colorDefinitions = initialData.colorDefinitions as VisualizerColorDefinition[];
	$: mediumPercent = Math.round(settings.heatmapMediumThreshold * 100);
	$: highPercent = Math.round(settings.heatmapHighThreshold * 100);

	function updateSettings(next: Partial<VisualizerSettings>): void {
		onUpdate({ ...settings, ...next });
	}

	function updateColor(key: string, color: string): void {
		updateSettings({ colors: { ...settings.colors, [key]: color } });
	}

	function updateMediumThreshold(value: string): void {
		const nextValue = normalizePercent(value, 1, Math.max(1, highPercent - 1), mediumPercent) / 100;

		updateSettings({ heatmapMediumThreshold: nextValue });
	}

	function updateHighThreshold(value: string): void {
		const nextValue = normalizePercent(value, Math.min(99, mediumPercent + 1), 99, highPercent) / 100;

		updateSettings({ heatmapHighThreshold: nextValue });
	}

	function normalizePercent(value: string, min: number, max: number, fallback: number): number {
		const numberValue = Number(value);
		const candidate = Number.isFinite(numberValue) ? numberValue : fallback;

		return Math.min(max, Math.max(min, candidate));
	}
</script>

{#if open}
	<div class="dialog-backdrop" role="presentation">
		<form class="dialog settings-dialog" aria-label="Visualizer settings" onsubmit={event => event.preventDefault()}>
			<header class="dialog-header">
				<h3>{title}</h3>
				<button class="icon-button dialog-close-button" type="button" title="Close" aria-label="Close settings" onclick={onClose}>
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"></path></svg>
				</button>
			</header>
			<section class="settings-section" aria-label="Layout settings">
				<h4>Workspace</h4>
				<div class="settings-toggle-grid">
					<label class="settings-toggle"><input type="checkbox" checked={settings.sideBySideLayout} onchange={event => updateSettings({ sideBySideLayout: event.currentTarget.checked })}><span>Side-by-side layout</span></label>
					<label class="settings-toggle"><input type="checkbox" checked={settings.documentationLinksHidden} onchange={event => updateSettings({ documentationLinksHidden: event.currentTarget.checked })}><span>Hide documentation links</span></label>
					<label class="settings-toggle"><input type="checkbox" checked={settings.orphanToggleVisible} onchange={event => updateSettings({ orphanToggleVisible: event.currentTarget.checked })}><span>Show orphan toggle</span></label>
					<label class="settings-toggle"><input type="checkbox" checked={settings.debugMessagesEnabled} onchange={event => updateSettings({ debugMessagesEnabled: event.currentTarget.checked })}><span>Debug messages</span></label>
				</div>
				<div class="settings-slider-grid">
					<label class="size-control"><span>Element size</span><input type="range" min="0.85" max="2" step="0.05" value={settings.nodeScale} oninput={event => updateSettings({ nodeScale: Number(event.currentTarget.value) })}><span class="size-value">{Math.round(settings.nodeScale * 100)}%</span></label>
					<label class="size-control"><span>Editor text</span><input type="range" min="0.75" max="1.6" step="0.05" value={settings.textScale} oninput={event => updateSettings({ textScale: Number(event.currentTarget.value) })}><span class="size-value">{Math.round(settings.textScale * 100)}%</span></label>
				</div>
			</section>
			<section class="settings-section" aria-label="Token heatmap settings">
				<h4>Token heatmap</h4>
				<div class="settings-control-grid">
					<label class="settings-toggle"><input type="checkbox" checked={settings.heatmapToggleVisible} onchange={event => updateSettings({ heatmapToggleVisible: event.currentTarget.checked })}><span>Show visualizer toggle</span></label>
					<label class="heatmap-model-control"><span>Default baseline model</span><select value={settings.heatmapBaselineModel || ''} onchange={event => updateSettings({ heatmapBaselineModel: event.currentTarget.value || undefined })}><option value="">Use graph-relative fallback</option>{#each availableModels as model}<option value={model.value}>{model.label || model.value}</option>{/each}</select></label>
				</div>
				<div class="threshold-grid">
					<label class="threshold-control"><span><strong>Orange threshold</strong><small>Percent of baseline context</small></span><span class="threshold-input-wrap"><input type="number" min="1" max="98" step="1" value={mediumPercent} inputmode="numeric" oninput={event => updateMediumThreshold(event.currentTarget.value)}><span class="threshold-unit" aria-hidden="true">%</span></span></label>
					<label class="threshold-control"><span><strong>Red threshold</strong><small>Percent of baseline context</small></span><span class="threshold-input-wrap"><input type="number" min="2" max="99" step="1" value={highPercent} inputmode="numeric" oninput={event => updateHighThreshold(event.currentTarget.value)}><span class="threshold-unit" aria-hidden="true">%</span></span></label>
				</div>
			</section>
			<section class="settings-section" aria-label="Visualizer colors">
				<h4>Colors</h4>
				<label class="settings-toggle color-toggle"><input type="checkbox" checked={settings.textShadowEnabled} onchange={event => updateSettings({ textShadowEnabled: event.currentTarget.checked })}><span>Text shadow</span></label>
				<div class="color-grid">
					{#each colorDefinitions as colorDefinition}
						<label class="color-control" title={colorDefinition.description}>
							<span><strong>{colorDefinition.label}</strong><small>{colorDefinition.description}</small></span>
							<input type="color" value={settings.colors[colorDefinition.key] || initialData.colorPickerFallbackColors[colorDefinition.key] || '#888888'} oninput={event => updateColor(colorDefinition.key, event.currentTarget.value)}>
						</label>
					{/each}
				</div>
			</section>
		</form>
	</div>
{/if}
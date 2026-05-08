<script lang="ts">
	import type { AvailableTool } from '../../../mapper';

	export interface ToolPreset {
		label: string;
		tools: string[];
	}

	export let tools: AvailableTool[] = [];
	export let selected: string[] = [];
	export let presets: ToolPreset[] = [];
	export let onChange: (tools: string[]) => void = () => {};

	let filterValue = '';
	let customToolName = '';

	$: selectedSet = new Set(normalizeTools(selected));
	$: toolDescriptions = new Map(tools.map(tool => [tool.name, tool.description || tool.name]));
	$: toolNames = normalizeTools([...tools.map(tool => tool.name), ...selected]);
	$: visibleToolNames = toolNames.filter(toolName => isToolVisible(toolName, filterValue));
	$: activeTools = normalizeTools(selected);

	function toggleTool(toolName: string, checked: boolean): void {
		const next = new Set(activeTools);

		if (checked) {
			next.add(toolName);
		} else {
			next.delete(toolName);
		}

		onChange(sortTools([...next]));
	}

	function applyPreset(preset: ToolPreset): void {
		onChange(sortTools(normalizeTools(preset.tools)));
	}

	function addCustomTool(): void {
		const name = customToolName.trim();

		if (!name) {
			return;
		}

		customToolName = '';
		onChange(sortTools(normalizeTools([...activeTools, name])));
	}

	function normalizeTools(values: string[]): string[] {
		return sortTools([...new Set(values.map(value => value.trim()).filter(Boolean))]);
	}

	function sortTools(values: string[]): string[] {
		return values.sort((left, right) => left.localeCompare(right));
	}

	function isToolVisible(toolName: string, filter: string): boolean {
		const normalizedFilter = filter.trim().toLowerCase();

		return !normalizedFilter || toolName.toLowerCase().includes(normalizedFilter);
	}

	function getDescription(toolName: string): string {
		return toolDescriptions.get(toolName) || 'Custom tool. Uncheck it to remove it when saving.';
	}
</script>

<div class="choice-section tool-editor">
	<div class="tool-preset-section">
		<div class="tool-preset-title">Tool presets</div>
		<div class="tool-preset-list" aria-label="Prebuilt tool selections">
			{#each presets as preset}
				<button class="tool-preset-button" type="button" title={preset.tools.join(', ')} onclick={() => applyPreset(preset)}>{preset.label}</button>
			{/each}
		</div>
	</div>
	<details class="choice-details">
		<summary><span class="label-text">Tools<span class="help-marker" title="Tool or tool set names available to this agent or prompt. Unavailable tools are ignored; prompt tools take priority over agent tools." aria-label="Tool or tool set names available to this agent or prompt. Unavailable tools are ignored; prompt tools take priority over agent tools.">?</span></span><span class={'selected-tools active-tools ' + (activeTools.length ? '' : 'empty-tools')} aria-label="Active tools">{#if activeTools.length}{#each activeTools as toolName}<span class="tool-pill" title={toolName}>{toolName}</span>{/each}{:else}<span class="tool-pill empty-tool-pill">No active tools</span>{/if}</span></summary>
		<div class="tool-filter"><input type="text" bind:value={filterValue} placeholder="Filter tools"></div>
		{#if activeTools.length}
			<div class="selected-tools active-tools" aria-label="Active tools">
				{#each activeTools as toolName}<span class="tool-pill" title={toolName}>{toolName}</span>{/each}
			</div>
		{/if}
		{#if toolNames.length}
			<div class="choice-list tool-choice-list">
				{#each visibleToolNames as toolName}
					<label class="choice-check" title={toolName}>
						<input class="edit-tool" type="checkbox" checked={selectedSet.has(toolName)} onchange={event => toggleTool(toolName, event.currentTarget.checked)}>
						<span class="choice-name">{toolName}</span>
						<span class="help-marker" title={getDescription(toolName)} aria-label={getDescription(toolName)}>?</span>
					</label>
				{/each}
			</div>
		{:else}
			<p class="choice-empty">No available tools found.</p>
		{/if}
		<div class="custom-tool-row">
			<input type="text" bind:value={customToolName} placeholder="Custom tool name" onkeydown={event => {
				if (event.key === 'Enter') {
					event.preventDefault();
					addCustomTool();
				}
			}}>
			<button type="button" onclick={addCustomTool}>Add</button>
		</div>
	</details>
</div>

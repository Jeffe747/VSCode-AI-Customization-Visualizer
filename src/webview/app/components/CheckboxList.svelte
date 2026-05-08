<script lang="ts">
	export interface CheckboxOption {
		name: string;
		description?: string;
	}

	export let label = '';
	export let options: CheckboxOption[] = [];
	export let selected: string[] = [];
	export let emptyText = 'No options found.';
	export let onToggle: (name: string, checked: boolean) => void = () => {};

	$: selectedSet = new Set(selected);
</script>

<div class="choice-section">
	{#if options.length}
		<details class="choice-details" open>
			<summary><span class="label-text">{label}</span></summary>
			<div class="choice-list compact-choice-list">
			{#each options as option}
				<label class="choice-check" title={option.description || option.name}>
					<input type="checkbox" checked={selectedSet.has(option.name)} onchange={event => onToggle(option.name, event.currentTarget.checked)}>
					<span class="choice-name">{option.name}</span>
				</label>
			{/each}
			</div>
		</details>
	{:else}
		<div class="field-label">{label}</div>
		<p class="choice-empty">{emptyText}</p>
	{/if}
</div>
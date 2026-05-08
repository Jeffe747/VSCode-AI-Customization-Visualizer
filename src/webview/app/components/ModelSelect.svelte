<script lang="ts">
	import type { AvailableModel } from '../../../mapper';

	export let value = '';
	export let models: AvailableModel[] = [];
	export let label = 'AI model';

	$: options = getModelOptions(value, models);

	function getModelOptions(selectedValue: string, availableModels: AvailableModel[]): AvailableModel[] {
		const seen = new Set<string>();
		const options: AvailableModel[] = [];

		if (selectedValue) {
			seen.add(selectedValue);
			options.push({ value: selectedValue, label: selectedValue });
		}

		for (const model of availableModels) {
			if (model.value && !seen.has(model.value)) {
				seen.add(model.value);
				options.push(model);
			}
		}

		return options;
	}
</script>

<label>
	<span class="label-text">{label}</span>
	<select bind:value>
		<option value=""></option>
		{#each options as model}
			<option value={model.value}>{model.label || model.value}</option>
		{/each}
	</select>
</label>
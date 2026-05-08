<script lang="ts">
	export let hidden = false;
	export let onOpenDocs: (url: string) => void = () => {};
</script>

{#if !hidden}
	<div class="docs-info" aria-label="VS Code Copilot customization documentation">
		<button class="docs-link" type="button" onclick={() => onOpenDocs('https://code.visualstudio.com/docs/copilot/customization/custom-instructions')}>Custom instructions documentation</button>
		<button class="docs-link" type="button" onclick={() => onOpenDocs('https://code.visualstudio.com/docs/copilot/customization/custom-agents')}>Custom agents documentation</button>
		<button class="docs-link" type="button" onclick={() => onOpenDocs('https://code.visualstudio.com/docs/copilot/customization/prompt-files')}>Prompt files documentation</button>
		<button class="docs-link" type="button" onclick={() => onOpenDocs('https://code.visualstudio.com/docs/copilot/customization/agent-skills')}>Agent skills documentation</button>
		<button class="docs-link" type="button" onclick={() => onOpenDocs('https://code.visualstudio.com/docs/copilot/customization/hooks')}>Hooks documentation</button>
	</div>
{/if}
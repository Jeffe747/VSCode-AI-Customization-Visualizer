<script lang="ts">
	import { tick } from 'svelte';
	import type { WebviewToExtensionMessage } from '../protocol';

	export let open = false;
	export let onClose = () => {};
	export let onCreate: (message: WebviewToExtensionMessage) => void = () => {};

	let kind = 'instruction';
	let instructionType = 'scoped';
	let name = '';
	let validationMessage = '';
	let wasOpen = false;
	let nameInput: HTMLInputElement | undefined;

	$: if (open && !wasOpen) {
		wasOpen = true;
		validationMessage = '';
		void focusDialogInput();
	} else if (!open && wasOpen) {
		wasOpen = false;
	}

	$: if (kind === 'mcp') {
		validationMessage = '';
	}

	function submitCreate(event: SubmitEvent): void {
		event.preventDefault();

		if (kind === 'mcp') {
			onCreate({ type: 'customization:create', kind });
			onClose();
			return;
		}

		const displayName = name.trim();

		if (!displayName) {
			validationMessage = 'Enter a name.';
			void focusDialogInput();
			return;
		}

		onCreate({ type: 'customization:create', kind, instructionType, name: displayName });
		name = '';
		validationMessage = '';
		onClose();
	}

	async function focusDialogInput(): Promise<void> {
		await tick();
		nameInput?.focus();
	}
</script>

{#if open}
	<div class="dialog-backdrop" role="presentation">
		<form class="dialog" aria-label="New customization" onsubmit={submitCreate}>
			<h3>New customization</h3>
			<label>Type<select bind:value={kind}><option value="instruction">Instruction</option><option value="skill">Skill</option><option value="prompt">Prompt</option><option value="agent">Agent</option><option value="hook">Hook</option><option value="mcp">MCP server</option></select></label>
			{#if kind === 'instruction'}
				<label>Instruction type<select bind:value={instructionType}><option value="scoped">Scoped instructions</option><option value="copilot">Copilot project instructions</option><option value="agents">All AI instructions</option><option value="claude">Claude instructions</option></select></label>
			{/if}
			{#if kind === 'mcp'}
				<div class="choice-empty">MCP servers are managed in VS Code's Extensions view.</div>
			{:else}
				<label>Name<input bind:this={nameInput} bind:value={name} type="text" placeholder="my-customization" autocomplete="off" aria-invalid={validationMessage ? 'true' : 'false'}></label>
				{#if validationMessage}<p class="form-error" role="alert">{validationMessage}</p>{/if}
			{/if}
			<div class="dialog-actions">
				<button type="button" onclick={onClose}>Cancel</button>
				<button type="submit">Create</button>
			</div>
		</form>
	</div>
{/if}
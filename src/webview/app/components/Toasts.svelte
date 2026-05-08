<script lang="ts">
	export let errorMessage = '';
	export let debugMessage = '';
	export let onDismissError = () => {};
	export let onDismissDebug = () => {};
</script>

{#if errorMessage}
	<div class="toast" role="alert" aria-live="assertive"><div>{errorMessage}</div><button type="button" title="Dismiss error" aria-label="Dismiss error" onclick={onDismissError}>x</button></div>
{/if}

{#if debugMessage}
	<div class="toast debug-toast" role="status" aria-live="polite"><div><span class="debug-title">Debug</span><div>{debugMessage}</div></div><button type="button" title="Dismiss debug message" aria-label="Dismiss debug message" onclick={onDismissDebug}>x</button></div>
{/if}
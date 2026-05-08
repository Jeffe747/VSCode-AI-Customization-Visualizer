<script lang="ts">
	export let open = false;
	export let onClose = () => {};
</script>

{#if open}
	<div class="dialog-backdrop" role="presentation">
		<form class="dialog" aria-label="About Copilot AI Customization Visualizer">
			<h3>About</h3>
			<div class="about-info">
				<span><strong>Engineer:</strong> Jeffe747@github</span>
				<span><strong>Agent:</strong> ChatGpt.5.5</span>
			</div>
			<div class="dialog-actions">
				<button type="button" onclick={onClose}>Close</button>
			</div>
		</form>
	</div>
{/if}
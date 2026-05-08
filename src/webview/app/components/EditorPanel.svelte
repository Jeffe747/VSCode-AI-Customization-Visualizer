<script lang="ts">
	import type { AvailableModel, AvailableTool, GraphNode, HookEventName } from '../../../mapper';
	import CheckboxList, { type CheckboxOption } from './CheckboxList.svelte';
	import ModelSelect from './ModelSelect.svelte';
	import ToolsEditor, { type ToolPreset } from './ToolsEditor.svelte';
	import type { WebviewToExtensionMessage } from '../protocol';
	import { createAgentEditorState, createAgentSaveMessage, createEmptyHookCommandEditorState, createHandoffEditorState, createHandoffSaveMessage, createHookEditorState, createHookSaveMessage, createInstructionEditorState, createInstructionSaveMessage, createPromptEditorState, createPromptSaveMessage, createSkillEditorState, createSkillSaveMessage, hookCommandPropertyDefinitions, hookEventOptions, type AgentEditorState, type HandoffEditorState, type HookCommandPropertyName, type HookEditorState, type InstructionEditorState, type PromptEditorState, type SkillEditorState } from '../editor/savePayload';

	export let node: GraphNode | undefined = undefined;
	export let agentOptions: string[] = [];
	export let availableTools: AvailableTool[] = [];
	export let availableModels: AvailableModel[] = [];
	export let toolPresets: ToolPreset[] = [];
	export let onOpenNode: (uri: string) => void = () => {};
	export let onOpenMcp: () => void = () => {};
	export let onSaveNode: (message: WebviewToExtensionMessage) => void = () => {};

	let loadedNodeId: string | undefined;
	let instructionState: InstructionEditorState = { name: '', description: '', applyTo: '', body: '' };
	let promptState: PromptEditorState = { name: '', agent: '', model: '', tools: [], body: '' };
	let agentState: AgentEditorState = { name: '', description: '', argumentHint: '', model: '', agents: [], tools: [], userInvocable: true, disableModelInvocation: false, body: '' };
	let skillState: SkillEditorState = { name: '', description: '', argumentHint: '', skillContext: '', userInvocable: true, disableModelInvocation: false, body: '' };
	let handoffState: HandoffEditorState = { name: '', agent: '', prompt: '', send: false, model: '' };
	let hookState: HookEditorState = { name: '', commands: [] };
	let validationMessage = '';
	let activeForm: HTMLFormElement | undefined;
	let handoffLabelInput: HTMLInputElement | undefined;
	let handoffAgentSelect: HTMLSelectElement | undefined;
	let handoffPromptInput: HTMLTextAreaElement | undefined;

	$: details = node ? getNodeDetails(node) : [];
	$: isEditable = Boolean(node?.uri && (node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill' || node.type === 'hook' || node.type === 'handoff'));
	$: hasAgentForm = Boolean(node?.type === 'agent' && node.uri);
	$: hasInstructionForm = Boolean(node?.type === 'instruction' && node.uri);
	$: hasPromptForm = Boolean(node?.type === 'prompt' && node.uri);
	$: hasSkillForm = Boolean(node?.type === 'skill' && node.uri);
	$: hasHandoffForm = Boolean(node?.type === 'handoff' && node.uri);
	$: hasHookForm = Boolean(node?.type === 'hook' && node.uri);
	$: promptAgentOptions = getPromptAgentOptions(promptState.agent, agentOptions);
	$: handoffAgentOptions = getHandoffAgentOptions(handoffState.agent, agentOptions);
	$: agentReferenceOptions = getAgentReferenceOptions(agentState.agents, agentOptions, node?.label);
	$: toolOptions = getToolOptions(agentState.tools, availableTools);
	$: if (node?.id !== loadedNodeId) {
		loadedNodeId = node?.id;
		validationMessage = '';
		agentState = node?.type === 'agent' ? createAgentEditorState(node) : { name: '', description: '', argumentHint: '', model: '', agents: [], tools: [], userInvocable: true, disableModelInvocation: false, body: '' };
		instructionState = node?.type === 'instruction' ? createInstructionEditorState(node) : { name: '', description: '', applyTo: '', body: '' };
		promptState = node?.type === 'prompt' ? createPromptEditorState(node) : { name: '', agent: '', model: '', tools: [], body: '' };
		skillState = node?.type === 'skill' ? createSkillEditorState(node) : { name: '', description: '', argumentHint: '', skillContext: '', userInvocable: true, disableModelInvocation: false, body: '' };
		handoffState = node?.type === 'handoff' ? createHandoffEditorState(node) : { name: '', agent: '', prompt: '', send: false, model: '' };
		hookState = node?.type === 'hook' ? createHookEditorState(node) : { name: '', commands: [] };
	}

	function getNodeDetails(node: GraphNode): string[] {
		return [
			'Type: ' + node.type,
			node.path ? 'Path: ' + node.path : '',
			node.model ? 'Model: ' + node.model : '',
			node.agent ? 'Agent: ' + node.agent : '',
			node.description ? 'Description: ' + node.description : '',
			node.unresolved ? 'Unresolved reference' : '',
			node.handoffAgent ? 'Target: ' + node.handoffAgent : '',
			node.mcpSource ? 'Source: ' + node.mcpSource : '',
		].filter(Boolean);
	}

	function saveInstruction(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const message = createInstructionSaveMessage(node, instructionState);

		if (message) {
			onSaveNode(message);
		}
	}

	function submitActiveForm(): void {
		activeForm?.requestSubmit();
	}

	function saveAgent(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const message = createAgentSaveMessage(node, agentState);

		if (message) {
			onSaveNode(message);
		}
	}

	function savePrompt(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const message = createPromptSaveMessage(node, promptState);

		if (message) {
			onSaveNode(message);
		}
	}

	function saveSkill(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const message = createSkillSaveMessage(node, skillState);

		if (message) {
			onSaveNode(message);
		}
	}

	function saveHandoff(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const validation = validateHandoff();

		if (!validation.ok) {
			validationMessage = validation.message;
			validation.element?.focus();
			return;
		}

		const message = createHandoffSaveMessage(node, handoffState);

		if (message) {
			validationMessage = '';
			onSaveNode(message);
		}
	}

	function validateHandoff(): { ok: true } | { ok: false; message: string; element?: HTMLElement } {
		if (!handoffState.name.trim()) {
			return { ok: false, message: 'Enter a handoff label.', element: handoffLabelInput };
		}

		if (!handoffState.agent) {
			return { ok: false, message: 'Choose a target agent.', element: handoffAgentSelect };
		}

		if (!handoffState.prompt.trim()) {
			return { ok: false, message: 'Enter a handoff prompt.', element: handoffPromptInput };
		}

		return { ok: true };
	}

	function saveHook(event: SubmitEvent): void {
		event.preventDefault();

		if (!node) {
			return;
		}

		const message = createHookSaveMessage(node, hookState);

		if (message) {
			onSaveNode(message);
		}
	}

	function getPromptAgentOptions(selectedAgent: string, agents: string[]): string[] {
		return [...new Set([selectedAgent, ...agents].filter(Boolean))].sort((left, right) => left.localeCompare(right));
	}

	function getHandoffAgentOptions(selectedAgent: string, agents: string[]): string[] {
		return [...new Set([selectedAgent, 'agent', 'ask', 'edit', 'plan', ...agents].filter(Boolean))].sort((left, right) => left.localeCompare(right));
	}

	function getAgentReferenceOptions(selectedAgents: string[], agents: string[], currentAgent: string | undefined): CheckboxOption[] {
		return [...new Set([...selectedAgents, ...agents.filter(agent => agent !== currentAgent)].filter(Boolean))]
			.sort((left, right) => left.localeCompare(right))
			.map(name => ({ name }));
	}

	function getToolOptions(selectedTools: string[], tools: AvailableTool[]): CheckboxOption[] {
		const descriptions = new Map(tools.map(tool => [tool.name, tool.description]));

		return [...new Set([...selectedTools, ...tools.map(tool => tool.name)].filter(Boolean))]
			.sort((left, right) => left.localeCompare(right))
			.map(name => ({ name, description: descriptions.get(name) || name }));
	}

	function toggleAgentReference(name: string, checked: boolean): void {
		agentState.agents = toggleValue(agentState.agents, name, checked);
	}

	function toggleTool(name: string, checked: boolean): void {
		agentState.tools = toggleValue(agentState.tools, name, checked);
	}

	function updateAgentTools(tools: string[]): void {
		agentState.tools = tools;
	}

	function updatePromptTools(tools: string[]): void {
		promptState.tools = tools;
	}

	function toggleValue(values: string[], value: string, checked: boolean): string[] {
		const next = new Set(values);

		if (checked) {
			next.add(value);
		} else {
			next.delete(value);
		}

		return [...next].sort((left, right) => left.localeCompare(right));
	}

	function addHookCommand(): void {
		hookState.commands = [...hookState.commands, createEmptyHookCommandEditorState('new:' + Date.now())];
	}

	function updateHookCommandEvent(index: number, event: HookEventName): void {
		hookState.commands = hookState.commands.map((command, commandIndex) => commandIndex === index ? { ...command, event } : command);
	}

	function updateHookCommandProperty(index: number, property: HookCommandPropertyName, value: string): void {
		hookState.commands = hookState.commands.map((command, commandIndex) => commandIndex === index ? { ...command, properties: { ...command.properties, [property]: value } } : command);
	}

	function toggleHookCommandProperty(index: number, property: HookCommandPropertyName, checked: boolean): void {
		if (!checked) {
			updateHookCommandProperty(index, property, '');
		}
	}

	const fieldHelp = {
		agentName: 'Custom agent name. If not specified, VS Code uses the file name.',
		promptName: 'Prompt name used after typing / in chat. If not specified, VS Code uses the file name.',
		instructionName: 'Display name shown in the UI. If omitted, VS Code uses the file name.',
		instructionDescription: 'Short description shown on hover in the Chat view.',
		instructionApplyTo: 'Glob pattern for files these instructions apply to automatically, relative to the workspace root. Use ** for all files. If omitted, they are only added manually.',
		skillName: 'Skill identifier. It must use lowercase letters, numbers, and hyphens, and match the parent directory.',
		hookName: 'Display name stored in this hook configuration file.',
		agentDescription: 'Brief description of the custom agent, shown as placeholder text in the chat input field.',
		skillDescription: 'Required summary of what the skill does and when Copilot should use it.',
		agentArgumentHint: 'Optional hint text shown in the chat input field to guide users on how to interact with the custom agent.',
		skillArgumentHint: 'Optional hint shown in chat when invoking the skill as a slash command.',
		agentDisableModelInvocation: 'Optional flag to prevent this agent from being invoked as a subagent by other agents.',
		skillDisableModelInvocation: 'Require manual slash-command invocation instead of automatic model selection.',
		handoffLabel: 'Button text shown for this handoff after a chat response completes.',
		handoffAgent: 'Custom agent that receives this handoff.',
		handoffPrompt: 'Prompt sent or prefilled for this handoff.',
		handoffSend: 'Automatically submit the handoff prompt instead of only pre-filling it.',
		handoffModel: 'AI model used for this handoff. If omitted, VS Code uses the current model.',
		skillContext: 'Use fork for large skills that should run in a dedicated subagent context.',
		agentModel: 'AI model to use for this custom agent. If omitted, VS Code uses the currently selected model; arrays can define fallback order.',
		promptModel: 'Language model used when running this prompt. If omitted, VS Code uses the currently selected model.',
		userInvocable: 'Controls whether this custom agent or skill appears in the chat menu.',
		agentAgents: 'Subagents available to this custom agent. Use * for all agents, or an empty list to prevent subagent use.',
		agentBody: 'Markdown instructions prepended when this custom agent runs. Use this for persona, behavior, constraints, and workflow guidance.',
		promptAgent: 'Agent used for running this prompt: ask, agent, plan, model, or a custom agent name.',
		promptBody: 'Markdown prompt text containing the task-specific instructions, context, guidelines, variables, and file references.',
		instructionBody: 'Markdown instructions that define guidelines and rules for the affected AI tools.',
		skillBody: 'Markdown instructions, workflow steps, examples, and links to resources in the skill directory.',
	};
</script>

{#if node}
	<section class="editor" aria-live="polite">
		<div class="editor-header">
			<div class="editor-title">
				<h3>{node.label}</h3>
				<p>{node.path || node.id}</p>
			</div>
			<div class="editor-actions">
				{#if node.uri}<button type="button" onclick={() => node?.uri && onOpenNode(node.uri)}>Open file</button>{/if}
				{#if node.type === 'mcp'}<button type="button" onclick={onOpenMcp}>Open MCP servers</button>{/if}
				{#if isEditable}<button type="button" onclick={submitActiveForm}>Save</button>{/if}
			</div>
		</div>
		<div class="editor-body">
			{#if hasAgentForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={saveAgent}>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={agentState.userInvocable}>
						<span class="label-text">User invocable<span class="help-marker" title={fieldHelp.userInvocable} aria-label={fieldHelp.userInvocable}>?</span></span>
					</label>
					<div class="field-row">
						<label>
							<span class="label-text">Name<span class="help-marker" title={fieldHelp.agentName} aria-label={fieldHelp.agentName}>?</span></span>
							<input type="text" bind:value={agentState.name} autocomplete="off">
						</label>
						<ModelSelect bind:value={agentState.model} models={availableModels} />
					</div>
					<label>
						<span class="label-text">Description<span class="help-marker" title={fieldHelp.agentDescription} aria-label={fieldHelp.agentDescription}>?</span></span>
						<textarea class="compact-field" bind:value={agentState.description}></textarea>
					</label>
					<label>
						<span class="label-text">Argument hint<span class="help-marker" title={fieldHelp.agentArgumentHint} aria-label={fieldHelp.agentArgumentHint}>?</span></span>
						<input type="text" bind:value={agentState.argumentHint}>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={agentState.disableModelInvocation}>
						<span class="label-text">Disable Model Invocation<span class="help-marker" title={fieldHelp.agentDisableModelInvocation} aria-label={fieldHelp.agentDisableModelInvocation}>?</span></span>
					</label>
					<CheckboxList label="Agents" options={agentReferenceOptions} selected={agentState.agents} emptyText="No available agents found." onToggle={toggleAgentReference} />
					<ToolsEditor tools={availableTools} selected={agentState.tools} presets={toolPresets} onChange={updateAgentTools} />
					<label>
						<span class="label-text">System Prompt<span class="help-marker" title={fieldHelp.agentBody} aria-label={fieldHelp.agentBody}>?</span></span>
						<textarea class="body-field" bind:value={agentState.body}></textarea>
					</label>
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if hasHandoffForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={saveHandoff}>
					<label>
						<span class="label-text">Label<span class="help-marker" title={fieldHelp.handoffLabel} aria-label={fieldHelp.handoffLabel}>?</span></span>
						<input bind:this={handoffLabelInput} type="text" bind:value={handoffState.name} autocomplete="off" aria-invalid={validationMessage ? 'true' : 'false'}>
					</label>
					<label>
						<span class="label-text">Agent<span class="help-marker" title={fieldHelp.handoffAgent} aria-label={fieldHelp.handoffAgent}>?</span></span>
						<select bind:this={handoffAgentSelect} bind:value={handoffState.agent} aria-invalid={validationMessage ? 'true' : 'false'}>
							<option value=""></option>
							{#each handoffAgentOptions as agent}
								<option value={agent}>{agent}</option>
							{/each}
						</select>
					</label>
					<label>
						<span class="label-text">Prompt<span class="help-marker" title={fieldHelp.handoffPrompt} aria-label={fieldHelp.handoffPrompt}>?</span></span>
						<textarea bind:this={handoffPromptInput} class="compact-field" bind:value={handoffState.prompt} aria-invalid={validationMessage ? 'true' : 'false'}></textarea>
					</label>
					{#if validationMessage}<p class="form-error" role="alert">{validationMessage}</p>{/if}
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={handoffState.send}>
						<span class="label-text">Send<span class="help-marker" title={fieldHelp.handoffSend} aria-label={fieldHelp.handoffSend}>?</span></span>
					</label>
					<ModelSelect bind:value={handoffState.model} models={availableModels} />
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if hasHookForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={saveHook}>
					<label>
						<span class="label-text">Name<span class="help-marker" title={fieldHelp.hookName} aria-label={fieldHelp.hookName}>?</span></span>
						<input type="text" bind:value={hookState.name} autocomplete="off">
					</label>
					<div class="hook-command-section">
						<div class="section-heading-row">
							<h4>Configured hooks</h4>
							<button type="button" onclick={addHookCommand}>Add hook event</button>
						</div>
						{#if hookState.commands.length}
							<div class="hook-command-list">
								{#each hookState.commands as command, commandIndex}
									<div class="hook-command-item">
										<label>
											<span class="label-text">Hook event</span>
											<select value={command.event} onchange={event => updateHookCommandEvent(commandIndex, event.currentTarget.value as HookEventName)}>
												{#each hookEventOptions as eventName}
													<option value={eventName}>{eventName}</option>
												{/each}
											</select>
										</label>
										<div class="hook-property-list">
											{#each hookCommandPropertyDefinitions as property}
												{@const enabled = Boolean(command.properties[property.name])}
												<div class={'hook-property-row ' + (enabled ? 'is-active' : 'is-inactive')}>
													<label class="checkbox-label" title={property.description}>
														<input type="checkbox" checked={enabled} onchange={event => toggleHookCommandProperty(commandIndex, property.name, event.currentTarget.checked)}>
														<span>{property.name}</span>
													</label>
													{#if enabled}
														<input type="text" value={command.properties[property.name]} placeholder={property.placeholder} oninput={event => updateHookCommandProperty(commandIndex, property.name, event.currentTarget.value)}>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<p class="editor-note">No configured hook commands were found in this file.</p>
						{/if}
						<p class="editor-note">Checked properties are written to the hook command. Env accepts a JSON object.</p>
					</div>
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if hasInstructionForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={saveInstruction}>
					<label>
						<span class="label-text">Name<span class="help-marker" title={fieldHelp.instructionName} aria-label={fieldHelp.instructionName}>?</span></span>
						<input type="text" bind:value={instructionState.name} autocomplete="off">
					</label>
					<label>
						<span class="label-text">Description<span class="help-marker" title={fieldHelp.instructionDescription} aria-label={fieldHelp.instructionDescription}>?</span></span>
						<textarea class="compact-field" bind:value={instructionState.description}></textarea>
					</label>
					<label>
						<span class="label-text">Apply to<span class="help-marker" title={fieldHelp.instructionApplyTo} aria-label={fieldHelp.instructionApplyTo}>?</span></span>
						<input type="text" bind:value={instructionState.applyTo} placeholder="**/*.ts">
					</label>
					<label>
						<span class="label-text">Instructions<span class="help-marker" title={fieldHelp.instructionBody} aria-label={fieldHelp.instructionBody}>?</span></span>
						<textarea class="body-field" bind:value={instructionState.body}></textarea>
					</label>
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if hasSkillForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={saveSkill}>
					<label>
						<span class="label-text">Name<span class="help-marker" title={fieldHelp.skillName} aria-label={fieldHelp.skillName}>?</span></span>
						<input type="text" bind:value={skillState.name} autocomplete="off">
					</label>
					<label>
						<span class="label-text">Description<span class="help-marker" title={fieldHelp.skillDescription} aria-label={fieldHelp.skillDescription}>?</span></span>
						<textarea class="compact-field" bind:value={skillState.description}></textarea>
					</label>
					<label>
						<span class="label-text">Argument hint<span class="help-marker" title={fieldHelp.skillArgumentHint} aria-label={fieldHelp.skillArgumentHint}>?</span></span>
						<input type="text" bind:value={skillState.argumentHint}>
					</label>
					<label>
						<span class="label-text">Context<span class="help-marker" title={fieldHelp.skillContext} aria-label={fieldHelp.skillContext}>?</span></span>
						<select bind:value={skillState.skillContext}>
							<option value="">Default</option>
							<option value="inline">Inline</option>
							<option value="fork">Fork</option>
						</select>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={skillState.userInvocable}>
						<span class="label-text">User invocable<span class="help-marker" title={fieldHelp.userInvocable} aria-label={fieldHelp.userInvocable}>?</span></span>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={skillState.disableModelInvocation}>
						<span class="label-text">Disable Model Invocation<span class="help-marker" title={fieldHelp.skillDisableModelInvocation} aria-label={fieldHelp.skillDisableModelInvocation}>?</span></span>
					</label>
					<label>
						<span class="label-text">Instructions<span class="help-marker" title={fieldHelp.skillBody} aria-label={fieldHelp.skillBody}>?</span></span>
						<textarea class="body-field" bind:value={skillState.body}></textarea>
					</label>
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if hasPromptForm}
				<form class="editor-form" bind:this={activeForm} onsubmit={savePrompt}>
					<div class="field-row">
						<label>
							<span class="label-text">Name<span class="help-marker" title={fieldHelp.promptName} aria-label={fieldHelp.promptName}>?</span></span>
							<input type="text" bind:value={promptState.name} autocomplete="off">
						</label>
						<ModelSelect bind:value={promptState.model} models={availableModels} />
					</div>
					<label>
						<span class="label-text">Agent<span class="help-marker" title={fieldHelp.promptAgent} aria-label={fieldHelp.promptAgent}>?</span></span>
						<select bind:value={promptState.agent}>
							<option value=""></option>
							{#each promptAgentOptions as agent}
								<option value={agent}>{agent}</option>
							{/each}
						</select>
					</label>
					<ToolsEditor tools={availableTools} selected={promptState.tools} presets={toolPresets} onChange={updatePromptTools} />
					<label>
						<span class="label-text">Prompt<span class="help-marker" title={fieldHelp.promptBody} aria-label={fieldHelp.promptBody}>?</span></span>
						<textarea class="body-field" bind:value={promptState.body}></textarea>
					</label>
					<div class="editor-form-actions">
						<button type="submit">Save</button>
					</div>
				</form>
			{:else if isEditable}
				<p class="editor-note">Svelte editor form migration placeholder. Editable fields and save payloads for this node type will be ported in a later slice.</p>
			{:else}
				<p class="editor-note">This node is currently read-only in the Svelte migration shell.</p>
			{/if}
			<ul class="node-detail-list">
				{#each details as detail}
					<li>{detail}</li>
				{/each}
			</ul>
		</div>
	</section>
{/if}
import type { GraphNode, HookEventName } from '../../../mapper';
import type { WebviewToExtensionMessage } from '../protocol';

export const hookEventOptions: HookEventName[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop'];

export const hookCommandPropertyDefinitions = [
	{ name: 'command', description: 'Default command to run across platforms.', placeholder: 'npx prettier --write "$TOOL_INPUT_FILE_PATH"' },
	{ name: 'windows', description: 'Windows-specific command override.', placeholder: 'powershell -File scripts\\hook.ps1' },
	{ name: 'linux', description: 'Linux-specific command override.', placeholder: './scripts/hook-linux.sh' },
	{ name: 'osx', description: 'macOS-specific command override.', placeholder: './scripts/hook-mac.sh' },
	{ name: 'cwd', description: 'Working directory relative to the repository root.', placeholder: 'packages/app' },
	{ name: 'env', description: 'Additional environment variables as a JSON object.', placeholder: '{"NODE_ENV":"test"}' },
	{ name: 'timeout', description: 'Timeout in seconds. Default is 30.', placeholder: '30' },
] as const;

export type HookCommandPropertyName = typeof hookCommandPropertyDefinitions[number]['name'];

export interface InstructionEditorState {
	name: string;
	description: string;
	applyTo: string;
	body: string;
}

export interface PromptEditorState {
	name: string;
	agent: string;
	model: string;
	tools: string[];
	body: string;
}

export interface AgentEditorState {
	name: string;
	description: string;
	argumentHint: string;
	model: string;
	agents: string[];
	tools: string[];
	userInvocable: boolean;
	disableModelInvocation: boolean;
	body: string;
}

export interface SkillEditorState {
	name: string;
	description: string;
	argumentHint: string;
	skillContext: '' | 'inline' | 'fork';
	userInvocable: boolean;
	disableModelInvocation: boolean;
	body: string;
}

export interface HandoffEditorState {
	name: string;
	agent: string;
	prompt: string;
	send: boolean;
	model: string;
}

export interface HookCommandEditorState {
	id: string;
	event: HookEventName;
	properties: Record<HookCommandPropertyName, string>;
}

export interface HookEditorState {
	name: string;
	commands: HookCommandEditorState[];
}

export function createInstructionEditorState(node: GraphNode): InstructionEditorState {
	return {
		name: node.label || '',
		description: node.description || '',
		applyTo: node.applyTo || '',
		body: node.body || '',
	};
}

export function createInstructionSaveMessage(node: GraphNode, state: InstructionEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'instruction' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		name: state.name,
		description: state.description,
		applyTo: state.applyTo,
		body: state.body,
	};
}

export function createPromptEditorState(node: GraphNode): PromptEditorState {
	return {
		name: node.label || '',
		agent: node.agent || '',
		model: node.model || '',
		tools: node.tools || [],
		body: node.body || '',
	};
}

export function createPromptSaveMessage(node: GraphNode, state: PromptEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'prompt' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		name: state.name,
		agent: state.agent,
		model: state.model,
		tools: state.tools,
		body: state.body,
	};
}

export function createAgentEditorState(node: GraphNode): AgentEditorState {
	return {
		name: node.label || '',
		description: node.description || '',
		argumentHint: node.argumentHint || '',
		model: node.model || '',
		agents: node.agents || [],
		tools: node.tools || [],
		userInvocable: node.userInvocable !== false,
		disableModelInvocation: Boolean(node.disableModelInvocation),
		body: node.body || '',
	};
}

export function createAgentSaveMessage(node: GraphNode, state: AgentEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'agent' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		name: state.name,
		description: state.description,
		argumentHint: state.argumentHint,
		model: state.model,
		agents: state.agents,
		tools: state.tools,
		userInvocable: state.userInvocable,
		disableModelInvocation: state.disableModelInvocation,
		handoffs: JSON.stringify(node.handoffs || []),
		body: state.body,
	};
}

export function createSkillEditorState(node: GraphNode): SkillEditorState {
	return {
		name: node.label || '',
		description: node.description || '',
		argumentHint: node.argumentHint || '',
		skillContext: node.skillContext || '',
		userInvocable: node.userInvocable !== false,
		disableModelInvocation: Boolean(node.disableModelInvocation),
		body: node.body || '',
	};
}

export function createSkillSaveMessage(node: GraphNode, state: SkillEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'skill' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		name: state.name,
		description: state.description,
		argumentHint: state.argumentHint,
		skillContext: state.skillContext,
		userInvocable: state.userInvocable,
		disableModelInvocation: state.disableModelInvocation,
		body: state.body,
	};
}

export function createHandoffEditorState(node: GraphNode): HandoffEditorState {
	return {
		name: node.label || '',
		agent: node.handoffAgent || '',
		prompt: node.handoffPrompt || '',
		send: Boolean(node.handoffSend),
		model: node.handoffModel || '',
	};
}

export function createHandoffSaveMessage(node: GraphNode, state: HandoffEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'handoff' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		handoffIndex: node.handoffIndex,
		name: state.name,
		agent: state.agent,
		prompt: state.prompt,
		send: state.send,
		model: state.model,
		handoffModel: state.model,
	};
}

export function createHookEditorState(node: GraphNode): HookEditorState {
	const commands = node.hookCommands || [];
	const commandEvents = new Set(commands.map(command => command.event));
	const eventOnlyRows = (node.hookEvents || [])
		.filter(event => event.commandCount === 0 && !commandEvents.has(event.name))
		.map(event => createHookCommandEditorState('event:' + event.name, event.name, {}));

	return {
		name: node.label || '',
		commands: [
			...commands.map(command => createHookCommandEditorState(command.id, command.event, command.properties || {})),
			...eventOnlyRows,
		].sort((left, right) => hookEventOptions.indexOf(left.event) - hookEventOptions.indexOf(right.event)),
	};
}

export function createHookSaveMessage(node: GraphNode, state: HookEditorState): WebviewToExtensionMessage | undefined {
	if (node.type !== 'hook' || !node.uri) {
		return undefined;
	}

	return {
		type: 'node:save',
		nodeType: node.type,
		uri: node.uri,
		name: state.name,
		hookCommands: JSON.stringify(state.commands.map(command => ({
			id: command.id,
			event: command.event,
			properties: trimHookCommandProperties(command.properties),
		}))),
	};
}

export function createEmptyHookCommandEditorState(id: string): HookCommandEditorState {
	return createHookCommandEditorState(id, 'PreToolUse', {});
}

function createHookCommandEditorState(id: string, event: HookEventName, properties: Record<string, string>): HookCommandEditorState {
	return {
		id,
		event,
		properties: hookCommandPropertyDefinitions.reduce<Record<HookCommandPropertyName, string>>((result, property) => {
			result[property.name] = properties[property.name] || '';
			return result;
		}, { command: '', windows: '', linux: '', osx: '', cwd: '', env: '', timeout: '' }),
	};
}

function trimHookCommandProperties(properties: Record<HookCommandPropertyName, string>): Record<string, string> {
	return hookCommandPropertyDefinitions.reduce<Record<string, string>>((result, property) => {
		const value = properties[property.name]?.trim() || '';

		if (value) {
			result[property.name] = value;
		}

		return result;
	}, {});
}
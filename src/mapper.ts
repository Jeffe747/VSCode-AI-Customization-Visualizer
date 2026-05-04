export type WorkspaceFileKind = 'agent' | 'prompt' | 'instruction' | 'skill';

export interface WorkspaceAiFile {
	uri: string;
	relativePath: string;
	kind: WorkspaceFileKind;
	name: string;
	frontmatter: Record<string, unknown>;
	body: string;
	agents: string[];
	tools: string[];
	model?: string;
	userInvocable?: boolean;
	agent?: string;
	instructionAudience?: string;
	description?: string;
	applyTo?: string;
	argumentHint?: string;
	disableModelInvocation?: boolean;
	handoffs?: unknown[];
	skillContext?: 'inline' | 'fork';
	skillFolderName?: string;
}

export interface GraphNode {
	id: string;
	label: string;
	type: 'agent' | 'prompt' | 'tool' | 'instruction' | 'skill' | 'mcp' | 'hook' | 'hook-event' | 'handoff';
	uri?: string;
	path?: string;
	agents?: string[];
	tools?: string[];
	model?: string;
	userInvocable?: boolean;
	agent?: string;
	body?: string;
	instructionAudience?: string;
	description?: string;
	applyTo?: string;
	argumentHint?: string;
	disableModelInvocation?: boolean;
	handoffs?: unknown[];
	handoffIndex?: number;
	handoffAgent?: string;
	handoffPrompt?: string;
	handoffSend?: boolean;
	handoffModel?: string;
	skillContext?: 'inline' | 'fork';
	skillIssues?: string[];
	contextEstimateTokens?: number;
	mcpSource?: string;
	mcpServerType?: string;
	mcpCommand?: string;
	hookEvents?: HookEventSummary[];
	hookCommands?: HookCommandSummary[];
	hookSource?: string;
	hookEventName?: HookEventName;
	hookEventDescription?: string;
	hookEventCommandCount?: number;
	hookEventVariableDriven?: boolean;
	unresolved?: boolean;
}

export interface McpServerConfig {
	name: string;
	source: string;
	serverType?: string;
	command?: string;
}

export interface HookEventSummary {
	name: HookEventName;
	description: string;
	commandCount: number;
	variableDriven: boolean;
}

export interface HookConfig {
	name: string;
	source: string;
	uri: string;
	events: HookEventSummary[];
	commands: HookCommandSummary[];
}

export interface HookCommandSummary {
	id: string;
	event: HookEventName;
	index: number;
	name: string;
	command: string;
	properties?: Record<string, string>;
}

export type HookEventName = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'SubagentStart' | 'SubagentStop' | 'Stop';

export interface AvailableTool {
	name: string;
	description?: string;
}

export interface AvailableModel {
	label: string;
	value: string;
	maxInputTokens?: number;
}

export interface GraphLink {
	id: string;
	source: string;
	target: string;
	type: 'uses-agent' | 'uses-tool' | 'runs-with-agent' | 'uses-mcp' | 'has-hook-event' | 'uses-handoff' | 'handoff-to-agent';
}

export interface GraphJson {
	nodes: GraphNode[];
	links: GraphLink[];
	availableTools: AvailableTool[];
	availableModels: AvailableModel[];
}

export function mapWorkspaceFilesToGraph(files: WorkspaceAiFile[], mcpServers: McpServerConfig[] = [], hookConfigs: HookConfig[] = []): GraphJson {
	const nodes = new Map<string, GraphNode>();
	const links = new Map<string, GraphLink>();
	const agentFilesByName = new Map(files.filter((file): file is WorkspaceAiFile & { kind: 'agent' } => file.kind === 'agent').map(file => [normalizeAgentName(file.name), file]));
	const knownAgents = new Set(agentFilesByName.keys());

	const addNode = (node: GraphNode) => {
		const existing = nodes.get(node.id);

		if (!existing || existing.unresolved || node.uri) {
			nodes.set(node.id, { ...existing, ...node });
		}
	};

	const addLink = (source: string, target: string, type: GraphLink['type']) => {
		const id = `${source}->${target}:${type}`;

		links.set(id, { id, source, target, type });
	};

	for (const file of files) {
		const nodeId = file.kind === 'agent'
			? getAgentNodeId(file.name)
			: file.kind === 'prompt'
				? getPromptNodeId(file.relativePath)
				: file.kind === 'skill'
					? getSkillNodeId(file.relativePath)
					: getInstructionNodeId(file.relativePath);
		const skillIssues = file.kind === 'skill' ? getSkillIssues(file) : [];

		addNode({
			id: nodeId,
			label: file.name,
			type: file.kind,
			uri: file.uri,
			path: file.relativePath,
			agents: file.kind === 'agent' ? file.agents : undefined,
			tools: file.tools,
			model: file.model,
			userInvocable: file.kind === 'agent' || file.kind === 'skill' ? file.userInvocable : undefined,
			agent: file.kind === 'prompt' ? file.agent : undefined,
			body: file.body,
			instructionAudience: file.kind === 'instruction' ? getInstructionAudience(file.relativePath) : undefined,
			description: file.kind === 'agent' || file.kind === 'skill' || file.kind === 'instruction' ? file.description : undefined,
			applyTo: file.kind === 'instruction' ? file.applyTo : undefined,
			argumentHint: file.kind === 'agent' || file.kind === 'skill' ? file.argumentHint : undefined,
			disableModelInvocation: file.kind === 'agent' || file.kind === 'skill' ? file.disableModelInvocation : undefined,
			handoffs: file.kind === 'agent' ? file.handoffs : undefined,
			skillContext: file.kind === 'skill' ? file.skillContext : undefined,
			skillIssues: skillIssues.length ? skillIssues : undefined,
			contextEstimateTokens: file.kind === 'agent' && file.userInvocable !== false ? estimateAgentContextTokens(file, agentFilesByName) : undefined,
			unresolved: file.kind === 'skill' ? skillIssues.length > 0 : false,
		});

		if (file.kind === 'agent') {
			for (const subAgent of file.agents) {
				const targetId = getAgentNodeId(subAgent);

				addNode({
					id: targetId,
					label: subAgent,
					type: 'agent',
					unresolved: !knownAgents.has(normalizeAgentName(subAgent)),
				});

				addLink(nodeId, targetId, 'uses-agent');
			}

			for (const [index, handoff] of (file.handoffs || []).entries()) {
				const handoffId = getHandoffNodeId(file.relativePath, index);
				const handoffLabel = readHandoffStringProperty(handoff, 'label') || `Handoff ${index + 1}`;
				const handoffAgent = readHandoffStringProperty(handoff, 'agent');
				const handoffPrompt = readHandoffStringProperty(handoff, 'prompt');
				const handoffSend = readHandoffBooleanProperty(handoff, 'send');
				const handoffModel = readHandoffStringProperty(handoff, 'model');

				addNode({
					id: handoffId,
					label: handoffLabel,
					type: 'handoff',
					uri: file.uri,
					path: `${file.relativePath}#handoffs[${index + 1}]`,
					handoffIndex: index,
					handoffAgent: handoffAgent,
					handoffPrompt: handoffPrompt,
					handoffSend: handoffSend,
					handoffModel: handoffModel,
				});

				addLink(nodeId, handoffId, 'uses-handoff');

				if (handoffAgent) {
					const targetId = getAgentNodeId(handoffAgent);

					addNode({
						id: targetId,
						label: handoffAgent,
						type: 'agent',
						unresolved: !knownAgents.has(normalizeAgentName(handoffAgent)),
					});

					addLink(handoffId, targetId, 'handoff-to-agent');
				}
			}

		}

		if (file.kind === 'prompt' && file.agent) {
			const targetId = getAgentNodeId(file.agent);

			addNode({
				id: targetId,
				label: file.agent,
				type: 'agent',
				unresolved: !knownAgents.has(normalizeAgentName(file.agent)),
			});

			addLink(nodeId, targetId, 'runs-with-agent');
		}

	}

	const mcpNodeIdsByToolName = new Map<string, string>();

	for (const server of mcpServers) {
		const mcpNodeId = getMcpNodeId(server.name, server.source);

		mcpNodeIdsByToolName.set(getMcpServerToolName(server.name), mcpNodeId);

		addNode({
			id: mcpNodeId,
			label: server.name,
			type: 'mcp',
			mcpSource: server.source,
			mcpServerType: server.serverType,
			mcpCommand: server.command,
		});
	}

	for (const file of files.filter(file => file.kind === 'agent')) {
		const sourceId = getAgentNodeId(file.name);

		for (const tool of file.tools) {
			const targetId = mcpNodeIdsByToolName.get(tool);

			if (targetId) {
				addLink(sourceId, targetId, 'uses-mcp');
			}
		}
	}

	for (const hookConfig of hookConfigs) {
		const hookNodeId = getHookNodeId(hookConfig.source);

		addNode({
			id: hookNodeId,
			label: hookConfig.name,
			type: 'hook',
			uri: hookConfig.uri,
			path: hookConfig.source,
			hookSource: hookConfig.source,
			hookEvents: hookConfig.events,
			hookCommands: hookConfig.commands,
		});

		for (const event of hookConfig.events) {
			const eventNodeId = getHookEventNodeId(hookConfig.source, event.name);

			addNode({
				id: eventNodeId,
				label: event.name,
				type: 'hook-event',
				hookSource: hookConfig.source,
				hookEventName: event.name,
				hookEventDescription: event.description,
				hookEventCommandCount: event.commandCount,
				hookEventVariableDriven: event.variableDriven,
			});

			addLink(hookNodeId, eventNodeId, 'has-hook-event');
		}
	}

	return {
		nodes: [...nodes.values()].sort((left, right) => left.label.localeCompare(right.label)),
		links: [...links.values()].sort((left, right) => left.id.localeCompare(right.id)),
		availableTools: unique(files.flatMap(file => file.tools).filter(tool => !isMcpServerToolReference(tool))).sort((left, right) => left.localeCompare(right)).map(name => ({ name })),
		availableModels: [],
	};
}

function getAgentNodeId(name: string): string {
	return `agent:${normalizeAgentName(name)}`;
}

function getPromptNodeId(relativePath: string): string {
	return `prompt:${relativePath}`;
}

function getInstructionNodeId(relativePath: string): string {
	return `instruction:${relativePath}`;
}

function getHandoffNodeId(ownerRelativePath: string, index: number): string {
	return `handoff:${ownerRelativePath}:${index}`;
}

function getHandoffSignature(handoff: unknown): string {
	return ['label', 'agent', 'prompt', 'send'].map(property => String(readHandoffProperty(handoff, property) ?? '')).join('\u001f');
}

function normalizeHandoffLabel(label: unknown): string {
	return typeof label === 'string' ? label.trim().toLocaleLowerCase() : '';
}

function readHandoffProperty(handoff: unknown, property: string): unknown {
	if (!handoff || typeof handoff !== 'object') {
		return undefined;
	}

	const record = handoff as Record<string, unknown>;

	if (record[property] !== undefined) {
		return record[property];
	}

	if (property === 'label') {
		return record.name;
	}

	if (property === 'agent') {
		return record.handoffAgent;
	}

	if (property === 'prompt') {
		return record.handoffPrompt;
	}

	if (property === 'send') {
		return record.handoffSend;
	}

	if (property === 'model') {
		return record.handoffModel;
	}

	return undefined;
}

function readHandoffStringProperty(handoff: unknown, property: string): string | undefined {
	const value = readHandoffProperty(handoff, property);

	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readHandoffBooleanProperty(handoff: unknown, property: string): boolean | undefined {
	const value = readHandoffProperty(handoff, property);

	return typeof value === 'boolean' ? value : undefined;
}

function getSkillNodeId(relativePath: string): string {
	return `skill:${relativePath}`;
}

function getMcpNodeId(name: string, source: string): string {
	return `mcp:${source}:${normalizeAgentName(name)}`;
}

function getMcpServerToolName(name: string): string {
	return `${name}/*`;
}

function isMcpServerToolReference(tool: string): boolean {
	return tool.endsWith('/*');
}

function getHookNodeId(source: string): string {
	return `hook:${source}`;
}

function getHookEventNodeId(source: string, eventName: HookEventName): string {
	return `hook:${source}:event:${eventName}`;
}

export function getHookEventDescription(eventName: HookEventName): string {
	const descriptions: Record<HookEventName, string> = {
		SessionStart: 'User submits the first prompt of a new session.',
		UserPromptSubmit: 'User submits a prompt.',
		PreToolUse: 'Before the agent invokes a tool.',
		PostToolUse: 'After a tool completes successfully.',
		PreCompact: 'Before conversation context is compacted.',
		SubagentStart: 'Subagent is spawned.',
		SubagentStop: 'Subagent completes.',
		Stop: 'Agent session ends.',
	};

	return descriptions[eventName];
}

export function isHookEventName(value: string): value is HookEventName {
	return value === 'SessionStart'
		|| value === 'UserPromptSubmit'
		|| value === 'PreToolUse'
		|| value === 'PostToolUse'
		|| value === 'PreCompact'
		|| value === 'SubagentStart'
		|| value === 'SubagentStop'
		|| value === 'Stop';
}

export function isVariableDrivenHookEvent(eventName: HookEventName): boolean {
	return eventName === 'PreToolUse' || eventName === 'PostToolUse';
}

function getSkillIssues(file: WorkspaceAiFile): string[] {
	const issues: string[] = [];
	const frontmatterName = typeof file.frontmatter.name === 'string' ? file.frontmatter.name.trim() : '';
	const description = file.description || '';
	const folderName = file.skillFolderName || '';

	if (!frontmatterName) {
		issues.push('Missing required name.');
	}

	if (!description) {
		issues.push('Missing required description.');
	} else if (description.length > 1024) {
		issues.push('Description must be 1024 characters or fewer.');
	}

	if (frontmatterName) {
		if (!/^[a-z0-9-]+$/.test(frontmatterName)) {
			issues.push('Name must use lowercase letters, numbers, and hyphens only.');
		}

		if (frontmatterName.length > 64) {
			issues.push('Name must be 64 characters or fewer.');
		}

		if (folderName && frontmatterName !== folderName) {
			issues.push('Name must match the parent directory.');
		}
	}

	return issues;
}

function estimateAgentContextTokens(file: WorkspaceAiFile, agentFilesByName: Map<string, WorkspaceAiFile>): number {
	const contextParts = collectAgentContextParts(file, agentFilesByName, new Set<string>());
	const characterCount = contextParts.join('\n').length;

	return Math.max(1, Math.ceil(characterCount / 4));
}

function collectAgentContextParts(file: WorkspaceAiFile, agentFilesByName: Map<string, WorkspaceAiFile>, visitedAgents: Set<string>): string[] {
	const agentKey = normalizeAgentName(file.name);

	if (visitedAgents.has(agentKey)) {
		return [];
	}

	visitedAgents.add(agentKey);

	const contextParts = [
		file.name,
		file.model || '',
		file.body,
		...file.tools.map(tool => `tool:${tool}`),
	].filter(Boolean);

	for (const agent of file.agents) {
		const agentFile = agentFilesByName.get(normalizeAgentName(agent));

		if (agentFile) {
			contextParts.push(...collectAgentContextParts(agentFile, agentFilesByName, visitedAgents));
		} else {
			contextParts.push(`agent:${agent}`);
		}
	}

	return contextParts;
}

function getInstructionAudience(relativePath: string): string {
	const pathParts = relativePath.replace(/\\/g, '/').split('/');
	const fileName = pathParts[pathParts.length - 1];

	if (fileName === 'AGENTS.md') {
		return 'All AI';
	}

	if (fileName === 'CLAUDE.md' || fileName === 'Claude.md') {
		return 'Claude';
	}

	if (fileName === 'copilot-instructions.md') {
		return 'Copilot';
	}

	return 'Copilot scoped';
}

function normalizeAgentName(name: string): string {
	return name.replace(/[^A-Za-z0-9]/g, '').toLocaleLowerCase();
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
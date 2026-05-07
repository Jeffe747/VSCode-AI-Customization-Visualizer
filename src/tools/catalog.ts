import { AvailableTool } from '../mapper';
import { unique } from '../utils/values';

interface ToolPresetDefinition {
	label: string;
	tools: string[];
}

const curatedDefaultAvailableTools: AvailableTool[] = [
	{ name: 'execute', description: 'Run commands in the integrated terminal.' },
	{ name: 'read', description: 'Read files, problems, and code context.' },
	{ name: 'edit', description: 'Create and update files in the workspace.' },
	{ name: 'search', description: 'Search code, symbols, and workspace content.' },
	{ name: 'agent', description: 'Invoke built-in or custom agents and subagents.' },
	{ name: 'web', description: 'Fetch and review external web content.' },
	{ name: 'todo', description: 'Track and update the current task plan.' },
];

const defaultToolPresets: ToolPresetDefinition[] = [
	{ label: 'General', tools: ['execute', 'read', 'edit', 'search', 'agent', 'web', 'todo'] },
	{ label: 'Planning', tools: ['read', 'search', 'web', 'todo'] },
	{ label: 'Implementation', tools: ['execute', 'read', 'edit', 'search', 'web', 'todo'] },
	{ label: 'Test', tools: ['execute', 'read', 'edit', 'search', 'todo'] },
];

export const toolChoiceHiddenCssRule = `.tool-choice-list .choice-check[hidden] {
			display: none;
		}`;

export function isToolChoiceVisibleForFilter(toolName: string, filterValue: string): boolean {
	const normalizedFilter = filterValue.trim().toLowerCase();

	return !normalizedFilter || toolName.toLowerCase().includes(normalizedFilter);
}

export function isMcpServerToolReference(toolName: unknown): boolean {
	return typeof toolName === 'string' && toolName.endsWith('/*');
}

export function normalizeDisplayedToolName(toolName: unknown): string | undefined {
	if (typeof toolName !== 'string') {
		return undefined;
	}

	const normalizedName = toolName.trim();

	if (!normalizedName) {
		return undefined;
	}

	return getCuratedToolAlias(normalizedName) || normalizedName;
}

export function normalizeDisplayedToolList(value: unknown): string[] {
	return Array.isArray(value)
		? unique(value.map(item => normalizeDisplayedToolName(item)).filter((item): item is string => Boolean(item)))
		: [];
}

export function createSavedToolsList(selectedTools: unknown, existingTools: unknown, preserveMcpServerReferences = false): string[] {
	const preservedTools = preserveMcpServerReferences ? normalizeDisplayedToolList(existingTools).filter(isMcpServerToolReference) : [];

	return unique([...normalizeDisplayedToolList(selectedTools), ...preservedTools]);
}

export function getDefaultAvailableTools(vscodeTools: AvailableTool[], customTools: AvailableTool[] = []): AvailableTool[] {
	const merged = new Map<string, AvailableTool>();

	for (const tool of curatedDefaultAvailableTools) {
		merged.set(tool.name, { ...tool });
	}

	for (const tool of vscodeTools) {
		const alias = getCuratedToolAlias(tool.name);

		if (!alias) {
			continue;
		}

		const existing = merged.get(alias);

		if (existing) {
			if (!existing.description && tool.description) {
				merged.set(alias, { ...existing, description: tool.description });
			}

			continue;
		}

		merged.set(alias, {
			name: alias,
			description: tool.description,
		});
	}

	for (const tool of customTools) {
		const normalizedName = normalizeDisplayedToolName(tool.name);

		if (!normalizedName) {
			continue;
		}

		const existing = merged.get(normalizedName);

		if (existing) {
			if (!existing.description && tool.description) {
				merged.set(normalizedName, { ...existing, description: tool.description });
			}

			continue;
		}

		merged.set(normalizedName, {
			...tool,
			name: normalizedName,
		});
	}

	return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function getDefaultToolPresets(): ToolPresetDefinition[] {
	return defaultToolPresets.map(preset => ({
		label: preset.label,
		tools: [...preset.tools],
	}));
}

function getCuratedToolAlias(toolName: string): string | undefined {
	const normalizedName = toolName.trim();

	if (!normalizedName) {
		return undefined;
	}

	if (curatedDefaultAvailableTools.some(tool => tool.name === normalizedName)) {
		return normalizedName;
	}

	const aliasByPrefix: Array<[string, string]> = [
		['agent/', 'agent'],
		['edit/', 'edit'],
		['execute/', 'execute'],
		['read/', 'read'],
		['search/', 'search'],
		['web/', 'web'],
	];

	for (const [prefix, alias] of aliasByPrefix) {
		if (normalizedName.startsWith(prefix)) {
			return alias;
		}
	}

	if (normalizedName === 'todos') {
		return 'todo';
	}

	return undefined;
}

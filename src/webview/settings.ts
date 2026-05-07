import { readString } from '../utils/values';

export type VisualizerSettingsMode = 'activity' | 'window';
export type VisualizerColorKey = 'agent' | 'prompt' | 'skill' | 'instruction' | 'mcp' | 'hook' | 'hook-event' | 'handoff' | 'tool' | 'edge' | 'marker' | 'marker-background' | 'marker-accent' | 'selection' | 'graph-background';

export interface VisualizerColorDefinition {
	key: VisualizerColorKey;
	label: string;
	description: string;
}

export interface VisualizerSettings {
	sideBySideLayout: boolean;
	documentationLinksHidden: boolean;
	nodeScale: number;
	textScale: number;
	colors: Partial<Record<VisualizerColorKey, string>>;
	heatmapToggleVisible: boolean;
	orphanToggleVisible: boolean;
	heatmapMediumThreshold: number;
	heatmapHighThreshold: number;
	heatmapBaselineModel?: string;
	debugMessagesEnabled: boolean;
}

export const visualizerColorDefinitions: VisualizerColorDefinition[] = [
	{ key: 'instruction', label: 'Instructions', description: 'Instruction file areas' },
	{ key: 'skill', label: 'Skills', description: 'Agent skill nodes' },
	{ key: 'prompt', label: 'Prompts', description: 'Prompt file nodes' },
	{ key: 'agent', label: 'Agents', description: 'Agent file nodes' },
	{ key: 'handoff', label: 'Handoffs', description: 'Agent handoff nodes' },
	{ key: 'mcp', label: 'MCP', description: 'MCP server nodes' },
	{ key: 'hook', label: 'Hooks', description: 'Hook file nodes' },
	{ key: 'hook-event', label: 'Hook events', description: 'Hook event sub-nodes' },
	{ key: 'tool', label: 'Tools', description: 'Tool references when shown' },
	{ key: 'edge', label: 'Edges', description: 'Graph lines and arrows' },
	{ key: 'marker', label: 'Icons', description: 'Robot, skill, MCP, and hook icon strokes' },
	{ key: 'marker-background', label: 'Icon backing', description: 'Icon badge fills and cutouts' },
	{ key: 'marker-accent', label: 'Icon accent', description: 'Stars and highlighted icon details' },
	{ key: 'selection', label: 'Selection', description: 'Selected and hovered node borders' },
	{ key: 'graph-background', label: 'Graph background', description: 'Visualizer canvas background' },
];

export const visualizerDefaultCssValues: Record<VisualizerColorKey, string> = {
	agent: 'var(--vscode-charts-red)',
	prompt: 'var(--vscode-charts-green)',
	skill: 'var(--vscode-charts-blue)',
	instruction: '#039faa',
	mcp: 'var(--vscode-charts-yellow)',
	hook: 'var(--vscode-charts-foreground, var(--vscode-charts-blue))',
	'hook-event': 'var(--hook)',
	handoff: '#b68763',
	tool: 'var(--vscode-charts-orange)',
	edge: 'var(--vscode-descriptionForeground)',
	marker: '#000000',
	'marker-background': '#ffffff',
	'marker-accent': 'var(--vscode-charts-yellow, #f2c744)',
	selection: 'var(--vscode-focusBorder)',
	'graph-background': 'color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-sideBar-foreground))',
};

export const colorPickerFallbackColors: Record<VisualizerColorKey, string> = {
	agent: '#d84f4f',
	prompt: '#4aa36b',
	skill: '#4f8bd8',
	instruction: '#039faa',
	mcp: '#d8b84f',
	hook: '#9aa0a6',
	'hook-event': '#9aa0a6',
	handoff: '#b68763',
	tool: '#d88a4f',
	edge: '#8f96a3',
	marker: '#000000',
	'marker-background': '#ffffff',
	'marker-accent': '#f2c744',
	selection: '#66afe9',
	'graph-background': '#20242b',
};

export const defaultVisualizerSettings: VisualizerSettings = {
	sideBySideLayout: false,
	documentationLinksHidden: false,
	nodeScale: 1.1,
	textScale: 1,
	colors: {},
	heatmapToggleVisible: false,
	orphanToggleVisible: false,
	heatmapMediumThreshold: 0.38,
	heatmapHighThreshold: 0.72,
	heatmapBaselineModel: undefined,
	debugMessagesEnabled: false,
};

export const visualizerSettingsStorageKeys: Record<VisualizerSettingsMode, string> = {
	activity: 'aivisualizer.settings.activityBar',
	window: 'aivisualizer.settings.windowMode',
};

export const sharedVisualizerSettingsStorageKey = 'aivisualizer.settings.shared';

export function normalizeVisualizerSettings(value: unknown): VisualizerSettings {
	const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	const heatmapHighThreshold = readNumberInRange(record.heatmapHighThreshold, 0.02, 0.99, defaultVisualizerSettings.heatmapHighThreshold);
	const heatmapMediumThreshold = readNumberInRange(record.heatmapMediumThreshold, 0.01, heatmapHighThreshold - 0.01, Math.min(defaultVisualizerSettings.heatmapMediumThreshold, heatmapHighThreshold - 0.01));

	return {
		sideBySideLayout: typeof record.sideBySideLayout === 'boolean' ? record.sideBySideLayout : defaultVisualizerSettings.sideBySideLayout,
		documentationLinksHidden: typeof record.documentationLinksHidden === 'boolean' ? record.documentationLinksHidden : defaultVisualizerSettings.documentationLinksHidden,
		nodeScale: readNumberInRange(record.nodeScale, 0.85, 2, defaultVisualizerSettings.nodeScale),
		textScale: readNumberInRange(record.textScale, 0.75, 1.6, defaultVisualizerSettings.textScale),
		colors: normalizeVisualizerColors(record.colors),
		heatmapToggleVisible: typeof record.heatmapToggleVisible === 'boolean' ? record.heatmapToggleVisible : defaultVisualizerSettings.heatmapToggleVisible,
		orphanToggleVisible: typeof record.orphanToggleVisible === 'boolean' ? record.orphanToggleVisible : defaultVisualizerSettings.orphanToggleVisible,
		heatmapMediumThreshold,
		heatmapHighThreshold,
		heatmapBaselineModel: readString(record.heatmapBaselineModel),
		debugMessagesEnabled: typeof record.debugMessagesEnabled === 'boolean' ? record.debugMessagesEnabled : defaultVisualizerSettings.debugMessagesEnabled,
	};
}

export function hasVisualizerColors(colors: Partial<Record<VisualizerColorKey, string>>): boolean {
	return visualizerColorDefinitions.some(definition => typeof colors[definition.key] === 'string');
}

function normalizeVisualizerColors(value: unknown): Partial<Record<VisualizerColorKey, string>> {
	const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	const colors: Partial<Record<VisualizerColorKey, string>> = {};

	for (const definition of visualizerColorDefinitions) {
		const color = readHexColor(record[definition.key]);

		if (color && color.toLowerCase() !== colorPickerFallbackColors[definition.key].toLowerCase() && !isLegacyColorPickerFallback(definition.key, color)) {
			colors[definition.key] = color;
		}
	}

	return colors;
}

function readHexColor(value: unknown): string | undefined {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function isLegacyColorPickerFallback(key: VisualizerColorKey, color: string): boolean {
	const legacyFallbacks: Partial<Record<VisualizerColorKey, string>> = {
		marker: '#f2f4f8',
		'marker-background': '#1f2329',
	};
	const legacyFallback = legacyFallbacks[key];

	return Boolean(legacyFallback && legacyFallback.toLowerCase() === color.toLowerCase());
}

function readNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
	const numberValue = typeof value === 'number' ? value : Number(value);

	if (!Number.isFinite(numberValue)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, numberValue));
}

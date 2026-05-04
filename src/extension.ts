import matter = require('gray-matter');
import * as path from 'path';
import * as vscode from 'vscode';
import { AvailableModel, AvailableTool, GraphJson, HookCommandSummary, HookConfig, HookEventName, HookEventSummary, McpServerConfig, WorkspaceAiFile, getHookEventDescription, isHookEventName, isVariableDrivenHookEvent, mapWorkspaceFilesToGraph } from './mapper';

const viewType = 'aivisualizer.agentVisualizer';
const markdownGlob = '**/*.{agent.md,prompt.md,instructions.md}';
const skillGlob = '**/skills/*/SKILL.md';
const instructionGlob = '**/{copilot-instructions.md,AGENTS.md,CLAUDE.md,Claude.md}';
const hookGlob = '**/{.github/hooks/*.json,.claude/settings.json,.claude/settings.local.json}';
const mcpGlob = '**/.vscode/mcp.json';
const excludeGlob = '**/{node_modules,out,dist,.git,.vscode-test}/**';
const agentDescriptionPlaceholder = 'Use when: describe when this agent should be selected.';
const agentBodyPlaceholder = "Describe this agent's role, workflow, constraints, and output style.";
type VisualizerSettingsMode = 'activity' | 'window';
type VisualizerColorKey = 'agent' | 'prompt' | 'skill' | 'instruction' | 'mcp' | 'hook' | 'hook-event' | 'handoff' | 'tool' | 'edge' | 'marker' | 'marker-background' | 'marker-accent' | 'selection' | 'graph-background';

interface VisualizerColorDefinition {
	key: VisualizerColorKey;
	label: string;
	description: string;
}

interface VisualizerSettings {
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
}

interface ReadProblem {
	uri: vscode.Uri;
	message: string;
	details: string;
}

const visualizerColorDefinitions: VisualizerColorDefinition[] = [
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

const visualizerDefaultCssValues: Record<VisualizerColorKey, string> = {
	agent: 'var(--vscode-charts-red)',
	prompt: 'var(--vscode-charts-green)',
	skill: 'var(--vscode-charts-blue)',
	instruction: 'var(--vscode-charts-purple)',
	mcp: 'var(--vscode-charts-yellow)',
	hook: 'var(--vscode-charts-foreground, var(--vscode-charts-blue))',
	'hook-event': 'var(--hook)',
	handoff: 'var(--vscode-charts-orange)',
	tool: 'var(--vscode-charts-orange)',
	edge: 'var(--vscode-descriptionForeground)',
	marker: '#000000',
	'marker-background': '#ffffff',
	'marker-accent': 'var(--vscode-charts-yellow, #f2c744)',
	selection: 'var(--vscode-focusBorder)',
	'graph-background': 'color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-sideBar-foreground))',
};

const colorPickerFallbackColors: Record<VisualizerColorKey, string> = {
	agent: '#d84f4f',
	prompt: '#4aa36b',
	skill: '#4f8bd8',
	instruction: '#8c6bd8',
	mcp: '#d8b84f',
	hook: '#9aa0a6',
	'hook-event': '#9aa0a6',
	handoff: '#d88a4f',
	tool: '#d88a4f',
	edge: '#8f96a3',
	marker: '#000000',
	'marker-background': '#ffffff',
	'marker-accent': '#f2c744',
	selection: '#66afe9',
	'graph-background': '#20242b',
};

const defaultVisualizerSettings: VisualizerSettings = {
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
};

const visualizerSettingsStorageKeys: Record<VisualizerSettingsMode, string> = {
	activity: 'aivisualizer.settings.activityBar',
	window: 'aivisualizer.settings.windowMode',
};

const sharedVisualizerSettingsStorageKey = 'aivisualizer.settings.shared';

export const toolChoiceHiddenCssRule = `.tool-choice-list .choice-check[hidden] {
			display: none;
		}`;

export function isToolChoiceVisibleForFilter(toolName: string, filterValue: string): boolean {
	const normalizedFilter = filterValue.trim().toLowerCase();

	return !normalizedFilter || toolName.toLowerCase().includes(normalizedFilter);
}

function normalizeVisualizerSettings(value: unknown): VisualizerSettings {
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
	};
}

function hasVisualizerColors(colors: Partial<Record<VisualizerColorKey, string>>): boolean {
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

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Copilot AI Customization Visualizer');
	const diagnostics = vscode.languages.createDiagnosticCollection('aivisualizer');
	const scanner = new WorkspaceScanner(output);
	const provider = new AgentVisualizerViewProvider(context, scanner, diagnostics);
	const fileWatchers = createGraphFileWatchers(provider);

	context.subscriptions.push(
		output,
		diagnostics,
		vscode.window.registerWebviewViewProvider(viewType, provider),
		vscode.commands.registerCommand('aivisualizer.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('aivisualizer.popout', () => void provider.toggleWindowMode()),
		...fileWatchers,
	);
}

export function deactivate() {}

function createGraphFileWatchers(provider: AgentVisualizerViewProvider): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	for (const glob of [markdownGlob, skillGlob, instructionGlob, hookGlob, mcpGlob]) {
		const watcher = vscode.workspace.createFileSystemWatcher(glob);
		const refresh = () => provider.refresh();

		disposables.push(
			watcher,
			watcher.onDidCreate(refresh),
			watcher.onDidChange(refresh),
			watcher.onDidDelete(refresh),
		);
	}

	return disposables;
}

class WorkspaceScanner {
	private readonly readProblems = new Map<string, ReadProblem>();

	constructor(private readonly output: vscode.OutputChannel) {}

	beginRefresh(): void {
		this.readProblems.clear();
	}

	getReadProblems(): ReadProblem[] {
		return [...this.readProblems.values()];
	}

	async scan(): Promise<WorkspaceAiFile[]> {
		const [markdownUris, skillUris, instructionUris] = await Promise.all([
			vscode.workspace.findFiles(markdownGlob, excludeGlob),
			vscode.workspace.findFiles(skillGlob, excludeGlob),
			vscode.workspace.findFiles(instructionGlob, excludeGlob),
		]);
		const uris = uniqueUris([
			...markdownUris,
			...skillUris,
			...instructionUris,
		]);
		const files = await Promise.all(uris.map(uri => this.readFile(uri)));

		return files.filter((file): file is WorkspaceAiFile => file !== undefined);
	}

	async scanMcpServers(): Promise<McpServerConfig[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const servers = await Promise.all(workspaceFolders.map(folder => this.readWorkspaceMcpServers(folder)));

		return servers.flat();
	}

	private async readWorkspaceMcpServers(folder: vscode.WorkspaceFolder): Promise<McpServerConfig[]> {
		const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');

		if (!await fileExists(uri)) {
			return [];
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawJson = Buffer.from(bytes).toString('utf8');
			const parsed = JSON.parse(rawJson) as Record<string, unknown>;
			const servers = normalizeObject(parsed.servers);
			const source = vscode.workspace.asRelativePath(uri, false);

			return Object.entries(servers).map(([name, value]) => {
				const server = normalizeObject(value);
				const serverType = readString(server.type) || (server.url ? 'http' : server.command ? 'stdio' : undefined);
				const command = readString(server.url) || readString(server.command);
				return { name, source, serverType, command };
			});
		} catch (error) {
			this.logReadError(uri, 'Unable to read MCP server configuration', error);
			return [];
		}
	}

	async scanHookConfigs(): Promise<HookConfig[]> {
		const uris = await vscode.workspace.findFiles(hookGlob, excludeGlob);
		const configs = await Promise.all(uris.map(uri => this.readHookConfig(uri)));

		return configs.filter((config): config is HookConfig => config !== undefined);
	}

	private async readHookConfig(uri: vscode.Uri): Promise<HookConfig | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawJson = Buffer.from(bytes).toString('utf8');
			const parsed = JSON.parse(rawJson) as Record<string, unknown>;
			const hooks = normalizeObject(parsed.hooks);
			const events = readHookEvents(hooks);
			const commands = readHookCommands(hooks);

			const source = vscode.workspace.asRelativePath(uri, false);

			return {
				name: readString(parsed.name) || getHookConfigName(source),
				source,
				uri: uri.toString(),
				events,
				commands,
			};
		} catch (error) {
			this.logReadError(uri, 'Unable to read hook configuration', error);
			return undefined;
		}
	}

	private async readFile(uri: vscode.Uri): Promise<WorkspaceAiFile | undefined> {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const kind = getFileKind(uri);

		if (!kind) {
			return undefined;
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawMarkdown = Buffer.from(bytes).toString('utf8');
			const parsed = matter(rawMarkdown);
			const frontmatter = normalizeFrontmatter(parsed.data);
			const name = getFileName(uri, kind, frontmatter);

			return {
				uri: uri.toString(),
				relativePath,
				kind,
				name,
				frontmatter,
				body: parsed.content,
				agents: kind === 'agent' ? readStringArray(frontmatter.agents) : [],
				tools: kind === 'instruction' ? [] : unique([...readStringArray(frontmatter.tools), ...extractToolReferences(parsed.content)]),
				model: readModel(frontmatter.model),
				userInvocable: kind === 'agent' || kind === 'skill' ? readBoolean(frontmatter['user-invocable']) : undefined,
				agent: kind === 'prompt' ? readString(frontmatter.agent) : undefined,
				description: kind === 'agent' || kind === 'skill' || kind === 'instruction' ? readString(frontmatter.description) : undefined,
				applyTo: kind === 'instruction' ? readString(frontmatter.applyTo) : undefined,
				argumentHint: kind === 'agent' || kind === 'skill' ? readString(frontmatter['argument-hint']) : undefined,
				disableModelInvocation: kind === 'agent' || kind === 'skill' ? readBoolean(frontmatter['disable-model-invocation']) : undefined,
				handoffs: kind === 'agent' ? readArray(frontmatter.handoffs) : undefined,
				skillContext: kind === 'skill' ? readSkillContext(frontmatter.context) : undefined,
				skillFolderName: kind === 'skill' ? path.basename(path.dirname(uri.fsPath)) : undefined,
			};
		} catch (error) {
			this.logReadError(uri, `Unable to read ${kind} customization file`, error);
			return undefined;
		}
	}

	private logReadError(uri: vscode.Uri, message: string, error: unknown): void {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const details = error instanceof Error ? error.message : String(error);

		this.output.appendLine(`[${new Date().toISOString()}] ${message}: ${relativePath}`);
		this.output.appendLine(details);
		this.readProblems.set(uri.toString(), { uri, message, details });
	}
}

class AgentVisualizerViewProvider implements vscode.WebviewViewProvider {
	private webviewView?: vscode.WebviewView;
	private popoutPanel?: vscode.WebviewPanel;
	private cachedGraph?: GraphJson;
	private cachedBaseModels?: { expiresAt: number; models: AvailableModel[] };
	private refreshTimer?: NodeJS.Timeout;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly scanner: WorkspaceScanner,
		private readonly diagnostics: vscode.DiagnosticCollection,
	) {}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};

		this.registerWebviewMessageHandlers(webviewView.webview);
		webviewView.webview.html = this.getHtml(webviewView.webview, false);
	}

	async toggleWindowMode(): Promise<void> {
		if (this.popoutPanel) {
			this.popoutPanel.dispose();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'aivisualizer.agentVisualizerPanel',
			'Copilot AI Customization Visualizer',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
			},
		);

		this.popoutPanel = panel;
		this.registerWebviewMessageHandlers(panel.webview);
		panel.webview.html = this.getHtml(panel.webview, true);
		panel.onDidDispose(() => {
			if (this.popoutPanel === panel) {
				this.popoutPanel = undefined;
				void this.postWindowModeState();
			}
		});
		await this.postWindowModeState();
		await this.moveActiveEditorToWindow();
	}

	private async moveActiveEditorToWindow(): Promise<void> {
		try {
			await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
		} catch {
			// Older VS Code builds can lack this command; the WebviewPanel remains open as an editor tab.
		}
	}

	private registerWebviewMessageHandlers(webview: vscode.Webview): void {
		webview.onDidReceiveMessage(message => {
			if (message?.type === 'webview:ready') {
				if (this.cachedGraph) {
					void this.postCachedGraph(webview);
				} else {
					this.refresh();
				}

				void this.postWindowModeState(webview);
			}

			if (message?.type === 'refresh') {
				this.refresh();
			}

			if (message?.type === 'popout') {
				void this.toggleWindowMode();
			}

			if (message?.type === 'node:open') {
				void this.openNode(message.uri);
			}

			if (message?.type === 'mcp:open') {
				void this.openMcpServersView();
			}

			if (message?.type === 'docs:open') {
				void this.openDocs(message.url);
			}

			if (message?.type === 'node:save') {
				void this.saveNode(message);
			}

			if (message?.type === 'customization:create') {
				void this.createCustomization(message);
			}

			if (message?.type === 'settings:update') {
				void this.saveVisualizerSettings(message);
			}
		});
	}

	private getVisualizerSettings(mode: VisualizerSettingsMode): VisualizerSettings {
		const modeSettings = normalizeVisualizerSettings(this.context.workspaceState.get(visualizerSettingsStorageKeys[mode]));
		const sharedSettings = normalizeVisualizerSettings(this.context.workspaceState.get(sharedVisualizerSettingsStorageKey));

		return {
			...modeSettings,
			colors: hasVisualizerColors(sharedSettings.colors) ? sharedSettings.colors : modeSettings.colors,
			heatmapToggleVisible: sharedSettings.heatmapToggleVisible,
			orphanToggleVisible: modeSettings.orphanToggleVisible,
			heatmapMediumThreshold: sharedSettings.heatmapMediumThreshold,
			heatmapHighThreshold: sharedSettings.heatmapHighThreshold,
			heatmapBaselineModel: sharedSettings.heatmapBaselineModel,
		};
	}

	private async saveVisualizerSettings(message: Record<string, unknown>): Promise<void> {
		const mode = message.mode === 'window' ? 'window' : 'activity';
		const settings = normalizeVisualizerSettings(message.settings);
		const existingModeSettings = normalizeVisualizerSettings(this.context.workspaceState.get(visualizerSettingsStorageKeys[mode]));
		const existingSharedSettings = normalizeVisualizerSettings(this.context.workspaceState.get(sharedVisualizerSettingsStorageKey));
		const modeSettings: VisualizerSettings = {
			...existingModeSettings,
			sideBySideLayout: settings.sideBySideLayout,
			documentationLinksHidden: settings.documentationLinksHidden,
			nodeScale: settings.nodeScale,
			textScale: settings.textScale,
			orphanToggleVisible: settings.orphanToggleVisible,
		};
		const sharedSettings: VisualizerSettings = {
			...existingSharedSettings,
			colors: settings.colors,
			heatmapToggleVisible: settings.heatmapToggleVisible,
			heatmapMediumThreshold: settings.heatmapMediumThreshold,
			heatmapHighThreshold: settings.heatmapHighThreshold,
			heatmapBaselineModel: settings.heatmapBaselineModel,
		};

		await Promise.all([
			this.context.workspaceState.update(visualizerSettingsStorageKeys[mode], modeSettings),
			this.context.workspaceState.update(sharedVisualizerSettingsStorageKey, sharedSettings),
		]);
	}

	refresh(): void {
		if (!this.webviewView && !this.popoutPanel) {
			return;
		}

		void this.postMessageToWebviews({ type: 'graph:loading' });

		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}

		this.refreshTimer = setTimeout(() => {
			void this.postGraph();
		}, 100);
	}

	private async postGraph(): Promise<void> {
		if (!this.webviewView && !this.popoutPanel) {
			return;
		}

		try {
			this.scanner.beginRefresh();
			const [files, mcpServers, hookConfigs] = await Promise.all([this.scanner.scan(), this.scanner.scanMcpServers(), this.scanner.scanHookConfigs()]);
			const graph = mapWorkspaceFilesToGraph(files, mcpServers, hookConfigs);
			graph.availableTools = this.getAvailableTools(graph);
			graph.availableModels = await this.getAvailableModels(graph);
			this.cachedGraph = graph;
			this.updateDiagnostics(files, graph, this.scanner.getReadProblems());

			await this.postCachedGraph();
		} catch (error) {
			await this.postMessageToWebviews({
				type: 'graph:error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private updateDiagnostics(files: WorkspaceAiFile[], graph: GraphJson, readProblems: ReadProblem[]): void {
		const diagnosticsByUri = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

		const addDiagnostic = (uriValue: string, message: string, severity = vscode.DiagnosticSeverity.Warning) => {
			const uri = vscode.Uri.parse(uriValue);
			const key = uri.toString();
			const entry = diagnosticsByUri.get(key) || { uri, diagnostics: [] };
			const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message, severity);

			diagnostic.source = 'AI Customization Visualizer';
			entry.diagnostics.push(diagnostic);
			diagnosticsByUri.set(key, entry);
		};

		for (const problem of readProblems) {
			const message = problem.details ? `${problem.message}: ${problem.details}` : problem.message;

			addDiagnostic(problem.uri.toString(), message, vscode.DiagnosticSeverity.Error);
		}

		for (const file of files) {
			if ((file.kind === 'agent' || file.kind === 'prompt' || file.kind === 'skill') && !readString(file.frontmatter.name)) {
				addDiagnostic(file.uri, `${capitalize(file.kind)} file is missing a name in frontmatter.`, vscode.DiagnosticSeverity.Error);
			}
		}

		for (const node of graph.nodes) {
			if (node.type === 'skill' && node.uri && node.skillIssues?.length) {
				for (const issue of node.skillIssues) {
					addDiagnostic(node.uri, issue, vscode.DiagnosticSeverity.Error);
				}
			}
		}

		const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
		const unresolvedMessages = new Set<string>();

		for (const link of graph.links) {
			const target = nodeById.get(link.target);

			if (!target?.unresolved || target.type !== 'agent') {
				continue;
			}

			const source = nodeById.get(link.source);
			const uri = source?.uri;

			if (!uri) {
				continue;
			}

			const key = `${uri}:${target.id}`;

			if (unresolvedMessages.has(key)) {
				continue;
			}

			unresolvedMessages.add(key);
			addDiagnostic(uri, `Unresolved agent reference: ${target.label}.`, vscode.DiagnosticSeverity.Error);
		}

		this.diagnostics.clear();

		for (const entry of diagnosticsByUri.values()) {
			this.diagnostics.set(entry.uri, entry.diagnostics);
		}
	}

	private async postCachedGraph(targetWebview?: vscode.Webview): Promise<void> {
		if (!this.cachedGraph) {
			return;
		}

		const message = {
			type: 'graph:update',
			graph: this.cachedGraph,
		};

		if (targetWebview) {
			await targetWebview.postMessage(message);
			return;
		}

		await this.postMessageToWebviews(message);
	}

	private async postWindowModeState(targetWebview?: vscode.Webview): Promise<void> {
		const message = {
			type: 'window-mode:update',
			active: Boolean(this.popoutPanel),
		};

		if (targetWebview) {
			await targetWebview.postMessage(message);
			return;
		}

		await this.postMessageToWebviews(message);
	}

	private async postMessageToWebviews(message: unknown): Promise<void> {
		await Promise.all([
			this.webviewView?.webview.postMessage(message),
			this.popoutPanel?.webview.postMessage(message),
		].filter((promise): promise is Thenable<boolean> => Boolean(promise)));
	}

	private getAvailableTools(graph: GraphJson): AvailableTool[] {
		const tools = new Map<string, AvailableTool>();

		for (const tool of vscode.lm.tools) {
			tools.set(tool.name, {
				name: tool.name,
				description: tool.description,
			});
		}

		for (const tool of graph.availableTools) {
			if (!tools.has(tool.name)) {
				tools.set(tool.name, tool);
			}
		}

		return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name));
	}

	private async getAvailableModels(graph: GraphJson): Promise<AvailableModel[]> {
		const models = new Map<string, AvailableModel>();

		for (const model of await this.getBaseAvailableModels()) {
			models.set(model.value, model);
		}

		for (const node of graph.nodes) {
			if (node.model && !models.has(node.model)) {
				models.set(node.model, {
					label: node.model,
					value: node.model,
				});
			}
		}

		return [...models.values()].sort((left, right) => left.label.localeCompare(right.label));
	}

	private async getBaseAvailableModels(): Promise<AvailableModel[]> {
		const now = Date.now();

		if (this.cachedBaseModels && this.cachedBaseModels.expiresAt > now) {
			return this.cachedBaseModels.models;
		}

		const models = (await vscode.lm.selectChatModels()).map(model => {
			const value = `${model.name} (${model.vendor})`;

			return {
				label: value,
				value,
				maxInputTokens: model.maxInputTokens,
			};
		});

		this.cachedBaseModels = {
			expiresAt: now + 60_000,
			models,
		};

		return models;
	}

	private async openNode(uriValue: unknown): Promise<void> {
		const uri = this.parseWorkspaceUri(uriValue);

		if (!uri) {
			return;
		}

		const existingViewColumn = findOpenTextTabViewColumn(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: false, viewColumn: existingViewColumn });
	}

	private async openDocs(urlValue: unknown): Promise<void> {
		if (typeof urlValue !== 'string') {
			return;
		}

		const allowedUrls = new Set([
			'https://code.visualstudio.com/docs/copilot/customization/custom-instructions',
			'https://code.visualstudio.com/docs/copilot/customization/prompt-files',
			'https://code.visualstudio.com/docs/copilot/customization/custom-agents',
			'https://code.visualstudio.com/docs/copilot/customization/agent-skills',
			'https://code.visualstudio.com/docs/copilot/customization/hooks',
		]);

		if (!allowedUrls.has(urlValue)) {
			return;
		}

		await vscode.env.openExternal(vscode.Uri.parse(urlValue));
	}

	private async openMcpServersView(): Promise<void> {
		try {
			await vscode.commands.executeCommand('workbench.view.extensions');
			await vscode.commands.executeCommand('workbench.extensions.search', '@mcp');
		} catch {
			await vscode.commands.executeCommand('workbench.view.extensions');
		}
	}

	private async saveNode(message: Record<string, unknown>): Promise<void> {
		const uri = this.parseWorkspaceUri(message.uri);

		if (!uri) {
			await this.postError('Unable to save: the selected node is not a workspace file.');
			return;
		}

		if (isHookFilePath(uri.path)) {
			await this.saveHookNode(uri, message);
			return;
		}

		const kind = getFileKind(uri);

		if (!kind) {
			await this.postError('Unable to save: only .agent.md .prompt.md SKILL.md and instruction files can be edited.');
			return;
		}

		const bytes = await vscode.workspace.fs.readFile(uri);
		const rawMarkdown = Buffer.from(bytes).toString('utf8');
		const parsed = matter(rawMarkdown);
		const frontmatter = normalizeFrontmatter(parsed.data);
		const name = readString(message.name);
		const body = kind === 'agent' ? cleanAgentPlaceholderText(message.body, parsed.content) : typeof message.body === 'string' ? message.body : parsed.content;

		if (name) {
			frontmatter.name = name;
		} else {
			delete frontmatter.name;
		}

		if (kind === 'agent') {
			if (message.nodeType === 'handoff') {
				const handoffIndex = readNumber(message.handoffIndex);

				if (handoffIndex === undefined) {
					await this.postError('Unable to save: selected handoff is missing its agent handoff index.');
					return;
				}

					const handoffValidation = validateRequiredHandoffFields([{
						label: message.name,
						agent: message.agent,
						prompt: message.prompt,
						send: message.send,
						model: message.handoffModel ?? message.model,
					}]);

					if (!handoffValidation.ok) {
						await this.postSaveError(`Unable to save: handoff ${handoffValidation.index + 1} is missing ${handoffValidation.field}.`);
						return;
					}

				const handoffs = updateHandoffAtIndex(readArray(frontmatter.handoffs), handoffIndex, message);

				if (handoffs.length) {
					frontmatter.handoffs = handoffs;
				} else {
					delete frontmatter.handoffs;
				}

				const updatedMarkdown = stringifyCustomizationMarkdown(body, frontmatter);

				await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedMarkdown, 'utf8'));
				this.refresh();
				return;
			}

			const handoffs = parseHandoffsInput(message.handoffs);

			if (!handoffs.ok) {
				await this.postError('Unable to save: handoffs must be a JSON array.');
				return;
			}

			const handoffValidation = validateRequiredHandoffFields(handoffs.value);

			if (!handoffValidation.ok) {
				await this.postSaveError(`Unable to save: handoff ${handoffValidation.index + 1} is missing ${handoffValidation.field}.`);
				return;
			}

			const normalizedHandoffs = normalizePostedHandoffs(handoffs.value);

			frontmatter.agents = parseLines(message.agents);
			frontmatter.tools = parseLines(message.tools);
			writeOptionalString(frontmatter, 'model', message.model);
			writeOptionalString(frontmatter, 'description', cleanAgentPlaceholderText(message.description));
			writeOptionalString(frontmatter, 'argument-hint', message.argumentHint);
			frontmatter['user-invocable'] = Boolean(message.userInvocable);
			frontmatter['disable-model-invocation'] = Boolean(message.disableModelInvocation);

			if (normalizedHandoffs.length) {
				frontmatter.handoffs = normalizedHandoffs;
			} else {
				delete frontmatter.handoffs;
			}
		} else if (kind === 'prompt') {
			const agent = readString(message.agent);
			frontmatter.tools = parseLines(message.tools);
			writeOptionalString(frontmatter, 'model', message.model);

			if (agent) {
				frontmatter.agent = agent;
			} else {
				delete frontmatter.agent;
			}
		} else if (kind === 'skill') {
			writeOptionalString(frontmatter, 'description', message.description);
			writeOptionalString(frontmatter, 'argument-hint', message.argumentHint);
			frontmatter['user-invocable'] = Boolean(message.userInvocable);
			frontmatter['disable-model-invocation'] = Boolean(message.disableModelInvocation);

			const skillContext = readSkillContext(message.skillContext);

			if (skillContext) {
				frontmatter.context = skillContext;
			} else {
				delete frontmatter.context;
			}
		} else if (kind === 'instruction') {
			writeOptionalString(frontmatter, 'description', message.description);
			writeOptionalString(frontmatter, 'applyTo', message.applyTo);
		}

		const updatedMarkdown = stringifyCustomizationMarkdown(body, frontmatter);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedMarkdown, 'utf8'));
		this.refresh();
	}

	private async saveHookNode(uri: vscode.Uri, message: Record<string, unknown>): Promise<void> {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const rawJson = Buffer.from(bytes).toString('utf8');
		const parsed = normalizeObject(JSON.parse(rawJson));
		const hooks = normalizeObject(parsed.hooks);
		const hookName = readString(message.name);
		const hookCommands = readPostedHookCommands(message.hookCommands);

		if (hookName) {
			parsed.name = hookName;
		} else {
			delete parsed.name;
		}

		const existingCommands = collectHookCommandObjects(hooks);
		const nextHooks: Record<string, unknown> = {};

		for (const hookCommand of hookCommands) {
			const eventEntries = readHookEventArray(nextHooks, hookCommand.event);
			const properties = normalizePostedHookCommandProperties(hookCommand.properties);

			if (!Object.keys(properties).length) {
				nextHooks[hookCommand.event] = eventEntries;
				continue;
			}

			const existingCommand = existingCommands.get(hookCommand.id) || {};
			const updatedCommand = removeHookCommandProperties({ ...existingCommand, type: 'command' });

			for (const [property, value] of Object.entries(properties)) {
				updatedCommand[property] = value;
			}

			eventEntries.push(updatedCommand);
			nextHooks[hookCommand.event] = eventEntries;
		}

		parsed.hooks = nextHooks;

		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(parsed, null, '\t')}\n`, 'utf8'));
		this.refresh();
	}

	private async createCustomization(message: Record<string, unknown>): Promise<void> {
		if (message.kind === 'mcp') {
			await this.openMcpServersView();
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const kind = message.kind === 'prompt' ? 'prompt' : message.kind === 'agent' ? 'agent' : message.kind === 'skill' ? 'skill' : message.kind === 'hook' ? 'hook' : message.kind === 'instruction' ? 'instruction' : undefined;
		const instructionType = kind === 'instruction' ? readInstructionCustomizationType(message.instructionType) : undefined;
		const displayName = readString(message.name);

		if (!workspaceFolder) {
			await this.postSaveError('Unable to create: open a workspace folder first.');
			return;
		}

		if (!kind) {
			await this.postSaveError('Unable to create: choose Instruction Agent Prompt Skill or Hook.');
			return;
		}

		if (!displayName) {
			await this.postSaveError('Unable to create: enter a name.');
			return;
		}

		const baseFolderUri = getCustomizationFolderUri(workspaceFolder.uri, kind, instructionType);
		const folderUri = kind === 'skill' ? vscode.Uri.joinPath(baseFolderUri, getSkillFolderName(displayName)) : baseFolderUri;
		const uri = vscode.Uri.joinPath(folderUri, getCustomizationFileName(kind, displayName, instructionType));
		const folderStat = await getFileStat(folderUri);

		if (await fileExists(uri)) {
			await this.postSaveError(`Unable to create: ${vscode.workspace.asRelativePath(uri, false)} already exists.`);
			return;
		}

		if (folderStat && !(folderStat.type & vscode.FileType.Directory)) {
			await this.postSaveError(`Unable to create: ${vscode.workspace.asRelativePath(folderUri, false)} already exists and is not a folder.`);
			return;
		}

		try {
			await vscode.workspace.fs.createDirectory(folderUri);
			const content = kind === 'hook' ? createHookCustomizationJson(displayName) : createCustomizationMarkdown(kind, displayName, instructionType);

			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
			await this.openNode(uri.toString());
			this.refresh();
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);

			await this.postSaveError(`Unable to create: ${details}`);
		}
	}

	private parseWorkspaceUri(value: unknown): vscode.Uri | undefined {
		if (typeof value !== 'string') {
			return undefined;
		}

		const uri = vscode.Uri.parse(value);
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

		return workspaceFolder ? uri : undefined;
	}

	private async postError(message: string): Promise<void> {
		await this.postMessageToWebviews({
			type: 'graph:error',
			message,
		});
	}

	private async postSaveError(message: string): Promise<void> {
		await this.postMessageToWebviews({
			type: 'save:error',
			message,
		});
	}

	private getHtml(webview: vscode.Webview, isWindowModeView: boolean): string {
		const nonce = getNonce();
		const settings = this.getVisualizerSettings(isWindowModeView ? 'window' : 'activity');
		const colorPickerControls = visualizerColorDefinitions.map(definition => '<label class="color-control" title="' + definition.description + '"><span><strong>' + definition.label + '</strong><small>' + definition.description + '</small></span><input class="color-picker" type="color" data-color-key="' + definition.key + '" value="' + (settings.colors[definition.key] || colorPickerFallbackColors[definition.key]) + '"></label>').join('');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Copilot AI Customization Visualizer</title>
	<style>
		:root {
			color-scheme: light dark;
			--panel-border: color-mix(in srgb, var(--vscode-sideBar-foreground) 18%, transparent);
			--agent: ${settings.colors.agent || visualizerDefaultCssValues.agent};
			--prompt: ${settings.colors.prompt || visualizerDefaultCssValues.prompt};
			--skill: ${settings.colors.skill || visualizerDefaultCssValues.skill};
			--instruction: ${settings.colors.instruction || visualizerDefaultCssValues.instruction};
			--mcp: ${settings.colors.mcp || visualizerDefaultCssValues.mcp};
			--hook: ${settings.colors.hook || visualizerDefaultCssValues.hook};
			--hook-event: ${settings.colors['hook-event'] || visualizerDefaultCssValues['hook-event']};
			--handoff: ${settings.colors.handoff || visualizerDefaultCssValues.handoff};
			--tool: ${settings.colors.tool || visualizerDefaultCssValues.tool};
			--edge: ${settings.colors.edge || visualizerDefaultCssValues.edge};
			--marker: ${settings.colors.marker || visualizerDefaultCssValues.marker};
			--marker-background: ${settings.colors['marker-background'] || visualizerDefaultCssValues['marker-background']};
			--marker-accent: ${settings.colors['marker-accent'] || visualizerDefaultCssValues['marker-accent']};
			--selection: ${settings.colors.selection || visualizerDefaultCssValues.selection};
			--graph-background: ${settings.colors['graph-background'] || visualizerDefaultCssValues['graph-background']};
		}

		html {
			scrollbar-gutter: stable;
		}

		body {
			margin: 0;
			padding: 12px;
			color: var(--vscode-sideBar-foreground);
			background: var(--vscode-sideBar-background);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}

		.toolbar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 12px;
		}

		.toolbar h2 {
			margin: 0;
			font-size: 13px;
			font-weight: 600;
		}

		.toolbar-actions {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
		}

		button {
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 4px;
			padding: 4px 9px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			font: inherit;
			cursor: pointer;
		}

		button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.window-mode-button {
			display: inline-flex;
			align-items: center;
			gap: 7px;
			min-height: 26px;
			border-color: var(--panel-border);
			border-radius: 14px;
			padding: 3px 8px 3px 4px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-sideBar-foreground));
			font-weight: 600;
		}

		.window-mode-button[aria-checked="true"] {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-button-background) 24%, var(--vscode-sideBar-background));
		}

		.window-mode-button:hover {
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 18%, var(--vscode-sideBar-background));
		}

		.window-mode-button[aria-checked="true"]:hover {
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 34%, var(--vscode-sideBar-background));
		}

		.switch-track {
			position: relative;
			display: inline-flex;
			align-items: center;
			width: 34px;
			height: 18px;
			border-radius: 999px;
			background: color-mix(in srgb, var(--vscode-descriptionForeground) 48%, transparent);
			box-shadow: inset 0 0 0 1px var(--panel-border);
			transition: background 120ms ease;
		}

		.switch-thumb {
			position: absolute;
			left: 2px;
			width: 14px;
			height: 14px;
			border-radius: 50%;
			background: var(--vscode-sideBar-background);
			box-shadow: 0 1px 3px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.28));
			transition: transform 120ms ease, background 120ms ease;
		}

		.window-mode-button[aria-checked="true"] .switch-track {
			background: var(--vscode-button-background);
		}

		.window-mode-button[aria-checked="true"] .switch-thumb {
			transform: translateX(16px);
			background: var(--vscode-button-foreground);
		}

		.switch-label {
			line-height: 1;
		}

		.refresh-button,
		.about-button,
		.settings-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			border-color: var(--panel-border);
			border-radius: 50%;
			padding: 0;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-sideBar-foreground));
		}

		.new-node-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			border-color: var(--panel-border);
			border-radius: 50%;
			padding: 0;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-sideBar-foreground));
		}

		.new-node-icon {
			display: block;
			width: 16px;
			height: 16px;
			stroke: currentColor;
		}

		.new-node-button:hover {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 22%, var(--vscode-sideBar-background));
		}

		.refresh-button:hover,
		.about-button:hover,
		.settings-button:hover {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 22%, var(--vscode-sideBar-background));
		}

		.about-button {
			font-weight: 700;
			line-height: 1;
		}

		.refresh-icon,
		.settings-icon {
			display: block;
			width: 16px;
			height: 16px;
			stroke: currentColor;
		}

		.status {
			position: absolute;
			left: 8px;
			bottom: 6px;
			z-index: 1;
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
			line-height: 1;
			pointer-events: none;
			white-space: nowrap;
		}

		.visualizer {
			margin-bottom: 12px;
		}

		.size-control {
			display: grid;
			grid-template-columns: auto minmax(120px, 1fr) 36px;
			align-items: center;
			gap: 8px;
			width: min(280px, 100%);
			margin-bottom: 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.size-control input {
			width: 100%;
		}

		.threshold-control input[type="number"] {
			box-sizing: border-box;
			width: 70px;
			margin: 0;
			border: 1px solid var(--vscode-input-border, var(--panel-border));
			border-radius: 3px;
			padding: 5px 6px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			font: inherit;
			font-variant-numeric: tabular-nums;
		}

		.size-value {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}

		.settings-toggle {
			display: flex;
			align-items: center;
			gap: 8px;
			width: fit-content;
			margin-bottom: 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.settings-toggle input[type="checkbox"] {
			display: inline-block;
			flex: 0 0 auto;
			width: auto;
			margin: 0;
		}

		.settings-toggle span {
			line-height: 1.2;
		}

		.legend {
			display: flex;
			flex-wrap: wrap;
			gap: 5px 8px;
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.legend span {
			display: inline-flex;
			align-items: center;
			gap: 4px;
		}

		.swatch {
			width: 9px;
			height: 9px;
			border-radius: 50%;
		}

		.graph {
			position: relative;
			width: 100%;
			min-height: 320px;
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			background: var(--graph-background);
			overflow: hidden;
		}

		.graph-overlay {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			z-index: 1;
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 5px 10px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 80%, transparent);
			pointer-events: none;
		}

		.layout-control {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			margin-left: auto;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			pointer-events: auto;
		}

		.graph-toggle {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 2px 6px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-sideBar-foreground));
			font: inherit;
			font-size: 11px;
			pointer-events: auto;
			cursor: pointer;
		}

		.graph-toggle:has(input:checked) {
			border-color: var(--selection);
			background: color-mix(in srgb, var(--vscode-button-background) 28%, var(--vscode-sideBar-background));
		}

		.graph-toggle input {
			width: auto;
			margin: 0;
		}

		.graph-toggle:hover {
			border-color: var(--selection);
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 22%, var(--vscode-sideBar-background));
		}

		.layout-control select {
			min-width: 112px;
			border: 1px solid var(--vscode-dropdown-border, var(--panel-border));
			border-radius: 4px;
			padding: 2px 5px;
			color: var(--vscode-dropdown-foreground);
			background: var(--vscode-dropdown-background);
			font: inherit;
		}

		.graph svg {
			display: block;
			cursor: grab;
			user-select: none;
		}

		.graph svg.is-panning {
			cursor: grabbing;
		}

		.loading-overlay {
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 72%, transparent);
			z-index: 2;
			pointer-events: none;
		}

		.plant-loader {
			display: grid;
			place-items: center;
			gap: 6px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.plant-loader svg {
			width: 34px;
			height: 34px;
			overflow: visible;
		}

		.plant-loader .sprout-stem {
			stroke: var(--vscode-charts-green);
			stroke-dasharray: 18;
			transform-origin: 12px 19px;
			animation: growStem 1100ms ease-in-out infinite;
		}

		.plant-loader .sprout-branch {
			fill: none;
			stroke: var(--vscode-charts-green);
			stroke-dasharray: 9;
			stroke-linecap: round;
			stroke-linejoin: round;
			animation: growBranch 1100ms ease-in-out infinite;
		}

		.plant-loader .sprout-leaf {
			fill: color-mix(in srgb, var(--vscode-charts-green) 82%, var(--vscode-sideBar-background));
			stroke: var(--vscode-charts-green);
			transform-box: view-box;
			animation: growLeaf 1100ms ease-in-out infinite;
		}

		.plant-loader .sprout-left-branch,
		.plant-loader .sprout-left {
			transform-origin: 12px 15px;
		}

		.plant-loader .sprout-right-branch,
		.plant-loader .sprout-right {
			transform-origin: 12px 13.6px;
			animation-delay: 90ms;
		}

		.plant-loader .sprout-soil {
			stroke: var(--vscode-descriptionForeground);
			opacity: 0.8;
		}

		@keyframes growStem {
			0%, 100% {
				stroke-dashoffset: 18;
				transform: scaleY(0.82);
			}

			50% {
				stroke-dashoffset: 0;
				transform: scaleY(1);
			}
		}

		@keyframes growBranch {
			0%, 100% {
				stroke-dashoffset: 9;
				opacity: 0.25;
			}

			50% {
				stroke-dashoffset: 0;
				opacity: 1;
			}
		}

		@keyframes growLeaf {
			0%, 100% {
				transform: scale(0.2);
				opacity: 0.25;
			}

			50% {
				transform: scale(1);
				opacity: 1;
			}
		}

		.content-shell {
			position: relative;
		}

		.error-toast {
			position: fixed;
			right: 14px;
			bottom: 14px;
			z-index: 30;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: start;
			gap: 10px;
			box-sizing: border-box;
			width: min(420px, calc(100vw - 28px));
			border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 58%, var(--panel-border));
			border-radius: 6px;
			padding: 10px 10px 10px 12px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-editorWidget-background) 94%, var(--vscode-errorForeground));
			box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
			font-size: 12px;
			line-height: 1.35;
		}

		.error-toast[hidden] {
			display: none;
		}

		.error-toast-message {
			min-width: 0;
			overflow-wrap: anywhere;
		}

		.error-toast-close {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 22px;
			height: 22px;
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 0;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, var(--vscode-errorForeground));
			font: inherit;
			line-height: 1;
			cursor: pointer;
		}

		.error-toast-close:hover {
			border-color: var(--vscode-errorForeground);
		}

		.workspace-panels.side-by-side.has-editor {
			display: grid;
			grid-template-columns: minmax(320px, 1.15fr) minmax(280px, 0.85fr);
			gap: 12px;
			align-items: start;
		}

		.workspace-panels.side-by-side.has-editor .visualizer,
		.workspace-panels.side-by-side.has-editor .editor {
			min-width: 0;
		}

		.workspace-panels.side-by-side.has-editor .visualizer {
			margin-bottom: 0;
		}

		.workspace-panels.side-by-side.has-editor .editor {
			margin-top: 0;
		}

		.content-shell.inactive .visualizer,
		.content-shell.inactive .graph,
		.content-shell.inactive .editor,
		.content-shell.inactive .legend,
		.content-shell.inactive .status {
			opacity: 0.35;
			pointer-events: none;
		}

		.inactive-overlay {
			position: absolute;
			inset: 26px 0 auto;
			z-index: 4;
			display: flex;
			justify-content: center;
			pointer-events: none;
		}

		.inactive-overlay[hidden] {
			display: none;
		}

		.inactive-message {
			max-width: min(260px, calc(100% - 24px));
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			padding: 8px 10px;
			color: var(--vscode-sideBar-foreground);
			background: var(--vscode-sideBar-background);
			box-shadow: 0 8px 18px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.22));
			font-size: 11px;
			text-align: center;
		}

		.editor {
			--editor-text-size: var(--vscode-font-size);
			margin-top: 12px;
			padding: 12px;
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--vscode-sideBar-foreground));
		}

		.editor[hidden] {
			display: none;
		}

		.editor-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 10px;
		}

		.editor-title {
			min-width: 0;
		}

		.editor-title h3 {
			margin: 0 0 2px;
			font-size: 13px;
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.editor-title p {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.editor-actions {
			display: flex;
			gap: 6px;
			flex-shrink: 0;
		}

		.editor-body[hidden] {
			display: none;
		}

		.collapse-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			border-color: var(--panel-border);
			border-radius: 50%;
			padding: 0;
			color: var(--vscode-sideBar-foreground);
			background: var(--vscode-button-secondaryBackground, transparent);
		}

		.collapse-button:hover {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 20%, var(--vscode-sideBar-background));
		}

		.collapse-icon {
			width: 16px;
			height: 16px;
			stroke: currentColor;
		}

		.editor label {
			display: block;
			margin-bottom: 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.label-text {
			display: inline-flex;
			align-items: center;
			gap: 4px;
		}

		.help-marker {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 13px;
			height: 13px;
			border: 1px solid var(--panel-border);
			border-radius: 50%;
			color: var(--vscode-descriptionForeground);
			font-size: 9px;
			line-height: 1;
			cursor: help;
		}

		.editor input,
		.editor select,
		.editor textarea {
			box-sizing: border-box;
			display: block;
			width: 100%;
			margin-top: 4px;
			border: 1px solid var(--vscode-input-border, var(--panel-border));
			border-radius: 3px;
			padding: 5px 6px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			font: inherit;
			font-size: var(--editor-text-size);
		}

		.editor input[type="checkbox"] {
			display: inline-block;
			width: auto;
			margin: 0 6px 0 0;
			vertical-align: middle;
		}

		.checkbox-label {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.field-row {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 8px;
		}

		.field-label {
			margin-bottom: 6px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.editor textarea {
			min-height: 86px;
			resize: vertical;
			font-family: var(--vscode-editor-font-family);
		}

		.editor .body-field {
			min-height: 140px;
		}

		.editor .compact-field {
			min-height: 52px;
		}

		.docs-link {
			display: inline-flex;
			margin: 0 0 10px;
			border: 0;
			padding: 0;
			color: var(--vscode-textLink-foreground);
			background: transparent;
			font-size: 11px;
			text-decoration: underline;
		}

		.docs-link:hover {
			color: var(--vscode-textLink-activeForeground);
			background: transparent;
		}

		.about-info {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin: 0 0 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.about-info strong {
			color: var(--vscode-sideBar-foreground);
			font-weight: 600;
		}

		.docs-info {
			display: flex;
			flex-wrap: wrap;
			gap: 6px 12px;
			margin-bottom: 10px;
			padding: 8px 10px;
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 97%, var(--vscode-sideBar-foreground));
		}

		.docs-info[hidden],
		.docs-info.documentation-links-hidden {
			display: none;
		}

		.docs-info .docs-link {
			margin: 0;
		}

		.dialog-backdrop {
			position: fixed;
			inset: 0;
			display: flex;
			align-items: flex-start;
			justify-content: flex-end;
			padding: 44px 12px 12px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 45%, transparent);
			z-index: 10;
		}

		.dialog-backdrop[hidden] {
			display: none;
		}

		.new-dialog {
			width: min(260px, calc(100vw - 24px));
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			padding: 10px;
			background: var(--vscode-sideBar-background);
			box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.24));
		}

		.settings-dialog {
			box-sizing: border-box;
			width: min(560px, calc(100vw - 24px));
			max-height: calc(100vh - 68px);
			padding: 12px;
			overflow-y: auto;
		}

		.settings-dialog h3 {
			margin-bottom: 10px;
		}

		.settings-section {
			display: grid;
			gap: 8px;
			margin-bottom: 12px;
			border: 1px solid var(--panel-border);
			border-radius: 6px;
			padding: 10px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--vscode-sideBar-foreground));
		}

		.settings-section h4 {
			margin: 0;
			color: var(--vscode-sideBar-foreground);
			font-size: 12px;
			font-weight: 600;
		}

		.settings-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
			gap: 8px 12px;
		}

		.settings-subsection {
			display: grid;
			gap: 8px;
			border: 1px solid var(--panel-border);
			border-radius: 5px;
			padding: 8px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 98%, var(--vscode-sideBar-foreground));
		}

		.settings-subsection-title {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			font-weight: 600;
		}

		.settings-checkbox-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
			align-items: center;
			gap: 8px 12px;
		}

		.settings-slider-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
			align-items: center;
			gap: 8px 12px;
		}

		.threshold-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
			gap: 8px;
		}

		.heatmap-model-control {
			display: grid;
			gap: 4px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.heatmap-model-control select {
			box-sizing: border-box;
			width: 100%;
			border: 1px solid var(--vscode-input-border, var(--panel-border));
			border-radius: 3px;
			padding: 5px 6px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			font: inherit;
		}

		.settings-dialog .size-control,
		.settings-dialog .settings-toggle,
		.settings-dialog .threshold-control,
		.settings-dialog .heatmap-model-control {
			width: 100%;
			margin: 0;
		}

		.threshold-control {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 6px;
			border: 1px solid var(--panel-border);
			border-radius: 5px;
			padding: 7px 8px;
			color: var(--vscode-descriptionForeground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 98%, var(--vscode-sideBar-foreground));
			font-size: 11px;
		}

		.threshold-control strong,
		.threshold-control small {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.threshold-control strong {
			color: var(--vscode-sideBar-foreground);
			font-weight: 600;
		}

		.threshold-input-wrap {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			justify-self: end;
		}

		.threshold-unit {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 12px;
			color: var(--vscode-descriptionForeground);
			font-variant-numeric: tabular-nums;
			line-height: 1;
		}

		.color-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(158px, 1fr));
			gap: 8px;
		}

		.color-control {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 34px;
			align-items: center;
			gap: 8px;
			margin: 0;
			border: 1px solid var(--panel-border);
			border-radius: 5px;
			padding: 7px 8px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 98%, var(--vscode-sideBar-foreground));
		}

		.color-control span {
			min-width: 0;
		}

		.color-control strong,
		.color-control small {
			display: block;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.color-control strong {
			color: var(--vscode-sideBar-foreground);
			font-size: 11px;
			font-weight: 600;
		}

		.color-control small {
			margin-top: 2px;
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
		}

		.color-control input[type="color"] {
			box-sizing: border-box;
			width: 32px;
			height: 28px;
			margin: 0;
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 2px;
			background: var(--vscode-input-background);
			cursor: pointer;
		}

		.new-dialog h3 {
			margin: 0 0 8px;
			font-size: 13px;
			font-weight: 600;
		}

		.new-dialog label {
			display: block;
			margin-bottom: 8px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.new-dialog [hidden] {
			display: none;
		}

		.new-dialog input,
		.new-dialog select {
			box-sizing: border-box;
			display: block;
			width: 100%;
			margin-top: 4px;
			border: 1px solid var(--vscode-input-border, var(--panel-border));
			border-radius: 3px;
			padding: 5px 6px;
			color: var(--vscode-input-foreground);
			background: var(--vscode-input-background);
			font: inherit;
		}

		.new-dialog .color-control {
			display: grid;
			margin: 0;
		}

		.new-dialog .color-control input[type="color"] {
			display: block;
			width: 32px;
			height: 28px;
			margin: 0;
			padding: 2px;
		}

		.dialog-actions {
			display: flex;
			justify-content: flex-end;
			gap: 6px;
		}

		.choice-details {
			margin: 0 0 10px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.choice-details summary {
			cursor: pointer;
			user-select: none;
		}

		.choice-details summary .selected-tools {
			padding-left: 14px;
		}

		.choice-details[open] > summary .selected-tools {
			display: none;
		}

		.choice-list {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
			gap: 6px;
			max-height: 170px;
			margin-top: 8px;
			overflow-x: hidden;
			overflow-y: auto;
		}

		.tool-choice-list {
			grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
			max-height: 300px;
			gap: 8px;
		}

		.tool-filter {
			margin-top: 8px;
		}

		.tool-preset-list {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 8px;
		}

		.tool-preset-button {
			min-height: 22px;
			border-color: var(--panel-border);
			padding: 2px 7px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-sideBar-foreground));
			font-size: 10px;
		}

		.tool-preset-button:hover {
			border-color: var(--vscode-focusBorder);
			background: color-mix(in srgb, var(--vscode-button-hoverBackground) 20%, var(--vscode-sideBar-background));
		}

		.tool-filter input {
			margin-top: 0;
		}

		.selected-tools {
			display: flex;
			flex-wrap: wrap;
			gap: 5px;
			margin-top: 8px;
		}

		.selected-tools.empty-tools {
			gap: 0;
			margin-top: 3px;
		}

		.tool-pill {
			display: inline-flex;
			align-items: center;
			max-width: 100%;
			border: 1px solid var(--panel-border);
			border-radius: 999px;
			padding: 2px 7px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-sideBar-foreground));
			font-size: 10px;
			line-height: 1.4;
		}

		.tool-pill.empty {
			border-color: transparent;
			padding: 0;
			color: var(--vscode-descriptionForeground);
			background: transparent;
			line-height: 1.2;
		}

		.choice-check {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			gap: 6px;
			min-width: 0;
			margin: 0;
			padding: 4px 6px;
			border: 1px solid var(--panel-border);
			border-radius: 3px;
			font-size: 11px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 98%, var(--vscode-sideBar-foreground));
		}

		.choice-check[hidden] {
			display: none;
		}

		.choice-check .choice-name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.choice-check input {
			flex-shrink: 0;
		}

		.choice-check .help-marker {
			flex-shrink: 0;
			margin-left: auto;
		}

		.tool-choice-list .choice-check {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			gap: 8px;
			align-items: center;
			min-height: 34px;
			padding: 6px 8px;
		}


		${toolChoiceHiddenCssRule}

		.tool-choice-list .choice-check .help-marker {
			margin-left: 0;
		}

		.custom-tool-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 6px;
			margin-top: 8px;
		}

		.custom-tool-row input {
			margin-top: 0;
		}

		.choice-empty {
			margin: 6px 0 10px;
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
		}

		.editor-note {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.hook-event-list {
			display: grid;
			gap: 6px;
			margin: 10px 0;
		}

		.hook-event-item {
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 7px 8px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--vscode-sideBar-foreground));
		}

		.hook-event-title {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
			margin-bottom: 4px;
			font-weight: 600;
		}

		.hook-event-description {
			margin: 0;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}

		.hook-event-reference {
			display: grid;
			gap: 6px;
			margin-top: 10px;
		}

		.hook-event-reference label {
			margin: 0;
		}

		.hook-event-summary {
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 7px 8px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--hook));
		}

		.hook-command-section {
			display: grid;
			gap: 8px;
			margin-top: 12px;
		}

		.hook-command-section h4 {
			margin: 0;
			font-size: 12px;
			font-weight: 600;
		}

		.hook-command-list {
			display: grid;
			gap: 8px;
		}

		.hook-command-item {
			display: grid;
			grid-template-columns: minmax(160px, 1fr);
			gap: 8px;
			border: 1px solid var(--panel-border);
			border-radius: 4px;
			padding: 8px;
			background: color-mix(in srgb, var(--vscode-sideBar-background) 96%, var(--vscode-sideBar-foreground));
		}

		.hook-command-item label {
			margin: 0;
		}

		.handoff-item-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}

		.handoff-item-header span {
			color: var(--vscode-sideBar-foreground);
			font-size: 12px;
			font-weight: 600;
		}

		.hook-command-actions {
			display: flex;
			justify-content: flex-end;
		}

		.hook-property-list {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(92px, max-content));
			gap: 6px;
		}

		.hook-property-row {
			display: grid;
			grid-column: 1 / -1;
			grid-template-columns: minmax(110px, 0.3fr) minmax(160px, 1fr);
			gap: 8px;
			align-items: center;
		}

		.hook-property-row.is-inactive {
			display: inline-flex;
			grid-column: auto;
			min-height: 22px;
		}

		.hook-property-row .checkbox-label {
			margin: 0;
		}

		.hook-property-row.is-inactive .checkbox-label {
			min-width: 0;
		}

		.hook-property-row.is-inactive .edit-hook-property-value,
		.edit-hook-property-value[hidden] {
			display: none;
		}

		.hook-property-row input[type="text"] {
			font-family: var(--vscode-editor-font-family);
		}

		.hook-pill {
			display: inline-flex;
			align-items: center;
			border: 1px solid var(--panel-border);
			border-radius: 999px;
			padding: 1px 6px;
			color: var(--vscode-sideBar-foreground);
			background: color-mix(in srgb, var(--vscode-sideBar-background) 90%, var(--hook));
			font-size: 10px;
			font-weight: 500;
		}

		.empty {
			padding: 28px 12px;
			border: 1px dashed var(--panel-border);
			border-radius: 6px;
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}

		.edge {
			stroke: var(--edge);
			stroke-width: 1.4;
			stroke-opacity: 0.65;
		}

		.edge-arrow {
			fill: var(--edge);
			opacity: 0.72;
		}

		.node .node-shape {
			stroke: var(--vscode-sideBar-background);
			stroke-width: 2;
		}

		.node .node-backer {
			fill: var(--vscode-sideBar-background);
			stroke: none;
		}

		.node .instruction-area {
			opacity: 0.9;
		}

		.node {
			cursor: pointer;
		}

		.node:hover .node-shape,
		.node.selected .node-shape {
			stroke: var(--selection);
			stroke-width: 3;
		}

		.node-skill.model-invocable:not(.selected):not(:hover) .node-shape {
			stroke: var(--agent);
			stroke-width: 3;
		}

		.node text {
			fill: var(--vscode-sideBar-foreground);
			font-size: 11px;
			paint-order: stroke;
			stroke: var(--vscode-sideBar-background);
			stroke-width: 3px;
			stroke-linejoin: round;
		}

		.node .model-label {
			fill: var(--vscode-descriptionForeground);
			font-size: 9px;
			stroke-width: 1.6px;
		}

		.node .context-label {
			fill: var(--vscode-descriptionForeground);
			font-size: 9px;
			stroke-width: 1.6px;
		}

		.node .audience-label {
			fill: var(--vscode-sideBar-foreground);
			font-size: 9px;
			stroke-width: 1.8px;
		}

		.node .hook-event-count {
			fill: var(--vscode-descriptionForeground);
			font-size: 8px;
			stroke: var(--vscode-sideBar-background);
			stroke-width: 2px;
		}

		.node-instruction text,
		.node-instruction .audience-label {
			fill: #ffffff;
			stroke: color-mix(in srgb, var(--instruction) 55%, #000000);
			stroke-width: 2.2px;
		}

		.agent-marker {
			pointer-events: none;
		}

		.agent-marker .marker-fill {
			fill: var(--marker-background);
			stroke: var(--marker);
			stroke-width: 1.2;
		}

		.agent-marker .marker-line {
			fill: none;
			stroke: var(--marker);
			stroke-width: 1.2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.agent-marker .marker-dot,
		.agent-marker .marker-star {
			fill: var(--marker);
			stroke: none;
		}

		.agent-marker .marker-star {
			fill: var(--marker-accent);
			stroke: var(--marker-background);
			stroke-width: 0.6;
		}

		.cog-marker .marker-line {
			stroke: var(--marker);
		}

		.cog-marker .marker-fill {
			fill: transparent;
			stroke: var(--marker);
		}

		.cog-marker .marker-dot {
			fill: var(--marker);
		}

		.skill-marker {
			pointer-events: none;
		}

		.skill-marker .marker-line {
			fill: none;
			stroke: var(--marker);
			stroke-width: 1.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.skill-context-marker {
			pointer-events: none;
		}

		.skill-context-marker .marker-badge {
			fill: var(--marker-background);
			stroke: var(--marker);
			stroke-width: 0.9;
		}

		.skill-context-marker .marker-line {
			fill: none;
			stroke: var(--marker);
			stroke-width: 1.4;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.skill-context-marker .marker-star {
			fill: var(--marker-accent);
			stroke: var(--marker-background);
			stroke-width: 0.7;
		}

		.mcp-marker {
			pointer-events: none;
		}

		.mcp-marker .marker-line {
			fill: none;
			stroke: var(--marker-background);
			stroke-width: 1.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.mcp-marker .marker-fill {
			fill: var(--marker-background);
			stroke: var(--marker-background);
			stroke-width: 1;
		}

		.hook-marker {
			pointer-events: none;
		}

		.hook-marker .marker-line {
			fill: none;
			stroke: var(--marker);
			stroke-width: 3.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		.hook-marker .marker-fill {
			fill: var(--marker);
			stroke: none;
		}

		.hook-marker .marker-hole {
			fill: var(--hook);
			stroke: none;
		}

		.node.unresolved .node-shape {
			stroke: #ff0000;
			stroke-dasharray: 3 2;
		}

		.node.orphan .node-shape {
			stroke: var(--vscode-charts-yellow, #f2c744);
			stroke-width: 2.4px;
			stroke-dasharray: 2 2;
		}

		.node.heatmap .node-shape {
			stroke: var(--edge);
			stroke-width: 1.4px;
		}

		.heatmap-glow {
			pointer-events: none;
			stroke: none;
		}

		.heatmap-low {
			fill: #4aa36b;
			opacity: 0.24;
			filter: drop-shadow(0 0 4px #4aa36b);
		}

		.heatmap-medium {
			fill: #d88a4f;
			opacity: 0.34;
			filter: drop-shadow(0 0 7px #d88a4f);
		}

		.heatmap-high {
			fill: #d84f4f;
			opacity: 0.46;
			filter: drop-shadow(0 0 11px #d84f4f);
		}

		@media (max-width: 420px) {
			.field-row {
				grid-template-columns: 1fr;
			}
		}

		@media (max-width: 720px) {
			.workspace-panels.side-by-side.has-editor {
				display: block;
			}

			.workspace-panels.side-by-side.has-editor .visualizer {
				margin-bottom: 12px;
			}

			.workspace-panels.side-by-side.has-editor .editor {
				margin-top: 12px;
			}
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<h2>Copilot AI Customization Visualizer</h2>
		<div class="toolbar-actions">
			<button id="new-file" class="new-node-button" title="Create a new instruction agent prompt or skill" aria-label="Create a new instruction agent prompt or skill"><svg class="new-node-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke-width="2.4" stroke-linecap="round"></path></svg></button>
			<button id="popout" class="window-mode-button" title="Open visualizer in a separate VS Code window" role="switch" aria-checked="false"><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span><span class="switch-label">Window-mode</span></button>
			<button id="about" class="about-button" title="About Copilot AI Customization Visualizer" aria-label="About Copilot AI Customization Visualizer">?</button>
			<button id="settings" class="settings-button" title="Visualizer settings" aria-label="Visualizer settings"><svg class="settings-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
			<button id="refresh" class="refresh-button" title="Refresh graph" aria-label="Refresh graph"><svg class="refresh-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M20 6v5h-5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4 18v-5h5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M19 11a7 7 0 0 0-12-4l-3 3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M5 13a7 7 0 0 0 12 4l3-3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>
		</div>
	</div>
	<div id="about-dialog-backdrop" class="dialog-backdrop" hidden>
		<form id="about-dialog" class="new-dialog">
			<h3>About</h3>
			<div class="about-info" aria-label="About Copilot AI Customization Visualizer">
				<span><strong>Engineer:</strong> Jeffe747@github</span>
				<span><strong>Agent:</strong> ChatGpt.5.5</span>
			</div>
			<div class="dialog-actions">
				<button id="close-about" type="button">Close</button>
			</div>
		</form>
	</div>
	<div id="settings-dialog-backdrop" class="dialog-backdrop" hidden>
		<form id="settings-dialog" class="new-dialog settings-dialog">
			<h3>${isWindowModeView ? 'Window-mode Extension Settings' : 'Extension Settings'}</h3>
			<section class="settings-section" aria-label="Layout settings">
				<h4>Layout</h4>
				<div class="settings-subsection" aria-label="Layout toggles">
					<div class="settings-subsection-title">Toggles</div>
					<div class="settings-checkbox-grid">
						<label class="settings-toggle"><input id="side-by-side-layout" type="checkbox"><span>Side-by-side layout</span></label>
						<label class="settings-toggle"><input id="hide-documentation-links" type="checkbox"><span>Hide documentation links</span></label>
						<label class="settings-toggle"><input id="show-orphan-toggle" type="checkbox"><span>Show orphan toggle</span></label>
					</div>
				</div>
				<div class="settings-subsection" aria-label="Layout sizing">
					<div class="settings-subsection-title">Sizing</div>
					<div class="settings-slider-grid">
						<label class="size-control" for="node-size"><span>Element size</span><input id="node-size" type="range" min="0.85" max="2" step="0.05" value="1.1"><span id="node-size-value" class="size-value">110%</span></label>
						<label class="size-control" for="text-size"><span>Editor text</span><input id="text-size" type="range" min="0.75" max="1.6" step="0.05" value="1"><span id="text-size-value" class="size-value">100%</span></label>
					</div>
				</div>
			</section>
			<section class="settings-section" aria-label="Token heatmap settings">
				<h4>Token heatmap</h4>
				<label class="settings-toggle"><input id="show-token-heatmap-toggle" type="checkbox"><span>Show visualizer toggle</span></label>
				<label class="heatmap-model-control" for="heatmap-baseline-model"><span>Default baseline model</span><select id="heatmap-baseline-model"><option value="">Use graph-relative fallback</option></select></label>
				<div class="threshold-grid">
					<label class="threshold-control" for="heatmap-medium-threshold"><span><strong>Orange threshold</strong><small>Percent of baseline context</small></span><span class="threshold-input-wrap"><input id="heatmap-medium-threshold" type="number" min="1" max="98" step="1" value="38" inputmode="numeric"><span class="threshold-unit" aria-hidden="true">%</span></span></label>
					<label class="threshold-control" for="heatmap-high-threshold"><span><strong>Red threshold</strong><small>Percent of baseline context</small></span><span class="threshold-input-wrap"><input id="heatmap-high-threshold" type="number" min="2" max="99" step="1" value="72" inputmode="numeric"><span class="threshold-unit" aria-hidden="true">%</span></span></label>
				</div>
			</section>
			<section class="settings-section" aria-label="Visualizer colors">
				<h4>Colors</h4>
				<div class="color-grid">${colorPickerControls}</div>
			</section>
			<div class="dialog-actions">
				<button id="close-settings" type="button">Close</button>
			</div>
		</form>
	</div>
	<div id="new-dialog-backdrop" class="dialog-backdrop" hidden>
		<form id="new-dialog" class="new-dialog">
			<h3>New customization</h3>
			<label>Type<select id="new-kind"><option value="instruction">Instruction</option><option value="skill">Skill</option><option value="prompt">Prompt</option><option value="agent">Agent</option><option value="hook">Hook</option><option value="mcp">MCP server</option></select></label>
			<label id="new-instruction-type-label" hidden>Instruction type<select id="new-instruction-type"><option value="scoped">Scoped instructions</option><option value="copilot">Copilot project instructions</option><option value="agents">All AI instructions</option><option value="claude">Claude instructions</option></select></label>
			<label id="new-name-label">Name<input id="new-name" type="text" placeholder="my-customization" autocomplete="off"></label>
			<div id="new-mcp-info" class="choice-empty" hidden>MCP servers are managed in VS Code's Extensions view.</div>
			<div class="dialog-actions">
				<button id="cancel-new" type="button">Cancel</button>
				<button id="submit-new" type="submit">Create</button>
			</div>
		</form>
	</div>
	<div id="content-shell" class="content-shell">
		<div id="inactive-overlay" class="inactive-overlay" hidden><div class="inactive-message">Window-mode is active. Use this toggle to return control here.</div></div>
		<div id="docs-info" class="docs-info" aria-label="VS Code Copilot customization documentation">
			<button class="docs-link" type="button" data-doc-url="https://code.visualstudio.com/docs/copilot/customization/custom-instructions">Custom instructions documentation</button>
			<button class="docs-link" type="button" data-doc-url="https://code.visualstudio.com/docs/copilot/customization/custom-agents">Custom agents documentation</button>
			<button class="docs-link" type="button" data-doc-url="https://code.visualstudio.com/docs/copilot/customization/prompt-files">Prompt files documentation</button>
			<button class="docs-link" type="button" data-doc-url="https://code.visualstudio.com/docs/copilot/customization/agent-skills">Agent skills documentation</button>
			<button class="docs-link" type="button" data-doc-url="https://code.visualstudio.com/docs/copilot/customization/hooks">Hooks documentation</button>
		</div>
		<div id="workspace-panels" class="workspace-panels">
			<section class="visualizer" aria-label="Graph visualizer">
				<div id="visualizer-body" class="visualizer-body">
					<div id="graph" class="graph"><div class="graph-overlay"><div class="legend"><span><i class="swatch" style="background: var(--instruction)"></i>Instructions</span><span><i class="swatch" style="background: var(--skill)"></i>Skill</span><span><i class="swatch" style="background: var(--prompt)"></i>Prompt</span><span><i class="swatch" style="background: var(--agent)"></i>Agent</span><span><i class="swatch" style="background: var(--handoff)"></i>Handoff</span><span><i class="swatch" style="background: var(--mcp)"></i>MCP</span><span><i class="swatch" style="background: var(--hook)"></i>Hook</span></div></div><div id="status" class="status">Scanning workspace...</div></div>
				</div>
			</section>
			<section id="editor" class="editor" hidden aria-live="polite"></section>
		</div>
	</div>
	<div id="error-toast" class="error-toast" role="alert" aria-live="assertive" hidden><div id="error-toast-message" class="error-toast-message"></div><button id="error-toast-close" class="error-toast-close" type="button" title="Dismiss error" aria-label="Dismiss error">x</button></div>
	<script nonce="${nonce}">
		const isWindowModeView = ${isWindowModeView ? 'true' : 'false'};
		const settingsMode = isWindowModeView ? 'window' : 'activity';
		const initialViewSettings = ${JSON.stringify(settings)};
		const agentDescriptionPlaceholder = ${JSON.stringify(agentDescriptionPlaceholder)};
		const agentBodyPlaceholder = ${JSON.stringify(agentBodyPlaceholder)};
		const vscode = acquireVsCodeApi();
		const savedWebviewState = vscode.getState?.() || {};
		const contentShell = document.getElementById('content-shell');
		const workspacePanels = document.getElementById('workspace-panels');
		const nodeSizeInput = document.getElementById('node-size');
		const nodeSizeValue = document.getElementById('node-size-value');
		const textSizeInput = document.getElementById('text-size');
		const textSizeValue = document.getElementById('text-size-value');
		const heatmapBaselineModelInput = document.getElementById('heatmap-baseline-model');
		const heatmapMediumThresholdInput = document.getElementById('heatmap-medium-threshold');
		const heatmapHighThresholdInput = document.getElementById('heatmap-high-threshold');
		const sideBySideInput = document.getElementById('side-by-side-layout');
		const hideDocumentationLinksInput = document.getElementById('hide-documentation-links');
		const showOrphanToggleInput = document.getElementById('show-orphan-toggle');
		const showTokenHeatmapToggleInput = document.getElementById('show-token-heatmap-toggle');
		const colorInputs = [...document.querySelectorAll('.color-picker')];
		const docsInfo = document.getElementById('docs-info');
		const graphElement = document.getElementById('graph');
		const editorElement = document.getElementById('editor');
		const errorToast = document.getElementById('error-toast');
		const errorToastMessage = document.getElementById('error-toast-message');
		const errorToastClose = document.getElementById('error-toast-close');
		const inactiveOverlay = document.getElementById('inactive-overlay');
		const windowModeButton = document.getElementById('popout');
		const aboutDialogBackdrop = document.getElementById('about-dialog-backdrop');
		const settingsDialogBackdrop = document.getElementById('settings-dialog-backdrop');
		const newDialogBackdrop = document.getElementById('new-dialog-backdrop');
		const newDialog = document.getElementById('new-dialog');
		const newKind = document.getElementById('new-kind');
		const newInstructionType = document.getElementById('new-instruction-type');
		const newInstructionTypeLabel = document.getElementById('new-instruction-type-label');
		const newNameLabel = document.getElementById('new-name-label');
		const newMcpInfo = document.getElementById('new-mcp-info');
		const submitNewButton = document.getElementById('submit-new');
		const newName = document.getElementById('new-name');
		let activeGraph;
		let selectedNodeId;
		let currentGraphStatus = 'Scanning workspace...';
		let nodeScale = Number(initialViewSettings.nodeScale) || 1.1;
		let textScale = Number(initialViewSettings.textScale) || 1;
		let heatmapBaselineModel = typeof initialViewSettings.heatmapBaselineModel === 'string' ? initialViewSettings.heatmapBaselineModel : '';
		let heatmapMediumThreshold = readPercentSetting(initialViewSettings.heatmapMediumThreshold, 0.38);
		let heatmapHighThreshold = readPercentSetting(initialViewSettings.heatmapHighThreshold, 0.72);
		let sideBySideLayout = Boolean(initialViewSettings.sideBySideLayout);
		let documentationLinksHidden = Boolean(initialViewSettings.documentationLinksHidden);
		let heatmapToggleVisible = Boolean(initialViewSettings.heatmapToggleVisible);
		let orphanToggleVisible = Boolean(initialViewSettings.orphanToggleVisible);
		let visualizerColors = { ...(initialViewSettings.colors || {}) };
		let graphLayoutAlgorithm = isGraphLayoutAlgorithm(savedWebviewState.graphLayoutAlgorithm) ? savedWebviewState.graphLayoutAlgorithm : 'hierarchical';
		let tokenHeatmapEnabled = Boolean(savedWebviewState.tokenHeatmapEnabled);
		let orphanHighlightEnabled = Boolean(savedWebviewState.orphanHighlightEnabled);
		const colorPickerFallbackColors = ${JSON.stringify(colorPickerFallbackColors)};
		let graphZoom = 1;
		let graphPanX = 0;
		let graphPanY = 0;
		let graphShouldCenterOnNextRender = true;
		let pendingSaveScrollState;
		let toolFilterValue = '';
		let toolFilterTimeout;
		let resizeTimeout;
		const colors = {
			agent: 'var(--agent)',
			prompt: 'var(--prompt)',
			skill: 'var(--skill)',
			mcp: 'var(--mcp)',
			hook: 'var(--hook)',
			'hook-event': 'var(--hook-event)',
			handoff: 'var(--handoff)',
			instruction: 'var(--instruction)',
			tool: 'var(--tool)',
		};
		const hookEventReferences = [
			{ name: 'SessionStart', description: 'User submits the first prompt of a new session.', variableDriven: false },
			{ name: 'UserPromptSubmit', description: 'User submits a prompt.', variableDriven: false },
			{ name: 'PreToolUse', description: 'Before the agent invokes a tool.', variableDriven: true },
			{ name: 'PostToolUse', description: 'After a tool completes successfully.', variableDriven: true },
			{ name: 'PreCompact', description: 'Before conversation context is compacted.', variableDriven: false },
			{ name: 'SubagentStart', description: 'Subagent is spawned.', variableDriven: false },
			{ name: 'SubagentStop', description: 'Subagent completes.', variableDriven: false },
			{ name: 'Stop', description: 'Agent session ends.', variableDriven: false },
		];
		const hookCommandPropertyReferences = [
			{ name: 'command', description: 'Default command to run across platforms.', placeholder: 'npx prettier --write "$TOOL_INPUT_FILE_PATH"' },
			{ name: 'windows', description: 'Windows-specific command override.', placeholder: 'powershell -File scripts\\hook.ps1' },
			{ name: 'linux', description: 'Linux-specific command override.', placeholder: './scripts/hook-linux.sh' },
			{ name: 'osx', description: 'macOS-specific command override.', placeholder: './scripts/hook-mac.sh' },
			{ name: 'cwd', description: 'Working directory relative to the repository root.', placeholder: 'packages/app' },
			{ name: 'env', description: 'Additional environment variables as a JSON object.', placeholder: '{"NODE_ENV":"test"}' },
			{ name: 'timeout', description: 'Timeout in seconds. Default is 30.', placeholder: '30' },
		];
		${isToolChoiceVisibleForFilter.toString()}
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
			agentHandoffs: 'Optional list of suggested next actions or prompts to transition between custom agents. Handoff buttons appear after a chat response completes.',
			handoffLabel: 'Button text shown for this handoff after a chat response completes.',
			handoffAgent: 'Custom agent that receives this handoff.',
			handoffPrompt: 'Prompt text inserted when the handoff is selected.',
			handoffSend: 'Automatically submit the handoff prompt instead of only pre-filling it.',
			handoffModel: 'AI model to use after the handoff. If omitted, VS Code uses the current model.',
			skillContext: 'Use fork for large skills that should run in a dedicated subagent context.',
			agentModel: 'AI model to use for this custom agent. If omitted, VS Code uses the currently selected model; arrays can define fallback order.',
			promptModel: 'Language model used when running this prompt. If omitted, VS Code uses the currently selected model.',
			userInvocable: 'Controls whether this custom agent or skill appears in the chat menu.',
			agentAgents: 'Subagents available to this custom agent. Use * for all agents, or an empty list to prevent subagent use.',
			promptAgent: 'Agent used for running this prompt: ask, agent, plan, model, or a custom agent name.',
			tools: 'Tool or tool set names available to this agent or prompt. Unavailable tools are ignored; prompt tools take priority over agent tools.',
			agentBody: 'Markdown instructions prepended when this custom agent runs. Use this for persona, behavior, constraints, and workflow guidance.',
			promptBody: 'Markdown prompt text containing the task-specific instructions, context, guidelines, variables, and file references.',
			instructionBody: 'Markdown instructions that define guidelines and rules for the affected AI tools.',
			skillBody: 'Markdown instructions, workflow steps, examples, and links to resources in the skill directory.',
		};
		const toolPresets = [
			{ label: 'Default Agent', tools: ['execute', 'read', 'edit', 'search', 'agent', 'web', 'todo'] },
			{ label: 'Planning Agent', tools: ['read', 'search', 'web', 'todo'] },
		];

		applySettingsToInputs();
		applyVisualizerColors();
		setGraphLoading(true, 'Growing visualization...');
		setSideBySideLayout(sideBySideLayout, false, false);
		setDocumentationLinksHidden(documentationLinksHidden, false);

		document.getElementById('refresh').addEventListener('click', () => {
			setStatus('Refreshing...');
			setGraphLoading(true, 'Refreshing visualization...');
			vscode.postMessage({ type: 'refresh' });
		});

		windowModeButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'popout' });
		});

		document.getElementById('settings').addEventListener('click', () => {
			syncHeatmapBaselineModelInput();
			settingsDialogBackdrop.hidden = false;
			nodeSizeInput.focus();
		});

		document.getElementById('about').addEventListener('click', () => {
			aboutDialogBackdrop.hidden = false;
			document.getElementById('close-about').focus();
		});

		document.getElementById('close-about').addEventListener('click', closeAboutDialog);
		errorToastClose.addEventListener('click', hideErrorToast);

		aboutDialogBackdrop.addEventListener('click', event => {
			if (event.target === aboutDialogBackdrop) {
				closeAboutDialog();
			}
		});

		document.getElementById('close-settings').addEventListener('click', closeSettingsDialog);

		settingsDialogBackdrop.addEventListener('click', event => {
			if (event.target === settingsDialogBackdrop) {
				closeSettingsDialog();
			}
		});

		contentShell.addEventListener('click', event => {
			const docsLink = event.target?.closest?.('[data-doc-url]');

			if (docsLink) {
				vscode.postMessage({ type: 'docs:open', url: docsLink.dataset.docUrl });
			}
		});

		nodeSizeInput.addEventListener('input', () => {
			nodeScale = Number(nodeSizeInput.value) || 1;
			nodeSizeValue.textContent = Math.round(nodeScale * 100) + '%';
			persistCurrentSettings();
			graphShouldCenterOnNextRender = true;

			if (activeGraph) {
				renderGraph(activeGraph, true);
			}
		});

		textSizeInput.addEventListener('input', () => {
			textScale = Number(textSizeInput.value) || 1;
			textSizeValue.textContent = Math.round(textScale * 100) + '%';
			persistCurrentSettings();
			applyEditorTextScale();
		});

		heatmapMediumThresholdInput.addEventListener('input', () => {
			heatmapMediumThreshold = normalizeHeatmapThreshold(Number(heatmapMediumThresholdInput.value) / 100, 0.01, heatmapHighThreshold - 0.01);
			syncHeatmapThresholdInputs();
			persistCurrentSettings();

			if (activeGraph && tokenHeatmapEnabled) {
				renderGraph(activeGraph, true);
			}
		});

		heatmapHighThresholdInput.addEventListener('input', () => {
			heatmapHighThreshold = normalizeHeatmapThreshold(Number(heatmapHighThresholdInput.value) / 100, heatmapMediumThreshold + 0.01, 0.99);
			syncHeatmapThresholdInputs();
			persistCurrentSettings();

			if (activeGraph && tokenHeatmapEnabled) {
				renderGraph(activeGraph, true);
			}
		});

		heatmapBaselineModelInput.addEventListener('change', () => {
			heatmapBaselineModel = heatmapBaselineModelInput.value;
			persistCurrentSettings();

			if (activeGraph && tokenHeatmapEnabled) {
				renderGraph(activeGraph, true);
			}
		});

		sideBySideInput.addEventListener('change', () => {
			setSideBySideLayout(sideBySideInput.checked);
		});

		hideDocumentationLinksInput.addEventListener('change', () => {
			setDocumentationLinksHidden(hideDocumentationLinksInput.checked);
		});

		showTokenHeatmapToggleInput.addEventListener('change', () => {
			heatmapToggleVisible = showTokenHeatmapToggleInput.checked;
			persistCurrentSettings();

			if (activeGraph) {
				renderGraph(activeGraph, true);
			}
		});

		showOrphanToggleInput.addEventListener('change', () => {
			orphanToggleVisible = showOrphanToggleInput.checked;
			persistCurrentSettings();

			if (activeGraph) {
				renderGraph(activeGraph, true);
			}
		});

		for (const colorInput of colorInputs) {
			colorInput.addEventListener('input', () => {
				visualizerColors = { ...visualizerColors, [colorInput.dataset.colorKey]: colorInput.value };
				applyVisualizerColors();
				persistCurrentSettings();
			});
		}

		document.getElementById('new-file').addEventListener('click', () => {
			newDialogBackdrop.hidden = false;
			newName.value = '';
			newKind.value = 'instruction';
			newInstructionType.value = 'scoped';
			updateInstructionTypeVisibility();
			newName.focus();
		});

		newKind.addEventListener('change', updateInstructionTypeVisibility);

		document.getElementById('cancel-new').addEventListener('click', closeNewDialog);

		newDialogBackdrop.addEventListener('click', event => {
			if (event.target === newDialogBackdrop) {
				closeNewDialog();
			}
		});

		newDialog.addEventListener('submit', event => {
			event.preventDefault();

			if (newKind.value === 'mcp') {
				setStatus('Opening MCP servers...');
				vscode.postMessage({ type: 'mcp:open' });
				closeNewDialog();
				return;
			}

			setStatus('Creating ' + newKind.value + '...');
			vscode.postMessage({ type: 'customization:create', kind: newKind.value, instructionType: newInstructionType.value, name: newName.value });
			closeNewDialog();
		});

		window.addEventListener('keydown', event => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				saveSelectedNode();
				return;
			}

			if (event.key === 'Escape' && !newDialogBackdrop.hidden) {
				closeNewDialog();
			}

			if (event.key === 'Escape' && !aboutDialogBackdrop.hidden) {
				closeAboutDialog();
			}

			if (event.key === 'Escape' && !settingsDialogBackdrop.hidden) {
				closeSettingsDialog();
			}

			if (event.key === 'Escape' && !errorToast.hidden) {
				hideErrorToast();
			}
		});

		window.addEventListener('resize', () => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				if (activeGraph) {
					renderGraph(activeGraph, true);
				}
			}, 120);
		});

		window.addEventListener('message', event => {
			const message = event.data;

			if (message.type === 'window-mode:update') {
				setWindowMode(message.active);
			}

			if (message.type === 'graph:update') {
				setGraphLoading(false);
				graphShouldCenterOnNextRender = true;
				renderGraph(message.graph);
				restorePendingSaveScrollState();
			}

			if (message.type === 'graph:error') {
				setGraphLoading(false);
				setStatus(message.message);
				showErrorToast(message.message);
				graphElement.innerHTML = renderGraphOverlay();
				installGraphOverlayControls();
				renderEditor(undefined);
			}

			if (message.type === 'save:error') {
				setGraphLoading(false);
				setStatus(message.message);
				showErrorToast(message.message);
			}

			if (message.type === 'graph:loading') {
				setGraphLoading(true, 'Growing visualization...');
			}
		});

		vscode.postMessage({ type: 'webview:ready' });

		function setWindowMode(active) {
			const originalInactive = active && !isWindowModeView;

			windowModeButton.setAttribute('aria-checked', active ? 'true' : 'false');
			windowModeButton.querySelector('.switch-label').textContent = active ? 'Exit Window-mode' : 'Window-mode';
			windowModeButton.title = active ? 'Close Window-mode and reactivate this view' : 'Open visualizer in a separate VS Code window';
			contentShell.classList.toggle('inactive', originalInactive);
			inactiveOverlay.hidden = !originalInactive;
		}

		function applySettingsToInputs() {
			nodeSizeInput.value = String(nodeScale);
			nodeSizeValue.textContent = Math.round(nodeScale * 100) + '%';
			textSizeInput.value = String(textScale);
			textSizeValue.textContent = Math.round(textScale * 100) + '%';
			showTokenHeatmapToggleInput.checked = heatmapToggleVisible;
			showOrphanToggleInput.checked = orphanToggleVisible;
			syncHeatmapBaselineModelInput();
			syncHeatmapThresholdInputs();

			for (const colorInput of colorInputs) {
				colorInput.value = visualizerColors[colorInput.dataset.colorKey] || colorPickerFallbackColors[colorInput.dataset.colorKey] || colorInput.value;
			}

			applyEditorTextScale();
		}

		function applyVisualizerColors() {
			for (const colorInput of colorInputs) {
				const key = colorInput.dataset.colorKey;
				const value = visualizerColors[key];

				if (value) {
					document.documentElement.style.setProperty('--' + key, value);
				} else {
					document.documentElement.style.removeProperty('--' + key);
				}
			}
		}

		function persistCurrentSettings() {
			vscode.postMessage({
				type: 'settings:update',
				mode: settingsMode,
				settings: {
					sideBySideLayout,
					documentationLinksHidden,
					nodeScale,
					textScale,
					colors: visualizerColors,
					heatmapToggleVisible,
					orphanToggleVisible,
					heatmapBaselineModel,
					heatmapMediumThreshold,
					heatmapHighThreshold,
				},
			});
		}

		function readPercentSetting(value, fallback) {
			return normalizeHeatmapThreshold(Number(value), 0.01, 0.99, fallback);
		}

		function normalizeHeatmapThreshold(value, min, max, fallback = min) {
			const number = Number(value);
			const candidate = Number.isFinite(number) ? number : fallback;

			return Math.min(max, Math.max(min, candidate));
		}

		function syncHeatmapThresholdInputs() {
			if (heatmapMediumThreshold >= heatmapHighThreshold) {
				heatmapMediumThreshold = normalizeHeatmapThreshold(heatmapHighThreshold - 0.01, 0.01, 0.98, 0.38);
			}

			heatmapMediumThresholdInput.value = String(Math.round(heatmapMediumThreshold * 100));
			heatmapHighThresholdInput.value = String(Math.round(heatmapHighThreshold * 100));
		}

		function syncHeatmapBaselineModelInput() {
			const availableModels = activeGraph?.availableModels || [];
			const modelValues = unique([heatmapBaselineModel, ...availableModels.map(model => model.value)].filter(Boolean));
			const options = ['<option value="">Use graph-relative fallback</option>'];

			for (const modelValue of modelValues) {
				const model = availableModels.find(model => model.value === modelValue);
				const label = model?.label || modelValue;

				options.push('<option value="' + escapeAttribute(modelValue) + '"' + (modelValue === heatmapBaselineModel ? ' selected' : '') + '>' + escapeHtml(label) + '</option>');
			}

			heatmapBaselineModelInput.innerHTML = options.join('');
			heatmapBaselineModelInput.value = heatmapBaselineModel;
		}

		function setSideBySideLayout(enabled, shouldRender = true, shouldPersist = true) {
			sideBySideLayout = Boolean(enabled);
			sideBySideInput.checked = sideBySideLayout;
			workspacePanels.classList.toggle('side-by-side', sideBySideLayout);

			if (shouldPersist) {
				persistCurrentSettings();
			}

			if (shouldRender && activeGraph) {
				renderGraph(activeGraph, true);
			}
		}

		function setDocumentationLinksHidden(hidden, shouldPersist = true) {
			documentationLinksHidden = Boolean(hidden);
			hideDocumentationLinksInput.checked = documentationLinksHidden;
			docsInfo.hidden = documentationLinksHidden;
			docsInfo.classList.toggle('documentation-links-hidden', documentationLinksHidden);

			if (shouldPersist) {
				persistCurrentSettings();
			}
		}

		function scheduleSideBySideGraphRender() {
			if (sideBySideLayout && activeGraph) {
				requestAnimationFrame(() => renderGraph(activeGraph, true));
			}
		}

		function setStatus(message) {
			currentGraphStatus = message;
			const statusElement = document.getElementById('status');

			if (statusElement) {
				statusElement.textContent = message;
			}
		}

		function showErrorToast(message) {
			errorToastMessage.textContent = message;
			errorToast.hidden = false;
		}

		function hideErrorToast() {
			errorToast.hidden = true;
			errorToastMessage.textContent = '';
		}

		function renderGraphOverlay() {
			const heatmapToggle = heatmapToggleVisible ? '<label class="graph-toggle" title="Show context token weight as a glow behind agent nodes"><input id="token-heatmap" type="checkbox" ' + (tokenHeatmapEnabled ? 'checked' : '') + '>Token heatmap</label>' : '';
			const orphanToggle = orphanToggleVisible ? '<label class="graph-toggle" title="Highlight disconnected editable agents prompts and skills"><input id="orphan-highlight" type="checkbox" ' + (orphanHighlightEnabled ? 'checked' : '') + '>Identify orphans</label>' : '';
			const status = '<div id="status" class="status">' + escapeHtml(currentGraphStatus) + '</div>';

			return '<div class="graph-overlay"><div class="legend"><span><i class="swatch" style="background: var(--instruction)"></i>Instructions</span><span><i class="swatch" style="background: var(--skill)"></i>Skill</span><span><i class="swatch" style="background: var(--prompt)"></i>Prompt</span><span><i class="swatch" style="background: var(--agent)"></i>Agent</span><span><i class="swatch" style="background: var(--handoff)"></i>Handoff</span><span><i class="swatch" style="background: var(--mcp)"></i>MCP</span><span><i class="swatch" style="background: var(--hook)"></i>Hook</span></div>' + heatmapToggle + orphanToggle + '<label class="layout-control">Layout<select id="layout-algorithm"><option value="hierarchical"' + (graphLayoutAlgorithm === 'hierarchical' ? ' selected' : '') + '>Hierarchical</option><option value="radial"' + (graphLayoutAlgorithm === 'radial' ? ' selected' : '') + '>Radial</option><option value="force"' + (graphLayoutAlgorithm === 'force' ? ' selected' : '') + '>Force-directed</option></select></label></div>' + status;
		}

		function installGraphOverlayControls() {
			const layoutSelect = document.getElementById('layout-algorithm');
			const heatmapButton = document.getElementById('token-heatmap');
			const orphanButton = document.getElementById('orphan-highlight');

			if (heatmapButton) {
				heatmapButton.addEventListener('change', () => {
					tokenHeatmapEnabled = heatmapButton.checked;
					persistGraphViewState();

					if (activeGraph) {
						renderGraph(activeGraph, true);
					}
				});
			}

			if (orphanButton) {
				orphanButton.addEventListener('change', () => {
					orphanHighlightEnabled = orphanButton.checked;
					persistGraphViewState();

					if (activeGraph) {
						renderGraph(activeGraph, true);
					}
				});
			}

			if (!layoutSelect) {
				return;
			}

			layoutSelect.addEventListener('change', () => {
				if (!isGraphLayoutAlgorithm(layoutSelect.value)) {
					return;
				}

				graphLayoutAlgorithm = layoutSelect.value;
				persistGraphViewState();
				graphShouldCenterOnNextRender = true;

				if (activeGraph) {
					renderGraph(activeGraph, true);
				}
			});
		}

		function isGraphLayoutAlgorithm(value) {
			return value === 'hierarchical' || value === 'radial' || value === 'force';
		}

		function persistGraphViewState() {
			vscode.setState?.({ ...(vscode.getState?.() || {}), graphLayoutAlgorithm, tokenHeatmapEnabled, orphanHighlightEnabled });
		}

		function setGraphLoading(loading, label = 'Growing visualization...') {
			const existingOverlay = graphElement.querySelector('.loading-overlay');

			if (!loading) {
				existingOverlay?.remove();
				return;
			}

			if (existingOverlay) {
				existingOverlay.querySelector('.plant-loader-label').textContent = label;
				return;
			}

			graphElement.insertAdjacentHTML('beforeend', '<div class="loading-overlay" role="status" aria-live="polite"><div class="plant-loader"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path class="sprout-soil" d="M5 20h14" stroke-width="1.7" stroke-linecap="round"></path><path class="sprout-stem" d="M12 20c0-3.4 0-6.2 0-9" stroke-width="1.9" stroke-linecap="round"></path><path class="sprout-branch sprout-left-branch" d="M12 15c-1.6-.4-2.8-1.4-3.6-3" stroke-width="1.4"></path><path class="sprout-leaf sprout-left" d="M8.3 12c-2.6-.3-4-1.8-4.6-4.1 2.5.1 4.1 1.4 4.6 4.1z"></path><path class="sprout-branch sprout-right-branch" d="M12 13.6c1.6-.5 2.8-1.7 3.4-3.4" stroke-width="1.4"></path><path class="sprout-leaf sprout-right" d="M15.4 10.2c2.6-.4 4.1-1.9 4.5-4.3-2.5.2-4 1.6-4.5 4.3z"></path></svg><span class="plant-loader-label">' + escapeHtml(label) + '</span></div></div>');
		}

		function renderGraph(graph, preserveEditor = false) {
			activeGraph = graph;
			syncHeatmapBaselineModelInput();
			setStatus(graph.nodes.length + ' nodes, ' + graph.links.length + ' edges');

			if (graph.nodes.length === 0) {
				graphElement.innerHTML = renderGraphOverlay() + '<div class="empty">No .agent.md or .prompt.md files found.</div>';
				installGraphOverlayControls();
				renderEditor(undefined);
				return;
			}

			const viewportWidth = Math.max(320, graphElement.clientWidth || 320);
			const layoutWidth = getGraphLayoutWidth(graph, viewportWidth);
			const positions = layoutGraph(graph, layoutWidth);
			const graphBounds = getGraphPositionBounds(positions);
			const viewportHeight = getGraphViewportHeight();
			const contentHeight = Math.max(viewportHeight, graphBounds.maxY + 92 * nodeScale);
			graphElement.style.height = viewportHeight + 'px';

			if (graphShouldCenterOnNextRender) {
				centerGraphPanOnBounds(viewportWidth, viewportHeight, layoutWidth, contentHeight, graphBounds);
				graphShouldCenterOnNextRender = false;
			}

			clampGraphPan(viewportWidth, viewportHeight, layoutWidth, contentHeight);
			const currentSelectionExists = graph.nodes.some(node => node.id === selectedNodeId);

			if (!currentSelectionExists) {
				selectedNodeId = undefined;
				if (!preserveEditor) {
					renderEditor(undefined);
				}
			} else {
				if (!preserveEditor) {
					renderEditor(graph.nodes.find(node => node.id === selectedNodeId));
				}
			}

			const edges = graph.links.map(link => {
				const source = positions.get(link.source);
				const target = positions.get(link.target);

				if (!source || !target) {
					return '';
				}


				const arrowX = (source.x + target.x) / 2;
				const arrowY = (source.y + target.y) / 2;
				const arrowAngle = Math.atan2(target.y - source.y, target.x - source.x) * 180 / Math.PI;

				return '<path class="edge" fill="none" d="M ' + source.x + ' ' + source.y + ' L ' + target.x + ' ' + target.y + '" />' +
					'<path class="edge-arrow" d="M -3 -4 L 5 0 L -3 4 Z" transform="translate(' + arrowX + ' ' + arrowY + ') rotate(' + arrowAngle + ')" />';
			}).join('');

			const subAgentIds = new Set(graph.links.filter(link => link.type === 'uses-agent').map(link => link.target));
			const orphanNodeIds = getOrphanNodeIds(graph);
			const fallbackHeatmapMaxTokens = getFallbackHeatmapMaxTokens(graph);
			const nodes = graph.nodes.map(node => {
				const position = positions.get(node.id);
				const label = escapeHtml(node.label);
				const modelLabel = node.uri && (node.type === 'agent' || node.type === 'prompt') ? formatModelLabel(node.model) : node.type === 'handoff' ? formatModelLabel(node.handoffModel) : '';
				const audienceLabel = node.type === 'instruction' ? node.instructionAudience || 'AI' : '';
				const skillDetails = node.type === 'skill'
					? [node.description || '', node.argumentHint ? 'Argument hint: ' + node.argumentHint : '', node.userInvocable === false ? 'Hidden from slash menu' : 'Slash-command invocable', node.disableModelInvocation ? 'Disable Model Invocation' : '', node.skillContext ? 'Context: ' + node.skillContext : '', ...(node.skillIssues || [])]
					: [];
				const mcpDetails = node.type === 'mcp'
					? [node.mcpServerType ? 'Type: ' + node.mcpServerType : '', node.mcpCommand ? 'Target: ' + node.mcpCommand : '', node.mcpSource ? 'Source: ' + node.mcpSource : '']
					: [];
				const hookDetails = node.type === 'hook'
					? [(node.hookEvents || []).map(event => event.name + ' (' + event.commandCount + ')').join(', '), (node.hookEvents || []).some(event => event.variableDriven) ? 'Tool hooks use variable-driven logic' : '']
					: node.type === 'hook-event'
					? [node.hookEventDescription || '', node.hookEventCommandCount ? node.hookEventCommandCount + ' command' + (node.hookEventCommandCount === 1 ? '' : 's') : '', node.hookEventVariableDriven ? 'Variable-driven tool logic' : '']
					: [];
				const handoffDetails = node.type === 'handoff'
					? [node.handoffAgent ? 'Target: ' + node.handoffAgent : '', node.handoffPrompt ? 'Prompt: ' + node.handoffPrompt : '', node.handoffSend ? 'Auto-submit prompt' : 'Prefill prompt']
					: [];
				const isOrphan = orphanHighlightEnabled && orphanNodeIds.has(node.id);
				const title = [node.path || node.id, audienceLabel ? 'Affects: ' + audienceLabel : '', node.type === 'instruction' ? 'Instruction area' : '', modelLabel ? 'Model: ' + modelLabel : '', isOrphan ? 'Orphan: disconnected editable customization' : '', ...skillDetails, ...mcpDetails, ...hookDetails, ...handoffDetails].filter(Boolean).join(' - ');
				const className = [node.unresolved ? 'node unresolved' : 'node', 'node-' + node.type, tokenHeatmapEnabled && node.type === 'agent' && node.contextEstimateTokens ? 'heatmap' : '', isOrphan ? 'orphan' : '', node.type === 'skill' && !node.disableModelInvocation ? 'model-invocable' : '', node.id === selectedNodeId ? 'selected' : ''].filter(Boolean).join(' ');
				const fillColor = colors[node.type];
				const isInvocableAgent = node.type === 'agent' && Boolean(node.uri) && node.userInvocable !== false;
				const contextLabel = node.type === 'agent' && node.uri && node.userInvocable !== false && node.contextEstimateTokens ? formatContextEstimate(node.contextEstimateTokens) : '';
				const hookEventCount = node.type === 'hook-event' && node.hookEventCommandCount ? node.hookEventCommandCount + ' cmd' : '';
				const heatmapGlow = getHeatmapGlow(node, fallbackHeatmapMaxTokens, isInvocableAgent);
				const shape = node.type === 'instruction'
					? '<rect class="node-shape instruction-area" x="-48" y="-22" width="96" height="44" rx="8" fill="' + fillColor + '"></rect>'
					: node.type === 'hook-event'
						? '<circle class="node-shape" r="8" fill="' + fillColor + '"></circle>'
					: node.type === 'skill'
						? '<circle class="node-shape" r="13" fill="' + fillColor + '"></circle>'
					: node.type === 'mcp'
						? '<circle class="node-shape" r="13" fill="' + fillColor + '"></circle>'
					: node.type === 'hook'
						? '<circle class="node-shape" r="13" fill="' + fillColor + '"></circle>'
					: node.type === 'handoff'
						? '<circle class="node-backer" r="16"></circle><circle class="node-shape" r="13" fill="' + fillColor + '"></circle>'
					: isInvocableAgent
						? '<circle class="node-shape" r="13" fill="' + fillColor + '"></circle>'
					: '<circle class="node-shape" r="11" fill="' + fillColor + '"></circle>';
				const textY = node.type === 'instruction' ? -3 : node.type === 'hook-event' ? 20 : 28;
				const agentMarker = node.type === 'agent' ? renderAgentMarker(isInvocableAgent, subAgentIds.has(node.id)) : '';
				const skillMarker = node.type === 'skill' ? renderSkillMarker(node.skillContext) : '';
				const mcpMarker = node.type === 'mcp' ? renderMcpMarker() : '';
				const hookMarker = node.type === 'hook' ? renderHookMarker() : '';
				const handoffMarker = node.type === 'handoff' ? renderHandoffMarker() : '';

				return '<g class="' + className + '" data-node-id="' + escapeAttribute(node.id) + '" transform="translate(' + position.x + ' ' + position.y + ')" tabindex="0" role="button" aria-label="Edit ' + escapeAttribute(node.label) + '">' +
					'<title>' + escapeHtml(title) + '</title>' +
					'<g transform="scale(' + nodeScale + ')">' +
					heatmapGlow +
					shape +
					agentMarker +
					skillMarker +
					mcpMarker +
					hookMarker +
					handoffMarker +
					'<text x="0" y="' + textY + '" text-anchor="middle">' + label + '</text>' +
					(audienceLabel ? '<text class="audience-label" x="0" y="12" text-anchor="middle">Affects: ' + escapeHtml(audienceLabel) + '</text>' : '') +
					(modelLabel ? '<text class="model-label" x="0" y="42" text-anchor="middle">' + escapeHtml(modelLabel) + '</text>' : '') +
					(contextLabel ? '<text class="context-label" x="0" y="55" text-anchor="middle">' + escapeHtml(contextLabel) + '</text>' : '') +
					(hookEventCount ? '<text class="hook-event-count" x="0" y="32" text-anchor="middle">' + escapeHtml(hookEventCount) + '</text>' : '') +
					'</g>' +
				'</g>';
			}).join('');

			graphElement.innerHTML = renderGraphOverlay() + '<svg width="100%" height="' + viewportHeight + '" viewBox="' + getGraphViewBox(viewportWidth, viewportHeight) + '" role="img" aria-label="Copilot AI customization graph">' + edges + nodes + '</svg>';
			installGraphOverlayControls();
			installGraphNavigation(graphElement.querySelector('svg'), viewportWidth, viewportHeight, layoutWidth, contentHeight);

			for (const nodeElement of graphElement.querySelectorAll('.node')) {
				nodeElement.addEventListener('click', () => selectNode(nodeElement.dataset.nodeId));
				nodeElement.addEventListener('keydown', event => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						selectNode(nodeElement.dataset.nodeId);
					}
				});
			}
		}

		function getHeatmapGlow(node, fallbackHeatmapMaxTokens, isInvocableAgent) {
			if (!tokenHeatmapEnabled || node.type !== 'agent' || !node.contextEstimateTokens) {
				return '';
			}

			const heatmapMaxTokens = getHeatmapMaxTokens(node, fallbackHeatmapMaxTokens);
			const ratio = heatmapMaxTokens > 0 ? node.contextEstimateTokens / heatmapMaxTokens : 0;
			const level = getHeatmapLevel(ratio);
			const radius = isInvocableAgent ? 21 : 18;

			return '<circle class="heatmap-glow heatmap-' + level + '" r="' + radius + '"></circle>';
		}

		function getHeatmapLevel(ratio) {
			if (ratio >= heatmapHighThreshold) {
				return 'high';
			}

			if (ratio >= heatmapMediumThreshold) {
				return 'medium';
			}

			return 'low';
		}

		function getHeatmapMaxTokens(node, fallbackHeatmapMaxTokens) {
			const modelMaxTokens = getModelMaxInputTokens(node.model);
			const baselineModelMaxTokens = getModelMaxInputTokens(heatmapBaselineModel);

			return modelMaxTokens || baselineModelMaxTokens || fallbackHeatmapMaxTokens;
		}

		function getModelMaxInputTokens(modelValue) {
			if (!modelValue) {
				return 0;
			}

			const model = activeGraph?.availableModels?.find(model => model.value === modelValue);

			return Number.isFinite(model?.maxInputTokens) && model.maxInputTokens > 0 ? model.maxInputTokens : 0;
		}

		function getFallbackHeatmapMaxTokens(graph) {
			return Math.max(0, ...graph.nodes.filter(node => node.type === 'agent').map(node => node.contextEstimateTokens || 0));
		}

		function getOrphanNodeIds(graph) {
			if (!orphanHighlightEnabled) {
				return new Set();
			}

			const connectedNodeIds = new Set();

			for (const link of graph.links) {
				connectedNodeIds.add(link.source);
				connectedNodeIds.add(link.target);
			}

			return new Set(graph.nodes
				.filter(node => isOrphanCandidate(node) && !connectedNodeIds.has(node.id))
				.map(node => node.id));
		}

		function isOrphanCandidate(node) {
			if (!node.uri || node.unresolved) {
				return false;
			}

			if (node.type === 'agent' || node.type === 'skill') {
				return node.userInvocable === false;
			}

			return node.type === 'prompt';
		}

		function getGraphLayoutWidth(graph, viewportWidth) {
			if (graphLayoutAlgorithm === 'radial') {
				const radius = Math.max(120 * nodeScale, graph.nodes.length * 13 * nodeScale);

				return Math.max(viewportWidth, radius * 2 + 140 * nodeScale);
			}

			if (graphLayoutAlgorithm === 'force') {
				return Math.max(viewportWidth, Math.ceil(Math.sqrt(graph.nodes.length)) * 170 * nodeScale);
			}

			const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
			const childrenById = new Map(graph.nodes.map(node => [node.id, []]));
			const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
			const hierarchicalLinks = graph.links.filter(link => link.type === 'uses-agent' || link.type === 'uses-handoff' || link.type === 'handoff-to-agent');

			for (const link of hierarchicalLinks) {
				if (!childrenById.has(link.source) || !nodeById.has(link.target)) {
					continue;
				}

				childrenById.get(link.source).push(link.target);
				incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
			}

			const roots = graph.nodes
				.filter(node => (node.type === 'agent' || node.type === 'handoff') && (incoming.get(node.id) || 0) === 0)
				.sort(compareNodes);
			const levels = new Map();
			const queue = roots.map(node => ({ id: node.id, depth: 0 }));

			while (queue.length > 0) {
				const item = queue.shift();
				const existingDepth = levels.get(item.id);

				if ((existingDepth !== undefined && existingDepth >= item.depth) || item.depth > graph.nodes.length) {
					continue;
				}

				levels.set(item.id, item.depth);

				for (const childId of [...(childrenById.get(item.id) || [])].sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))) {
					queue.push({ id: childId, depth: item.depth + 1 });
				}
			}

			for (const node of graph.nodes) {
				if (!levels.has(node.id)) {
					levels.set(node.id, node.type === 'instruction' ? -2 : node.type === 'prompt' || node.type === 'skill' ? -1 : 0);
				}
			}

			for (const link of graph.links.filter(link => link.type === 'runs-with-agent')) {
				const targetLevel = levels.get(link.target) || 0;
				levels.set(link.source, targetLevel - 1);
			}

			const agentLevels = graph.nodes.filter(node => node.type === 'agent').map(node => levels.get(node.id) || 0);
			const belowAgentsLevel = (agentLevels.length ? Math.max(...agentLevels) : 0) + 1;

			for (const node of graph.nodes) {
				if (node.type === 'mcp' || node.type === 'hook' || node.type === 'tool') {
					levels.set(node.id, belowAgentsLevel);
				}
			}

			for (const link of graph.links.filter(link => link.type === 'has-hook-event')) {
				levels.set(link.target, (levels.get(link.source) || belowAgentsLevel) + 1);
			}

			const minLevel = Math.min(...levels.values());
			const nodeCountsByLevel = new Map();

			for (const node of graph.nodes) {
				const level = (levels.get(node.id) || 0) - minLevel;
				nodeCountsByLevel.set(level, (nodeCountsByLevel.get(level) || 0) + 1);
			}

			const maxNodesOnLevel = Math.max(1, ...nodeCountsByLevel.values());
			const minimumNodeGap = 108 * nodeScale;
			const sidePadding = 72 * nodeScale;

			return Math.max(viewportWidth, maxNodesOnLevel * minimumNodeGap + sidePadding * 2);
		}

		function getGraphViewportHeight() {
			const bounds = graphElement.getBoundingClientRect();
			const bottomPadding = 12;
			const documentTop = bounds.top + window.scrollY;

			return Math.max(320, Math.floor(window.innerHeight - documentTop - bottomPadding));
		}

		function getGraphViewBox(width, height) {
			return graphPanX + ' ' + graphPanY + ' ' + (width / graphZoom) + ' ' + (height / graphZoom);
		}

		function clampGraphPan(width, height, layoutWidth, contentHeight) {
			if (!Number.isFinite(graphPanX)) {
				graphPanX = 0;
			}

			if (!Number.isFinite(graphPanY)) {
				graphPanY = 0;
			}
		}

		function centerGraphPanOnBounds(width, height, layoutWidth, contentHeight, bounds) {
			const viewWidth = width / graphZoom;
			const viewHeight = height / graphZoom;
			const centerX = (bounds.minX + bounds.maxX) / 2;
			const centerY = (bounds.minY + bounds.maxY) / 2;

			graphPanX = centerX - viewWidth / 2;
			graphPanY = centerY - viewHeight / 2;
			clampGraphPan(width, height, layoutWidth, contentHeight);
		}

		function getGraphPositionBounds(positions) {
			const values = [...positions.values()];

			if (!values.length) {
				return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
			}

			const padding = 62 * nodeScale;

			return {
				minX: Math.min(...values.map(position => position.x)) - padding,
				maxX: Math.max(...values.map(position => position.x)) + padding,
				minY: Math.min(...values.map(position => position.y)) - padding,
				maxY: Math.max(...values.map(position => position.y)) + padding,
			};
		}

		function installGraphNavigation(svg, width, height, layoutWidth, contentHeight) {
			if (!svg) {
				return;
			}

			let activePointerId;
			let startClientX = 0;
			let startClientY = 0;
			let startPanX = 0;
			let startPanY = 0;

			svg.addEventListener('pointerdown', event => {
				if (event.button !== 0 || event.target.closest('.node')) {
					return;
				}

				activePointerId = event.pointerId;
				startClientX = event.clientX;
				startClientY = event.clientY;
				startPanX = graphPanX;
				startPanY = graphPanY;
				svg.classList.add('is-panning');
				svg.setPointerCapture(event.pointerId);
				event.preventDefault();
			});

			svg.addEventListener('pointermove', event => {
				if (activePointerId !== event.pointerId) {
					return;
				}

				const bounds = svg.getBoundingClientRect();
				const unitX = (width / graphZoom) / Math.max(1, bounds.width);
				const unitY = (height / graphZoom) / Math.max(1, bounds.height);

				graphPanX = startPanX - (event.clientX - startClientX) * unitX;
				graphPanY = startPanY - (event.clientY - startClientY) * unitY;
				clampGraphPan(width, height, layoutWidth, contentHeight);
				svg.setAttribute('viewBox', getGraphViewBox(width, height));
				event.preventDefault();
			});

			svg.addEventListener('wheel', event => {
				if (!event.ctrlKey) {
					return;
				}

				const bounds = svg.getBoundingClientRect();
				const viewWidth = width / graphZoom;
				const viewHeight = height / graphZoom;
				const pointerRatioX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
				const pointerRatioY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
				const pointerGraphX = graphPanX + pointerRatioX * viewWidth;
				const pointerGraphY = graphPanY + pointerRatioY * viewHeight;
				const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

				graphZoom = Math.min(4, Math.max(0.5, graphZoom * zoomFactor));
				graphPanX = pointerGraphX - pointerRatioX * (width / graphZoom);
				graphPanY = pointerGraphY - pointerRatioY * (height / graphZoom);
				clampGraphPan(width, height, layoutWidth, contentHeight);
				svg.setAttribute('viewBox', getGraphViewBox(width, height));
				event.preventDefault();
			}, { passive: false });

			const endPan = event => {
				if (activePointerId !== event.pointerId) {
					return;
				}

				activePointerId = undefined;
				svg.classList.remove('is-panning');

				if (svg.hasPointerCapture(event.pointerId)) {
					svg.releasePointerCapture(event.pointerId);
				}
			};

			svg.addEventListener('pointerup', endPan);
			svg.addEventListener('pointercancel', endPan);
		}

		function layoutGraph(graph, width) {
			if (graphLayoutAlgorithm === 'radial') {
				return layoutRadialGraph(graph, width);
			}

			if (graphLayoutAlgorithm === 'force') {
				return layoutForceDirectedGraph(graph, width);
			}

			return layoutHierarchicalGraph(graph, width);
		}

		function layoutHierarchicalGraph(graph, width) {
			const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
			const childrenById = new Map(graph.nodes.map(node => [node.id, []]));
			const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
			const hierarchicalLinks = graph.links.filter(link => link.type === 'uses-agent' || link.type === 'uses-handoff' || link.type === 'handoff-to-agent');

			for (const link of hierarchicalLinks) {
				if (!childrenById.has(link.source) || !nodeById.has(link.target)) {
					continue;
				}

				childrenById.get(link.source).push(link.target);
				incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
			}

			const roots = graph.nodes
				.filter(node => (node.type === 'agent' || node.type === 'handoff') && (incoming.get(node.id) || 0) === 0)
				.sort(compareNodes);
			const levels = new Map();
			const queue = roots.map(node => ({ id: node.id, depth: 0 }));

			while (queue.length > 0) {
				const item = queue.shift();
				const existingDepth = levels.get(item.id);

				if ((existingDepth !== undefined && existingDepth >= item.depth) || item.depth > graph.nodes.length) {
					continue;
				}

				levels.set(item.id, item.depth);

				for (const childId of [...(childrenById.get(item.id) || [])].sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))) {
					queue.push({ id: childId, depth: item.depth + 1 });
				}
			}

			for (const node of graph.nodes) {
				if (!levels.has(node.id)) {
					levels.set(node.id, node.type === 'instruction' ? -2 : node.type === 'prompt' || node.type === 'skill' ? -1 : 0);
				}
			}

			for (const link of graph.links.filter(link => link.type === 'runs-with-agent')) {
				const targetLevel = levels.get(link.target) || 0;
				levels.set(link.source, targetLevel - 1);
			}

			const agentLevels = graph.nodes.filter(node => node.type === 'agent').map(node => levels.get(node.id) || 0);
			const belowAgentsLevel = (agentLevels.length ? Math.max(...agentLevels) : 0) + 1;

			for (const node of graph.nodes) {
				if (node.type === 'mcp' || node.type === 'hook' || node.type === 'tool') {
					levels.set(node.id, belowAgentsLevel);
				}
			}

			for (const link of graph.links.filter(link => link.type === 'has-hook-event')) {
				levels.set(link.target, (levels.get(link.source) || belowAgentsLevel) + 1);
			}

			const minLevel = Math.min(...levels.values());
			const normalizedLevels = new Map([...levels.entries()].map(([id, level]) => [id, level - minLevel]));
			const verticalGap = 100 * nodeScale;
			const topPadding = 66 * nodeScale;
			const nodesByLevel = new Map();

			for (const node of graph.nodes) {
				const level = normalizedLevels.get(node.id) || 0;
				const nodes = nodesByLevel.get(level) || [];
				nodes.push(node);
				nodesByLevel.set(level, nodes);
			}

			const positions = new Map();

			for (const [level, nodes] of nodesByLevel) {
				nodes.sort(compareNodes);
				const horizontalGap = Math.max(108 * nodeScale, width / (nodes.length + 1));

				nodes.forEach((node, index) => {
					const sidePadding = (node.type === 'instruction' ? 52 : 36) * nodeScale;

					positions.set(node.id, {
						x: Math.min(width - sidePadding, Math.max(sidePadding, horizontalGap * (index + 1))),
						y: topPadding + level * verticalGap,
					});
				});
			}

			return positions;
		}

		function layoutRadialGraph(graph, width) {
			const positions = new Map();
			const orderedNodes = [...graph.nodes].sort(compareNodes);
			const centerX = width / 2;
			const centerY = Math.max(180 * nodeScale, orderedNodes.length * 11 * nodeScale);
			const radius = Math.max(110 * nodeScale, orderedNodes.length * 11 * nodeScale);
			const centerCandidates = orderedNodes.filter(node => node.type === 'agent' && node.uri && node.userInvocable !== false);
			const centerNode = centerCandidates[0] || orderedNodes.find(node => node.type === 'agent') || orderedNodes[0];
			const ringNodes = orderedNodes.filter(node => node !== centerNode);

			if (centerNode) {
				positions.set(centerNode.id, { x: centerX, y: centerY });
			}

			ringNodes.forEach((node, index) => {
				const angle = (Math.PI * 2 * index / Math.max(1, ringNodes.length)) - Math.PI / 2;

				positions.set(node.id, {
					x: centerX + Math.cos(angle) * radius,
					y: centerY + Math.sin(angle) * radius,
				});
			});

			return positions;
		}

		function layoutForceDirectedGraph(graph, width) {
			const positions = new Map();
			const velocities = new Map();
			const orderedNodes = [...graph.nodes].sort(compareNodes);
			const height = Math.max(360 * nodeScale, Math.ceil(Math.sqrt(Math.max(1, orderedNodes.length))) * 160 * nodeScale);
			const centerX = width / 2;
			const centerY = height / 2;
			const initialRadius = Math.min(width, height) * 0.34;
			const repulsion = 3600 * nodeScale;
			const springLength = 105 * nodeScale;
			const springStrength = 0.018;

			orderedNodes.forEach((node, index) => {
				const angle = Math.PI * 2 * index / Math.max(1, orderedNodes.length);

				positions.set(node.id, {
					x: centerX + Math.cos(angle) * initialRadius,
					y: centerY + Math.sin(angle) * initialRadius,
				});
				velocities.set(node.id, { x: 0, y: 0 });
			});

			for (let iteration = 0; iteration < 120; iteration += 1) {
				for (let leftIndex = 0; leftIndex < orderedNodes.length; leftIndex += 1) {
					for (let rightIndex = leftIndex + 1; rightIndex < orderedNodes.length; rightIndex += 1) {
						const left = orderedNodes[leftIndex];
						const right = orderedNodes[rightIndex];
						const leftPosition = positions.get(left.id);
						const rightPosition = positions.get(right.id);
						const leftVelocity = velocities.get(left.id);
						const rightVelocity = velocities.get(right.id);
						const deltaX = leftPosition.x - rightPosition.x;
						const deltaY = leftPosition.y - rightPosition.y;
						const distanceSquared = Math.max(100, deltaX * deltaX + deltaY * deltaY);
						const force = repulsion / distanceSquared;
						const distance = Math.sqrt(distanceSquared);
						const forceX = deltaX / distance * force;
						const forceY = deltaY / distance * force;

						leftVelocity.x += forceX;
						leftVelocity.y += forceY;
						rightVelocity.x -= forceX;
						rightVelocity.y -= forceY;
					}
				}

				for (const link of graph.links) {
					const source = positions.get(link.source);
					const target = positions.get(link.target);
					const sourceVelocity = velocities.get(link.source);
					const targetVelocity = velocities.get(link.target);

					if (!source || !target || !sourceVelocity || !targetVelocity) {
						continue;
					}

					const deltaX = target.x - source.x;
					const deltaY = target.y - source.y;
					const distance = Math.max(1, Math.sqrt(deltaX * deltaX + deltaY * deltaY));
					const force = (distance - springLength) * springStrength;
					const forceX = deltaX / distance * force;
					const forceY = deltaY / distance * force;

					sourceVelocity.x += forceX;
					sourceVelocity.y += forceY;
					targetVelocity.x -= forceX;
					targetVelocity.y -= forceY;
				}

				for (const node of orderedNodes) {
					const position = positions.get(node.id);
					const velocity = velocities.get(node.id);

					velocity.x = (velocity.x + (centerX - position.x) * 0.002) * 0.82;
					velocity.y = (velocity.y + (centerY - position.y) * 0.002) * 0.82;
					position.x = Math.min(width - 60 * nodeScale, Math.max(60 * nodeScale, position.x + velocity.x));
					position.y = Math.min(height - 60 * nodeScale, Math.max(70 * nodeScale, position.y + velocity.y));
				}
			}

			return positions;
		}

		function renderAgentMarker(isInvocable, isSubAgent) {
			if (isInvocable) {
				return renderRobotMarker(!isSubAgent);
			}

			if (isSubAgent) {
				return renderCogMarker();
			}

			return '';
		}

		function renderRobotMarker(withStar) {
			return '<g class="agent-marker" transform="translate(0 1.4)" aria-hidden="true">' +
				'<path class="marker-line" d="M0 -7v-2"></path>' +
				'<rect class="marker-fill" x="-6" y="-6" width="12" height="10" rx="3"></rect>' +
				'<circle class="marker-dot" cx="-2.5" cy="-1.5" r="1"></circle>' +
				'<circle class="marker-dot" cx="2.5" cy="-1.5" r="1"></circle>' +
				'<path class="marker-line" d="M-3 2h6"></path>' +
				(withStar ? '<path class="marker-star" d="M6.8 -10.7l1.1 2.4 2.6.4-1.9 1.8.5 2.6-2.3-1.3-2.3 1.3.5-2.6-1.9-1.8 2.6-.4z"></path>' : '') +
			'</g>';
		}

		function renderCogMarker() {
			return '<g class="agent-marker cog-marker" aria-hidden="true" transform="scale(0.62) translate(-12 -12)">' +
				'<path class="marker-line" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"></path>' +
				'<path class="marker-line" d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z"></path>' +
			'</g>';
		}

		function renderSkillMarker(skillContext) {
			return renderHammerMarker() + renderSkillContextMarker(skillContext);
		}

		function renderHammerMarker() {
			return '<g class="skill-marker" aria-hidden="true" transform="rotate(-38)">' +
				'<path class="marker-line" d="M-5 -4h8l2 2-2 2h-8z"></path>' +
				'<path class="marker-line" d="M0 0v8"></path>' +
			'</g>';
		}

		function renderSkillContextMarker(skillContext) {
			if (skillContext === 'inline') {
				return '<g class="skill-context-marker" aria-hidden="true" transform="translate(7 -8)">' +
					'<circle class="marker-badge" r="4.2"></circle>' +
					'<path class="marker-line" d="M-2 0h4M0 -2v4"></path>' +
				'</g>';
			}

			if (skillContext === 'fork') {
				return '<g class="skill-context-marker" aria-hidden="true" transform="translate(7 -8)">' +
					'<path class="marker-star" d="M0 -4.8l1.2 2.5 2.8.4-2 1.9.5 2.8L0 1.5l-2.5 1.3.5-2.8-2-1.9 2.8-.4z"></path>' +
				'</g>';
			}

			return '';
		}

		function renderMcpMarker() {
			return '<g class="mcp-marker" aria-hidden="true">' +
				'<rect class="marker-fill" x="-5" y="-3" width="10" height="8" rx="2"></rect>' +
				'<path class="marker-line" d="M-2 -3v-4M2 -3v-4M-2 -7h4M-5 1h-3M5 1h3M-8 1v4M8 1v4"></path>' +
			'</g>';
		}

		function renderHookMarker() {
			return '<g class="hook-marker" aria-hidden="true" transform="translate(2 0.4) scale(0.9)">' +
				'<circle class="marker-fill" cx="0" cy="-6.4" r="4.2"></circle>' +
				'<circle class="marker-hole" cx="0" cy="-6.4" r="1.5"></circle>' +
				'<path class="marker-line" d="M0 -3v6.2c0 3-2.3 5.3-5.4 5.3c-2.9 0-5.1-2.1-5.1-5.1"></path>' +
				'<path class="marker-fill" d="M-10.4 -1.4l5.4 5.4h-5.4z"></path>' +
			'</g>';
		}

		function renderHandoffMarker() {
			return '<g class="agent-marker" aria-hidden="true">' +
				'<path class="marker-line" d="M-6 0h10"></path>' +
				'<path class="marker-fill" d="M2 -4l5 4-5 4z"></path>' +
				'<path class="marker-line" d="M-5 -5v10"></path>' +
			'</g>';
		}

		function selectNode(nodeId) {
			const parentLink = activeGraph.links.find(link => link.type === 'has-hook-event' && link.target === nodeId);
			const selectedId = parentLink?.source || nodeId;

			selectedNodeId = selectedId;
			renderGraph(activeGraph);
			renderEditor(activeGraph.nodes.find(node => node.id === selectedId));
		}

		function renderEditor(node) {
			if (!node) {
				const hadEditor = workspacePanels.classList.contains('has-editor');
				editorElement.hidden = true;
				editorElement.innerHTML = '';
				workspacePanels.classList.remove('has-editor');

				if (hadEditor) {
					scheduleSideBySideGraphRender();
				}

				return;
			}

			const hadEditor = workspacePanels.classList.contains('has-editor');

			const isEditable = Boolean(node.uri) && (node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill' || node.type === 'hook' || node.type === 'handoff');
			const modelField = isEditable && (node.type === 'agent' || node.type === 'prompt') ? renderModelField(node.model || '', node.type) : '';
			const relationField = node.type === 'agent'
				? renderAgentFlags(node.agents || [], node.id)
				: node.type === 'prompt'
					? '<label>' + renderFieldLabel('Agent mode', fieldHelp.promptAgent) + '<select id="edit-agent">' + renderPromptAgentOptions(node.agent || '') + '</select></label>'
					: '';
			const toolsField = node.type === 'agent' || node.type === 'prompt'
				? renderToolFlags((node.tools || []).filter(tool => !isMcpServerToolReference(tool)), activeGraph?.availableTools || [])
				: '';
			const userInvocableField = node.type === 'agent' || node.type === 'skill'
				? '<label class="checkbox-label"><input id="edit-user-invocable" type="checkbox" ' + (node.userInvocable === false ? '' : 'checked') + '>' + renderFieldLabel('User invocable', fieldHelp.userInvocable) + '</label>'
				: '';
			const nameField = '<label>' + renderFieldLabel(node.type === 'handoff' ? 'Label' : 'Name', node.type === 'agent' ? fieldHelp.agentName : node.type === 'prompt' ? fieldHelp.promptName : node.type === 'skill' ? fieldHelp.skillName : node.type === 'hook' ? fieldHelp.hookName : node.type === 'handoff' ? fieldHelp.handoffLabel : fieldHelp.instructionName) + '<input id="edit-name" type="text" value="' + escapeAttribute(node.label) + '"></label>';
			const readOnlyNote = node.type === 'mcp'
				? 'MCP servers are managed in the Extensions view.'
				: node.type === 'hook'
				? 'Hooks run shell commands at configured Copilot lifecycle events.'
				: node.type === 'instruction'
				? 'This instruction file is shown as an area because it automatically influences AI behavior.'
				: 'This node is inferred from a reference and does not have an editable file.';
			const readOnlyDetails = node.type === 'hook' ? renderHookDetails(node) : '';
			const handoffFields = node.type === 'handoff' ? nameField + renderHandoffFields(node) : '';
			const primaryFields = node.type === 'agent' && modelField ? '<div class="field-row">' + nameField + modelField + '</div>' : nameField;
			const pairedFields = node.type !== 'agent' && modelField && relationField ? '<div class="field-row">' + modelField + relationField + '</div>' : modelField + relationField;
			const agentFields = node.type === 'agent' ? renderAgentFields(node) : '';
			const skillFields = node.type === 'skill' ? renderSkillFields(node) : '';
			const instructionFields = node.type === 'instruction' ? renderInstructionFields(node) : '';
			const skillIssues = node.type === 'skill' && node.skillIssues?.length ? '<p class="editor-note">' + escapeHtml(node.skillIssues.join(' ')) + '</p>' : '';
			const hookFields = node.type === 'hook' ? primaryFields + renderHookCommandList(node) : '';
			const editableFields = node.type === 'skill'
				? skillIssues + userInvocableField + primaryFields + skillFields
				: node.type === 'hook' ? hookFields
				: node.type === 'handoff' ? handoffFields
				: node.type === 'instruction' ? primaryFields + instructionFields
				: node.type === 'agent' ? userInvocableField + primaryFields + agentFields + relationField + toolsField : userInvocableField + primaryFields + pairedFields + toolsField;

			editorElement.hidden = false;
			workspacePanels.classList.add('has-editor');

			if (!hadEditor) {
				scheduleSideBySideGraphRender();
			}

			applyEditorTextScale();
			editorElement.innerHTML = '<div class="editor-header">' +
				'<div class="editor-title"><h3>' + escapeHtml(node.label) + '</h3><p>' + escapeHtml(node.path || node.id) + '</p></div>' +
				'<div class="editor-actions">' +
					(node.uri ? '<button id="open-node" type="button">Open file</button>' : '') +
					(node.type === 'mcp' ? '<button id="open-mcp" type="button">Open MCP servers</button>' : '') +
					(isEditable ? '<button id="save-node" type="button">Save</button>' : '') +
				'</div>' +
			'</div>' +
			'<div id="editor-body" class="editor-body">' +
				(isEditable ? editableFields + (node.type === 'hook' || node.type === 'handoff' ? '' : '<label>' + renderFieldLabel(node.type === 'skill' ? 'Instructions' : 'System Prompt', node.type === 'agent' ? fieldHelp.agentBody : node.type === 'prompt' ? fieldHelp.promptBody : node.type === 'skill' ? fieldHelp.skillBody : fieldHelp.instructionBody) + '<textarea id="edit-body" class="body-field"' + renderBodyPlaceholderAttribute(node.type) + '>' + escapeHtml(node.body || '') + '</textarea></label>') : '<p class="editor-note">' + escapeHtml(readOnlyNote) + '</p>' + readOnlyDetails) +
			'</div>';

			const openButton = document.getElementById('open-node');
			const openMcpButton = document.getElementById('open-mcp');
			const saveButton = document.getElementById('save-node');
			const toolFilterInput = document.getElementById('tool-filter');
			const toolList = document.getElementById('tool-check-list');
			const toolPresetList = document.getElementById('tool-preset-list');

			if (toolFilterInput) {
				toolFilterInput.addEventListener('input', scheduleToolFilter);
				toolFilterInput.value = toolFilterValue;
				filterToolChoices();
			}

			if (toolList) {
				toolList.addEventListener('change', event => {
					if (event.target?.classList?.contains('edit-tool')) {
						updateActiveToolPills();
					}
				});
			}

			if (toolPresetList) {
				toolPresetList.addEventListener('click', event => {
					const presetButton = event.target?.closest?.('.tool-preset-button');

					if (presetButton) {
						applyToolPreset(presetButton.dataset.toolPreset);
					}
				});
			}

			if (openButton) {
				openButton.addEventListener('click', () => vscode.postMessage({ type: 'node:open', uri: node.uri }));
			}

			if (openMcpButton) {
				openMcpButton.addEventListener('click', () => vscode.postMessage({ type: 'mcp:open' }));
			}

			if (saveButton) {
				saveButton.addEventListener('click', () => saveNode(node));
			}

			const addCustomToolButton = document.getElementById('add-custom-tool');
			const addHandoffButton = document.getElementById('add-handoff');
			const handoffList = document.getElementById('handoff-list');

			if (addCustomToolButton) {
				addCustomToolButton.addEventListener('click', addCustomTool);
			}

			if (addHandoffButton) {
				addHandoffButton.addEventListener('click', addHandoffRow);
			}

			if (handoffList) {
				handoffList.addEventListener('click', event => {
					const target = event.target;

					if (target?.classList?.contains('remove-handoff')) {
						target.closest('.handoff-item')?.remove();

						if (!handoffList.querySelector('.handoff-item')) {
							handoffList.innerHTML = '<p class="editor-note handoff-empty">No handoffs configured for this agent.</p>';
						}
					}
				});
			}

			const addHookEventButton = document.getElementById('add-hook-event');

			if (addHookEventButton) {
				addHookEventButton.addEventListener('click', addHookEventRow);
			}

			const hookCommandList = document.getElementById('hook-command-list');

			if (hookCommandList) {
				hookCommandList.addEventListener('change', event => {
					if (event.target?.classList?.contains('edit-hook-property-enabled')) {
						updateHookPropertyInput(event.target);
					}
				});
			}

		}

		function renderHookCommandList(node) {
			const commands = getHookEditorRows(node);
			const rows = commands.length
				? commands.map(command => renderHookCommandRow(command.id, command.event, command.command, command.properties || {})).join('')
				: '<p class="editor-note">No configured hook commands were found in this file.</p>';

			return '<div class="hook-command-section"><h4>Configured hooks</h4><div id="hook-command-list" class="hook-command-list">' + rows + '</div>' +
				'<div class="hook-command-actions"><button id="add-hook-event" type="button">Add hook event</button></div>' +
				'<p class="editor-note">Checked properties are written to the hook command. Env accepts a JSON object.</p></div>';
		}

		function renderHookCommandRow(id, selectedEvent, command, properties = {}) {
			const propertyValues = { ...properties };

			if (command && !propertyValues.command) {
				propertyValues.command = command;
			}

			return '<div class="hook-command-item" data-hook-command-id="' + escapeAttribute(id) + '">' +
				'<label>Hook event<select class="edit-hook-event">' + renderHookEventOptions(selectedEvent) + '</select></label>' +
				renderHookCommandProperties(propertyValues) +
			'</div>';
		}

		function renderHookCommandProperties(properties) {
			const sortedProperties = [...hookCommandPropertyReferences].sort((left, right) => {
				const leftChecked = Boolean(properties[left.name]);
				const rightChecked = Boolean(properties[right.name]);

				return Number(rightChecked) - Number(leftChecked);
			});

			return '<div class="hook-property-list">' + sortedProperties.map(property => {
				const value = properties[property.name] || '';
				const checked = Boolean(value);

				return '<div class="hook-property-row ' + (checked ? 'is-active' : 'is-inactive') + '" data-hook-property="' + escapeAttribute(property.name) + '">' +
					'<label class="checkbox-label"><input class="edit-hook-property-enabled" type="checkbox" ' + (checked ? 'checked' : '') + '>' + escapeHtml(property.name) + '<span class="help-marker" title="' + escapeAttribute(property.description) + '" aria-label="' + escapeAttribute(property.description) + '">?</span></label>' +
					'<input class="edit-hook-property-value" type="text" value="' + escapeAttribute(value) + '" placeholder="' + escapeAttribute(property.placeholder) + '" ' + (checked ? '' : 'hidden disabled') + '>' +
				'</div>';
			}).join('') + '</div>';
		}

		function getHookEditorRows(node) {
			const commands = node.hookCommands || [];
			const commandEvents = new Set(commands.map(command => command.event));
			const eventOnlyRows = (node.hookEvents || [])
				.filter(event => event.commandCount === 0 && !commandEvents.has(event.name))
				.map(event => ({ id: 'event:' + event.name, event: event.name, command: '' }));

			return [...commands, ...eventOnlyRows].sort((left, right) => getHookEventReferenceOrder(left.event) - getHookEventReferenceOrder(right.event));
		}

		function getHookEventReferenceOrder(eventName) {
			const index = hookEventReferences.findIndex(event => event.name === eventName);

			return index === -1 ? hookEventReferences.length : index;
		}

		function renderHookEventOptions(selectedEvent) {
			return hookEventReferences.map(event => '<option value="' + escapeAttribute(event.name) + '"' + (event.name === selectedEvent ? ' selected' : '') + '>' + escapeHtml(event.name) + '</option>').join('');
		}

		function addHookEventRow() {
			const list = document.getElementById('hook-command-list');

			if (!list) {
				return;
			}

			const emptyState = list.querySelector('.editor-note');

			if (emptyState) {
				emptyState.remove();
			}

			list.insertAdjacentHTML('beforeend', renderHookCommandRow('new:' + Date.now(), 'PreToolUse', '', {}));
		}

		function updateHookPropertyInput(checkbox) {
			const row = checkbox.closest('.hook-property-row');
			const input = row?.querySelector('.edit-hook-property-value');

			if (!input) {
				return;
			}

			input.hidden = !checkbox.checked;
			input.disabled = !checkbox.checked;
			row.classList.toggle('is-active', checkbox.checked);
			row.classList.toggle('is-inactive', !checkbox.checked);
			sortHookPropertyRows(row.parentElement);

			if (checkbox.checked) {
				input.focus();
			}
		}

		function sortHookPropertyRows(list) {
			if (!list) {
				return;
			}

			const rows = [...list.querySelectorAll('.hook-property-row')];
			const activeRows = rows.filter(row => row.classList.contains('is-active'));
			const inactiveRows = rows.filter(row => row.classList.contains('is-inactive'));

			for (const row of [...activeRows, ...inactiveRows]) {
				list.appendChild(row);
			}
		}

		function renderHookDetails(node) {
			const events = node.hookEvents || [];
			const configuredEventNames = new Set(events.map(event => event.name));
			const selectedEventName = events[0]?.name || 'SessionStart';
			const eventReference = renderHookEventReference(selectedEventName, events, configuredEventNames);

			if (!events.length) {
				return eventReference + '<p class="editor-note">No enabled hook events were found in this configuration.</p>';
			}

			const eventItems = events.map(event => '<div class="hook-event-item">' +
				'<div class="hook-event-title"><span>' + escapeHtml(event.name) + '</span><span class="hook-pill">' + event.commandCount + ' command' + (event.commandCount === 1 ? '' : 's') + '</span>' + (event.variableDriven ? '<span class="hook-pill">Variable-driven tool logic</span>' : '') + '</div>' +
				'<p class="hook-event-description">' + escapeHtml(event.description) + '</p>' +
			'</div>').join('');

			const hasVariableDrivenToolLogic = events.some(event => event.variableDriven);

			return eventReference + '<div class="hook-event-list">' + eventItems + '</div>' +
				(hasVariableDrivenToolLogic ? '<p class="editor-note">Tool hook events receive variables such as tool_name and tool_input, so commands can branch on the selected tool and its input.</p>' : '');
		}

		function renderHookEventReference(selectedEventName, configuredEvents, configuredEventNames) {
			return '<div class="hook-event-reference"><label>Hook event<select id="hook-event-select">' +
				hookEventReferences.map(event => '<option value="' + escapeAttribute(event.name) + '"' + (event.name === selectedEventName ? ' selected' : '') + '>' + escapeHtml(event.name) + (configuredEventNames.has(event.name) ? ' (configured)' : '') + '</option>').join('') +
			'</select></label><div id="hook-event-summary" class="hook-event-summary">' + renderHookSelectedEventDetails(selectedEventName, configuredEvents) + '</div></div>';
		}

		function renderHookSelectedEventDetails(eventName, configuredEvents) {
			const eventReference = hookEventReferences.find(event => event.name === eventName) || hookEventReferences[0];
			const configuredEvent = configuredEvents.find(event => event.name === eventReference.name);
			const commandCount = configuredEvent ? '<span class="hook-pill">' + configuredEvent.commandCount + ' command' + (configuredEvent.commandCount === 1 ? '' : 's') + '</span>' : '<span class="hook-pill">Not configured</span>';
			const variableDriven = eventReference.variableDriven ? '<span class="hook-pill">Variable-driven tool logic</span>' : '';

			return '<div class="hook-event-title"><span>' + escapeHtml(eventReference.name) + '</span>' + commandCount + variableDriven + '</div>' +
				'<p class="hook-event-description">' + escapeHtml(eventReference.description) + '</p>';
		}

		function applyEditorTextScale() {
			const baseSize = Number.parseFloat(getComputedStyle(document.body).fontSize) || 13;
			editorElement.style.setProperty('--editor-text-size', (baseSize * textScale).toFixed(1) + 'px');
		}

		function saveSelectedNode() {
			const node = activeGraph?.nodes.find(candidate => candidate.id === selectedNodeId);

			if (node) {
				saveNode(node);
			}
		}

		function saveNode(node) {
			const isEditable = Boolean(node.uri) && (node.type === 'agent' || node.type === 'prompt' || node.type === 'instruction' || node.type === 'skill' || node.type === 'hook' || node.type === 'handoff');
			const nameInput = document.getElementById('edit-name');
			const bodyInput = document.getElementById('edit-body');

			if (!isEditable || !nameInput || (node.type !== 'hook' && node.type !== 'handoff' && !bodyInput)) {
				return;
			}

			const editedHandoffs = node.type === 'agent' ? getEditedHandoffs() : [];
			const handoffValidation = node.type === 'agent'
				? validateEditedHandoffs(editedHandoffs)
				: node.type === 'handoff'
					? validateDirectHandoffEditor()
					: { ok: true };

			if (!handoffValidation.ok) {
				setStatus('Unable to save: handoff ' + (handoffValidation.index + 1) + ' is missing ' + handoffValidation.field + '.');
				handoffValidation.element?.focus();
				return;
			}

			setStatus('Saving ' + node.label + '...');
			pendingSaveScrollState = captureEditorScrollState();
			vscode.postMessage({
				type: 'node:save',
				nodeType: node.type,
				uri: node.uri,
				handoffIndex: node.handoffIndex,
				name: nameInput.value,
				agents: getCheckedAgents(),
				tools: unique([...getCheckedTools(), ...(node.type === 'agent' ? (node.tools || []).filter(isMcpServerToolReference) : [])]),
				model: document.getElementById('edit-model')?.value,
				handoffModel: node.type === 'handoff' ? document.getElementById('edit-model')?.value : undefined,
				userInvocable: document.getElementById('edit-user-invocable')?.checked,
				agent: document.getElementById('edit-agent')?.value,
				prompt: document.getElementById('edit-prompt')?.value,
				send: document.getElementById('edit-send')?.checked,
				description: document.getElementById('edit-description')?.value,
				applyTo: document.getElementById('edit-apply-to')?.value,
				argumentHint: document.getElementById('edit-argument-hint')?.value,
				handoffs: node.type === 'agent' ? JSON.stringify(editedHandoffs.map(item => item.handoff)) : undefined,
				disableModelInvocation: document.getElementById('edit-disable-model-invocation')?.checked,
				skillContext: document.getElementById('edit-skill-context')?.value,
				hookCommands: JSON.stringify(getHookCommandEdits()),
				body: bodyInput?.value,
			});
		}

		function captureEditorScrollState() {
			return {
				windowX: window.scrollX,
				windowY: window.scrollY,
				documentX: document.documentElement.scrollLeft,
				documentY: document.documentElement.scrollTop,
				bodyX: document.body.scrollLeft,
				bodyY: document.body.scrollTop,
				editorX: editorElement.scrollLeft,
				editorY: editorElement.scrollTop,
			};
		}

		function restorePendingSaveScrollState() {
			const scrollState = pendingSaveScrollState;

			if (!scrollState) {
				return;
			}

			pendingSaveScrollState = undefined;

			requestAnimationFrame(() => {
				document.documentElement.scrollLeft = scrollState.documentX;
				document.documentElement.scrollTop = scrollState.documentY;
				document.body.scrollLeft = scrollState.bodyX;
				document.body.scrollTop = scrollState.bodyY;
				editorElement.scrollLeft = scrollState.editorX;
				editorElement.scrollTop = scrollState.editorY;
				window.scrollTo(scrollState.windowX, scrollState.windowY);
			});
		}

		function getHookCommandEdits() {
			return [...editorElement.querySelectorAll('.hook-command-item')].map(row => ({
				id: row.dataset.hookCommandId || '',
				event: row.querySelector('.edit-hook-event')?.value || 'PreToolUse',
				properties: getHookCommandPropertyEdits(row),
			}));
		}

		function getHookCommandPropertyEdits(row) {
			const properties = {};

			for (const propertyRow of row.querySelectorAll('.hook-property-row')) {
				const name = propertyRow.dataset.hookProperty;
				const enabled = propertyRow.querySelector('.edit-hook-property-enabled')?.checked;
				const value = propertyRow.querySelector('.edit-hook-property-value')?.value || '';

				if (name && enabled) {
					properties[name] = value;
				}
			}

			return properties;
		}

		function renderAgentFields(node) {
			return '<label>' + renderFieldLabel('Description', fieldHelp.agentDescription) + '<textarea id="edit-description" class="compact-field" placeholder="' + escapeAttribute(agentDescriptionPlaceholder) + '">' + escapeHtml(node.description || '') + '</textarea></label>' +
				'<label>' + renderFieldLabel('Argument hint', fieldHelp.agentArgumentHint) + '<input id="edit-argument-hint" type="text" value="' + escapeAttribute(node.argumentHint || '') + '"></label>' +
				'<label class="checkbox-label"><input id="edit-disable-model-invocation" type="checkbox" ' + (node.disableModelInvocation ? 'checked' : '') + '>' + renderFieldLabel('Disable Model Invocation', fieldHelp.agentDisableModelInvocation) + '</label>' +
				renderAgentHandoffEditor(node.handoffs || []);
		}

		function renderBodyPlaceholderAttribute(nodeType) {
			return nodeType === 'agent' ? ' placeholder="' + escapeAttribute(agentBodyPlaceholder) + '"' : '';
		}

		function renderAgentHandoffEditor(handoffs) {
			const rows = handoffs.length
				? handoffs.map((handoff, index) => renderHandoffEditorRow(handoff, index)).join('')
				: '<p class="editor-note handoff-empty">No handoffs configured for this agent.</p>';
			const labels = handoffs.map(handoff => readHandoffProperty(handoff, 'label')).filter(Boolean);

			return '<details class="choice-details"><summary>' + renderFieldLabel('Handoffs', fieldHelp.agentHandoffs) + renderSelectedHandoffPills(labels) + '</summary>' +
				renderSelectedHandoffPills(labels) +
				'<div id="handoff-list" class="hook-command-list">' + rows + '</div><div class="hook-command-actions"><button id="add-handoff" type="button">Add handoff</button></div></details>';
		}

		function renderSelectedHandoffPills(handoffLabels) {
			const sortedLabels = unique(handoffLabels.filter(Boolean)).sort((left, right) => String(left).localeCompare(String(right)));

			return sortedLabels.length ? '<div class="selected-tools">' + sortedLabels.map(label => '<span class="tool-pill">' + escapeHtml(label) + '</span>').join('') + '</div>' : '';
		}

		function renderHandoffEditorRow(handoff, index) {
			const label = readHandoffProperty(handoff, 'label') || '';
			const agent = readHandoffProperty(handoff, 'agent') || '';
			const prompt = readHandoffProperty(handoff, 'prompt') || '';
			const send = Boolean(readHandoffProperty(handoff, 'send'));
			const model = readHandoffProperty(handoff, 'model') || '';

			return '<div class="hook-command-item handoff-item" data-handoff-index="' + index + '">' +
				'<div class="handoff-item-header"><span>Handoff</span><button class="remove-handoff" type="button">Remove</button></div>' +
				'<div class="field-row"><label>' + renderFieldLabel('Label', fieldHelp.handoffLabel) + '<input class="edit-handoff-label" type="text" value="' + escapeAttribute(label) + '"></label>' +
				'<label>' + renderFieldLabel('Agent', fieldHelp.handoffAgent) + '<select class="edit-handoff-agent">' + renderHandoffAgentOptions(agent) + '</select></label></div>' +
				'<label>' + renderFieldLabel('Prompt', fieldHelp.handoffPrompt) + '<textarea class="edit-handoff-prompt compact-field">' + escapeHtml(prompt) + '</textarea></label>' +
				'<div class="field-row"><label class="checkbox-label"><input class="edit-handoff-send" type="checkbox" ' + (send ? 'checked' : '') + '>' + renderFieldLabel('Send', fieldHelp.handoffSend) + '</label>' +
				'<label>' + renderFieldLabel('AI model', fieldHelp.handoffModel) + '<select class="edit-handoff-model">' + renderModelOptions(model) + '</select></label></div>' +
			'</div>';
		}

		function addHandoffRow() {
			const list = document.getElementById('handoff-list');

			if (!list) {
				return;
			}

			list.querySelector('.handoff-empty')?.remove();
			list.insertAdjacentHTML('beforeend', renderHandoffEditorRow({}, list.querySelectorAll('.handoff-item').length));
		}

		function getEditedHandoffs() {
			return [...editorElement.querySelectorAll('#handoff-list .handoff-item')].map(item => {
				const labelInput = item.querySelector('.edit-handoff-label');
				const agentInput = item.querySelector('.edit-handoff-agent');
				const promptInput = item.querySelector('.edit-handoff-prompt');
				const sendInput = item.querySelector('.edit-handoff-send');
				const modelInput = item.querySelector('.edit-handoff-model');
				const label = labelInput?.value.trim() || '';
				const agent = agentInput?.value || '';
				const prompt = promptInput?.value.trim() || '';
				const send = Boolean(sendInput?.checked);
				const model = modelInput?.value || '';

				const handoff = {
					label,
					agent,
					prompt,
					send,
				};

				if (model) {
					handoff.model = model;
				}

				return {
					handoff,
					inputs: {
						label: labelInput,
						agent: agentInput,
						prompt: promptInput,
						send: sendInput,
					},
				};
			});
		}

		function validateEditedHandoffs(items) {
			for (const [index, item] of items.entries()) {
				if (!item.handoff.label) {
					return { ok: false, index, field: 'label', element: item.inputs.label };
				}

				if (!item.handoff.agent) {
					return { ok: false, index, field: 'agent', element: item.inputs.agent };
				}

				if (!item.handoff.prompt) {
					return { ok: false, index, field: 'prompt', element: item.inputs.prompt };
				}

				if (!item.inputs.send) {
					return { ok: false, index, field: 'send', element: item.inputs.send };
				}
			}

			return { ok: true };
		}

		function validateDirectHandoffEditor() {
			const labelInput = document.getElementById('edit-name');
			const agentInput = document.getElementById('edit-agent');
			const promptInput = document.getElementById('edit-prompt');
			const sendInput = document.getElementById('edit-send');

			if (!labelInput?.value.trim()) {
				return { ok: false, index: 0, field: 'label', element: labelInput };
			}

			if (!agentInput?.value) {
				return { ok: false, index: 0, field: 'agent', element: agentInput };
			}

			if (!promptInput?.value.trim()) {
				return { ok: false, index: 0, field: 'prompt', element: promptInput };
			}

			if (!sendInput) {
				return { ok: false, index: 0, field: 'send', element: sendInput };
			}

			return { ok: true };
		}

		function getHandoffDescription(handoff) {
			const agent = readHandoffProperty(handoff, 'agent');
			const prompt = readHandoffProperty(handoff, 'prompt');
			const send = readHandoffProperty(handoff, 'send') ? 'Auto-submit' : 'Prefill prompt';

			return [agent ? 'Target: ' + agent : '', prompt ? 'Prompt: ' + prompt : '', send].filter(Boolean).join(' - ');
		}

		function renderHandoffFields(node) {
			return '<label>' + renderFieldLabel('Agent', fieldHelp.handoffAgent) + '<select id="edit-agent">' + renderHandoffAgentOptions(node.handoffAgent || '') + '</select></label>' +
				'<label>' + renderFieldLabel('Prompt', fieldHelp.handoffPrompt) + '<textarea id="edit-prompt" class="compact-field">' + escapeHtml(node.handoffPrompt || '') + '</textarea></label>' +
				'<label class="checkbox-label"><input id="edit-send" type="checkbox" ' + (node.handoffSend ? 'checked' : '') + '>' + renderFieldLabel('Send', fieldHelp.handoffSend) + '</label>' +
				renderModelField(node.handoffModel || '', 'handoff');
		}

		function readHandoffProperty(handoff, property) {
			return handoff && typeof handoff === 'object' ? handoff[property] : undefined;
		}

		function renderSkillFields(node) {
			return '<label>' + renderFieldLabel('Description', fieldHelp.skillDescription) + '<textarea id="edit-description" class="compact-field">' + escapeHtml(node.description || '') + '</textarea></label>' +
				'<label>' + renderFieldLabel('Argument hint', fieldHelp.skillArgumentHint) + '<input id="edit-argument-hint" type="text" value="' + escapeAttribute(node.argumentHint || '') + '"></label>' +
				'<label class="checkbox-label"><input id="edit-disable-model-invocation" type="checkbox" ' + (node.disableModelInvocation ? 'checked' : '') + '>' + renderFieldLabel('Disable Model Invocation', fieldHelp.skillDisableModelInvocation) + '</label>' +
				'<label>' + renderFieldLabel('Context', fieldHelp.skillContext) + '<select id="edit-skill-context">' + renderSkillContextOptions(node.skillContext || '') + '</select></label>';
		}

		function renderInstructionFields(node) {
			return '<label>' + renderFieldLabel('Description', fieldHelp.instructionDescription) + '<textarea id="edit-description" class="compact-field">' + escapeHtml(node.description || '') + '</textarea></label>' +
				'<label>' + renderFieldLabel('Apply to', fieldHelp.instructionApplyTo) + '<input id="edit-apply-to" type="text" value="' + escapeAttribute(node.applyTo || '') + '" placeholder="**/*.ts"></label>';
		}

		function renderHandoffAgentOptions(selectedAgent) {
			const builtInAgents = ['agent', 'ask', 'edit', 'plan'];
			const customAgents = (activeGraph?.nodes || [])
				.filter(node => node.type === 'agent' && node.uri && node.userInvocable !== false)
				.map(node => node.label)
				.sort((left, right) => left.localeCompare(right));
			const agentNames = unique([...builtInAgents, ...customAgents]);

			return '<option value="">Select agent...</option>' + agentNames.map(agentName => '<option value="' + escapeAttribute(agentName) + '"' + (agentName === selectedAgent ? ' selected' : '') + '>' + escapeHtml(agentName) + '</option>').join('');
		}

		function renderSkillContextOptions(selectedContext) {
			const options = [
				['', 'Default'],
				['inline', 'Inline'],
				['fork', 'Fork'],
			];

			return options.map(option => '<option value="' + escapeAttribute(option[0]) + '"' + (option[0] === selectedContext ? ' selected' : '') + '>' + escapeHtml(option[1]) + '</option>').join('');
		}

		function renderAgentFlags(selectedAgents, currentNodeId) {
			const selected = new Set(selectedAgents);
			const availableAgents = (activeGraph?.nodes || [])
				.filter(node => node.type === 'agent' && node.uri && node.id !== currentNodeId)
				.map(node => node.label);
			const agentNames = unique([...availableAgents, ...selectedAgents]).sort((left, right) => left.localeCompare(right));

			if (!agentNames.length) {
				return '<div><div class="field-label">' + renderFieldLabel('Agents', fieldHelp.agentAgents) + '</div><p class="choice-empty">No available agents found.</p></div>';
			}

			return '<details class="choice-details" open><summary>' + renderFieldLabel('Agents', fieldHelp.agentAgents) + '</summary><div class="choice-list">' + agentNames.map(agentName => '<label class="choice-check" title="' + escapeAttribute(agentName) + '"><input class="edit-agent-reference" type="checkbox" value="' + escapeAttribute(agentName) + '" ' + (selected.has(agentName) ? 'checked' : '') + '><span class="choice-name">' + escapeHtml(agentName) + '</span></label>').join('') + '</div></details>';
		}

		function renderToolFlags(selectedTools, availableTools) {
			const selected = new Set(selectedTools);
			const descriptions = new Map(availableTools.map(tool => [tool.name, tool.description || tool.name]));
			const toolNames = unique([...availableTools.map(tool => tool.name), ...selectedTools]).sort((left, right) => left.localeCompare(right));
			const presetButtons = renderToolPresetButtons();

			if (!toolNames.length) {
				return '<div class="field-label">' + renderFieldLabel('Tools', fieldHelp.tools) + '</div>' + presetButtons + '<p class="choice-empty">No available tools found.</p><div id="tool-check-list" class="choice-list"></div>' + renderCustomToolInput();
			}

			return '<details class="choice-details"><summary>' + renderFieldLabel('Tools', fieldHelp.tools) + renderSelectedToolPills([...selected]) + '</summary>' + presetButtons + '<div class="tool-filter"><input id="tool-filter" type="text" value="' + escapeAttribute(toolFilterValue) + '" placeholder="Filter tools"></div>' + renderSelectedToolPills([...selected]) + '<div id="tool-check-list" class="choice-list tool-choice-list">' + toolNames.map(toolName => renderToolCheckbox(toolName, selected.has(toolName), descriptions.get(toolName) || toolName)).join('') + '</div>' + renderCustomToolInput() + '</details>';
		}

		function renderToolPresetButtons() {
			return '<div id="tool-preset-list" class="tool-preset-list" aria-label="Prebuilt tool selections">' + toolPresets.map((preset, index) => '<button class="tool-preset-button" type="button" data-tool-preset="' + index + '" title="' + escapeAttribute(preset.tools.join(', ')) + '">' + escapeHtml(preset.label) + '</button>').join('') + '</div>';
		}

		function renderSelectedToolPills(toolNames) {
			const sortedToolNames = unique(toolNames.filter(Boolean)).sort((left, right) => left.localeCompare(right));

			if (!sortedToolNames.length) {
				return '<div class="selected-tools active-tools empty-tools" aria-label="Active tools"><span class="tool-pill empty">No active tools</span></div>';
			}

			return '<div class="selected-tools active-tools" aria-label="Active tools">' + sortedToolNames.map(toolName => '<span class="tool-pill" title="' + escapeAttribute(toolName) + '">' + escapeHtml(toolName) + '</span>').join('') + '</div>';
		}

		function renderToolCheckbox(toolName, checked, description) {
			return '<label class="choice-check" title="' + escapeAttribute(toolName) + '"><input class="edit-tool" type="checkbox" value="' + escapeAttribute(toolName) + '" ' + (checked ? 'checked' : '') + '><span class="choice-name">' + escapeHtml(toolName) + '</span><span class="help-marker" title="' + escapeAttribute(description) + '" aria-label="' + escapeAttribute(description) + '">?</span></label>';
		}

		function renderCustomToolInput() {
			return '<div class="custom-tool-row"><input id="custom-tool-name" type="text" placeholder="Custom tool name"><button id="add-custom-tool" type="button">Add</button></div>';
		}

		function renderModelField(value, nodeType) {
			return '<label>' + renderFieldLabel('AI model', nodeType === 'agent' ? fieldHelp.agentModel : nodeType === 'handoff' ? fieldHelp.handoffModel : fieldHelp.promptModel) + '<select id="edit-model">' + renderModelOptions(value) + '</select></label>';
		}

		function renderModelOptions(value) {
			const models = unique([value, ...(activeGraph?.availableModels || []).map(model => model.value)].filter(Boolean));

			return ['<option value=""></option>', ...models.map(model => '<option value="' + escapeAttribute(model) + '"' + (model === value ? ' selected' : '') + '>' + escapeHtml(model) + '</option>')].join('');
		}

		function formatModelLabel(model) {
			const label = model || 'current model';

			return label.length > 22 ? label.slice(0, 19) + '...' : label;
		}

		function formatContextEstimate(tokens) {
			if (tokens >= 1000) {
				return '~' + (tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1) + 'k ctx';
			}

			return '~' + tokens + ' ctx';
		}

		function renderFieldLabel(label, helpText) {
			return '<span class="label-text">' + escapeHtml(label) + '<span class="help-marker" title="' + escapeAttribute(helpText) + '" aria-label="' + escapeAttribute(helpText) + '">?</span></span>';
		}

		function closeNewDialog() {
			newDialogBackdrop.hidden = true;
		}

		function closeSettingsDialog() {
			settingsDialogBackdrop.hidden = true;
		}

		function closeAboutDialog() {
			aboutDialogBackdrop.hidden = true;
		}

		function updateInstructionTypeVisibility() {
			const mcpSelected = newKind.value === 'mcp';

			newInstructionTypeLabel.hidden = newKind.value !== 'instruction';
			newNameLabel.hidden = mcpSelected;
			newMcpInfo.hidden = !mcpSelected;
			submitNewButton.textContent = mcpSelected ? 'Open MCP servers' : 'Create';
		}

		function renderPromptAgentOptions(selectedAgent) {
			const options = unique(['ask', 'agent', 'plan', 'model', ...(activeGraph?.nodes || []).filter(node => node.type === 'agent' && node.uri).map(node => node.label), selectedAgent].filter(Boolean));

			return options.map(option => '<option value="' + escapeAttribute(option) + '"' + (option === selectedAgent ? ' selected' : '') + '>' + escapeHtml(option) + '</option>').join('');
		}

		function getCheckedTools() {
			return [...editorElement.querySelectorAll('.edit-tool:checked')].map(tool => tool.value);
		}

		function getCheckedAgents() {
			return [...editorElement.querySelectorAll('.edit-agent-reference:checked')].map(agent => agent.value);
		}

		function scheduleToolFilter() {
			toolFilterValue = document.getElementById('tool-filter')?.value || '';
			clearTimeout(toolFilterTimeout);
			toolFilterTimeout = setTimeout(filterToolChoices, 220);
		}

		function filterToolChoices() {
			const toolFilterInput = document.getElementById('tool-filter');

			if (toolFilterInput) {
				toolFilterValue = toolFilterInput.value;
			}

			for (const toolChoice of editorElement.querySelectorAll('#tool-check-list .choice-check')) {
				const toolName = toolChoice.querySelector('.edit-tool')?.value || '';
				toolChoice.hidden = !isToolChoiceVisibleForFilter(toolName, toolFilterValue);
			}
		}

		function updateActiveToolPills() {
			const activeTools = [...editorElement.querySelectorAll('.active-tools')];
			const renderedPills = renderSelectedToolPills(getCheckedTools());

			for (const activeToolsElement of activeTools) {
				activeToolsElement.outerHTML = renderedPills;
			}
		}

		function isMcpServerToolReference(toolName) {
			return typeof toolName === 'string' && toolName.endsWith('/*');
		}

		function addCustomTool() {
			const customToolName = document.getElementById('custom-tool-name');
			const toolList = document.getElementById('tool-check-list');
			const name = customToolName?.value.trim();
			const existingTool = [...editorElement.querySelectorAll('.edit-tool')].find(tool => tool.value === name);

			if (!name || !toolList) {
				return;
			}

			if (existingTool) {
				existingTool.checked = true;
				updateActiveToolPills();
				customToolName.value = '';
				customToolName.focus();
				return;
			}

			toolList.insertAdjacentHTML('beforeend', renderToolCheckbox(name, true, 'Custom tool. Uncheck it to remove it when saving.'));
			updateActiveToolPills();
			filterToolChoices();
			customToolName.value = '';
			customToolName.focus();
		}

		function applyToolPreset(presetIndex) {
			const preset = toolPresets[Number(presetIndex)];
			const toolList = document.getElementById('tool-check-list');

			if (!preset || !toolList) {
				return;
			}

			const presetTools = new Set(preset.tools);

			for (const toolName of preset.tools) {
				if (![...editorElement.querySelectorAll('.edit-tool')].some(tool => tool.value === toolName)) {
					toolList.insertAdjacentHTML('beforeend', renderToolCheckbox(toolName, false, 'Prebuilt tool selection.'));
				}
			}

			for (const toolInput of editorElement.querySelectorAll('.edit-tool')) {
				toolInput.checked = presetTools.has(toolInput.value);
			}

			updateActiveToolPills();
			filterToolChoices();
		}

		function compareNodes(left, right) {
			return (left?.label || '').localeCompare(right?.label || '');
		}

		function unique(values) {
			return [...new Set(values)];
		}

		function escapeHtml(value) {
			return String(value).replace(/[&<>'"]/g, character => ({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				"'": '&#39;',
				'"': '&quot;',
			}[character]));
		}

		function escapeAttribute(value) {
			return escapeHtml(value).replace(/\`/g, '&#96;');
		}
	</script>
</body>
</html>`;
	}
}

function getFileKind(uri: vscode.Uri): WorkspaceAiFile['kind'] | undefined {
	if (uri.path.endsWith('.agent.md')) {
		return 'agent';
	}

	if (uri.path.endsWith('.prompt.md')) {
		return 'prompt';
	}

	if (isSkillFilePath(uri.path)) {
		return 'skill';
	}

	if (isInstructionFilePath(uri.path)) {
		return 'instruction';
	}

	return undefined;
}

function getFileName(uri: vscode.Uri, kind: WorkspaceAiFile['kind'], frontmatter: Record<string, unknown>): string {
	const frontmatterName = readString(frontmatter.name);

	if (frontmatterName) {
		return frontmatterName;
	}

	const suffix = kind === 'agent' ? '.agent.md' : kind === 'prompt' ? '.prompt.md' : kind === 'skill' ? '' : '.md';

	if (kind === 'skill') {
		return path.basename(path.dirname(uri.fsPath));
	}

	return path.basename(uri.fsPath, suffix);
}

function isSkillFilePath(uriPath: string): boolean {
	const pathParts = uriPath.replace(/\\/g, '/').split('/').filter(Boolean);
	const fileName = pathParts[pathParts.length - 1];
	const skillsFolder = pathParts[pathParts.length - 3];

	return fileName === 'SKILL.md' && skillsFolder === 'skills' && Boolean(pathParts[pathParts.length - 2]);
}

function isInstructionFilePath(uriPath: string): boolean {
	const fileName = path.posix.basename(uriPath);

	return uriPath.endsWith('.instructions.md')
		|| fileName === 'copilot-instructions.md'
		|| fileName === 'AGENTS.md'
		|| fileName === 'CLAUDE.md'
		|| fileName === 'Claude.md';
}

function isHookFilePath(uriPath: string): boolean {
	const normalizedPath = uriPath.replace(/\\/g, '/');

	return /\/\.github\/hooks\/[^/]+\.json$/.test(normalizedPath)
		|| normalizedPath.endsWith('/.claude/settings.json')
		|| normalizedPath.endsWith('/.claude/settings.local.json');
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
	const byUri = new Map<string, vscode.Uri>();

	for (const uri of uris) {
		byUri.set(uri.toString(), uri);
	}

	return [...byUri.values()];
}

function normalizeFrontmatter(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function readModel(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return readString(value);
	}

	if (Array.isArray(value)) {
		return readStringArray(value).join(', ');
	}

	return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function parseHandoffsInput(value: unknown): { ok: true; value: unknown[] } | { ok: false } {
	if (typeof value !== 'string' || !value.trim()) {
		return { ok: true, value: [] };
	}

	try {
		const parsed = JSON.parse(value) as unknown;

		if (Array.isArray(parsed)) {
			return { ok: true, value: parsed };
		}
	} catch {
		// Reported to the user by saveNode.
	}

	return { ok: false };
}

export function validateRequiredHandoffFields(handoffs: unknown[]): { ok: true } | { ok: false; index: number; field: 'label' | 'agent' | 'prompt' | 'send' } {
	for (const [index, handoff] of handoffs.entries()) {
		const record = normalizeObject(handoff);
		const label = readString(record.label) || readString(record.name);
		const agent = readString(record.agent) || readString(record.handoffAgent);
		const prompt = readString(record.prompt) || readString(record.handoffPrompt);
		const hasSend = typeof record.send === 'boolean' || typeof record.handoffSend === 'boolean';

		if (!label) {
			return { ok: false, index, field: 'label' };
		}

		if (!agent) {
			return { ok: false, index, field: 'agent' };
		}

		if (!prompt) {
			return { ok: false, index, field: 'prompt' };
		}

		if (!hasSend) {
			return { ok: false, index, field: 'send' };
		}
	}

	return { ok: true };
}

export function normalizePostedHandoffs(handoffs: unknown[]): unknown[] {
	return handoffs.map(handoff => {
		const record = normalizeObject(handoff);
		const label = readString(record.label) || readString(record.name);
		const agent = readString(record.agent) || readString(record.handoffAgent);
		const prompt = readString(record.prompt) || readString(record.handoffPrompt);
		const model = readModel(record.model ?? record.handoffModel);

		if (!label && !agent && !prompt && !model) {
			return undefined;
		}

		const normalized: Record<string, unknown> = {
			send: Boolean(record.send ?? record.handoffSend),
		};

		if (label) {
			normalized.label = label;
		}

		if (agent) {
			normalized.agent = agent;
		}

		if (prompt) {
			normalized.prompt = prompt;
		}

		if (model) {
			normalized.model = model;
		}

		return normalized;
	}).filter((handoff): handoff is Record<string, unknown> => Boolean(handoff));
}

function updateHandoffAtIndex(handoffs: unknown[], index: number, message: Record<string, unknown>): unknown[] {
	const nextHandoffs = [...handoffs];
	const existing = normalizeObject(nextHandoffs[index]);
	const updated: Record<string, unknown> = {
		...existing,
		send: Boolean(message.send),
	};

	writeOptionalString(updated, 'label', message.name);
	writeOptionalString(updated, 'agent', message.agent);
	writeOptionalString(updated, 'prompt', message.prompt);
	writeOptionalString(updated, 'model', message.handoffModel ?? message.model);
	nextHandoffs[index] = updated;

	return normalizePostedHandoffs(nextHandoffs);
}

function readSkillContext(value: unknown): 'inline' | 'fork' | undefined {
	return value === 'inline' || value === 'fork' ? value : undefined;
}

function writeOptionalString(target: Record<string, unknown>, key: string, value: unknown): void {
	const text = readString(value);

	if (text) {
		target[key] = text;
	} else {
		delete target[key];
	}
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return unique(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean));
}

function readHookEventName(value: unknown): HookEventName | undefined {
	return typeof value === 'string' && isHookEventName(value) ? value : undefined;
}

export function parseLines(value: unknown): string[] {
	if (Array.isArray(value)) {
		return readStringArray(value);
	}

	if (typeof value !== 'string') {
		return [];
	}

	return unique(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean));
}

function extractToolReferences(content: string): string[] {
	const matches = content.matchAll(/#tool:([A-Za-z0-9_.-]+)/g);

	return unique([...matches].map(match => match[1]));
}

function readHookEvents(hooks: Record<string, unknown>): HookEventSummary[] {
	const events: HookEventSummary[] = [];

	for (const [name, commands] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(commands)) {
			continue;
		}

		events.push({
			name,
			description: getHookEventDescription(name),
			commandCount: countHookCommands(commands),
			variableDriven: isVariableDrivenHookEvent(name),
		});
	}

	return events.sort((left, right) => getHookEventOrder(left.name) - getHookEventOrder(right.name));
}

function readHookCommands(hooks: Record<string, unknown>): HookCommandSummary[] {
	const commands: HookCommandSummary[] = [];

	for (const [name, entries] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(entries)) {
			continue;
		}

		entries.forEach((entry, index) => {
			const config = normalizeObject(entry);
			const command = readString(config.command) || readString(config.windows) || readString(config.linux) || readString(config.osx) || '';
			const properties = readHookCommandProperties(config);

			if (!Object.keys(properties).length) {
				return;
			}

			commands.push({
				id: `${name}:${index}`,
				event: name,
				index,
				name: readString(config.name) || `${name} command ${index + 1}`,
				command,
				properties,
			});
		});
	}

	return commands.sort((left, right) => getHookEventOrder(left.event) - getHookEventOrder(right.event) || left.index - right.index);
}

function readHookCommandProperties(config: Record<string, unknown>): Record<string, string> {
	const properties: Record<string, string> = {};

	for (const property of ['command', 'windows', 'linux', 'osx', 'cwd'] as const) {
		const value = readString(config[property]);

		if (value) {
			properties[property] = value;
		}
	}

	if (typeof config.timeout === 'number') {
		properties.timeout = String(config.timeout);
	} else {
		const timeout = readString(config.timeout);

		if (timeout) {
			properties.timeout = timeout;
		}
	}

	if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
		properties.env = JSON.stringify(config.env);
	} else {
		const env = readString(config.env);

		if (env) {
			properties.env = env;
		}
	}

	return properties;
}

function readHookEventArray(hooks: Record<string, unknown>, eventName: HookEventName): unknown[] {
	const entries = hooks[eventName];

	return Array.isArray(entries) ? entries : [];
}

function collectHookCommandObjects(hooks: Record<string, unknown>): Map<string, Record<string, unknown>> {
	const commands = new Map<string, Record<string, unknown>>();

	for (const [name, entries] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(entries)) {
			continue;
		}

		entries.forEach((entry, index) => {
			commands.set(`${name}:${index}`, normalizeObject(entry));
		});
	}

	return commands;
}

const editableHookCommandProperties = ['command', 'windows', 'linux', 'osx', 'cwd', 'env', 'timeout'] as const;

function readPostedHookCommands(value: unknown): Array<{ id: string; event: HookEventName; properties: Record<string, unknown> }> {
	if (typeof value !== 'string') {
		return [];
	}

	try {
		const parsed = JSON.parse(value) as unknown;

		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.map(item => {
			const command = normalizeObject(item);
			const event = readHookEventName(command.event) || 'PreToolUse';

			return {
				id: readString(command.id) || '',
				event,
				properties: normalizeObject(command.properties),
			};
		});
	} catch {
		return [];
	}
}

function normalizePostedHookCommandProperties(properties: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};

	for (const property of editableHookCommandProperties) {
		if (!Object.prototype.hasOwnProperty.call(properties, property)) {
			continue;
		}

		const value = properties[property];
		const text = typeof value === 'string' ? value : '';

		if (property === 'timeout') {
			const timeout = Number(text);

			normalized.timeout = Number.isFinite(timeout) ? timeout : text;
		} else if (property === 'env') {
			normalized.env = parseHookEnvValue(text);
		} else {
			normalized[property] = text;
		}
	}

	return normalized;
}

function parseHookEnvValue(value: string): unknown {
	try {
		const parsed = JSON.parse(value) as unknown;

		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed;
		}
	} catch {
		// Keep non-JSON values as text so the user's input is not lost.
	}

	return value;
}

function removeHookCommandProperties(command: Record<string, unknown>): Record<string, unknown> {
	for (const property of editableHookCommandProperties) {
		delete command[property];
	}

	return command;
}

function countHookCommands(eventEntries: unknown[]): number {
	return eventEntries.reduce<number>((total, entry) => {
		const config = normalizeObject(entry);
		const hooks = Array.isArray(config.hooks) ? config.hooks : [];

		return total + Math.max(1, hooks.length);
	}, 0);
}

function getHookEventOrder(eventName: HookEventSummary['name']): number {
	const order: HookEventSummary['name'][] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop'];

	return order.indexOf(eventName);
}

function getHookConfigName(source: string): string {
	const normalizedSource = source.replace(/\\/g, '/');
	const fileName = path.posix.basename(normalizedSource, '.json');

	return normalizedSource.includes('/hooks/') ? fileName : normalizedSource;
}

type CustomizationKind = 'agent' | 'prompt' | 'instruction' | 'skill' | 'hook';
type MarkdownCustomizationKind = Exclude<CustomizationKind, 'hook'>;
type InstructionCustomizationType = 'scoped' | 'copilot' | 'agents' | 'claude';

export function getCustomizationFolderUri(workspaceUri: vscode.Uri, kind: CustomizationKind, instructionType: InstructionCustomizationType = 'scoped'): vscode.Uri {
	if (kind === 'agent') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
	}

	if (kind === 'prompt') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'prompts');
	}

	if (kind === 'skill') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'skills');
	}

	if (kind === 'hook') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'hooks');
	}

	if (instructionType === 'copilot') {
		return vscode.Uri.joinPath(workspaceUri, '.github');
	}

	if (instructionType === 'agents') {
		return workspaceUri;
	}

	if (instructionType === 'claude') {
		return vscode.Uri.joinPath(workspaceUri, '.claude');
	}

	return vscode.Uri.joinPath(workspaceUri, '.github', 'instructions');
}

export function getCustomizationFileName(kind: CustomizationKind, displayName: string, instructionType: InstructionCustomizationType = 'scoped'): string {
	const stem = slugifyFileStem(displayName);

	if (kind === 'agent') {
		return `${stem}.agent.md`;
	}

	if (kind === 'prompt') {
		return `${stem}.prompt.md`;
	}

	if (kind === 'skill') {
		return 'SKILL.md';
	}

	if (kind === 'hook') {
		return `${stem}.json`;
	}

	if (instructionType === 'copilot') {
		return 'copilot-instructions.md';
	}

	if (instructionType === 'agents') {
		return 'AGENTS.md';
	}

	if (instructionType === 'claude') {
		return 'CLAUDE.md';
	}

	return `${stem}.instructions.md`;
}

export function createCustomizationMarkdown(kind: MarkdownCustomizationKind, displayName: string, instructionType: InstructionCustomizationType = 'scoped'): string {
	const skillName = getSkillFolderName(displayName);
	const frontmatter: Record<string, unknown> = {
		name: kind === 'skill' ? skillName : displayName.trim(),
	};

	if (kind !== 'agent') {
		frontmatter.description = kind === 'prompt'
				? 'Use when: describe when this prompt should be run.'
				: kind === 'skill'
					? 'Use when: describe what reusable capability this skill provides and when Copilot should load it.'
					: 'Use when: describe which files or tasks these instructions apply to.';
	}

	if (kind === 'agent') {
		frontmatter.tools = [];
		frontmatter.agents = [];
		frontmatter['user-invocable'] = true;
	} else if (kind === 'prompt') {
		frontmatter.agent = 'agent';
		frontmatter.tools = [];
	} else if (kind === 'skill') {
		frontmatter['user-invocable'] = false;
	} else if (kind === 'instruction' && instructionType === 'scoped') {
		frontmatter.applyTo = '**';
	}

	const heading = displayName.trim();
	const body = kind === 'agent'
		? ''
		: kind === 'prompt'
			? `# ${heading}\n\nDescribe the task this prompt should run, including expected inputs and output format.\n`
			: kind === 'skill'
				? `# ${heading}\n\nDescribe the skill's workflow, step-by-step procedures, expected inputs and outputs, and links to any resources in this skill directory.\n`
				: `# ${heading}\n\nDescribe the coding guidelines, project rules, and conventions that should influence AI assistance.\n`;

	return matter.stringify(body, frontmatter);
}

function cleanAgentPlaceholderText(value: unknown, fallback = ''): string {
	if (typeof value !== 'string') {
		return fallback;
	}

	const trimmedValue = value.trim();

	if (trimmedValue === agentDescriptionPlaceholder || trimmedValue === agentBodyPlaceholder || trimmedValue === `# ${readFirstMarkdownHeading(value)}\n\n${agentBodyPlaceholder}`.trim()) {
		return '';
	}

	return value;
}

function readFirstMarkdownHeading(value: string): string {
	const heading = value.split(/\r?\n/, 1)[0] || '';

	return heading.startsWith('# ') ? heading.slice(2).trim() : '';
}

export function createHookCustomizationJson(displayName: string): string {
	return `${JSON.stringify({
		name: displayName.trim(),
		hooks: {
			PreToolUse: [],
		},
	}, null, '\t')}\n`;
}

function readInstructionCustomizationType(value: unknown): InstructionCustomizationType {
	return value === 'copilot' || value === 'agents' || value === 'claude' ? value : 'scoped';
}

export function stringifyCustomizationMarkdown(body: string, frontmatter: Record<string, unknown>): string {
	const markdown = matter.stringify(body, frontmatter);
	const tools = readStringArray(frontmatter.tools);

	return replaceArrayBlockWithFlowArray(markdown, 'tools', tools);
}

function replaceArrayBlockWithFlowArray(markdown: string, key: string, values: string[]): string {
	const flowValue = `[${values.map(value => toYamlFlowScalar(value)).join(',')}]`;
	const lines = markdown.split('\n');
	const keyLineIndex = lines.findIndex(line => line === `${key}:` || line.startsWith(`${key}: `));

	if (keyLineIndex === -1) {
		return markdown;
	}

	const nextTopLevelIndex = lines.findIndex((line, index) => index > keyLineIndex && (line === '---' || /^[A-Za-z0-9_-]+:/.test(line)));
	const deleteCount = (nextTopLevelIndex === -1 ? lines.length : nextTopLevelIndex) - keyLineIndex;
	lines.splice(keyLineIndex, deleteCount, `${key}: ${flowValue}`);

	return lines.join('\n');
}

function toYamlFlowScalar(value: string): string {
	return /^[A-Za-z0-9_./*-]+$/.test(value) ? value : JSON.stringify(value);
}

function slugifyFileStem(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'customization';
}

function getSkillFolderName(displayName: string): string {
	return slugifyFileStem(displayName).slice(0, 64);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	return Boolean(await getFileStat(uri));
}

async function getFileStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
	try {
		return await vscode.workspace.fs.stat(uri);
	} catch {
		return undefined;
	}
}

function findOpenTextTabViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
	for (const tabGroup of vscode.window.tabGroups.all) {
		if (tabGroup.tabs.some(tab => tab.input instanceof vscode.TabInputText && areSameResourceUri(tab.input.uri, uri))) {
			return tabGroup.viewColumn;
		}
	}

	return undefined;
}

function areSameResourceUri(left: vscode.Uri, right: vscode.Uri): boolean {
	if (left.scheme === 'file' && right.scheme === 'file') {
		const leftPath = path.normalize(left.fsPath);
		const rightPath = path.normalize(right.fsPath);

		return process.platform === 'win32' ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
	}

	return left.toString() === right.toString();
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for (let index = 0; index < 32; index += 1) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return text;
}

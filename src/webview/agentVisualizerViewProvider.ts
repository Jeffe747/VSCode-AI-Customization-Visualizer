import * as vscode from 'vscode';
import { CustomizationPersistence } from '../customizations/persistence';
import { updateCustomizationDiagnostics } from '../diagnostics/customizationDiagnostics';
import { AvailableModel, AvailableTool, GraphJson, mapWorkspaceFilesToGraph } from '../mapper';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { getDefaultAvailableTools } from '../tools/catalog';
import { findOpenTextTabViewColumn, isWorkspaceResourceUri } from '../utils/vscodeResources';
import { readString } from '../utils/values';
import * as htmlRenderer from './htmlRenderer';
import { ExtensionToWebviewMessage } from './protocol';
import { VisualizerSettings, VisualizerSettingsMode, hasVisualizerColors, normalizeVisualizerSettings, sharedVisualizerSettingsStorageKey, visualizerSettingsStorageKeys } from './settings';


export class AgentVisualizerViewProvider implements vscode.WebviewViewProvider {
	private webviewView?: vscode.WebviewView;
	private popoutPanel?: vscode.WebviewPanel;
	private cachedGraph?: GraphJson;
	private cachedBaseModels?: { expiresAt: number; models: AvailableModel[] };
	private refreshTimer?: NodeJS.Timeout;
	private readonly postedMessagesForTests: unknown[] = [];
	private readonly persistence: CustomizationPersistence;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly scanner: WorkspaceScanner,
		private readonly diagnostics: vscode.DiagnosticCollection,
	) {
		this.persistence = new CustomizationPersistence({
			parseWorkspaceUri: value => this.parseWorkspaceUri(value),
			postError: message => this.postError(message),
			postSaveError: message => this.postSaveError(message),
			openNode: uriValue => this.openNode(uriValue),
			openMcpServersView: () => this.openMcpServersView(),
			refresh: () => this.refresh(),
		});
	}

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
				void this.openNode(message.uri).catch(error => this.postError(formatOperationError('Unable to open file', error)));
			}

			if (message?.type === 'mcp:open') {
				void this.openMcpServersView();
			}

			if (message?.type === 'docs:open') {
				void this.openDocs(message.url);
			}

			if (message?.type === 'node:save') {
				void this.persistence.saveNode(message).catch(error => this.postSaveError(formatOperationError('Unable to save', error)));
			}

			if (message?.type === 'customization:create') {
				void this.persistence.createCustomization(message);
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
			textShadowEnabled: sharedSettings.textShadowEnabled,
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
			debugMessagesEnabled: settings.debugMessagesEnabled,
		};
		const sharedSettings: VisualizerSettings = {
			...existingSharedSettings,
			colors: settings.colors,
			textShadowEnabled: settings.textShadowEnabled,
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
			updateCustomizationDiagnostics(this.diagnostics, files, graph, this.scanner.getReadProblems());

			await this.postCachedGraph();
		} catch (error) {
			await this.postMessageToWebviews({
				type: 'graph:error',
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async postCachedGraph(targetWebview?: vscode.Webview): Promise<void> {
		if (!this.cachedGraph) {
			return;
		}

		const message: ExtensionToWebviewMessage = {
			type: 'graph:update',
			graph: this.cachedGraph,
		};

		if (targetWebview) {
			await this.postMessageToWebview(targetWebview, message);
			return;
		}

		await this.postMessageToWebviews(message);
	}

	private async postWindowModeState(targetWebview?: vscode.Webview): Promise<void> {
		const message: ExtensionToWebviewMessage = {
			type: 'window-mode:update',
			active: Boolean(this.popoutPanel),
		};

		if (targetWebview) {
			await this.postMessageToWebview(targetWebview, message);
			return;
		}

		await this.postMessageToWebviews(message);
	}

	private async postMessageToWebviews(message: ExtensionToWebviewMessage): Promise<void> {
		await Promise.all([
			this.postMessageToWebview(this.webviewView?.webview, message),
			this.postMessageToWebview(this.popoutPanel?.webview, message),
		]);
	}

	private async postMessageToWebview(webview: vscode.Webview | undefined, message: ExtensionToWebviewMessage): Promise<void> {
		if (!webview) {
			return;
		}

		await webview.postMessage(message);
		this.recordPostedMessageForTests(message);
	}

	getPostedMessagesForTests(): unknown[] {
		return [...this.postedMessagesForTests];
	}

	resetPostedMessagesForTests(): void {
		this.postedMessagesForTests.splice(0);
	}

	private recordPostedMessageForTests(message: ExtensionToWebviewMessage): void {
		if (this.context.extensionMode !== vscode.ExtensionMode.Test) {
			return;
		}

		this.postedMessagesForTests.push(clonePostedMessage(message));
	}

	private getAvailableTools(graph: GraphJson): AvailableTool[] {
		const vscodeTools: AvailableTool[] = [];

		for (const tool of vscode.lm.tools) {
			vscodeTools.push({
				name: tool.name,
				description: tool.description,
			});
		}

		return getDefaultAvailableTools(vscodeTools, graph.availableTools);
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
			await this.postError('Unable to open file: the selected node is not a workspace file.');
			return;
		}

		const existingViewColumn = findOpenTextTabViewColumn(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false, viewColumn: existingViewColumn });
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

	private parseWorkspaceUri(value: unknown): vscode.Uri | undefined {
		if (typeof value !== 'string') {
			return undefined;
		}

		let uri: vscode.Uri;

		try {
			uri = vscode.Uri.parse(value);
		} catch {
			return undefined;
		}

		return isWorkspaceResourceUri(uri) ? uri : undefined;
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
		const settings = this.getVisualizerSettings(isWindowModeView ? 'window' : 'activity');

		return htmlRenderer.renderVisualizerHtml(webview, isWindowModeView, settings);
	}
}

function formatOperationError(prefix: string, error: unknown): string {
	const details = error instanceof Error ? error.message : String(error);

	return details ? `${prefix}: ${details}` : prefix;
}

function clonePostedMessage(message: unknown): unknown {
	try {
		return JSON.parse(JSON.stringify(message)) as unknown;
	} catch {
		return message;
	}
}


<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import AboutDialog from './components/AboutDialog.svelte';
	import DocumentationLinks from './components/DocumentationLinks.svelte';
	import EditorPanel from './components/EditorPanel.svelte';
	import type { ToolPreset } from './components/ToolsEditor.svelte';
	import GraphShell from './components/GraphShell.svelte';
	import type { GraphLayoutAlgorithm, GraphViewState } from './graph/viewState';
	import { normalizeGraphViewState } from './graph/viewState';
	import NewCustomizationDialog from './components/NewCustomizationDialog.svelte';
	import SettingsDialog from './components/SettingsDialog.svelte';
	import Toasts from './components/Toasts.svelte';
	import Toolbar from './components/Toolbar.svelte';
	import { listenForExtensionMessages } from './messageRuntime';
	import type { GraphJson, GraphNode } from '../../mapper';
	import type { ExtensionToWebviewMessage, WebviewBootstrapData } from './protocol';
	import { defaultVisualizerSettings, type VisualizerSettings } from '../settings';
	import { getWebviewState, postWebviewMessage, setWebviewState } from './vscodeApi';

	export let initialData: WebviewBootstrapData;

	let aboutOpen = false;
	let settingsOpen = false;
	let newOpen = false;
	let errorMessage = '';
	let debugMessage = '';
	let windowModeActive = false;
	let loading = true;
	let graphStatus = 'Scanning workspace...';
	let activeGraphNodeCount = 0;
	let activeGraphLinkCount = 0;
	let activeGraph: GraphJson | undefined;
	let selectedNodeId: string | undefined;
	let currentSettings: VisualizerSettings;
	let toolPresets: ToolPreset[];
	let graphViewState = normalizeGraphViewState(undefined);
	let stopListening: (() => void) | undefined;
	let pendingSaveScrollState: ScrollState | undefined;

	currentSettings = createInitialSettings(initialData);
	toolPresets = normalizeToolPresets(initialData.toolPresets);

	$: selectedNode = getSelectedNode(activeGraph, selectedNodeId);
	$: editableAgentNames = getEditableAgentNames(activeGraph);

	onMount(() => {
		graphViewState = normalizeGraphViewState(getWebviewState<unknown>({}));
		stopListening = listenForExtensionMessages(handleExtensionMessage);
		postWebviewMessage({ type: 'webview:ready' });
	});

	onDestroy(() => {
		stopListening?.();
	});

	function handleExtensionMessage(message: ExtensionToWebviewMessage): void {
		if (message.type === 'window-mode:update') {
			windowModeActive = message.active;
			return;
		}

		if (message.type === 'graph:loading') {
			loading = true;
			graphStatus = 'Scanning workspace...';
			return;
		}

		if (message.type === 'graph:update') {
			loading = false;
			activeGraph = message.graph;
			if (selectedNodeId && !message.graph.nodes.some(node => node.id === selectedNodeId)) {
				selectedNodeId = undefined;
			}
			activeGraphNodeCount = message.graph.nodes.length;
			activeGraphLinkCount = message.graph.links.length;
			graphStatus = activeGraphNodeCount + ' nodes, ' + activeGraphLinkCount + ' edges';
			restorePendingSaveScrollState();
			return;
		}

		if (message.type === 'graph:error' || message.type === 'save:error') {
			loading = false;
			errorMessage = message.message;
			graphStatus = message.message;
		}
	}

	function updateGraphViewState(nextState: Partial<GraphViewState>): void {
		graphViewState = normalizeGraphViewState({ ...graphViewState, ...nextState });
		setWebviewState(graphViewState);
	}

	function updateVisualizerSettings(settings: VisualizerSettings): void {
		currentSettings = settings;
		applyVisualizerColors(settings);
		postWebviewMessage({ type: 'settings:update', mode: initialData.settingsMode, settings });
	}

	interface ScrollState {
		windowX: number;
		windowY: number;
		documentX: number;
		documentY: number;
		bodyX: number;
		bodyY: number;
	}

	function captureScrollState(): ScrollState {
		return {
			windowX: window.scrollX,
			windowY: window.scrollY,
			documentX: document.documentElement.scrollLeft,
			documentY: document.documentElement.scrollTop,
			bodyX: document.body.scrollLeft,
			bodyY: document.body.scrollTop,
		};
	}

	function restorePendingSaveScrollState(): void {
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
			window.scrollTo(scrollState.windowX, scrollState.windowY);
		});
	}

	function selectNode(nodeId: string): void {
		selectedNodeId = nodeId;
	}

	function getSelectedNode(graph: GraphJson | undefined, nodeId: string | undefined): GraphNode | undefined {
		return graph?.nodes.find(node => node.id === nodeId);
	}

	function getEditableAgentNames(graph: GraphJson | undefined): string[] {
		return [...new Set((graph?.nodes || [])
			.filter(node => node.type === 'agent' && node.uri && node.userInvocable !== false)
			.map(node => node.label))]
			.sort((left, right) => left.localeCompare(right));
	}

	function createInitialSettings(data: WebviewBootstrapData): VisualizerSettings {
		return {
			...defaultVisualizerSettings,
			...data.settings,
			colors: typeof data.settings.colors === 'object' && data.settings.colors ? data.settings.colors : {},
		};
	}

	function applyVisualizerColors(settings: VisualizerSettings): void {
		for (const [key, fallback] of Object.entries(initialData.colorPickerFallbackColors)) {
			const value = settings.colors[key as keyof typeof settings.colors] || fallback;

			document.documentElement.style.setProperty('--' + key, value);
		}
	}

	function normalizeToolPresets(value: unknown): ToolPreset[] {
		return Array.isArray(value)
			? value.map(item => {
				const record = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
				const label = typeof record.label === 'string' ? record.label : '';
				const tools = Array.isArray(record.tools) ? record.tools.filter((tool): tool is string => typeof tool === 'string') : [];

				return { label, tools };
			}).filter(preset => preset.label && preset.tools.length)
			: [];
	}
</script>

<main class="app-shell" class:side-by-side={currentSettings.sideBySideLayout} style={'--editor-text-size: ' + currentSettings.textScale + 'em'} data-settings-mode={initialData.settingsMode}>
	<Toolbar windowModeActive={windowModeActive} onNew={() => newOpen = true} onPopout={() => postWebviewMessage({ type: 'popout' })} onAbout={() => aboutOpen = true} onSettings={() => settingsOpen = true} onRefresh={() => postWebviewMessage({ type: 'refresh' })} />
	<DocumentationLinks hidden={currentSettings.documentationLinksHidden} onOpenDocs={url => postWebviewMessage({ type: 'docs:open', url })} />
	<div class="workspace-panels">
		<GraphShell graph={activeGraph} {selectedNodeId} status={graphStatus} {loading} tokenHeatmapVisible={currentSettings.heatmapToggleVisible} orphanToggleVisible={currentSettings.orphanToggleVisible} layoutAlgorithm={graphViewState.graphLayoutAlgorithm} tokenHeatmapEnabled={graphViewState.tokenHeatmapEnabled} orphanHighlightEnabled={graphViewState.orphanHighlightEnabled} nodeScale={currentSettings.nodeScale} heatmapMediumThreshold={currentSettings.heatmapMediumThreshold} heatmapHighThreshold={currentSettings.heatmapHighThreshold} heatmapBaselineModel={currentSettings.heatmapBaselineModel} onLayoutChange={(graphLayoutAlgorithm: GraphLayoutAlgorithm) => updateGraphViewState({ graphLayoutAlgorithm })} onTokenHeatmapChange={tokenHeatmapEnabled => updateGraphViewState({ tokenHeatmapEnabled })} onOrphanHighlightChange={orphanHighlightEnabled => updateGraphViewState({ orphanHighlightEnabled })} onSelectNode={selectNode} />
		<EditorPanel node={selectedNode} agentOptions={editableAgentNames} availableTools={activeGraph?.availableTools || []} availableModels={activeGraph?.availableModels || []} {toolPresets} onOpenNode={uri => postWebviewMessage({ type: 'node:open', uri })} onOpenMcp={() => postWebviewMessage({ type: 'mcp:open' })} onSaveNode={message => {
			graphStatus = 'Saving ' + (selectedNode?.label || 'node') + '...';
			pendingSaveScrollState = captureScrollState();
			postWebviewMessage(message);
		}} />
	</div>
	<AboutDialog open={aboutOpen} onClose={() => aboutOpen = false} />
	<SettingsDialog open={settingsOpen} {initialData} settings={currentSettings} availableModels={activeGraph?.availableModels || []} onClose={() => settingsOpen = false} onUpdate={updateVisualizerSettings} />
	<NewCustomizationDialog open={newOpen} onClose={() => newOpen = false} onCreate={message => {
		graphStatus = message.kind === 'mcp' ? 'Opening MCP servers...' : 'Creating customization...';
		postWebviewMessage(message);
	}} />
	<Toasts {errorMessage} {debugMessage} onDismissError={() => errorMessage = ''} onDismissDebug={() => debugMessage = ''} />
</main>
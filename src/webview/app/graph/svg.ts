import type { GraphJson, GraphNode } from '../../../mapper';
import { layoutGraph } from './layout';
import type { GraphLayoutAlgorithm } from './viewState';

export interface RenderedGraphNode {
	id: string;
	label: string;
	type: GraphNode['type'];
	title: string;
	x: number;
	y: number;
	shape: 'circle' | 'rect';
	radius: number;
	textY: number;
	unresolved: boolean;
	orphan: boolean;
	heatmapLevel?: 'low' | 'medium' | 'high';
	modelLabel: string;
	contextLabel: string;
	audienceLabel: string;
	hookEventCount: string;
	isInvocableAgent: boolean;
	isSubAgent: boolean;
	skillContext?: 'inline' | 'fork';
	disableModelInvocation?: boolean;
}

export interface RenderedGraphEdge {
	id: string;
	path: string;
	arrowX: number;
	arrowY: number;
	arrowAngle: number;
}

export interface RenderedGraph {
	viewBox: string;
	width: number;
	height: number;
	nodeScale: number;
	bounds: RenderedGraphBounds;
	nodes: RenderedGraphNode[];
	edges: RenderedGraphEdge[];
}

export interface RenderedGraphBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export interface RenderedGraphOptions {
	nodeScale: number;
	tokenHeatmapEnabled: boolean;
	orphanHighlightEnabled: boolean;
	heatmapMediumThreshold: number;
	heatmapHighThreshold: number;
	heatmapBaselineModel?: string;
	viewportWidth: number;
}

export function createRenderedGraph(graph: GraphJson, algorithm: GraphLayoutAlgorithm, options: RenderedGraphOptions): RenderedGraph {
	const layout = layoutGraph(graph, algorithm, { viewportWidth: options.viewportWidth, nodeScale: options.nodeScale });
	const subAgentIds = new Set(graph.links.filter(link => link.type === 'uses-agent').map(link => link.target));
	const orphanNodeIds = options.orphanHighlightEnabled ? getOrphanNodeIds(graph) : new Set<string>();
	const fallbackHeatmapMaxTokens = getFallbackHeatmapMaxTokens(graph);
	const nodes = graph.nodes.map(node => {
		const position = layout.positions.get(node.id) || { x: 0, y: 0 };
		const isInvocableAgent = node.type === 'agent' && Boolean(node.uri) && node.userInvocable !== false;
		const modelLabel = node.uri && (node.type === 'agent' || node.type === 'prompt') ? formatModelLabel(node.model) : node.type === 'handoff' ? formatModelLabel(node.handoffModel) : '';
		const audienceLabel = node.type === 'instruction' ? node.instructionAudience || 'AI' : '';
		const isOrphan = orphanNodeIds.has(node.id);
		const heatmapLevel = getHeatmapLevel(node, graph, fallbackHeatmapMaxTokens, options);
		const title = [
			node.path || node.id,
			audienceLabel ? 'Affects: ' + audienceLabel : '',
			node.type === 'instruction' ? 'Instruction area' : '',
			modelLabel ? 'Model: ' + modelLabel : '',
			isOrphan ? 'Orphan: disconnected editable customization' : '',
			...getNodeDetailLabels(node),
		].filter(Boolean).join(' - ');

		return {
			id: node.id,
			label: node.label,
			type: node.type,
			title,
			x: position.x,
			y: position.y,
			shape: node.type === 'instruction' ? 'rect' : 'circle',
			radius: getNodeRadius(node, isInvocableAgent),
			textY: node.type === 'instruction' ? -3 : node.type === 'hook-event' ? 20 : 28,
			unresolved: Boolean(node.unresolved),
			orphan: isOrphan,
			heatmapLevel,
			modelLabel,
			contextLabel: isInvocableAgent && node.contextEstimateTokens ? formatContextEstimate(node.contextEstimateTokens) : '',
			audienceLabel,
			hookEventCount: node.type === 'hook-event' && node.hookEventCommandCount ? node.hookEventCommandCount + ' cmd' : '',
			isInvocableAgent,
			isSubAgent: subAgentIds.has(node.id),
			skillContext: node.skillContext,
			disableModelInvocation: node.disableModelInvocation,
		} satisfies RenderedGraphNode;
	});
	const reciprocalLinkIds = getReciprocalLinkIds(graph.links);
	const edges = graph.links.map(link => {
		const source = layout.positions.get(link.source);
		const target = layout.positions.get(link.target);

		if (!source || !target) {
			return undefined;
		}

		const edgeGeometry = getEdgeGeometry(source, target, reciprocalLinkIds.has(link.id));

		return {
			id: link.id,
			path: edgeGeometry.path,
			arrowX: edgeGeometry.arrowX,
			arrowY: edgeGeometry.arrowY,
			arrowAngle: edgeGeometry.arrowAngle,
		} satisfies RenderedGraphEdge;
	}).filter((edge): edge is RenderedGraphEdge => Boolean(edge));

	return {
		viewBox: '0 0 ' + layout.width + ' ' + layout.height,
		width: layout.width,
		height: Math.max(layout.height, 360 * options.nodeScale),
		nodeScale: options.nodeScale,
		bounds: getGraphPositionBounds(layout.positions, options.nodeScale),
		nodes,
		edges,
	};
}

function getGraphPositionBounds(positions: Map<string, { x: number; y: number }>, nodeScale: number): RenderedGraphBounds {
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

function getReciprocalLinkIds(links: GraphJson['links']): Set<string> {
	const directionKeys = new Set(links.map(link => link.source + '->' + link.target));
	const reciprocalLinkIds = new Set<string>();

	for (const link of links) {
		if (directionKeys.has(link.target + '->' + link.source)) {
			reciprocalLinkIds.add(link.id);
		}
	}

	return reciprocalLinkIds;
}

function getEdgeGeometry(source: { x: number; y: number }, target: { x: number; y: number }, isReciprocal: boolean): { path: string; arrowX: number; arrowY: number; arrowAngle: number } {
	const angle = Math.atan2(target.y - source.y, target.x - source.x) * 180 / Math.PI;

	if (!isReciprocal) {
		return {
			path: 'M ' + source.x + ' ' + source.y + ' L ' + target.x + ' ' + target.y,
			arrowX: (source.x + target.x) / 2,
			arrowY: (source.y + target.y) / 2,
			arrowAngle: angle,
		};
	}

	const deltaX = target.x - source.x;
	const deltaY = target.y - source.y;
	const length = Math.max(1, Math.hypot(deltaX, deltaY));
	const offset = 22;
	const controlX = (source.x + target.x) / 2 + (-deltaY / length) * offset;
	const controlY = (source.y + target.y) / 2 + (deltaX / length) * offset;

	return {
		path: 'M ' + source.x + ' ' + source.y + ' Q ' + controlX + ' ' + controlY + ' ' + target.x + ' ' + target.y,
		arrowX: (source.x + target.x + 2 * controlX) / 4,
		arrowY: (source.y + target.y + 2 * controlY) / 4,
		arrowAngle: angle,
	};
}

function getNodeRadius(node: GraphNode, isInvocableAgent: boolean): number {
	if (node.type === 'hook-event') {
		return 8;
	}

	if (node.type === 'skill' || node.type === 'mcp' || node.type === 'hook' || node.type === 'handoff' || isInvocableAgent) {
		return 13;
	}

	return 11;
}

function getOrphanNodeIds(graph: GraphJson): Set<string> {
	const connectedNodeIds = new Set<string>();

	for (const link of graph.links) {
		connectedNodeIds.add(link.source);
		connectedNodeIds.add(link.target);
	}

	return new Set(graph.nodes
		.filter(node => isOrphanCandidate(node) && !connectedNodeIds.has(node.id))
		.map(node => node.id));
}

function isOrphanCandidate(node: GraphNode): boolean {
	if (!node.uri || node.unresolved) {
		return false;
	}

	if (node.type === 'agent' || node.type === 'skill') {
		return node.userInvocable === false;
	}

	return node.type === 'prompt';
}

function getHeatmapLevel(node: GraphNode, graph: GraphJson, fallbackHeatmapMaxTokens: number, options: RenderedGraphOptions): 'low' | 'medium' | 'high' | undefined {
	if (!options.tokenHeatmapEnabled || node.type !== 'agent' || !node.contextEstimateTokens) {
		return undefined;
	}

	const heatmapMaxTokens = getHeatmapMaxTokens(node, graph, fallbackHeatmapMaxTokens, options.heatmapBaselineModel);
	const ratio = heatmapMaxTokens > 0 ? node.contextEstimateTokens / heatmapMaxTokens : 0;

	if (ratio >= options.heatmapHighThreshold) {
		return 'high';
	}

	if (ratio >= options.heatmapMediumThreshold) {
		return 'medium';
	}

	return 'low';
}

function getFallbackHeatmapMaxTokens(graph: GraphJson): number {
	return Math.max(0, ...graph.nodes.filter(node => node.type === 'agent').map(node => node.contextEstimateTokens || 0));
}

function getHeatmapMaxTokens(node: GraphNode, graph: GraphJson, fallbackHeatmapMaxTokens: number, heatmapBaselineModel: string | undefined): number {
	const modelMaxTokens = getModelMaxInputTokens(graph, node.model);
	const baselineModelMaxTokens = getModelMaxInputTokens(graph, heatmapBaselineModel);

	return modelMaxTokens || baselineModelMaxTokens || fallbackHeatmapMaxTokens;
}

function getModelMaxInputTokens(graph: GraphJson, modelValue: string | undefined): number {
	if (!modelValue) {
		return 0;
	}

	const model = graph.availableModels.find(candidate => candidate.value === modelValue);

	return Number.isFinite(model?.maxInputTokens) && Number(model?.maxInputTokens) > 0 ? Number(model?.maxInputTokens) : 0;
}

function getNodeDetailLabels(node: GraphNode): string[] {
	if (node.type === 'skill') {
		return [node.description || '', node.argumentHint ? 'Argument hint: ' + node.argumentHint : '', node.userInvocable === false ? 'Hidden from slash menu' : 'Slash-command invocable', node.disableModelInvocation ? 'Disable Model Invocation' : '', node.skillContext ? 'Context: ' + node.skillContext : '', ...(node.skillIssues || [])];
	}

	if (node.type === 'mcp') {
		return [node.mcpServerType ? 'Type: ' + node.mcpServerType : '', node.mcpCommand ? 'Target: ' + node.mcpCommand : '', node.mcpSource ? 'Source: ' + node.mcpSource : ''];
	}

	if (node.type === 'hook') {
		return [(node.hookEvents || []).map(event => event.name + ' (' + event.commandCount + ')').join(', '), (node.hookEvents || []).some(event => event.variableDriven) ? 'Tool hooks use variable-driven logic' : ''];
	}

	if (node.type === 'hook-event') {
		return [node.hookEventDescription || '', node.hookEventCommandCount ? node.hookEventCommandCount + ' command' + (node.hookEventCommandCount === 1 ? '' : 's') : '', node.hookEventVariableDriven ? 'Variable-driven tool logic' : ''];
	}

	if (node.type === 'handoff') {
		return [node.handoffAgent ? 'Target: ' + node.handoffAgent : '', node.handoffPrompt ? 'Prompt: ' + node.handoffPrompt : '', node.handoffSend ? 'Auto-submit prompt' : 'Prefill prompt'];
	}

	return [];
}

function formatModelLabel(model: string | undefined): string {
	const label = model || 'current model';

	return label.length > 22 ? label.slice(0, 19) + '...' : label;
}

function formatContextEstimate(tokens: number): string {
	if (tokens >= 1000) {
		return '~' + (tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1) + 'k ctx';
	}

	return '~' + tokens + ' ctx';
}
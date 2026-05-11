<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { GraphJson } from '../../../mapper';
	import { createRenderedGraph } from '../graph/svg';
	import type { GraphLayoutAlgorithm } from '../graph/viewState';

	export let graph: GraphJson | undefined = undefined;
	export let selectedNodeId: string | undefined = undefined;
	export let status = 'Scanning workspace...';
	export let loading = false;
	export let tokenHeatmapVisible = false;
	export let orphanToggleVisible = false;
	export let layoutAlgorithm: GraphLayoutAlgorithm = 'hierarchical';
	export let tokenHeatmapEnabled = false;
	export let orphanHighlightEnabled = false;
	export let nodeScale = 1.1;
	export let textShadowEnabled = true;
	export let heatmapMediumThreshold = 0.38;
	export let heatmapHighThreshold = 0.72;
	export let heatmapBaselineModel: string | undefined = undefined;
	export let onLayoutChange: (value: GraphLayoutAlgorithm) => void = () => {};
	export let onTokenHeatmapChange: (enabled: boolean) => void = () => {};
	export let onOrphanHighlightChange: (enabled: boolean) => void = () => {};
	export let onSelectNode: (nodeId: string) => void = () => {};

	let graphPanX = 0;
	let graphPanY = 0;
	let graphZoom = 1;
	let activePointerId: number | undefined;
	let startClientX = 0;
	let startClientY = 0;
	let startPanX = 0;
	let startPanY = 0;
	let isPanning = false;
	let didPan = false;
	let graphElement: HTMLDivElement | undefined;
	let graphViewportWidth = 760;
	let graphViewportHeight = 360;
	let resizeObserver: ResizeObserver | undefined;
	let centeredGraphKey = '';

	$: renderedGraph = graph && graph.nodes.length ? createRenderedGraph(graph, layoutAlgorithm, { nodeScale, tokenHeatmapEnabled, orphanHighlightEnabled, heatmapMediumThreshold, heatmapHighThreshold, heatmapBaselineModel, viewportWidth: graphViewportWidth }) : undefined;
	$: graphViewBox = renderedGraph ? graphPanX + ' ' + graphPanY + ' ' + (graphViewportWidth / graphZoom) + ' ' + (graphViewportHeight / graphZoom) : '0 0 0 0';
	$: graphCenterKey = graph ? [layoutAlgorithm, graph.nodes.map(node => node.id).join('|'), graph.links.map(link => link.id).join('|'), graphViewportWidth, graphViewportHeight, nodeScale].join('::') : '';
	$: if (renderedGraph && graphCenterKey && graphCenterKey !== centeredGraphKey) {
		centeredGraphKey = graphCenterKey;
		centerGraphPan();
	}
	$: if (renderedGraph) {
		clampGraphPan();
	}

	onMount(() => {
		measureGraphViewport();
		resizeObserver = new ResizeObserver(() => measureGraphViewport());

		if (graphElement) {
			resizeObserver.observe(graphElement);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
	});

	function measureGraphViewport(): void {
		if (!graphElement) {
			return;
		}

		const bounds = graphElement.getBoundingClientRect();
		const documentTop = bounds.top + window.scrollY;

		graphViewportWidth = Math.max(320, Math.floor(bounds.width || 320));
		graphViewportHeight = Math.max(320, Math.floor(window.innerHeight - documentTop - 12));
	}

	function handleGraphPointerDown(event: PointerEvent): void {
		if (!renderedGraph || event.button !== 0 || getNodeElementFromEvent(event)) {
			return;
		}

		activePointerId = event.pointerId;
		startClientX = event.clientX;
		startClientY = event.clientY;
		startPanX = graphPanX;
		startPanY = graphPanY;
		isPanning = true;
		didPan = false;
		(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function handleGraphPointerMove(event: PointerEvent): void {
		if (!renderedGraph || activePointerId !== event.pointerId) {
			return;
		}

		const svg = event.currentTarget as SVGSVGElement;
		const bounds = svg.getBoundingClientRect();
		const unitX = (graphViewportWidth / graphZoom) / Math.max(1, bounds.width);
		const unitY = (graphViewportHeight / graphZoom) / Math.max(1, bounds.height);
		const deltaX = event.clientX - startClientX;
		const deltaY = event.clientY - startClientY;

		graphPanX = startPanX - deltaX * unitX;
		graphPanY = startPanY - deltaY * unitY;
		didPan = didPan || Math.hypot(deltaX, deltaY) > 4;
		clampGraphPan();
		event.preventDefault();
	}

	function handleGraphPointerEnd(event: PointerEvent): void {
		if (activePointerId !== event.pointerId) {
			return;
		}

		activePointerId = undefined;
		isPanning = false;

		const svg = event.currentTarget as SVGSVGElement;

		if (svg.hasPointerCapture(event.pointerId)) {
			svg.releasePointerCapture(event.pointerId);
		}
	}

	function handleGraphWheel(event: WheelEvent): void {
		if (!renderedGraph || !event.ctrlKey) {
			return;
		}

		const svg = event.currentTarget as SVGSVGElement;
		const bounds = svg.getBoundingClientRect();
		const viewWidth = graphViewportWidth / graphZoom;
		const viewHeight = graphViewportHeight / graphZoom;
		const pointerRatioX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
		const pointerRatioY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
		const pointerGraphX = graphPanX + pointerRatioX * viewWidth;
		const pointerGraphY = graphPanY + pointerRatioY * viewHeight;
		const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;

		graphZoom = Math.min(4, Math.max(0.5, graphZoom * zoomFactor));
		graphPanX = pointerGraphX - pointerRatioX * (graphViewportWidth / graphZoom);
		graphPanY = pointerGraphY - pointerRatioY * (graphViewportHeight / graphZoom);
		clampGraphPan();
		event.preventDefault();
	}

	function selectGraphNode(nodeId: string): void {
		if (didPan) {
			didPan = false;
			return;
		}

		onSelectNode(nodeId);
	}

	function getNodeElementFromEvent(event: Event): Element | undefined {
		const target = event.target;

		return target instanceof Element ? target.closest('.node') || undefined : undefined;
	}

	function centerGraphPan(): void {
		if (!renderedGraph) {
			return;
		}

		const viewWidth = graphViewportWidth / graphZoom;
		const viewHeight = graphViewportHeight / graphZoom;
		const centerX = (renderedGraph.bounds.minX + renderedGraph.bounds.maxX) / 2;
		const centerY = (renderedGraph.bounds.minY + renderedGraph.bounds.maxY) / 2;

		graphPanX = centerX - viewWidth / 2;
		graphPanY = centerY - viewHeight / 2;
		clampGraphPan();
	}

	function clampGraphPan(): void {
		graphPanX = Number.isFinite(graphPanX) ? graphPanX : 0;
		graphPanY = Number.isFinite(graphPanY) ? graphPanY : 0;
	}
</script>

<section class="visualizer" aria-label="Graph visualizer">
	<div class="visualizer-body">
		<div class="graph" class:text-shadow-disabled={!textShadowEnabled} bind:this={graphElement}>
			<div class="graph-overlay">
				<div class="legend">
					<span><i class="swatch instruction"></i>Instructions</span>
					<span><i class="swatch skill"></i>Skill</span>
					<span><i class="swatch prompt"></i>Prompt</span>
					<span><i class="swatch agent"></i>Agent</span>
					<span><i class="swatch handoff"></i>Handoff</span>
					<span><i class="swatch mcp"></i>MCP</span>
					<span><i class="swatch hook"></i>Hook</span>
				</div>
				{#if tokenHeatmapVisible}<label class="graph-toggle"><input type="checkbox" checked={tokenHeatmapEnabled} onchange={event => onTokenHeatmapChange(event.currentTarget.checked)}>Token heatmap</label>{/if}
				{#if orphanToggleVisible}<label class="graph-toggle"><input type="checkbox" checked={orphanHighlightEnabled} onchange={event => onOrphanHighlightChange(event.currentTarget.checked)}>Identify orphans</label>{/if}
				<label class="layout-control">Layout<select value={layoutAlgorithm} onchange={event => onLayoutChange(event.currentTarget.value as GraphLayoutAlgorithm)}><option value="hierarchical">Hierarchical</option><option value="radial">Radial</option><option value="force">Force-directed</option></select></label>
			</div>
			{#if renderedGraph}
				<svg class={'graph-svg' + (isPanning ? ' is-panning' : '')} width="100%" height={graphViewportHeight} viewBox={graphViewBox} role="img" aria-label="Copilot AI customization graph" onpointerdown={handleGraphPointerDown} onpointermove={handleGraphPointerMove} onpointerup={handleGraphPointerEnd} onpointercancel={handleGraphPointerEnd} onwheel={handleGraphWheel}>
					{#each renderedGraph.edges as edge}
						<path class="edge" d={edge.path}></path>
						<path class="edge-arrow" d="M -3 -4 L 5 0 L -3 4 Z" transform={'translate(' + edge.arrowX + ' ' + edge.arrowY + ') rotate(' + edge.arrowAngle + ')'}></path>
					{/each}
					{#each renderedGraph.nodes as node}
						<g class={'node node-' + node.type + (node.unresolved ? ' unresolved' : '') + (node.orphan ? ' orphan' : '') + (node.heatmapLevel ? ' heatmap' : '') + (node.type === 'skill' && !node.disableModelInvocation ? ' model-invocable' : '') + (node.id === selectedNodeId ? ' selected' : '')} transform={'translate(' + node.x + ' ' + node.y + ')'} role="button" tabindex="0" aria-label={'Select ' + node.label} onclick={() => selectGraphNode(node.id)} onkeydown={event => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								onSelectNode(node.id);
							}
						}}>
							<title>{node.title}</title>
							<g transform={'scale(' + renderedGraph.nodeScale + ')'}>
								{#if node.shape === 'rect'}
									<rect class="node-hit-target" x="-56" y="-28" width="112" height="76" rx="8"></rect>
									<rect class="node-shape instruction-area" x="-48" y="-22" width="96" height="44" rx="8"></rect>
								{:else}
									<circle class="node-hit-target" r="36"></circle>
									{#if node.heatmapLevel}<circle class={'heatmap-glow heatmap-' + node.heatmapLevel} r={node.isInvocableAgent ? 21 : 18}></circle>{/if}
									{#if node.type === 'handoff'}<circle class="node-backer" r="16"></circle>{/if}
									<circle class="node-shape" r={node.radius}></circle>
								{/if}
								{#if node.type === 'agent' && node.isInvocableAgent}
									<g class="agent-marker" transform="translate(0 1.4)" aria-hidden="true"><path class="marker-line" d="M0 -7v-2"></path><rect class="marker-fill" x="-6" y="-6" width="12" height="10" rx="3"></rect><circle class="marker-dot" cx="-2.5" cy="-1.5" r="1"></circle><circle class="marker-dot" cx="2.5" cy="-1.5" r="1"></circle><path class="marker-line" d="M-3 2h6"></path>{#if !node.isSubAgent}<path class="marker-star" d="M6.8 -10.7l1.1 2.4 2.6.4-1.9 1.8.5 2.6-2.3-1.3-2.3 1.3.5-2.6-1.9-1.8 2.6-.4z"></path>{/if}</g>
								{:else if node.type === 'agent' && node.isSubAgent}
									<g class="agent-marker cog-marker" aria-hidden="true" transform="scale(0.62) translate(-12 -12)"><path class="marker-line" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"></path><path class="marker-line" d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06A2 2 0 0 1 21.4 6.6l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15z"></path></g>
								{:else if node.type === 'skill'}
									<g class="skill-marker" aria-hidden="true" transform="rotate(-38)"><path class="marker-line" d="M-5 -4h8l2 2-2 2h-8z"></path><path class="marker-line" d="M0 0v8"></path></g>
									{#if node.skillContext === 'inline'}<g class="skill-context-marker" aria-hidden="true" transform="translate(7 -8)"><circle class="marker-badge" r="4.2"></circle><path class="marker-line" d="M-2 0h4M0 -2v4"></path></g>{:else if node.skillContext === 'fork'}<g class="skill-context-marker" aria-hidden="true" transform="translate(7 -8)"><path class="marker-star" d="M0 -4.8l1.2 2.5 2.8.4-2 1.9.5 2.8L0 1.5l-2.5 1.3.5-2.8-2-1.9 2.8-.4z"></path></g>{/if}
								{:else if node.type === 'mcp'}
									<g class="mcp-marker" aria-hidden="true"><rect class="marker-fill" x="-5" y="-3" width="10" height="8" rx="2"></rect><path class="marker-line" d="M-2 -3v-4M2 -3v-4M-2 -7h4M-5 1h-3M5 1h3M-8 1v4M8 1v4"></path></g>
								{:else if node.type === 'hook'}
									<g class="hook-marker" aria-hidden="true" transform="translate(2 0.4) scale(0.9)"><circle class="marker-fill" cx="0" cy="-6.4" r="4.2"></circle><circle class="marker-hole" cx="0" cy="-6.4" r="1.5"></circle><path class="marker-line" d="M0 -3v6.2c0 3-2.3 5.3-5.4 5.3c-2.9 0-5.1-2.1-5.1-5.1"></path><path class="marker-fill" d="M-10.4 -1.4l5.4 5.4h-5.4z"></path></g>
								{:else if node.type === 'handoff'}
									<g class="agent-marker" aria-hidden="true"><path class="marker-line" d="M-6 0h10"></path><path class="marker-fill" d="M2 -4l5 4-5 4z"></path><path class="marker-line" d="M-5 -5v10"></path></g>
								{/if}
								<text x="0" y={node.textY} text-anchor="middle">{node.label}</text>
								{#if node.audienceLabel}<text class="audience-label" x="0" y="12" text-anchor="middle">Affects: {node.audienceLabel}</text>{/if}
								{#if node.modelLabel}<text class="model-label" x="0" y="42" text-anchor="middle">{node.modelLabel}</text>{/if}
								{#if node.contextLabel}<text class="context-label" x="0" y="55" text-anchor="middle">{node.contextLabel}</text>{/if}
								{#if node.hookEventCount}<text class="hook-event-count" x="0" y="32" text-anchor="middle">{node.hookEventCount}</text>{/if}
							</g>
						</g>
					{/each}
				</svg>
			{:else}
				<div class="empty">{loading ? 'Growing visualization...' : 'No customization graph loaded.'}</div>
			{/if}
			<div class="status">{status}</div>
		</div>
	</div>
</section>
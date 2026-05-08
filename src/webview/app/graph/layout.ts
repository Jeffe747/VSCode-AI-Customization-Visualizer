import type { GraphJson, GraphNode } from '../../../mapper';
import type { GraphLayoutAlgorithm } from './viewState';

export interface GraphPoint {
	x: number;
	y: number;
}

export interface GraphLayoutResult {
	positions: Map<string, GraphPoint>;
	width: number;
	height: number;
}

export interface GraphLayoutOptions {
	viewportWidth: number;
	nodeScale: number;
}

export function layoutGraph(graph: GraphJson, algorithm: GraphLayoutAlgorithm, options: GraphLayoutOptions): GraphLayoutResult {
	const width = getGraphLayoutWidth(graph, algorithm, options);

	if (algorithm === 'radial') {
		return layoutRadialGraph(graph, width, options.nodeScale);
	}

	if (algorithm === 'force') {
		return layoutForceDirectedGraph(graph, width, options.nodeScale);
	}

	return layoutHierarchicalGraph(graph, width, options.nodeScale);
}

function getGraphLayoutWidth(graph: GraphJson, algorithm: GraphLayoutAlgorithm, options: GraphLayoutOptions): number {
	const scale = options.nodeScale;

	if (algorithm === 'radial') {
		const radius = Math.max(120 * scale, graph.nodes.length * 13 * scale);

		return Math.max(options.viewportWidth, radius * 2 + 140 * scale);
	}

	if (algorithm === 'force') {
		return Math.max(options.viewportWidth, Math.ceil(Math.sqrt(graph.nodes.length)) * 170 * scale);
	}

	const levels = getHierarchicalLevels(graph);
	const nodeCountsByLevel = new Map<number, number>();

	for (const node of graph.nodes) {
		const level = levels.get(node.id) || 0;

		nodeCountsByLevel.set(level, (nodeCountsByLevel.get(level) || 0) + 1);
	}

	const maxNodesOnLevel = Math.max(1, ...nodeCountsByLevel.values());
	const minimumNodeGap = 108 * scale;
	const sidePadding = 72 * scale;

	return Math.max(options.viewportWidth, maxNodesOnLevel * minimumNodeGap + sidePadding * 2);
}

function layoutHierarchicalGraph(graph: GraphJson, width: number, scale: number): GraphLayoutResult {
	const positions = new Map<string, GraphPoint>();
	const levels = getHierarchicalLevels(graph);
	const nodesByLevel = new Map<number, GraphNode[]>();
	const verticalGap = 100 * scale;
	const topPadding = 66 * scale;

	for (const node of graph.nodes) {
		const level = levels.get(node.id) || 0;
		const nodes = nodesByLevel.get(level) || [];

		nodes.push(node);
		nodesByLevel.set(level, nodes);
	}

	const sortedLevels = [...nodesByLevel.keys()].sort((left, right) => left - right);

	for (const level of sortedLevels) {
		const nodes = [...(nodesByLevel.get(level) || [])].sort(compareNodes);
		const horizontalGap = Math.max(108 * scale, width / (nodes.length + 1));

		nodes.forEach((node, index) => {
			const sidePadding = (node.type === 'instruction' ? 52 : 36) * scale;

			positions.set(node.id, {
				x: Math.min(width - sidePadding, Math.max(sidePadding, horizontalGap * (index + 1))),
				y: topPadding + level * verticalGap,
			});
		});
	}

	const bounds = getGraphPositionBounds(positions, scale);

	return {
		positions,
		width,
		height: Math.max(360 * scale, bounds.maxY + 92 * scale),
	};
}

function getHierarchicalLevels(graph: GraphJson): Map<string, number> {
	const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
	const levels = new Map<string, number>();
	const childrenById = new Map<string, string[]>();
	const incoming = new Map<string, number>();

	for (const node of graph.nodes) {
		childrenById.set(node.id, []);
		incoming.set(node.id, 0);
	}

	for (const link of getHierarchicalLayoutLinks(graph)) {
		if (!childrenById.has(link.source) || !nodeById.has(link.target)) {
			continue;
		}

		childrenById.get(link.source)?.push(link.target);
		incoming.set(link.target, (incoming.get(link.target) || 0) + 1);
	}

	const roots = graph.nodes
		.filter(node => (node.type === 'agent' || node.type === 'handoff') && (incoming.get(node.id) || 0) === 0)
		.sort(compareNodes);
	const queue = roots.map(node => ({ id: node.id, level: 0 }));

	while (queue.length) {
		const item = queue.shift();

		if (!item) {
			continue;
		}

		const existingLevel = levels.get(item.id);

		if ((existingLevel !== undefined && existingLevel >= item.level) || item.level > graph.nodes.length) {
			continue;
		}

		levels.set(item.id, item.level);

		for (const childId of [...(childrenById.get(item.id) || [])].sort((left, right) => compareNodes(nodeById.get(left), nodeById.get(right)))) {
			queue.push({ id: childId, level: item.level + 1 });
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

	const minimumLevel = Math.min(...levels.values());

	return new Map([...levels.entries()].map(([id, level]) => [id, level - minimumLevel]));
}

function getHierarchicalLayoutLinks(graph: GraphJson): GraphJson['links'] {
	const handoffOwnerIds = new Map(graph.links.filter(link => link.type === 'uses-handoff').map(link => [link.target, link.source]));

	return graph.links.filter(link => {
		if (link.type !== 'uses-agent' && link.type !== 'uses-handoff' && link.type !== 'handoff-to-agent') {
			return false;
		}

		return !(link.type === 'handoff-to-agent' && handoffOwnerIds.get(link.source) === link.target);
	});
}

function layoutRadialGraph(graph: GraphJson, width: number, scale: number): GraphLayoutResult {
	const positions = new Map<string, GraphPoint>();
	const nodes = [...graph.nodes].sort(compareNodes);
	const centerX = width / 2;
	const centerY = Math.max(180 * scale, nodes.length * 11 * scale);
	const radius = Math.max(110 * scale, nodes.length * 11 * scale);
	const centerCandidates = nodes.filter(node => node.type === 'agent' && node.uri && node.userInvocable !== false);
	const centerNode = centerCandidates[0] || nodes.find(node => node.type === 'agent') || nodes[0];
	const ringNodes = nodes.filter(node => node !== centerNode);

	if (centerNode) {
		positions.set(centerNode.id, { x: centerX, y: centerY });
	}

	ringNodes.forEach((node, index) => {
		const angle = Math.PI * 2 * index / Math.max(1, ringNodes.length) - Math.PI / 2;

		positions.set(node.id, {
			x: centerX + Math.cos(angle) * radius,
			y: centerY + Math.sin(angle) * radius,
		});
	});

	const bounds = getGraphPositionBounds(positions, scale);

	return { positions, width, height: Math.max(360 * scale, bounds.maxY + 92 * scale) };
}

function layoutForceDirectedGraph(graph: GraphJson, width: number, scale: number): GraphLayoutResult {
	const positions = new Map<string, GraphPoint>();
	const velocities = new Map<string, GraphPoint>();
	const nodes = [...graph.nodes].sort(compareNodes);
	const height = Math.max(360 * scale, Math.ceil(Math.sqrt(Math.max(1, nodes.length))) * 160 * scale);
	const centerX = width / 2;
	const centerY = height / 2;
	const initialRadius = Math.min(width, height) * 0.34;
	const repulsion = 3600 * scale;
	const springLength = 105 * scale;
	const springStrength = 0.018;

	nodes.forEach((node, index) => {
		const angle = Math.PI * 2 * index / Math.max(1, nodes.length);

		positions.set(node.id, {
			x: centerX + Math.cos(angle) * initialRadius,
			y: centerY + Math.sin(angle) * initialRadius,
		});
		velocities.set(node.id, { x: 0, y: 0 });
	});

	for (let iteration = 0; iteration < 120; iteration += 1) {
		for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
			for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
				const left = nodes[leftIndex];
				const right = nodes[rightIndex];
				const leftPosition = positions.get(left.id);
				const rightPosition = positions.get(right.id);
				const leftVelocity = velocities.get(left.id);
				const rightVelocity = velocities.get(right.id);

				if (!leftPosition || !rightPosition || !leftVelocity || !rightVelocity) {
					continue;
				}

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

		for (const node of nodes) {
			const position = positions.get(node.id);
			const velocity = velocities.get(node.id);

			if (!position || !velocity) {
				continue;
			}

			velocity.x = (velocity.x + (centerX - position.x) * 0.002) * 0.82;
			velocity.y = (velocity.y + (centerY - position.y) * 0.002) * 0.82;
			position.x = Math.min(width - 60 * scale, Math.max(60 * scale, position.x + velocity.x));
			position.y = Math.min(height - 60 * scale, Math.max(70 * scale, position.y + velocity.y));
		}
	}

	return {
		positions,
		width,
		height,
	};
}

function getGraphPositionBounds(positions: Map<string, GraphPoint>, scale: number): { minX: number; maxX: number; minY: number; maxY: number } {
	const values = [...positions.values()];

	if (!values.length) {
		return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
	}

	const padding = 62 * scale;

	return {
		minX: Math.min(...values.map(position => position.x)) - padding,
		maxX: Math.max(...values.map(position => position.x)) + padding,
		minY: Math.min(...values.map(position => position.y)) - padding,
		maxY: Math.max(...values.map(position => position.y)) + padding,
	};
}

function compareNodes(left: GraphNode | undefined, right: GraphNode | undefined): number {
	return (left?.label || left?.id || '').localeCompare(right?.label || right?.id || '');
}
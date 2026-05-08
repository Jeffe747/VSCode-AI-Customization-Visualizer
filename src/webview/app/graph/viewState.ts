export type GraphLayoutAlgorithm = 'hierarchical' | 'radial' | 'force';

export interface GraphViewState {
	graphLayoutAlgorithm: GraphLayoutAlgorithm;
	tokenHeatmapEnabled: boolean;
	orphanHighlightEnabled: boolean;
}

export const defaultGraphViewState: GraphViewState = {
	graphLayoutAlgorithm: 'hierarchical',
	tokenHeatmapEnabled: false,
	orphanHighlightEnabled: false,
};

export function normalizeGraphViewState(value: unknown): GraphViewState {
	if (!value || typeof value !== 'object') {
		return { ...defaultGraphViewState };
	}

	const candidate = value as Partial<GraphViewState>;

	return {
		graphLayoutAlgorithm: isGraphLayoutAlgorithm(candidate.graphLayoutAlgorithm) ? candidate.graphLayoutAlgorithm : defaultGraphViewState.graphLayoutAlgorithm,
		tokenHeatmapEnabled: Boolean(candidate.tokenHeatmapEnabled),
		orphanHighlightEnabled: Boolean(candidate.orphanHighlightEnabled),
	};
}

export function isGraphLayoutAlgorithm(value: unknown): value is GraphLayoutAlgorithm {
	return value === 'hierarchical' || value === 'radial' || value === 'force';
}
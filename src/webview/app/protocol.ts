import type { WebviewBootstrapData } from '../protocol';

export type { ExtensionToWebviewMessage, WebviewApi, WebviewBootstrapData, WebviewToExtensionMessage } from '../protocol';

export function readBootstrapData(): WebviewBootstrapData | undefined {
	const value = (globalThis as { visualizerBootstrap?: unknown }).visualizerBootstrap;

	return isBootstrapData(value) ? value : undefined;
}

export function createDefaultBootstrapData(): WebviewBootstrapData {
	return {
		isWindowModeView: false,
		settingsMode: 'activity',
		settings: {},
		colorDefinitions: [],
		colorPickerFallbackColors: {},
		toolPresets: [],
		placeholders: {
			agentDescription: '',
			agentBody: '',
		},
	};
}

function isBootstrapData(value: unknown): value is WebviewBootstrapData {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<WebviewBootstrapData>;

	return typeof candidate.isWindowModeView === 'boolean' && (candidate.settingsMode === 'activity' || candidate.settingsMode === 'window');
}
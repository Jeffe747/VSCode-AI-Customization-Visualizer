import type { GraphJson } from '../mapper';
import type { VisualizerSettings } from './settings';

export interface WebviewBootstrapData {
	isWindowModeView: boolean;
	settingsMode: 'activity' | 'window';
	settings: Partial<VisualizerSettings>;
	colorDefinitions: unknown[];
	colorPickerFallbackColors: Record<string, string>;
	toolPresets: unknown[];
	placeholders: {
		agentDescription: string;
		agentBody: string;
	};
}

export type ExtensionToWebviewMessage =
	| { type: 'graph:loading' }
	| { type: 'graph:update'; graph: GraphJson }
	| { type: 'graph:error'; message: string }
	| { type: 'save:error'; message: string }
	| { type: 'window-mode:update'; active: boolean };

export type WebviewToExtensionMessage =
	| { type: 'webview:ready' }
	| { type: 'refresh' }
	| { type: 'popout' }
	| { type: 'node:open'; uri: string }
	| { type: 'mcp:open' }
	| { type: 'docs:open'; url: string }
	| ({ type: 'node:save' } & Record<string, unknown>)
	| ({ type: 'customization:create' } & Record<string, unknown>)
	| ({ type: 'settings:update' } & Record<string, unknown>);

export interface WebviewApi {
	postMessage(message: WebviewToExtensionMessage): void;
	getState?(): unknown;
	setState?(state: unknown): void;
}
import * as vscode from 'vscode';
import { agentBodyPlaceholder, agentDescriptionPlaceholder } from '../customizations/factory';
import { getDefaultToolPresets } from '../tools/catalog';
import { WebviewBootstrapData } from './protocol';
import { VisualizerSettings, colorPickerFallbackColors, visualizerColorDefinitions, visualizerDefaultCssValues } from './settings';

export function renderVisualizerHtml(webview: vscode.Webview, isWindowModeView: boolean, settings: VisualizerSettings): string {
	const extensionUri = webview.options.localResourceRoots?.[0];

	if (!extensionUri) {
		throw new Error('Unable to render visualizer: extension resources are not available.');
	}

	return renderBundledVisualizerHtml(webview, extensionUri, isWindowModeView, settings);
}

export function renderBundledVisualizerHtml(webview: vscode.Webview, extensionUri: vscode.Uri, isWindowModeView: boolean, settings: VisualizerSettings): string {
	const nonce = getNonce();
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'index.css'));
	const bootstrapData: WebviewBootstrapData = {
		isWindowModeView,
		settingsMode: isWindowModeView ? 'window' : 'activity',
		settings,
		colorDefinitions: visualizerColorDefinitions,
		colorPickerFallbackColors,
		toolPresets: getDefaultToolPresets(),
		placeholders: {
			agentDescription: agentDescriptionPlaceholder,
			agentBody: agentBodyPlaceholder,
		},
	};

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<title>Copilot AI Customization Visualizer</title>
	<style nonce="${nonce}">
		:root {
			color-scheme: light dark;
			--panel-border: color-mix(in srgb, var(--vscode-sideBar-foreground) 18%, transparent);
${renderVisualizerColorCss(settings)}
		}

		html {
			scrollbar-gutter: stable;
		}

		body {
			margin: 0;
		}
	</style>
	<link rel="stylesheet" href="${styleUri}">
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">globalThis.visualizerBootstrap = ${toScriptJson(bootstrapData)};</script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function renderVisualizerColorCss(settings: VisualizerSettings): string {
	return visualizerColorDefinitions
		.map(definition => `\t\t\t--${definition.key}: ${settings.colors[definition.key] || visualizerDefaultCssValues[definition.key]};`)
		.join('\n');
}

function toScriptJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for (let index = 0; index < 32; index += 1) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return text;
}

import type { WebviewApi, WebviewToExtensionMessage } from './protocol';

declare const acquireVsCodeApi: undefined | (() => WebviewApi);

let api: WebviewApi | undefined;

export function getVsCodeApi(): WebviewApi | undefined {
	if (!api && typeof acquireVsCodeApi === 'function') {
		api = acquireVsCodeApi();
	}

	return api;
}

export function postWebviewMessage(message: WebviewToExtensionMessage): void {
	getVsCodeApi()?.postMessage(message);
}

export function getWebviewState<T>(fallback: T): T {
	const state = getVsCodeApi()?.getState?.();

	return state === undefined ? fallback : state as T;
}

export function setWebviewState(state: unknown): void {
	getVsCodeApi()?.setState?.(state);
}
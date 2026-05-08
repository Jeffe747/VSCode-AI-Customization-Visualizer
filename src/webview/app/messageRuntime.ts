import type { ExtensionToWebviewMessage } from './protocol';

export type ExtensionMessageHandler = (message: ExtensionToWebviewMessage) => void;

export function listenForExtensionMessages(handler: ExtensionMessageHandler): () => void {
	const listener = (event: MessageEvent<unknown>) => {
		if (isExtensionToWebviewMessage(event.data)) {
			handler(event.data);
		}
	};

	window.addEventListener('message', listener);

	return () => window.removeEventListener('message', listener);
}

function isExtensionToWebviewMessage(value: unknown): value is ExtensionToWebviewMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const type = (value as { type?: unknown }).type;

	return type === 'graph:loading' || type === 'graph:update' || type === 'graph:error' || type === 'save:error' || type === 'window-mode:update';
}
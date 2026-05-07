import { normalizeObject, readModel, readString, writeOptionalString } from '../utils/values';

export function parseHandoffsInput(value: unknown): { ok: true; value: unknown[] } | { ok: false } {
	if (typeof value !== 'string' || !value.trim()) {
		return { ok: true, value: [] };
	}

	try {
		const parsed = JSON.parse(value) as unknown;

		if (Array.isArray(parsed)) {
			return { ok: true, value: parsed };
		}
	} catch {
		// Reported to the user by saveNode.
	}

	return { ok: false };
}

export function validateRequiredHandoffFields(handoffs: unknown[]): { ok: true } | { ok: false; index: number; field: 'label' | 'agent' | 'prompt' | 'send' } {
	for (const [index, handoff] of handoffs.entries()) {
		const record = normalizeObject(handoff);
		const label = readString(record.label) || readString(record.name);
		const agent = readString(record.agent) || readString(record.handoffAgent);
		const prompt = readString(record.prompt) || readString(record.handoffPrompt);
		const hasSend = typeof record.send === 'boolean' || typeof record.handoffSend === 'boolean';

		if (!label) {
			return { ok: false, index, field: 'label' };
		}

		if (!agent) {
			return { ok: false, index, field: 'agent' };
		}

		if (!prompt) {
			return { ok: false, index, field: 'prompt' };
		}

		if (!hasSend) {
			return { ok: false, index, field: 'send' };
		}
	}

	return { ok: true };
}

export function normalizePostedHandoffs(handoffs: unknown[]): unknown[] {
	return handoffs.map(handoff => {
		const record = normalizeObject(handoff);
		const label = readString(record.label) || readString(record.name);
		const agent = readString(record.agent) || readString(record.handoffAgent);
		const prompt = readString(record.prompt) || readString(record.handoffPrompt);
		const model = readModel(record.model ?? record.handoffModel);

		if (!label && !agent && !prompt && !model) {
			return undefined;
		}

		const normalized: Record<string, unknown> = {
			send: Boolean(record.send ?? record.handoffSend),
		};

		if (label) {
			normalized.label = label;
		}

		if (agent) {
			normalized.agent = agent;
		}

		if (prompt) {
			normalized.prompt = prompt;
		}

		if (model) {
			normalized.model = model;
		}

		return normalized;
	}).filter((handoff): handoff is Record<string, unknown> => Boolean(handoff));
}

export function updateHandoffAtIndex(handoffs: unknown[], index: number, message: Record<string, unknown>): unknown[] {
	const nextHandoffs = [...handoffs];
	const existing = normalizeObject(nextHandoffs[index]);
	const updated: Record<string, unknown> = {
		...existing,
		send: Boolean(message.send),
	};

	writeOptionalString(updated, 'label', message.name);
	writeOptionalString(updated, 'agent', message.agent);
	writeOptionalString(updated, 'prompt', message.prompt);
	writeOptionalString(updated, 'model', message.handoffModel ?? message.model);
	nextHandoffs[index] = updated;

	return normalizePostedHandoffs(nextHandoffs);
}

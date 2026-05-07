import { HookCommandSummary, HookEventName, HookEventSummary, getHookEventDescription, isHookEventName, isVariableDrivenHookEvent } from '../mapper';
import { normalizeObject, readString } from '../utils/values';

const editableHookCommandProperties = ['command', 'windows', 'linux', 'osx', 'cwd', 'env', 'timeout'] as const;

export function readHookEventName(value: unknown): HookEventName | undefined {
	return typeof value === 'string' && isHookEventName(value) ? value : undefined;
}

export function readHookEvents(hooks: Record<string, unknown>): HookEventSummary[] {
	const events: HookEventSummary[] = [];

	for (const [name, commands] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(commands)) {
			continue;
		}

		events.push({
			name,
			description: getHookEventDescription(name),
			commandCount: countHookCommands(commands),
			variableDriven: isVariableDrivenHookEvent(name),
		});
	}

	return events.sort((left, right) => getHookEventOrder(left.name) - getHookEventOrder(right.name));
}

export function readHookCommands(hooks: Record<string, unknown>): HookCommandSummary[] {
	const commands: HookCommandSummary[] = [];

	for (const [name, entries] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(entries)) {
			continue;
		}

		entries.forEach((entry, index) => {
			const config = normalizeObject(entry);
			const command = readString(config.command) || readString(config.windows) || readString(config.linux) || readString(config.osx) || '';
			const properties = readHookCommandProperties(config);

			if (!Object.keys(properties).length) {
				return;
			}

			commands.push({
				id: `${name}:${index}`,
				event: name,
				index,
				name: readString(config.name) || `${name} command ${index + 1}`,
				command,
				properties,
			});
		});
	}

	return commands.sort((left, right) => getHookEventOrder(left.event) - getHookEventOrder(right.event) || left.index - right.index);
}

export function readHookCommandProperties(config: Record<string, unknown>): Record<string, string> {
	const properties: Record<string, string> = {};

	for (const property of ['command', 'windows', 'linux', 'osx', 'cwd'] as const) {
		const value = readString(config[property]);

		if (value) {
			properties[property] = value;
		}
	}

	const timeout = readHookTimeoutText(config);

	if (timeout) {
		properties.timeout = timeout;
	}

	if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
		properties.env = JSON.stringify(config.env);
	} else {
		const env = readString(config.env);

		if (env) {
			properties.env = env;
		}
	}

	return properties;
}

export function readHookEventArray(hooks: Record<string, unknown>, eventName: HookEventName): unknown[] {
	const entries = hooks[eventName];

	return Array.isArray(entries) ? entries : [];
}

export function collectHookCommandObjects(hooks: Record<string, unknown>): Map<string, Record<string, unknown>> {
	const commands = new Map<string, Record<string, unknown>>();

	for (const [name, entries] of Object.entries(hooks)) {
		if (!isHookEventName(name) || !Array.isArray(entries)) {
			continue;
		}

		entries.forEach((entry, index) => {
			commands.set(`${name}:${index}`, normalizeObject(entry));
		});
	}

	return commands;
}

export function readPostedHookCommands(value: unknown): Array<{ id: string; event: HookEventName; properties: Record<string, unknown> }> {
	if (typeof value !== 'string') {
		return [];
	}

	try {
		const parsed = JSON.parse(value) as unknown;

		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.map(item => {
			const command = normalizeObject(item);
			const event = readHookEventName(command.event) || 'PreToolUse';

			return {
				id: readString(command.id) || '',
				event,
				properties: normalizeObject(command.properties),
			};
		});
	} catch {
		return [];
	}
}

export function normalizePostedHookCommandProperties(properties: Record<string, unknown>): Record<string, unknown> {
	const normalized: Record<string, unknown> = {};

	for (const property of editableHookCommandProperties) {
		if (!Object.prototype.hasOwnProperty.call(properties, property)) {
			continue;
		}

		const value = properties[property];
		const text = typeof value === 'string' ? value : '';

		if (property === 'timeout') {
			const timeout = Number(text);

			normalized.timeout = Number.isFinite(timeout) ? timeout : text;
		} else if (property === 'env') {
			normalized.env = parseHookEnvValue(text);
		} else {
			normalized[property] = text;
		}
	}

	if (!Object.prototype.hasOwnProperty.call(normalized, 'timeout') && Object.prototype.hasOwnProperty.call(properties, 'timeoutSec')) {
		const legacyTimeout = properties.timeoutSec;
		const text = typeof legacyTimeout === 'number' ? String(legacyTimeout) : typeof legacyTimeout === 'string' ? legacyTimeout : '';

		if (text.trim()) {
			const timeout = Number(text);

			normalized.timeout = Number.isFinite(timeout) ? timeout : text;
		}
	}

	return normalized;
}

export function removeHookCommandProperties(command: Record<string, unknown>): Record<string, unknown> {
	for (const property of editableHookCommandProperties) {
		delete command[property];
	}

	return command;
}

export function getHookConfigName(source: string): string {
	const normalizedSource = source.replace(/\\/g, '/');
	const fileName = normalizedSource.split('/').pop()?.replace(/\.json$/, '') || normalizedSource;

	return normalizedSource.includes('/hooks/') ? fileName : normalizedSource;
}

function readHookTimeoutText(config: Record<string, unknown>): string | undefined {
	if (typeof config.timeout === 'number') {
		return String(config.timeout);
	}

	const timeout = readString(config.timeout);

	if (timeout) {
		return timeout;
	}

	if (typeof config.timeoutSec === 'number') {
		return String(config.timeoutSec);
	}

	return readString(config.timeoutSec);
}

function parseHookEnvValue(value: string): unknown {
	try {
		const parsed = JSON.parse(value) as unknown;

		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed;
		}
	} catch {
		// Keep non-JSON values as text so the user's input is not lost.
	}

	return value;
}

function countHookCommands(eventEntries: unknown[]): number {
	return eventEntries.reduce<number>((total, entry) => {
		const config = normalizeObject(entry);
		const hooks = Array.isArray(config.hooks) ? config.hooks : [];

		return total + Math.max(1, hooks.length);
	}, 0);
}

function getHookEventOrder(eventName: HookEventSummary['name']): number {
	const order: HookEventSummary['name'][] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop'];

	return order.indexOf(eventName);
}

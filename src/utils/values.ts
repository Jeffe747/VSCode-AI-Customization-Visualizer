export function normalizeObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function readModel(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return readString(value);
	}

	if (Array.isArray(value)) {
		return readStringArray(value).join(', ');
	}

	return undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function readSkillContext(value: unknown): 'inline' | 'fork' | undefined {
	return value === 'inline' || value === 'fork' ? value : undefined;
}

export function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return unique(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean));
}

export function parseLines(value: unknown): string[] {
	if (Array.isArray(value)) {
		return readStringArray(value);
	}

	if (typeof value !== 'string') {
		return [];
	}

	return unique(value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean));
}

export function writeOptionalString(target: Record<string, unknown>, key: string, value: unknown): void {
	const text = readString(value);

	if (text) {
		target[key] = text;
	} else {
		delete target[key];
	}
}

export function unique(values: string[]): string[] {
	return [...new Set(values)];
}

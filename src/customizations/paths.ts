import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceAiFile } from '../mapper';
import { readString, unique } from '../utils/values';

export function getFileKind(uri: vscode.Uri): WorkspaceAiFile['kind'] | undefined {
	if (uri.path.endsWith('.agent.md')) {
		return 'agent';
	}

	if (uri.path.endsWith('.prompt.md')) {
		return 'prompt';
	}

	if (isSkillFilePath(uri.path)) {
		return 'skill';
	}

	if (isInstructionFilePath(uri.path)) {
		return 'instruction';
	}

	return undefined;
}

export function getFileName(uri: vscode.Uri, kind: WorkspaceAiFile['kind'], frontmatter: Record<string, unknown>): string {
	const frontmatterName = readString(frontmatter.name);

	if (frontmatterName) {
		return frontmatterName;
	}

	const suffix = kind === 'agent' ? '.agent.md' : kind === 'prompt' ? '.prompt.md' : kind === 'skill' ? '' : '.md';

	if (kind === 'skill') {
		return path.basename(path.dirname(uri.fsPath));
	}

	return path.basename(uri.fsPath, suffix);
}

export function isSkillFilePath(uriPath: string): boolean {
	const pathParts = uriPath.replace(/\\/g, '/').split('/').filter(Boolean);
	const fileName = pathParts[pathParts.length - 1];
	const skillsFolder = pathParts[pathParts.length - 3];

	return fileName === 'SKILL.md' && skillsFolder === 'skills' && Boolean(pathParts[pathParts.length - 2]);
}

export function isInstructionFilePath(uriPath: string): boolean {
	const fileName = path.posix.basename(uriPath);

	return uriPath.endsWith('.instructions.md')
		|| fileName === 'copilot-instructions.md'
		|| fileName === 'AGENTS.md'
		|| fileName === 'CLAUDE.md'
		|| fileName === 'Claude.md';
}

export function isHookFilePath(uriPath: string): boolean {
	const normalizedPath = uriPath.replace(/\\/g, '/');

	return /\/\.github\/hooks\/[^/]+\.json$/.test(normalizedPath)
		|| normalizedPath.endsWith('/.claude/settings.json')
		|| normalizedPath.endsWith('/.claude/settings.local.json');
}

export function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
	const byUri = new Map<string, vscode.Uri>();

	for (const uri of uris) {
		byUri.set(uri.toString(), uri);
	}

	return [...byUri.values()];
}

export function normalizeFrontmatter(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function extractToolReferences(content: string): string[] {
	const matches = content.matchAll(/#tool:([A-Za-z0-9_.-]+)/g);

	return unique([...matches].map(match => match[1]));
}

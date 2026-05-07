import matter = require('gray-matter');
import * as vscode from 'vscode';
import { readStringArray } from '../utils/values';
import { CustomizationKind, InstructionCustomizationType, MarkdownCustomizationKind } from './types';

export const agentDescriptionPlaceholder = 'Use when: describe when this agent should be selected.';
export const agentBodyPlaceholder = "Describe this agent's role, workflow, constraints, and output style.";

export function getCustomizationFolderUri(workspaceUri: vscode.Uri, kind: CustomizationKind, instructionType: InstructionCustomizationType = 'scoped'): vscode.Uri {
	if (kind === 'agent') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
	}

	if (kind === 'prompt') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'prompts');
	}

	if (kind === 'skill') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'skills');
	}

	if (kind === 'hook') {
		return vscode.Uri.joinPath(workspaceUri, '.github', 'hooks');
	}

	if (instructionType === 'copilot') {
		return vscode.Uri.joinPath(workspaceUri, '.github');
	}

	if (instructionType === 'agents') {
		return workspaceUri;
	}

	if (instructionType === 'claude') {
		return vscode.Uri.joinPath(workspaceUri, '.claude');
	}

	return vscode.Uri.joinPath(workspaceUri, '.github', 'instructions');
}

export function getCustomizationFileName(kind: CustomizationKind, displayName: string, instructionType: InstructionCustomizationType = 'scoped'): string {
	const stem = slugifyFileStem(displayName);

	if (kind === 'agent') {
		return `${stem}.agent.md`;
	}

	if (kind === 'prompt') {
		return `${stem}.prompt.md`;
	}

	if (kind === 'skill') {
		return 'SKILL.md';
	}

	if (kind === 'hook') {
		return `${stem}.json`;
	}

	if (instructionType === 'copilot') {
		return 'copilot-instructions.md';
	}

	if (instructionType === 'agents') {
		return 'AGENTS.md';
	}

	if (instructionType === 'claude') {
		return 'CLAUDE.md';
	}

	return `${stem}.instructions.md`;
}

export function createCustomizationMarkdown(kind: MarkdownCustomizationKind, displayName: string, instructionType: InstructionCustomizationType = 'scoped'): string {
	const skillName = getSkillFolderName(displayName);
	const frontmatter: Record<string, unknown> = {
		name: kind === 'skill' ? skillName : displayName.trim(),
	};

	if (kind !== 'agent') {
		frontmatter.description = kind === 'prompt'
				? 'Use when: describe when this prompt should be run.'
				: kind === 'skill'
					? 'Use when: describe what reusable capability this skill provides and when Copilot should load it.'
					: 'Use when: describe which files or tasks these instructions apply to.';
	}

	if (kind === 'agent') {
		frontmatter.tools = [];
		frontmatter.agents = [];
		frontmatter['user-invocable'] = true;
	} else if (kind === 'prompt') {
		frontmatter.agent = 'agent';
		frontmatter.tools = [];
	} else if (kind === 'skill') {
		frontmatter['user-invocable'] = false;
	} else if (kind === 'instruction' && instructionType === 'scoped') {
		frontmatter.applyTo = '**';
	}

	const heading = displayName.trim();
	const body = kind === 'agent'
		? ''
		: kind === 'prompt'
			? `# ${heading}\n\nDescribe the task this prompt should run, including expected inputs and output format.\n`
			: kind === 'skill'
				? `# ${heading}\n\nDescribe the skill's workflow, step-by-step procedures, expected inputs and outputs, and links to any resources in this skill directory.\n`
				: `# ${heading}\n\nDescribe the coding guidelines, project rules, and conventions that should influence AI assistance.\n`;

	return matter.stringify(body, frontmatter);
}

export function cleanAgentPlaceholderText(value: unknown, fallback = ''): string {
	if (typeof value !== 'string') {
		return fallback;
	}

	const trimmedValue = value.trim();

	if (trimmedValue === agentDescriptionPlaceholder || trimmedValue === agentBodyPlaceholder || trimmedValue === `# ${readFirstMarkdownHeading(value)}\n\n${agentBodyPlaceholder}`.trim()) {
		return '';
	}

	return value;
}

export function createHookCustomizationJson(displayName: string): string {
	return `${JSON.stringify({
		name: displayName.trim(),
		hooks: {
			PreToolUse: [],
		},
	}, null, '\t')}\n`;
}

export function readInstructionCustomizationType(value: unknown): InstructionCustomizationType {
	return value === 'copilot' || value === 'agents' || value === 'claude' ? value : 'scoped';
}

export function stringifyCustomizationMarkdown(body: string, frontmatter: Record<string, unknown>): string {
	const markdown = matter.stringify(body, frontmatter);
	const tools = readStringArray(frontmatter.tools);

	return replaceArrayBlockWithFlowArray(markdown, 'tools', tools);
}

function readFirstMarkdownHeading(value: string): string {
	const heading = value.split(/\r?\n/, 1)[0] || '';

	return heading.startsWith('# ') ? heading.slice(2).trim() : '';
}

function replaceArrayBlockWithFlowArray(markdown: string, key: string, values: string[]): string {
	const flowValue = `[${values.map(value => toYamlFlowScalar(value)).join(',')}]`;
	const lines = markdown.split('\n');
	const keyLineIndex = lines.findIndex(line => line === `${key}:` || line.startsWith(`${key}: `));

	if (keyLineIndex === -1) {
		return markdown;
	}

	const nextTopLevelIndex = lines.findIndex((line, index) => index > keyLineIndex && (line === '---' || /^[A-Za-z0-9_-]+:/.test(line)));
	const deleteCount = (nextTopLevelIndex === -1 ? lines.length : nextTopLevelIndex) - keyLineIndex;
	lines.splice(keyLineIndex, deleteCount, `${key}: ${flowValue}`);

	return lines.join('\n');
}

function toYamlFlowScalar(value: string): string {
	return /^[A-Za-z0-9_./*-]+$/.test(value) ? value : JSON.stringify(value);
}

function slugifyFileStem(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'customization';
}

export function getSkillFolderName(displayName: string): string {
	return slugifyFileStem(displayName).slice(0, 64);
}

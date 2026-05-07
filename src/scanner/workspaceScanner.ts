import matter = require('gray-matter');
import * as path from 'path';
import * as vscode from 'vscode';
import { excludeGlob, hookGlob, instructionGlob, markdownGlob, skillGlob } from '../customizations/globs';
import { extractToolReferences, getFileKind, getFileName, normalizeFrontmatter, uniqueUris } from '../customizations/paths';
import { getHookConfigName, readHookCommands, readHookEvents } from '../customizations/hooks';
import { HookConfig, McpServerConfig, WorkspaceAiFile } from '../mapper';
import { normalizeDisplayedToolList } from '../tools/catalog';
import { fileExists } from '../utils/vscodeResources';
import { normalizeObject, readArray, readBoolean, readModel, readSkillContext, readString, readStringArray } from '../utils/values';

export interface ReadProblem {
	uri: vscode.Uri;
	message: string;
	details: string;
}

export class WorkspaceScanner {
	private readonly readProblems = new Map<string, ReadProblem>();

	constructor(private readonly output: vscode.OutputChannel) {}

	beginRefresh(): void {
		this.readProblems.clear();
	}

	getReadProblems(): ReadProblem[] {
		return [...this.readProblems.values()];
	}

	async scan(): Promise<WorkspaceAiFile[]> {
		const [markdownUris, skillUris, instructionUris] = await Promise.all([
			vscode.workspace.findFiles(markdownGlob, excludeGlob),
			vscode.workspace.findFiles(skillGlob, excludeGlob),
			vscode.workspace.findFiles(instructionGlob, excludeGlob),
		]);
		const uris = uniqueUris([
			...markdownUris,
			...skillUris,
			...instructionUris,
		]);
		const files = await Promise.all(uris.map(uri => this.readFile(uri)));

		return files.filter((file): file is WorkspaceAiFile => file !== undefined);
	}

	async scanMcpServers(): Promise<McpServerConfig[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const servers = await Promise.all(workspaceFolders.map(folder => this.readWorkspaceMcpServers(folder)));

		return servers.flat();
	}

	private async readWorkspaceMcpServers(folder: vscode.WorkspaceFolder): Promise<McpServerConfig[]> {
		const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'mcp.json');

		if (!await fileExists(uri)) {
			return [];
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawJson = Buffer.from(bytes).toString('utf8');
			const parsed = JSON.parse(rawJson) as Record<string, unknown>;
			const servers = normalizeObject(parsed.servers);
			const source = vscode.workspace.asRelativePath(uri, false);

			return Object.entries(servers).map(([name, value]) => {
				const server = normalizeObject(value);
				const serverType = readString(server.type) || (server.url ? 'http' : server.command ? 'stdio' : undefined);
				const command = readString(server.url) || readString(server.command);
				return { name, source, serverType, command };
			});
		} catch (error) {
			this.logReadError(uri, 'Unable to read MCP server configuration', error);
			return [];
		}
	}

	async scanHookConfigs(): Promise<HookConfig[]> {
		const uris = await vscode.workspace.findFiles(hookGlob, excludeGlob);
		const configs = await Promise.all(uris.map(uri => this.readHookConfig(uri)));

		return configs.filter((config): config is HookConfig => config !== undefined);
	}

	private async readHookConfig(uri: vscode.Uri): Promise<HookConfig | undefined> {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawJson = Buffer.from(bytes).toString('utf8');
			const parsed = JSON.parse(rawJson) as Record<string, unknown>;
			const hooks = normalizeObject(parsed.hooks);
			const events = readHookEvents(hooks);
			const commands = readHookCommands(hooks);

			const source = vscode.workspace.asRelativePath(uri, false);

			return {
				name: readString(parsed.name) || getHookConfigName(source),
				source,
				uri: uri.toString(),
				events,
				commands,
			};
		} catch (error) {
			this.logReadError(uri, 'Unable to read hook configuration', error);
			return undefined;
		}
	}

	private async readFile(uri: vscode.Uri): Promise<WorkspaceAiFile | undefined> {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const kind = getFileKind(uri);

		if (!kind) {
			return undefined;
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const rawMarkdown = Buffer.from(bytes).toString('utf8');
			const parsed = matter(rawMarkdown);
			const frontmatter = normalizeFrontmatter(parsed.data);
			const name = getFileName(uri, kind, frontmatter);

			return {
				uri: uri.toString(),
				relativePath,
				kind,
				name,
				frontmatter,
				body: parsed.content,
				agents: kind === 'agent' ? readStringArray(frontmatter.agents) : [],
				tools: kind === 'instruction' ? [] : normalizeDisplayedToolList([...readStringArray(frontmatter.tools), ...extractToolReferences(parsed.content)]),
				model: readModel(frontmatter.model),
				userInvocable: kind === 'agent' || kind === 'skill' ? readBoolean(frontmatter['user-invocable']) : undefined,
				agent: kind === 'prompt' ? readString(frontmatter.agent) : undefined,
				description: kind === 'agent' || kind === 'skill' || kind === 'instruction' ? readString(frontmatter.description) : undefined,
				applyTo: kind === 'instruction' ? readString(frontmatter.applyTo) : undefined,
				argumentHint: kind === 'agent' || kind === 'skill' ? readString(frontmatter['argument-hint']) : undefined,
				disableModelInvocation: kind === 'agent' || kind === 'skill' ? readBoolean(frontmatter['disable-model-invocation']) : undefined,
				handoffs: kind === 'agent' ? readArray(frontmatter.handoffs) : undefined,
				skillContext: kind === 'skill' ? readSkillContext(frontmatter.context) : undefined,
				skillFolderName: kind === 'skill' ? path.basename(path.dirname(uri.fsPath)) : undefined,
			};
		} catch (error) {
			this.logReadError(uri, `Unable to read ${kind} customization file`, error);
			return undefined;
		}
	}

	private logReadError(uri: vscode.Uri, message: string, error: unknown): void {
		const relativePath = vscode.workspace.asRelativePath(uri, false);
		const details = error instanceof Error ? error.message : String(error);

		this.output.appendLine(`[${new Date().toISOString()}] ${message}: ${relativePath}`);
		this.output.appendLine(details);
		this.readProblems.set(uri.toString(), { uri, message, details });
	}
}

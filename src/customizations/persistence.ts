import matter = require('gray-matter');
import * as vscode from 'vscode';
import { cleanAgentPlaceholderText, createCustomizationMarkdown, createHookCustomizationJson, getCustomizationFileName, getCustomizationFolderUri, getSkillFolderName, readInstructionCustomizationType, stringifyCustomizationMarkdown } from './factory';
import { normalizePostedHandoffs, parseHandoffsInput, updateHandoffAtIndex, validateRequiredHandoffFields } from './handoffs';
import { collectHookCommandObjects, normalizePostedHookCommandProperties, readHookEventArray, readPostedHookCommands, removeHookCommandProperties } from './hooks';
import { getFileKind, isHookFilePath, normalizeFrontmatter } from './paths';
import { fileExists, getFileStat } from '../utils/vscodeResources';
import { normalizeObject, parseLines, readArray, readNumber, readSkillContext, readString, writeOptionalString } from '../utils/values';

interface CustomizationPersistenceActions {
	parseWorkspaceUri(value: unknown): vscode.Uri | undefined;
	postError(message: string): Promise<void>;
	postSaveError(message: string): Promise<void>;
	openNode(uriValue: unknown): Promise<void>;
	openMcpServersView(): Promise<void>;
	refresh(): void;
}

export class CustomizationPersistence {
	constructor(private readonly actions: CustomizationPersistenceActions) {}

	async saveNode(message: Record<string, unknown>): Promise<void> {
		const uri = this.actions.parseWorkspaceUri(message.uri);

		if (!uri) {
			await this.actions.postError('Unable to save: the selected node is not a workspace file.');
			return;
		}

		if (isHookFilePath(uri.path)) {
			await this.saveHookNode(uri, message);
			return;
		}

		const kind = getFileKind(uri);

		if (!kind) {
			await this.actions.postError('Unable to save: only .agent.md .prompt.md SKILL.md and instruction files can be edited.');
			return;
		}

		const bytes = await vscode.workspace.fs.readFile(uri);
		const rawMarkdown = Buffer.from(bytes).toString('utf8');
		const parsed = matter(rawMarkdown);
		const frontmatter = normalizeFrontmatter(parsed.data);
		const name = readString(message.name);
		const body = kind === 'agent' ? cleanAgentPlaceholderText(message.body, parsed.content) : typeof message.body === 'string' ? message.body : parsed.content;

		if (name) {
			frontmatter.name = name;
		} else {
			delete frontmatter.name;
		}

		if (kind === 'agent') {
			if (message.nodeType === 'handoff') {
				const handoffIndex = readNumber(message.handoffIndex);

				if (handoffIndex === undefined) {
					await this.actions.postError('Unable to save: selected handoff is missing its agent handoff index.');
					return;
				}

				const handoffValidation = validateRequiredHandoffFields([{
					label: message.name,
					agent: message.agent,
					prompt: message.prompt,
					send: message.send,
					model: message.handoffModel ?? message.model,
				}]);

				if (!handoffValidation.ok) {
					await this.actions.postSaveError(`Unable to save: handoff ${handoffValidation.index + 1} is missing ${handoffValidation.field}.`);
					return;
				}

				const handoffs = updateHandoffAtIndex(readArray(frontmatter.handoffs), handoffIndex, message);

				if (handoffs.length) {
					frontmatter.handoffs = handoffs;
				} else {
					delete frontmatter.handoffs;
				}

				const updatedMarkdown = stringifyCustomizationMarkdown(body, frontmatter);

				await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedMarkdown, 'utf8'));
				this.actions.refresh();
				return;
			}

			const handoffs = parseHandoffsInput(message.handoffs);

			if (!handoffs.ok) {
				await this.actions.postError('Unable to save: handoffs must be a JSON array.');
				return;
			}

			const handoffValidation = validateRequiredHandoffFields(handoffs.value);

			if (!handoffValidation.ok) {
				await this.actions.postSaveError(`Unable to save: handoff ${handoffValidation.index + 1} is missing ${handoffValidation.field}.`);
				return;
			}

			const normalizedHandoffs = normalizePostedHandoffs(handoffs.value);

			frontmatter.agents = parseLines(message.agents);
			frontmatter.tools = parseLines(message.tools);
			writeOptionalString(frontmatter, 'model', message.model);
			writeOptionalString(frontmatter, 'description', cleanAgentPlaceholderText(message.description));
			writeOptionalString(frontmatter, 'argument-hint', message.argumentHint);
			frontmatter['user-invocable'] = Boolean(message.userInvocable);
			frontmatter['disable-model-invocation'] = Boolean(message.disableModelInvocation);

			if (normalizedHandoffs.length) {
				frontmatter.handoffs = normalizedHandoffs;
			} else {
				delete frontmatter.handoffs;
			}
		} else if (kind === 'prompt') {
			const agent = readString(message.agent);
			frontmatter.tools = parseLines(message.tools);
			writeOptionalString(frontmatter, 'model', message.model);

			if (agent) {
				frontmatter.agent = agent;
			} else {
				delete frontmatter.agent;
			}
		} else if (kind === 'skill') {
			writeOptionalString(frontmatter, 'description', message.description);
			writeOptionalString(frontmatter, 'argument-hint', message.argumentHint);
			frontmatter['user-invocable'] = Boolean(message.userInvocable);
			frontmatter['disable-model-invocation'] = Boolean(message.disableModelInvocation);

			const skillContext = readSkillContext(message.skillContext);

			if (skillContext) {
				frontmatter.context = skillContext;
			} else {
				delete frontmatter.context;
			}
		} else if (kind === 'instruction') {
			writeOptionalString(frontmatter, 'description', message.description);
			writeOptionalString(frontmatter, 'applyTo', message.applyTo);
		}

		const updatedMarkdown = stringifyCustomizationMarkdown(body, frontmatter);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedMarkdown, 'utf8'));
		this.actions.refresh();
	}

	async createCustomization(message: Record<string, unknown>): Promise<void> {
		if (message.kind === 'mcp') {
			await this.actions.openMcpServersView();
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		const kind = message.kind === 'prompt' ? 'prompt' : message.kind === 'agent' ? 'agent' : message.kind === 'skill' ? 'skill' : message.kind === 'hook' ? 'hook' : message.kind === 'instruction' ? 'instruction' : undefined;
		const instructionType = kind === 'instruction' ? readInstructionCustomizationType(message.instructionType) : undefined;
		const displayName = readString(message.name);

		if (!workspaceFolder) {
			await this.actions.postSaveError('Unable to create: open a workspace folder first.');
			return;
		}

		if (!kind) {
			await this.actions.postSaveError('Unable to create: choose Instruction Agent Prompt Skill or Hook.');
			return;
		}

		if (!displayName) {
			await this.actions.postSaveError('Unable to create: enter a name.');
			return;
		}

		const baseFolderUri = getCustomizationFolderUri(workspaceFolder.uri, kind, instructionType);
		const folderUri = kind === 'skill' ? vscode.Uri.joinPath(baseFolderUri, getSkillFolderName(displayName)) : baseFolderUri;
		const uri = vscode.Uri.joinPath(folderUri, getCustomizationFileName(kind, displayName, instructionType));
		const folderStat = await getFileStat(folderUri);

		if (await fileExists(uri)) {
			await this.actions.postSaveError(`Unable to create: ${vscode.workspace.asRelativePath(uri, false)} already exists.`);
			return;
		}

		if (folderStat && !(folderStat.type & vscode.FileType.Directory)) {
			await this.actions.postSaveError(`Unable to create: ${vscode.workspace.asRelativePath(folderUri, false)} already exists and is not a folder.`);
			return;
		}

		try {
			await vscode.workspace.fs.createDirectory(folderUri);
			const content = kind === 'hook' ? createHookCustomizationJson(displayName) : createCustomizationMarkdown(kind, displayName, instructionType);

			await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
			await this.actions.openNode(uri.toString());
			this.actions.refresh();
		} catch (error) {
			const details = error instanceof Error ? error.message : String(error);

			await this.actions.postSaveError(`Unable to create: ${details}`);
		}
	}

	private async saveHookNode(uri: vscode.Uri, message: Record<string, unknown>): Promise<void> {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const rawJson = Buffer.from(bytes).toString('utf8');
		const parsed = normalizeObject(JSON.parse(rawJson));
		const hooks = normalizeObject(parsed.hooks);
		const hookName = readString(message.name);
		const hookCommands = readPostedHookCommands(message.hookCommands);

		if (hookName) {
			parsed.name = hookName;
		} else {
			delete parsed.name;
		}

		const existingCommands = collectHookCommandObjects(hooks);
		const nextHooks: Record<string, unknown> = {};

		for (const hookCommand of hookCommands) {
			const eventEntries = readHookEventArray(nextHooks, hookCommand.event);
			const properties = normalizePostedHookCommandProperties(hookCommand.properties);

			if (!Object.keys(properties).length) {
				nextHooks[hookCommand.event] = eventEntries;
				continue;
			}

			const existingCommand = existingCommands.get(hookCommand.id) || {};
			const updatedCommand = removeHookCommandProperties({ ...existingCommand, type: 'command' });

			for (const [property, value] of Object.entries(properties)) {
				updatedCommand[property] = value;
			}

			eventEntries.push(updatedCommand);
			nextHooks[hookCommand.event] = eventEntries;
		}

		parsed.hooks = nextHooks;

		await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(parsed, null, '\t')}\n`, 'utf8'));
		this.actions.refresh();
	}
}

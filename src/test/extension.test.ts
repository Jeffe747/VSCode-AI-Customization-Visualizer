import * as assert from 'assert';
import matter = require('gray-matter');
import * as vscode from 'vscode';
import { createCustomizationMarkdown, createHookCustomizationJson, getCustomizationFileName, getCustomizationFolderUri, isToolChoiceVisibleForFilter, normalizePostedHandoffs, parseHandoffsInput, parseLines, stringifyCustomizationMarkdown, toolChoiceHiddenCssRule, validateRequiredHandoffFields } from '../extension';
import { WorkspaceAiFile, mapWorkspaceFilesToGraph } from '../mapper';

suite('Extension Test Suite', () => {
	test('maps agent references into hierarchy links', () => {
		const files: WorkspaceAiFile[] = [
			createAgent('ProjectOrchestrator', ['ImplementationEngineer', 'TestEngineer']),
			createAgent('ImplementationEngineer'),
			createAgent('TestEngineer'),
		];

		const graph = mapWorkspaceFilesToGraph(files);

		assert.ok(graph.links.some(link => link.source === 'agent:projectorchestrator' && link.target === 'agent:implementationengineer' && link.type === 'uses-agent'));
		assert.ok(graph.links.some(link => link.source === 'agent:projectorchestrator' && link.target === 'agent:testengineer' && link.type === 'uses-agent'));
	});

	test('keeps editable metadata on file-backed nodes', () => {
		const handoffs = [{ label: 'Review', agent: 'ReviewAgent', prompt: 'Review this plan.' }];
		const graph = mapWorkspaceFilesToGraph([
			createAgent('ProjectOrchestrator', ['ImplementationEngineer'], ['codebase'], 'Coordinate the team.', 'GPT-5 (copilot)', false, 'task details', true, handoffs, 'Coordinates implementation work.'),
		]);
		const node = graph.nodes.find(node => node.id === 'agent:projectorchestrator');

		assert.ok(node);
		assert.strictEqual(node.uri, 'file:///ProjectOrchestrator.agent.md');
		assert.strictEqual(node.path, 'ProjectOrchestrator.agent.md');
		assert.deepStrictEqual(node.agents, ['ImplementationEngineer']);
		assert.deepStrictEqual(node.tools, ['codebase']);
		assert.strictEqual(node.model, 'GPT-5 (copilot)');
		assert.strictEqual(node.userInvocable, false);
		assert.strictEqual(node.description, 'Coordinates implementation work.');
		assert.strictEqual(node.argumentHint, 'task details');
		assert.strictEqual(node.disableModelInvocation, true);
		assert.deepStrictEqual(node.handoffs, handoffs);
		assert.strictEqual(node.body, 'Coordinate the team.');
		assert.strictEqual(node.contextEstimateTokens, undefined);
	});

	test('estimates initial context size for invocable agents', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('PlanningAgent', ['ReviewAgent'], ['codebase'], 'Plan work carefully.', undefined, true),
		]);
		const node = graph.nodes.find(node => node.id === 'agent:planningagent');

		assert.ok(node);
		assert.strictEqual(node.contextEstimateTokens, 17);
	});

	test('includes referenced agent files in context size estimates', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('PlanningAgent', ['ReviewAgent'], ['codebase'], 'Plan work carefully.', undefined, true),
			createAgent('ReviewAgent', [], ['search'], 'Review the implementation.', undefined, false),
		]);
		const node = graph.nodes.find(node => node.id === 'agent:planningagent');

		assert.ok(node);
		assert.strictEqual(node.contextEstimateTokens, 25);
	});

	test('keeps prompt model agent and tools metadata', () => {
		const graph = mapWorkspaceFilesToGraph([
			createPrompt('review.prompt.md', 'review', 'ProjectOrchestrator', ['search'], 'Claude Sonnet 4.5 (copilot)'),
		]);
		const node = graph.nodes.find(node => node.id === 'prompt:review.prompt.md');

		assert.ok(node);
		assert.strictEqual(node.agent, 'ProjectOrchestrator');
		assert.deepStrictEqual(node.tools, ['search']);
		assert.strictEqual(node.model, 'Claude Sonnet 4.5 (copilot)');
	});

	test('matches kebab-case agent files to PascalCase references', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('ProjectOrchestrator', ['ImplementationEngineer']),
			createAgent('implementation-engineer'),
		]);
		const implementationEngineer = graph.nodes.find(node => node.id === 'agent:implementationengineer');

		assert.ok(implementationEngineer);
		assert.strictEqual(implementationEngineer.unresolved, false);
		assert.strictEqual(implementationEngineer.path, 'implementation-engineer.agent.md');
	});

	test('keeps tools out of the visible graph', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('ProjectOrchestrator', [], ['codebase']),
		]);
		const agentNode = graph.nodes.find(node => node.id === 'agent:projectorchestrator');

		assert.ok(agentNode);
		assert.deepStrictEqual(agentNode.tools, ['codebase']);
		assert.deepStrictEqual(graph.availableTools, [{ name: 'codebase' }]);
		assert.strictEqual(graph.nodes.some(node => node.type === 'tool'), false);
		assert.strictEqual(graph.links.some(link => link.type === 'uses-tool'), false);
	});

	test('maps configured MCP servers as visible nodes', () => {
		const graph = mapWorkspaceFilesToGraph([], [
			{ name: 'playwright', source: '.vscode/mcp.json', serverType: 'stdio', command: 'npx' },
		]);
		const node = graph.nodes.find(node => node.id === 'mcp:.vscode/mcp.json:playwright');

		assert.ok(node);
		assert.strictEqual(node.type, 'mcp');
		assert.strictEqual(node.label, 'playwright');
		assert.strictEqual(node.mcpSource, '.vscode/mcp.json');
		assert.strictEqual(node.mcpServerType, 'stdio');
		assert.strictEqual(node.mcpCommand, 'npx');
	});

	test('links agents to configured MCP servers listed as tools', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('ResearchAgent', [], ['playwright/*', 'codebase']),
		], [
			{ name: 'playwright', source: '.vscode/mcp.json', serverType: 'stdio', command: 'npx' },
		]);

		assert.ok(graph.links.some(link => link.source === 'agent:researchagent' && link.target === 'mcp:.vscode/mcp.json:playwright' && link.type === 'uses-mcp'));
		assert.deepStrictEqual(graph.availableTools, [{ name: 'codebase' }]);
	});

	test('maps embedded handoffs as visible nodes linked from owners to target agents', () => {
		const handoff = { label: 'Start Implementation', agent: 'ImplementationAgent', prompt: 'Now implement the plan.', send: true, model: 'GPT-5 (copilot)' };
		const graph = mapWorkspaceFilesToGraph([
			createAgent('PlanningAgent', [], [], '', undefined, undefined, undefined, undefined, [handoff]),
			createAgent('ImplementationAgent'),
		]);
		const node = graph.nodes.find(node => node.id === 'handoff:PlanningAgent.agent.md:0');

		assert.ok(node);
		assert.strictEqual(node.type, 'handoff');
		assert.strictEqual(node.label, 'Start Implementation');
		assert.strictEqual(node.uri, 'file:///PlanningAgent.agent.md');
		assert.strictEqual(node.path, 'PlanningAgent.agent.md#handoffs[1]');
		assert.strictEqual(node.handoffIndex, 0);
		assert.strictEqual(node.handoffAgent, 'ImplementationAgent');
		assert.strictEqual(node.handoffPrompt, 'Now implement the plan.');
		assert.strictEqual(node.handoffSend, true);
		assert.strictEqual(node.handoffModel, 'GPT-5 (copilot)');
		assert.ok(graph.links.some(link => link.source === 'agent:planningagent' && link.target === 'handoff:PlanningAgent.agent.md:0' && link.type === 'uses-handoff'));
		assert.ok(graph.links.some(link => link.source === 'handoff:PlanningAgent.agent.md:0' && link.target === 'agent:implementationagent' && link.type === 'handoff-to-agent'));
	});

	test('keeps duplicate handoff labels distinct per owning agent', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('Planning', [], [], '', undefined, undefined, undefined, undefined, [{ label: 'Test1', agent: 'ProjectOrchestrator' }]),
			createAgent('Review', [], [], '', undefined, undefined, undefined, undefined, [{ label: 'Test1', agent: 'ProjectOrchestrator' }]),
			createAgent('ProjectOrchestrator'),
		]);

		assert.strictEqual(graph.nodes.filter(node => node.type === 'handoff' && node.label === 'Test1').length, 2);
		assert.ok(graph.links.some(link => link.source === 'agent:planning' && link.target === 'handoff:Planning.agent.md:0' && link.type === 'uses-handoff'));
		assert.ok(graph.links.some(link => link.source === 'agent:review' && link.target === 'handoff:Review.agent.md:0' && link.type === 'uses-handoff'));
	});

	test('maps legacy handoff editor property names into graph nodes', () => {
		const graph = mapWorkspaceFilesToGraph([
			createAgent('Planning', [], [], '', undefined, undefined, undefined, undefined, [{ name: 'Proceed', handoffAgent: 'ProjectOrchestrator', handoffPrompt: 'Continue the work.', handoffSend: false, handoffModel: 'Auto (copilot)' }]),
			createAgent('ProjectOrchestrator'),
		]);
		const node = graph.nodes.find(node => node.id === 'handoff:Planning.agent.md:0');

		assert.ok(node);
		assert.strictEqual(node.label, 'Proceed');
		assert.strictEqual(node.handoffAgent, 'ProjectOrchestrator');
		assert.strictEqual(node.handoffPrompt, 'Continue the work.');
		assert.strictEqual(node.handoffSend, false);
		assert.strictEqual(node.handoffModel, 'Auto (copilot)');
		assert.ok(graph.links.some(link => link.source === 'handoff:Planning.agent.md:0' && link.target === 'agent:projectorchestrator' && link.type === 'handoff-to-agent'));
	});

	test('maps hook configs as visible nodes with event summaries', () => {
		const graph = mapWorkspaceFilesToGraph([], [], [
			{
				name: 'Workspace hooks',
				source: '.github/hooks/notify.json',
				uri: 'file:///.github/hooks/notify.json',
				events: [
					{
						name: 'PreToolUse',
						description: 'Before the agent invokes a tool.',
						commandCount: 2,
						variableDriven: true,
					},
					{
						name: 'Stop',
						description: 'Agent session ends.',
						commandCount: 1,
						variableDriven: false,
					},
				],
				commands: [
					{
						id: 'PreToolUse:0',
						event: 'PreToolUse',
						index: 0,
						name: 'PreToolUse command 1',
						command: './scripts/validate-tool.ps1',
					},
				],
			},
		]);
		const node = graph.nodes.find(node => node.id === 'hook:.github/hooks/notify.json');

		assert.ok(node);
		assert.strictEqual(node.type, 'hook');
		assert.strictEqual(node.uri, 'file:///.github/hooks/notify.json');
		assert.strictEqual(node.path, '.github/hooks/notify.json');
		assert.strictEqual(node.hookSource, '.github/hooks/notify.json');
		assert.strictEqual(node.hookEvents?.[0]?.name, 'PreToolUse');
		assert.strictEqual(node.hookEvents?.[0]?.commandCount, 2);
		assert.strictEqual(node.hookEvents?.[0]?.variableDriven, true);
		assert.strictEqual(node.hookEvents?.[1]?.name, 'Stop');
		assert.strictEqual(node.hookEvents?.[1]?.variableDriven, false);
		assert.strictEqual(node.hookCommands?.[0]?.id, 'PreToolUse:0');
		assert.strictEqual(node.hookCommands?.[0]?.command, './scripts/validate-tool.ps1');

		const preToolUseNode = graph.nodes.find(node => node.id === 'hook:.github/hooks/notify.json:event:PreToolUse');
		const stopNode = graph.nodes.find(node => node.id === 'hook:.github/hooks/notify.json:event:Stop');

		assert.ok(preToolUseNode);
		assert.strictEqual(preToolUseNode.type, 'hook-event');
		assert.strictEqual(preToolUseNode.label, 'PreToolUse');
		assert.strictEqual(preToolUseNode.hookEventCommandCount, 2);
		assert.strictEqual(preToolUseNode.hookEventVariableDriven, true);
		assert.ok(stopNode);
		assert.strictEqual(stopNode.type, 'hook-event');
		assert.ok(graph.links.some(link => link.source === 'hook:.github/hooks/notify.json' && link.target === 'hook:.github/hooks/notify.json:event:PreToolUse' && link.type === 'has-hook-event'));
		assert.ok(graph.links.some(link => link.source === 'hook:.github/hooks/notify.json' && link.target === 'hook:.github/hooks/notify.json:event:Stop' && link.type === 'has-hook-event'));
	});

	test('keeps empty hook configs visible', () => {
		const graph = mapWorkspaceFilesToGraph([], [], [
			{
				name: 'Empty hooks',
				source: '.github/hooks/empty.json',
				uri: 'file:///.github/hooks/empty.json',
				events: [],
				commands: [],
			},
		]);
		const node = graph.nodes.find(node => node.id === 'hook:.github/hooks/empty.json');

		assert.ok(node);
		assert.strictEqual(node.type, 'hook');
		assert.deepStrictEqual(node.hookEvents, []);
		assert.deepStrictEqual(node.hookCommands, []);
	});

	test('maps instruction files as visible instruction areas', () => {
		const graph = mapWorkspaceFilesToGraph([
			createInstruction('.github/copilot-instructions.md', 'copilot-instructions', 'Use project conventions.', 'Project-wide conventions.', '**'),
		]);
		const node = graph.nodes.find(node => node.id === 'instruction:.github/copilot-instructions.md');

		assert.ok(node);
		assert.strictEqual(node.type, 'instruction');
		assert.strictEqual(node.uri, 'file:///.github/copilot-instructions.md');
		assert.strictEqual(node.path, '.github/copilot-instructions.md');
		assert.strictEqual(node.body, 'Use project conventions.');
		assert.strictEqual(node.description, 'Project-wide conventions.');
		assert.strictEqual(node.applyTo, '**');
		assert.strictEqual(node.instructionAudience, 'Copilot');
		assert.deepStrictEqual(node.tools, []);
		assert.strictEqual(graph.links.length, 0);
	});

	test('maps instruction file audiences by convention', () => {
		const graph = mapWorkspaceFilesToGraph([
			createInstruction('AGENTS.md', 'AGENTS'),
			createInstruction('CLAUDE.md', 'CLAUDE'),
			createInstruction('.github/instructions/typescript.instructions.md', 'typescript'),
		]);

		assert.strictEqual(graph.nodes.find(node => node.path === 'AGENTS.md')?.instructionAudience, 'All AI');
		assert.strictEqual(graph.nodes.find(node => node.path === 'CLAUDE.md')?.instructionAudience, 'Claude');
		assert.strictEqual(graph.nodes.find(node => node.path === '.github/instructions/typescript.instructions.md')?.instructionAudience, 'Copilot scoped');
	});

	test('maps skill files with editable metadata', () => {
		const graph = mapWorkspaceFilesToGraph([
			createSkill('.github/skills/webapp-testing/SKILL.md', 'webapp-testing', 'Test web applications.', 'target page', true, true, 'fork'),
		]);
		const node = graph.nodes.find(node => node.id === 'skill:.github/skills/webapp-testing/SKILL.md');

		assert.ok(node);
		assert.strictEqual(node.type, 'skill');
		assert.strictEqual(node.uri, 'file:///.github/skills/webapp-testing/SKILL.md');
		assert.strictEqual(node.path, '.github/skills/webapp-testing/SKILL.md');
		assert.strictEqual(node.description, 'Test web applications.');
		assert.strictEqual(node.argumentHint, 'target page');
		assert.strictEqual(node.userInvocable, true);
		assert.strictEqual(node.disableModelInvocation, true);
		assert.strictEqual(node.skillContext, 'fork');
		assert.strictEqual(node.unresolved, false);
	});

	test('flags invalid skill metadata', () => {
		const graph = mapWorkspaceFilesToGraph([
			createSkill('.github/skills/webapp-testing/SKILL.md', 'WebApp.Testing', ''),
		]);
		const node = graph.nodes.find(node => node.id === 'skill:.github/skills/webapp-testing/SKILL.md');

		assert.ok(node);
		assert.strictEqual(node.unresolved, true);
		assert.ok(node.skillIssues?.some(issue => issue.includes('description')));
		assert.ok(node.skillIssues?.some(issue => issue.includes('lowercase')));
		assert.ok(node.skillIssues?.some(issue => issue.includes('parent directory')));
	});

	test('creates expected customization file names', () => {
		assert.strictEqual(getCustomizationFileName('agent', 'Project Orchestrator'), 'project-orchestrator.agent.md');
		assert.strictEqual(getCustomizationFileName('prompt', 'Review API!'), 'review-api.prompt.md');
		assert.strictEqual(getCustomizationFileName('skill', 'Web App Testing'), 'SKILL.md');
		assert.strictEqual(getCustomizationFileName('hook', 'Tool Guard'), 'tool-guard.json');
		assert.strictEqual(getCustomizationFileName('instruction', 'TypeScript Rules'), 'typescript-rules.instructions.md');
		assert.strictEqual(getCustomizationFileName('instruction', 'Copilot Rules', 'copilot'), 'copilot-instructions.md');
		assert.strictEqual(getCustomizationFileName('instruction', 'All AI Rules', 'agents'), 'AGENTS.md');
		assert.strictEqual(getCustomizationFileName('instruction', 'Claude Rules', 'claude'), 'CLAUDE.md');
	});

	test('creates instruction customizations in expected folders', () => {
		const workspaceUri = vscode.Uri.file('/workspace');

		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'instruction').path, '/workspace/.github/instructions');
		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'instruction', 'copilot').path, '/workspace/.github');
		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'instruction', 'agents').path, '/workspace');
		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'instruction', 'claude').path, '/workspace/.claude');
		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'skill').path, '/workspace/.github/skills');
		assert.strictEqual(getCustomizationFolderUri(workspaceUri, 'hook').path, '/workspace/.github/hooks');
	});

	test('creates starter markdown for new customizations', () => {
		const agent = matter(createCustomizationMarkdown('agent', 'Planning Agent'));
		const prompt = matter(createCustomizationMarkdown('prompt', 'Review Prompt'));
		const skill = matter(createCustomizationMarkdown('skill', 'Web App Testing'));
		const instruction = matter(createCustomizationMarkdown('instruction', 'TypeScript Rules'));

		assert.strictEqual(agent.data.name, 'Planning Agent');
		assert.strictEqual(agent.data['user-invocable'], true);
		assert.deepStrictEqual(agent.data.tools, []);
		assert.deepStrictEqual(agent.data.agents, []);
		assert.strictEqual(agent.data.description, undefined);
		assert.strictEqual(agent.content.trim(), '');

		assert.strictEqual(prompt.data.name, 'Review Prompt');
		assert.strictEqual(prompt.data.agent, 'agent');
		assert.deepStrictEqual(prompt.data.tools, []);
		assert.ok(prompt.content.includes('Describe the task this prompt should run'));

		assert.strictEqual(skill.data.name, 'web-app-testing');
		assert.strictEqual(skill.data['user-invocable'], false);
		assert.ok(skill.data.description.includes('reusable capability'));
		assert.ok(skill.content.includes("Describe the skill's workflow"));

		assert.strictEqual(instruction.data.name, 'TypeScript Rules');
		assert.strictEqual(instruction.data.applyTo, '**');
		assert.ok(instruction.content.includes('Describe the coding guidelines'));
	});

	test('creates starter JSON for new hook customizations', () => {
		const hook = JSON.parse(createHookCustomizationJson('Tool Guard')) as Record<string, unknown>;
		const hooks = hook.hooks as Record<string, unknown>;

		assert.strictEqual(hook.name, 'Tool Guard');
		assert.deepStrictEqual(hooks.PreToolUse, []);
	});

	test('saves agent tools as an inline frontmatter list', () => {
		const markdown = stringifyCustomizationMarkdown('Agent body.', {
			name: 'Planning Agent',
			agents: ['ReviewAgent'],
			tools: ['codebase', 'web/fetch'],
			'user-invocable': true,
		});

		assert.match(markdown, /^tools: \[codebase,web\/fetch\]$/m);
		assert.doesNotMatch(markdown, /^tools:\n\s+- /m);
		assert.deepStrictEqual(matter(markdown).data.tools, ['codebase', 'web/fetch']);
	});

	test('saves prompt tools as an inline frontmatter list', () => {
		const markdown = stringifyCustomizationMarkdown('Prompt body.', {
			name: 'Review Prompt',
			agent: 'agent',
			tools: ['search', 'custom-tool'],
		});

		assert.match(markdown, /^tools: \[search,custom-tool\]$/m);
		assert.doesNotMatch(markdown, /^tools:\n\s+- /m);
		assert.deepStrictEqual(matter(markdown).data.tools, ['search', 'custom-tool']);
	});

	test('filters tools by trimmed case-insensitive contains text', () => {
		assert.strictEqual(isToolChoiceVisibleForFilter('read', ''), true);
		assert.strictEqual(isToolChoiceVisibleForFilter('read', '  RE  '), true);
		assert.strictEqual(isToolChoiceVisibleForFilter('copilot_fetchWebPage', 'fetch'), true);
		assert.strictEqual(isToolChoiceVisibleForFilter('search', 'read'), false);
	});

	test('keeps hidden filtered tool rows from overriding display none', () => {
		assert.match(toolChoiceHiddenCssRule, /\.tool-choice-list\s+\.choice-check\[hidden\]/);
		assert.match(toolChoiceHiddenCssRule, /display:\s*none/);
	});

	test('parses comma newline and array line inputs into unique trimmed values', () => {
		assert.deepStrictEqual(parseLines(' search, read\nread\n custom-tool '), ['search', 'read', 'custom-tool']);
		assert.deepStrictEqual(parseLines([' search ', 'read', 'read', 7]), ['search', 'read']);
		assert.deepStrictEqual(parseLines({ tools: ['read'] }), []);
	});

	test('parses handoff JSON input only when it is an array', () => {
		assert.deepStrictEqual(parseHandoffsInput(''), { ok: true, value: [] });
		assert.deepStrictEqual(parseHandoffsInput('[{"label":"Proceed","agent":"agent","prompt":"Go","send":false}]'), { ok: true, value: [{ label: 'Proceed', agent: 'agent', prompt: 'Go', send: false }] });
		assert.deepStrictEqual(parseHandoffsInput('{"label":"Proceed"}'), { ok: false });
		assert.deepStrictEqual(parseHandoffsInput('['), { ok: false });
	});

	test('normalizes posted handoffs from canonical and editor property names', () => {
		assert.deepStrictEqual(normalizePostedHandoffs([
			{ label: ' Proceed ', agent: ' agent ', prompt: ' Go ', send: false, model: ['Auto (copilot)', 'GPT-5 (copilot)'] },
			{ name: 'Review', handoffAgent: 'Reviewer', handoffPrompt: 'Review this.', handoffSend: true, handoffModel: 'Claude (copilot)' },
			{ send: true },
		]), [
			{ send: false, label: 'Proceed', agent: 'agent', prompt: 'Go', model: 'Auto (copilot), GPT-5 (copilot)' },
			{ send: true, label: 'Review', agent: 'Reviewer', prompt: 'Review this.', model: 'Claude (copilot)' },
		]);
	});

	test('saves handoff model inside handoff frontmatter item', () => {
		const markdown = stringifyCustomizationMarkdown('Agent body.', {
			name: 'Worker',
			handoffs: [
				{
					send: false,
					label: 'Proceed',
					agent: 'agent',
					prompt: 'Proceed',
					model: 'Auto (copilot)',
				},
			],
		});

		assert.match(markdown, /^\s+model: Auto \(copilot\)$/m);
		assert.doesNotMatch(markdown, /^model: Auto \(copilot\)$/m);
		assert.strictEqual(matter(markdown).data.handoffs[0].model, 'Auto (copilot)');
	});

	test('requires handoff fields except model before saving', () => {
		assert.deepStrictEqual(validateRequiredHandoffFields([{ label: 'Proceed', agent: 'agent', prompt: 'Proceed', send: false }]), { ok: true });
		assert.deepStrictEqual(validateRequiredHandoffFields([{ agent: 'agent', prompt: 'Proceed', send: false, model: 'Auto (copilot)' }]), { ok: false, index: 0, field: 'label' });
		assert.deepStrictEqual(validateRequiredHandoffFields([{ label: 'Proceed', prompt: 'Proceed', send: false }]), { ok: false, index: 0, field: 'agent' });
		assert.deepStrictEqual(validateRequiredHandoffFields([{ label: 'Proceed', agent: 'agent', send: false }]), { ok: false, index: 0, field: 'prompt' });
		assert.deepStrictEqual(validateRequiredHandoffFields([{ label: 'Proceed', agent: 'agent', prompt: 'Proceed' }]), { ok: false, index: 0, field: 'send' });
	});
});

function createAgent(name: string, agents: string[] = [], tools: string[] = [], body = '', model?: string, userInvocable?: boolean, argumentHint?: string, disableModelInvocation?: boolean, handoffs?: unknown[], description?: string): WorkspaceAiFile {
	return {
		uri: `file:///${name}.agent.md`,
		relativePath: `${name}.agent.md`,
		kind: 'agent',
		name,
		frontmatter: { name, agents, tools, description, 'argument-hint': argumentHint, 'disable-model-invocation': disableModelInvocation, handoffs },
		body,
		agents,
		tools,
		model,
		userInvocable,
		description,
		argumentHint,
		disableModelInvocation,
		handoffs,
	};
}

function createPrompt(relativePath: string, name: string, agent: string, tools: string[] = [], model?: string): WorkspaceAiFile {
	return {
		uri: `file:///${relativePath}`,
		relativePath,
		kind: 'prompt',
		name,
		frontmatter: { name, agent, tools, model },
		body: '',
		agents: [],
		tools,
		agent,
		model,
	};
}

function createInstruction(relativePath: string, name: string, body = '', description?: string, applyTo?: string): WorkspaceAiFile {
	return {
		uri: `file:///${relativePath}`,
		relativePath,
		kind: 'instruction',
		name,
		frontmatter: { name, description, applyTo },
		body,
		agents: [],
		tools: [],
		description,
		applyTo,
	};
}

function createSkill(relativePath: string, name: string, description: string, argumentHint?: string, userInvocable?: boolean, disableModelInvocation?: boolean, skillContext?: 'inline' | 'fork'): WorkspaceAiFile {
	return {
		uri: `file:///${relativePath}`,
		relativePath,
		kind: 'skill',
		name,
		frontmatter: { name, description },
		body: 'Follow these skill instructions.',
		agents: [],
		tools: [],
		description,
		argumentHint,
		userInvocable,
		disableModelInvocation,
		skillContext,
		skillFolderName: relativePath.split('/').at(-2),
	};
}

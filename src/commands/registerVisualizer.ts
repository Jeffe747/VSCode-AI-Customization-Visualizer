import * as vscode from 'vscode';
import { hookGlob, instructionGlob, markdownGlob, mcpGlob, skillGlob } from '../customizations/globs';
import { WorkspaceScanner } from '../scanner/workspaceScanner';
import { AgentVisualizerViewProvider } from '../webview/agentVisualizerViewProvider';

const viewType = 'aivisualizer.agentVisualizer';

export function registerVisualizer(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Copilot AI Customization Visualizer');
	const diagnostics = vscode.languages.createDiagnosticCollection('aivisualizer');
	const scanner = new WorkspaceScanner(output);
	const provider = new AgentVisualizerViewProvider(context, scanner, diagnostics);
	const fileWatchers = createGraphFileWatchers(provider);

	context.subscriptions.push(
		output,
		diagnostics,
		vscode.window.registerWebviewViewProvider(viewType, provider),
		vscode.commands.registerCommand('aivisualizer.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('aivisualizer.popout', () => void provider.toggleWindowMode()),
		...fileWatchers,
	);

	if (context.extensionMode === vscode.ExtensionMode.Test) {
		context.subscriptions.push(
			vscode.commands.registerCommand('aivisualizer.test.resetPostedMessages', () => provider.resetPostedMessagesForTests()),
			vscode.commands.registerCommand('aivisualizer.test.getPostedMessages', () => provider.getPostedMessagesForTests()),
		);
	}
}

function createGraphFileWatchers(provider: AgentVisualizerViewProvider): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	for (const glob of [markdownGlob, skillGlob, instructionGlob, hookGlob, mcpGlob]) {
		const watcher = vscode.workspace.createFileSystemWatcher(glob);
		const refresh = () => provider.refresh();

		disposables.push(
			watcher,
			watcher.onDidCreate(refresh),
			watcher.onDidChange(refresh),
			watcher.onDidDelete(refresh),
		);
	}

	return disposables;
}

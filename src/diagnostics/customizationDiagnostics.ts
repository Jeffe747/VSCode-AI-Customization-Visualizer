import * as vscode from 'vscode';
import { GraphJson, WorkspaceAiFile } from '../mapper';
import { ReadProblem } from '../scanner/workspaceScanner';
import { capitalize, readString } from '../utils/values';

export function updateCustomizationDiagnostics(diagnostics: vscode.DiagnosticCollection, files: WorkspaceAiFile[], graph: GraphJson, readProblems: ReadProblem[]): void {
	const diagnosticsByUri = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();

	const addDiagnostic = (uriValue: string, message: string, severity = vscode.DiagnosticSeverity.Warning) => {
		const uri = vscode.Uri.parse(uriValue);
		const key = uri.toString();
		const entry = diagnosticsByUri.get(key) || { uri, diagnostics: [] };
		const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message, severity);

		diagnostic.source = 'AI Customization Visualizer';
		entry.diagnostics.push(diagnostic);
		diagnosticsByUri.set(key, entry);
	};

	for (const problem of readProblems) {
		const message = problem.details ? `${problem.message}: ${problem.details}` : problem.message;

		addDiagnostic(problem.uri.toString(), message, vscode.DiagnosticSeverity.Error);
	}

	for (const file of files) {
		if ((file.kind === 'agent' || file.kind === 'prompt' || file.kind === 'skill') && !readString(file.frontmatter.name)) {
			addDiagnostic(file.uri, `${capitalize(file.kind)} file is missing a name in frontmatter.`, vscode.DiagnosticSeverity.Error);
		}
	}

	for (const node of graph.nodes) {
		if (node.type === 'skill' && node.uri && node.skillIssues?.length) {
			for (const issue of node.skillIssues) {
				addDiagnostic(node.uri, issue, vscode.DiagnosticSeverity.Error);
			}
		}
	}

	const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
	const unresolvedMessages = new Set<string>();

	for (const link of graph.links) {
		const target = nodeById.get(link.target);

		if (!target?.unresolved || target.type !== 'agent') {
			continue;
		}

		const source = nodeById.get(link.source);
		const uri = source?.uri;

		if (!uri) {
			continue;
		}

		const key = `${uri}:${target.id}`;

		if (unresolvedMessages.has(key)) {
			continue;
		}

		unresolvedMessages.add(key);
		addDiagnostic(uri, `Unresolved agent reference: ${target.label}.`, vscode.DiagnosticSeverity.Error);
	}

	diagnostics.clear();

	for (const entry of diagnosticsByUri.values()) {
		diagnostics.set(entry.uri, entry.diagnostics);
	}
}

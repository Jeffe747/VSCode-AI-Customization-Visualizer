import * as path from 'path';
import * as vscode from 'vscode';

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
	return Boolean(await getFileStat(uri));
}

export async function getFileStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
	try {
		return await vscode.workspace.fs.stat(uri);
	} catch {
		return undefined;
	}
}

export function isWorkspaceResourceUri(uri: vscode.Uri): boolean {
	if (vscode.workspace.getWorkspaceFolder(uri)) {
		return true;
	}

	if (uri.scheme !== 'file') {
		return false;
	}

	const candidatePath = normalizeResourcePath(uri.fsPath);

	return Boolean(vscode.workspace.workspaceFolders?.some(folder => {
		const folderPath = normalizeResourcePath(folder.uri.fsPath);
		const folderPrefix = folderPath.endsWith(path.sep) ? folderPath : `${folderPath}${path.sep}`;

		return candidatePath === folderPath || candidatePath.startsWith(folderPrefix);
	}));
}

export function findOpenTextTabViewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
	for (const tabGroup of vscode.window.tabGroups.all) {
		if (tabGroup.tabs.some(tab => tab.input instanceof vscode.TabInputText && areSameResourceUri(tab.input.uri, uri))) {
			return tabGroup.viewColumn;
		}
	}

	return undefined;
}

function normalizeResourcePath(value: string): string {
	const normalized = path.normalize(value);

	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function areSameResourceUri(left: vscode.Uri, right: vscode.Uri): boolean {
	if (left.scheme === 'file' && right.scheme === 'file') {
		const leftPath = path.normalize(left.fsPath);
		const rightPath = path.normalize(right.fsPath);

		return process.platform === 'win32' ? leftPath.toLowerCase() === rightPath.toLowerCase() : leftPath === rightPath;
	}

	return left.toString() === right.toString();
}

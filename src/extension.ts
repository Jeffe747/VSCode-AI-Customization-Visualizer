import * as vscode from 'vscode';
import { registerVisualizer } from './commands/registerVisualizer';

export function activate(context: vscode.ExtensionContext) {
	registerVisualizer(context);
}

export function deactivate() {}



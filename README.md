# Copilot AI Customization Visualizer

Copilot AI Customization Visualizer is a VS Code extension for inspecting and editing project Copilot AI customization files from one visual workspace. It maps custom agents, prompt files, instruction files, hooks, model choices, sub-agent links, and active tools into an interactive graph.

Author: Jeffe747@github

Copilot AI Customization Visualizer has been AI-engineered with ChatGpt5.5.

## Features

- Visualizes custom agents, handoffs, prompts, skills, MCP servers, hooks, and instruction files in a graph view.
- Shows relationships between agents, prompt agent modes, and sub-agent references.
- Places hooks and MCP/tool-style nodes below the agent hierarchy for easier scanning.
- Draws links from agents to MCP servers when the agent tools include `<server name>/*`.
- Displays instruction files as areas with labels for which AI tools they affect.
- Marks invocable agents with larger nodes, sub-agents, unresolved referenced agents, and agent model choices.
- Edits agent, prompt, and instruction metadata directly from the extension view, including agent handoffs and instruction `applyTo` globs.
- Edits skill metadata and instructions directly from the extension view.
- Marks skill context on skill nodes with a plus for inline context and a star for forked context.
- Marks model-invocable skill nodes with an agent-colored border when Disable Model Invocation is off.
- Opens MCP server management in VS Code's Extensions view from MCP nodes.
- Outlines configured hook events with a lifecycle-event dropdown, descriptions, and variable-driven tool logic notes.
- Edits hook names, configured hook event types, and hook command properties directly against the selected hook JSON file.
- Adds new hook events from the hook editor without exposing command text.
- Shows hook command property toggles for command, platform overrides, cwd, env, and timeout.
- Shows configured hook events as smaller nodes connected to hook file nodes, without exposing command text in the graph.
- Supports tool selection, custom tools, tool filtering, and inline active-tool pills.
- Creates new agent, handoff, prompt, skill, hook, and instruction customization files from the `+` button.
- Opens MCP server management from the `+` button.
- Keeps element-size and editor-text controls in a toolbar settings dialog.
- Opens the visualizer in Window-mode for a larger editing surface.

## Supported Files

Copilot AI Customization Visualizer scans common Copilot and AI customization files, including:

- `.agent.md`
- `.github/agents/handoffs/*.handoff.md`
- `.prompt.md`
- `skills/<skill-name>/SKILL.md`
- `.vscode/mcp.json`
- `.github/hooks/*.json`
- `.claude/settings.json`
- `.claude/settings.local.json`
- `.instructions.md`
- `.github/copilot-instructions.md`
- `AGENTS.md`
- `.claude/CLAUDE.md`

## Usage

Open the `Copilot AI Customization Visualizer` activity bar view to inspect the current workspace. Select a node to edit its metadata and system prompt, then use `Save` or `Ctrl+S` to write changes back to the source file.

Use the toolbar settings button to adjust graph element size and editor text size.

## Extension Commands

- `Copilot AI Customization Visualizer: Refresh Copilot AI Customization Visualizer`
- `Copilot AI Customization Visualizer: Open Copilot AI Customization Visualizer in Window-mode`

## Requirements

No external services are required. The extension works with files in the current VS Code workspace.

## Release Notes

### 0.0.1

Initial Copilot AI Customization Visualizer release with graph visualization, metadata editing, customization creation, instruction-file support, tool selection, and Window-mode.

# Usage
Tasks should be listed as small and precie tasks. Use already defined tasks as a template.

# Done

## Handoff Plan: Refactor Webview Renderer and Add E2E UI Coverage

### Original Goal
- Dismantle the massive `src/webview/htmlRenderer.ts` file into maintainable webview UI modules.
- Replace fragile HTML string concatenation with a declarative frontend layer.
- Add real VS Code integration coverage that activates the extension, runs `aivisualizer.refresh`, and verifies webview message payloads.

### Original Recommendation
- Use Svelte for the webview UI.
- Keep the extension bundle on the existing esbuild pipeline.
- Add a separate Vite/Svelte build for webview assets only.
- Use `@vscode/test-electron` as the primary E2E/integration test harness.
- Defer Playwright unless DOM-level webview interaction or visual regression testing is needed later.

### Acceptance Criteria Met
- `src/webview/htmlRenderer.ts` is reduced to a small webview HTML shell.
- Webview UI is implemented as Svelte components and supporting TypeScript modules.
- The extension still loads the activity-bar webview and window-mode panel.

### Phase 1: Add a Separate Webview Build
- Added Svelte/Vite dev dependencies and a separate webview build pipeline.
- Kept `esbuild.js` responsible for `dist/extension.js`.
- Added Vite output for webview assets in `dist/webview/`.
- Updated compile, watch, package, and prepublish scripts so extension and webview assets are built together.
- Confirmed CSP-compatible bundled webview output with no remote assets.

### Phase 2: Reduce `htmlRenderer.ts` to a Shell
- Switched normal extension use from the legacy HTML string renderer to the bundled Svelte webview shell.
- Kept the provider-facing `renderVisualizerHtml(webview, isWindowModeView, settings)` entry point stable.
- Reduced `src/webview/htmlRenderer.ts` to the HTML shell, CSP, root element, bootstrapped settings, color variables, and bundled JS/CSS asset links.
- Removed legacy static markup, dialogs, graph UI, editor UI, event handling, and SVG rendering from the renderer string.

### Phase 3: Define a Typed Webview Protocol
- Added shared extension-to-webview message types for graph loading, update, error, save error, and window-mode update.
- Added shared webview-to-extension message types for ready, refresh, popout, open actions, save, create, and settings updates.
- Reused the shared protocol from the provider and Svelte webview app where practical.

### Phase 4: Completed Webview UI Migration Slices
- Added the first Svelte webview UI migration slice with toolbar, about/settings/new dialogs, documentation links, graph shell, toast components, and shared app styling.
- Added Svelte-side message runtime and VS Code API helpers for ready, refresh, popout, documentation links, loading, graph update, graph error, save error, and window-mode state handling.
- Ported graph overlay state with a layout selector, token heatmap toggle, orphan highlight toggle, and `vscode.setState` persistence.
- Ported first-pass graph layout helpers and SVG rendering for hierarchical, radial, and force-style grid layouts using `GraphJson` payloads.
- Ported first-pass graph node interaction with click/keyboard selection, selected-node styling, and a placeholder editor panel with node details plus Open file/MCP actions.
- Ported first-pass graph navigation with background drag panning, Ctrl+wheel zoom, panning cursors, and larger invisible SVG node hit targets.
- Ported editable Svelte instruction, prompt, and first-pass agent editor forms with `node:save` payload generation.
- Ported the first-pass editable Svelte skill editor form with `node:save` payload generation.
- Ported the first-pass direct Svelte handoff editor form with `node:save` payload generation.
- Ported the first-pass editable Svelte hook editor form with hook command payload generation.
- Ported Svelte new customization dialog behavior with create payload posting, MCP open behavior, validation feedback, and focus handling.
- Ported Svelte settings dialog behavior with auto-persisted layout, documentation, graph toggle, sizing, heatmap, baseline model, debug, and color settings.
- Ported Svelte save polish with direct handoff validation and scroll preservation across save-triggered graph refreshes.
- Ported final Svelte graph parity details: token heatmap glow, orphan styling, marker glyphs, reciprocal edge curves, model/context/audience labels, hook command labels, node-scale-aware layout spacing, responsive graph viewport sizing, and bounds-centered rendering.
- Added a reusable model selector and shared agent/tool checkbox controls for editor migration reuse.

### Phase 5: Add Test-Only Message Recording
- Added test-only webview message recording in `AgentVisualizerViewProvider` around the existing `postMessage` path.
- Enabled recording only in `vscode.ExtensionMode.Test`.
- Added unadvertised test commands for resetting and reading posted webview messages.
- Recorded extension-to-webview messages after posting so integration tests can assert provider payloads without DOM scraping.

### Phase 6: Add Fixture Workspace
- Added a minimal fixture customization workspace for integration tests.
- Included predictable agent, prompt, instruction, handoff, and link payload coverage.

### Phase 7: Implement `@vscode/test-electron` Integration Tests
- Added integration coverage that activates the extension in a real VS Code test host.
- Added coverage that opens the visualizer, executes `aivisualizer.refresh`, and verifies `graph:loading` and `graph:update` payloads.
- Asserted fixture graph payload shape and absence of `graph:error` for the fixture workspace.

### Playwright Decision
- Deferred Playwright for this refactor.
- Kept `@vscode/test-electron` as the primary tool for extension activation, command execution, and provider message payload verification.
- Left Playwright as a later option for webview DOM behavior, screenshots, visual regression, or deep user interaction tests.

## Completed Work Log
- Removed the About button from the Svelte toolbar.
- Restored Material-style SVG icons for New, Settings, and Refresh toolbar actions.
- Enlarged the settings dialog and widened its color picker grid so the settings content fits more comfortably.
- Added a visualizer Text shadow checkbox alongside the color pickers, persisted it with shared visualizer settings, and made it toggle the SVG label halo in the graph.
- Fixed the collapsed Svelte Tools summary empty pill so `No active tools` no longer inherits the global page-empty layout and renders as a tall capsule.
- Fixed the expanded Svelte Tools editor empty state so `No active tools` no longer renders as an oversized capsule when no tools are selected.
- Matched the Svelte agent/prompt editor presentation to the legacy editor screenshots: header Save button, user-invocable-first ordering, two-column name/model rows, collapsible Agents and Tools sections, collapsed Tools summary pills, non-wrapping tool pills, and corrected checkbox alignment.
- Restored Svelte editor parity for tool editing: preset buttons, filterable tool choices, active tool pills, custom tool input, prompt tool editing, aligned checkbox rows, and `?` help markers on editable fields.
- Restored the pre-refactor graph presentation algorithms in the Svelte layout engine for Hierarchical, Radial, and Force-directed modes, including legacy hierarchy ordering, radial center/radius placement, and the force simulation instead of the simplified grid fallback.
- Switched production rendering to the bundled Svelte shell and reduced `src/webview/htmlRenderer.ts` from the legacy monolithic renderer to the small CSP/bootstrap/asset shell.
- Ported final Svelte graph parity details including heatmap/orphan styling, marker glyphs, reciprocal edge curves, model/context/audience labels, hook command labels, node-scale-aware layout spacing, responsive graph viewport sizing, and graph-bounds centering.
- Ported Svelte save polish with direct handoff label/agent/prompt validation, focused validation feedback, and window/document scroll restoration after save refreshes.
- Ported Svelte settings dialog persistence and immediate UI application for documentation visibility, graph toggles, side-by-side layout, editor text scale, heatmap thresholds, baseline model, debug flag, and visualizer colors.
- Ported Svelte new customization dialog behavior for instruction, skill, prompt, agent, hook, and MCP creation paths with required-name validation and focus handling.
- Ported the first-pass Svelte hook editor form with editable name, configured hook event rows, add hook event support, command property toggles, and `hookCommands` payload generation.
- Ported the first-pass direct Svelte handoff editor form with editable label, target agent, prompt, send flag, model selector, and `node:save` payload generation back into the owning agent file.
- Ported the first-pass Svelte skill editor form with editable name, description, argument hint, context, invocation flags, body, and `node:save` payload generation.
- Ported the first-pass Svelte agent editor form with editable core fields, reusable model selector, shared agent/tool checkbox controls, and `node:save` payload generation that preserves existing handoffs.
- Ported the Svelte prompt editor form with editable name, agent, model, and body fields, preserving existing tools in `node:save` payloads and adding a reusable model selector component.
- Ported the first Svelte editable editor form for instruction nodes, including name, description, apply-to, body fields, and `node:save` payload generation through a shared save helper.
- Ported first-pass Svelte graph navigation with background drag panning, Ctrl+wheel zoom, panning cursors, and larger invisible SVG node hit targets.
- Ported first-pass Svelte graph node interaction with click/keyboard selection, selected-node styling, and a placeholder editor panel with node details plus Open file/MCP actions.
- Ported first-pass graph layout helpers and SVG rendering into the Svelte webview app for hierarchical, radial, and force-style grid layouts using `GraphJson` payloads.
- Ported graph overlay state into the Svelte webview app with a layout selector, token heatmap toggle, orphan highlight toggle, and `vscode.setState` persistence.
- Added a CSP-safe bundled Svelte webview shell renderer path and gated it to VS Code test mode while preserving the legacy renderer for normal extension use.
- Added Svelte-side webview message runtime and VS Code API helpers for `webview:ready`, refresh, popout, documentation links, loading, graph update, graph error, save error, and window-mode state handling.
- Added the first Svelte webview UI migration slice with toolbar, about/settings/new dialogs, documentation links, graph shell, toast components, and shared app styling.
- Added a separate Svelte/Vite webview build scaffold that outputs `dist/webview/index.js` and `dist/webview/index.css` while keeping the extension bundle on esbuild.
- Added typed webview protocol definitions for extension-to-webview and webview-to-extension messages.
- Added test-only webview message recording commands for `@vscode/test-electron` integration assertions.
- Added a fixture customization workspace and a VS Code Electron integration test that opens the visualizer popout, executes `aivisualizer.refresh`, and verifies `graph:loading` and `graph:update` payloads.
- Refactored the bloated extension entrypoint into focused modules for activation wiring, webview orchestration, HTML rendering, settings, scanning, diagnostics, persistence, customization helpers, tools, hooks, handoffs, paths, and VS Code resource utilities, leaving extension.ts as a thin lifecycle shim.
- Canonicalized tool lists across file reads, editor state, and saves so raw built-in tool IDs like execute/getTerminalOutput and execute/runInTerminal no longer appear in the Tools UI.
- Made the default displayed tool choices use the curated VS Code custom-agent aliases, added General/Planning/Implementation/Test role presets, and kept arbitrary custom tool strings supported. [execute,read,edit,search,agent,web,todo].
- Added a tools preselector title above the preselect buttons so they no longer look like they are part of the "Agents" section.
- Made the tool preselect buttons visible even when the Tools section is collapsed.
- Fixed hook timeout editing so legacy `timeoutSec` values display and save as the correct `timeout` property.
- Made save failures report visible webview errors instead of failing silently.
- Made Open file report invalid selections, normalize workspace URI matching more robustly, and explicitly focus opened editors.
- Added toast error reporting for node open and save failures.
- Fixed self-referential handoffs so a handoff targeting its owning agent no longer creates a layout cycle that makes the agent hard to open.
- Fixed agent selection in the visualizer by adding reliable SVG node hit targets and delegated node clicks.
- Added a test that verifies the Tools edit section saves selected tools.
- Fixed the Tools edit section so selected tools are preserved and saved from edit state.
- Changed the default handoff visualization color to RGB(182,135,99).
- Changed the default instruction visualization color to RGB(3,159,170).
- Restored graph node click highlighting by suppressing the native SVG focus rectangle that left a persistent white box.
- Made bidirectional graph links clearer by separating reciprocal arrows onto curved opposing paths.
- Made webview error messages appear as dismissable toast notifications.
- Validated new customization file creation before writing so duplicate names and path conflicts show a non-destructive user error.
- Moved the visualizer node and edge count to the bottom-left corner with smaller text.
- Split the Layout settings container into aligned Toggles and Sizing subsections.
- Hid the Token heatmap and Identify orphans graph toggles by default and added settings checkboxes to show them when needed.
- Fixed the Token heatmap '%' marker alignment by grouping each threshold input with its unit.
- Adjusted the Token heatmap settings to accept a default baseline AI model for default calculations.
- Aligned the percentage '%' marker next to the Token heatmap threshold input fields.
- Derived token heatmap max from the selected model's max input tokens when available, falling back only when no model capacity is known.
- Moved heatmap threshold controls into their own settings container and changed them from sliders to numeric percentage input fields.
- Moved heatmap thresholds into shared settings so activity view and window mode use the same orange/red token heatmap thresholds.
- Made color picker settings shared between activity view and window mode.
- Changed graph profiling controls into checkbox-style toggles.
- Changed token heatmap visualization from node color replacement to adjustable background glow intensity behind agent nodes.
- Added visualizer toggles for token heatmap profiling and orphan detection, with state persisted in the webview.
- Added token heatmap coloring for agent context estimates and orphan highlighting for disconnected editable prompts, hidden agents, and hidden skills.
- Added agent, skill, and cogwheel glyphs to the three nodes in resources/agent-graph-icon.png.
- Added the extension icon to README.md under an Extension Icon header.
- Fixed the visualizer height calculation so saving while scrolled in the edit view no longer makes the graph grow larger.
- Preserved the edit view scroll position when saving a node so the Save-button refresh no longer jumps to the top.
- Removed hard graph panning borders so users can drag freely in every direction without view limits.
- Center aligned the graph viewport on node bounds after graph refreshes, layout changes, and element-size changes.
- Added VS Code Problems panel diagnostics for malformed customization files, missing agent/prompt/skill names, invalid skill metadata, and unresolved agent references.
- Added a graph layout dropdown with Hierarchical, Radial, and Force-directed layout algorithms for larger AI workspaces.
- The cogwheel icon for the 'settings-menu' is much more clean. Reuse the icon for the sub-agent nodes.
- Gemini has done some code review. Address the two points outlined:
1. Testing coverage: The parsing logic inside mapper.ts and extension.ts involves heavy object manipulation (e.g., normalizeObject, parsing handoffs). Ensuring comprehensive unit tests exist in the test directory for these utilities is critical.
2. Error Handling: catch { return undefined } blocks exist in file readers. Consider logging errors to a dedicated VS Code Output Channel to assist with debugging malformed frontmatter.
- In your implementation of the last step, you change some default colors. Please return them to their original colors.
- Reviewed the project folder as a VSCode Extension Expert.
- In the settings popup. Add a color picker section. Make handles for picking the colors of all the different visualizations/nodes/marks/icons and so on. Rename it from "Activity bar settings" to 'Extenstion Settings'. Also make the dialog larger to accomdate the new fields.
- Act as a UI expert and give the settings dialog a pass. 
- If i press 'open file' the file opens. That is good. If i try to reopen a already open file, it needs to move focus to that file.
- Make the settings auto-save, so they persist.
- Cut the settings in two. One for the view in the activity bar, and one for the window mode.
- The new section overshadows instruction file nodes. Move the colors to the same line as the node and edge counter, to reduce the height. Then make some padding that moves the instruction nodes down abit.
- Move the color information inside the visualizer, but make them stick to the top. Remove the button for collapsing it. Remove the lefterover space.
- The visializer does not fill-content. 
- The drag around in the visualizer broke during implementation of the last task.
- Make the visualizer zoomable. Zoom when the user holds ctrl+<scrollup/scrolldown>
- Create a test that validates that filters is working.
- The 'tools' filter is still broken
- Add small buttons for prebuilt tools selection. Should be added above the filter. Create a small list of clickable prebuilt selections. 1. "Default Agent" with execute, read, edit, search, agent, web, todo.  2. Planning Agent with read, search, web, todo
- Nodes are placed on top of each other when the nodes exceed the size of the visualizer.
- The 'tools' filter broke, when editing agents.
- Enforced mandatory label, agent, prompt, and send fields when saving from the direct handoff node editor.
- Made embedded handoff label, agent, prompt, and send required when saving from the agent edit view, with model remaining optional.
- Fixed agent edit view rendering by exposing placeholder constants inside the webview script.
- Fixed handoff model saving so model stays nested inside the handoff frontmatter item.
- Changed agent description and system prompt guidance to UI placeholders instead of saved file content.
- Adjusted the VSIX package builder to output versioned packages into builds and kept local customization files out of the VSIX.
- Adjusted side-by-side header spacing so the visualizer header aligns with the editor header.
- Completed a performance pass by parallelizing workspace file discovery and caching chat model discovery during refreshes.
- Added README links for repository and Marketplace publisher search from the author line.
- Fixed remaining npm audit findings with patched transitive overrides and verified tests/package build.
- Replaced deprecated vsce with @vscode/vsce after npm audit and confirmed production dependencies are clean.
- Moved vsce to devDependencies and revalidated VSIX package contents.
- Added official GitHub repository metadata and tightened VSIX package contents for best-practice publishing.
- Updated .gitignore to allow package-lock.json to be tracked.
- Reviewed whether .gitignore matches the VS Code extension workspace outputs.
- Change the VSIX publisher from a human-friendly name to a valid publisher identifier.
- The hide documentation links checkbox does not work. It does not hide the links to the documentation about agents in vscode.
- Make the area with 'Tools' checkboxes larger. Also, the size for each column rendered has to be larger as some text aligns wrong.
- Add a setting for hiding the documentation links. Put it in the settings dialog.
- Change the publisher to Jeppe Andreas Jakobsen, instead of Jeffe747@github
- Add the missing license file that the vsix packager is asking for.
- Add a icon to the extension package, that matches the one made for the selector inside vscode.
- Add Jeffe747@github as publisher on the vsix package.
- Make the visualization "dragable". When the mouse do not touch a node, make it a hand so we can drag the visulization content around. This is for supporting projects with large amounts of agents and tools.
- Is it possible to make the extenstion listen for the files related to the nodes, and trigger a update on a specific node when the files are edited outside the editor?
- Make the handoff section in the agent edit view collapsable. Just like the agents and tools sections.
- Remove the text for the handoff node, then move the actual handoff code over into the edit view as input fields.
- Make the bat file called vsix.bat bump the version number. specifically the 0.0.x being the x in the version. I will control the other two values.
- We're rolling back part of a feature. The handoffs are right now moved into their own files at '.github/agents/handoffs'. We do not want to have the logic moved out into those files anymore, but we still want the nodes visualized. Handoffs are a part of the agent, but right now we save them as seperate files and move the content into agents when saving. Do not use files any longer. Save the fields into the agent file, but still visualize the handoff nodes.
- Move the about section into a sub menu opened by clicking a '?' button on the action menu. place it to the left of the settings button.
- Add a about section at the top, displaying that Jeffe747@github is the engineer and ChatGpt.5.5 is the Agent.
- make the side by side checkbox setting align better, So it displays as input - header. Right now they are misaligned.
- Side-by-side layout is implemented wrong. The header should always be the title and the options for 'new', window-mode, setting and so on. The list of links for documentation should also be at the top. The side-by-side view should affect the visualizer and the edit view. When checked they sit side by side, and when not, they sit above and below.
- Add a setting that makes the visualizer and the edit view sit side-by-side instead of above and below.
- Node lines are drawn on top the handoff nodes, so it sometimes has lines going through it. Adjust the handoff node so lines a drawn behind and not on top of it.
- When saving a handoff, the agent field is not saved correctly to the using agent. The agent field in the agent file is written as "agent: agent" instead of the chosen agent from the agent file.
- We accidenctally removed the model field from Handoff editing. Readd it.
- The file that is saved when saving a handoff contains a subsection that is not part of the handoff. Remove it. The only fields that should be listed for edit is label, agent, prompt and send. It does not need a body.
- Add a direction indicator to the lines drawn in the vizualizer.
- Bug in the visualizer. I added a agent "Planning" and gave it the handoff 'Test1'. The 'Test1' has the agent 'ProjectOrchestrator'. The line being drawn in the vizualizer should go from "Planning" to 'Test1' then to 'ProjectOrchestrator'. The only line being drawn is from the handoff to the 'ProjectOrchestrator'. Fix it.
- Move handoffs down, so they are placed along with agents. We want node lines to go downwards. When a agent has a handoff, the line is drawn upwards - that is unacceptable. When a agent has a handoff, place the handof below the agent, and any agent connected to the handoff, below the handoff.
- When a agent has a handoff, draw a line to the handoff node, and a line to the agent that the handoff uses.
- Change the model field when editing handoffs to the same type as the model field that the agent editing has. So you have a dropdown list of available AI models.
- The handoff must only be able to select agents that are user-invocable, along with uilt in, such as agent, ask, edit and plan
- Add the fields label, agent, prompt, send and model to be editable from the gui for the handoff. The agent has to be a dropdown of currently created agents.
- Add the description field to agent edit.
- Change the handoff input field to follow the same style as tools. Make created handoff files available here. When saving, add the added handoffs to the agent file.
- Handoffs are a part of the agent. But we're moving them into our own files. Save handoffs in '.github/agents/handoffs' and make it possible to create a handoff in the 'new' button. Handoffs are essentially a part of agents, but we're turning them into their own nodes. Read logic for handoffs in https://code.visualstudio.com/docs/copilot/customization/custom-agents then make it possible to create the files with the properties: label, agent, prompt, send and model. Do not do anything to agent editing yet, just create this part.
- Add 'argument-hint', 'handoffs' and 'disable-model-invocation' to agent edit
- Add name, description and applyTo fields to instruction edits. Add the descriptions from https://code.visualstudio.com/docs/copilot/customization/custom-instructions
- The point list above the visualizer is currently: Agent, Prompt, Skill, MCP, Hook, Instructions. Change it to: Instructions, Skill, Prompt, Agent, MCP, Hook.
- When a hook property is deselected then hide the input field. All deselected properties but be aligned as a list. Active properties should be displayed as they do now.
- To each Configured hook event theres a dropdown. Below each dropdown i want you to list all of the properties. [command, windows, linuxm, osx, cwd, env, timeout] along with their descriptions, use a '?', from https://code.visualstudio.com/docs/copilot/customization/hooks. These must then each have a checkbox that indicates whether they are active in the current hook. When checked, add a input field for a text to add with it.
- Make use-invocable agent nodes visually larger. Approx the same size as the hook node
- Do a pass on the hook icon. It looks bent.
- I cannot add new events to a tool. When i add them with a new button it appears in the file and node view, but the list "Configured hooks" does not display them.
- Add a "Add hook event" to the edit Hook view.
- For the tool node. When Disable Model Invocation is deselected, mark the node with a border that matches the agent color. When its checked, display the current border.
- Remove the MCP section from the agent edit. It did not functionally work as i expected.
- https://code.visualstudio.com/docs/copilot/customization/custom-agents this page states that you can configure a mcp server as a tool for the agent. Draw lines from the agent node to a mcp server if we know it can use it specificly. Add available MCP servers to a new input field, made just like Tools. If no mcp servers are configured, add a button that sends the user to the MCP section of VSCode.
- Move hook and tool nodes below agents in the vizualizer
- The cogwheel icon, on the tool is black. Change it to a small star, like the one on the agent node.
- Add a indicator for what context a skill is run in, ie. "Default", "Inline" or "Fork". Don't add anything when its "Default". Add a "+" when its inline. Add a cogwheel when it is "Fork". This should be shown top right on the hammer icon, just like the star on the Agent nodes. 
- Rename "Manual invocation only" to "Disable Model Invocation" - i assume you meant this when you created the checkbox.
- Alright the added input fields for hook editing is too confusing. Remove the input fields for editing configured hooks. Only leave a dropdown for changing Hook Events type, remove the other input fields. 
- When i press a sub-node to at tool, select the parent node instead.
- The events for a tool in the visualizer does not need to display the command text, only the Hook Events defined, not the actual code. Also make them smaller nodes connected to the hook node.
- Each hook event has their own variables. When you select a new Hook event, we need different input fields. Scan https://code.visualstudio.com/docs/copilot/customization/hooks and create the relevant intput fields for each hook Event type.
- Remove the "Common hook variables", i have deemed it bloat and not needed
- When i press save on hooks, they dissappear from the visualizer.
- List all hooks active as nodes on a node for a hook file.
- The current edit view for Hooks are way too bloated with unuseable stuff. Remove the current fields. Add a input for Name. A list of commmon hook variables, and a "Open File". Make a list of configured hooks inside the file and lastly a edit field for each hook. Also a button to add a new hook to the list.
- Create a settings button next to the refresh button. Move the sliders for Element Size and Editor Text size into a dialog that opens when pressing this new settings button.
- The edit view of each tool needs to be scoped to its file. The edit window needs to provide logic for editing and changing the selected tool. Add input fields for name, hook event and a field for the hook code. For example if you select PreToolUse and add a command: field, then its needs a input field for adding the command.
- Add the hook events as a dropdown on each hook in the edit view. Think SessionStart, UserPromptSubmit and so on. The hook events can be found here https://code.visualstudio.com/docs/copilot/customization/hooks
- Add a section to the edit view of Hooks that display commmonly used variables that play into activating hooks. Think $TOOL_INPUT_FILE_PATH for example
- Add Hooks to the 'new' button
- Visualize Hooks. Draw info about it here: https://code.visualstudio.com/docs/copilot/customization/hooks
- Make sure the edit part of the hook outlines Hook Events and descriptions.
- Make sure to represent that tools are Variable-Driven Logic
- Add mcp servers to the 'new' button, but when selected show the same link to MCP servers as when trying to edit one.
- Visualize configured MCP servers as nodes. When trying to edit a MCP server, send the user to the MCP section of "EXTENSIONS" inside vscode, as it is a default feature.
- The leaves on the plant does not match, make them grow out and follow the stem.
- Add a spinner to the vizualiation. It should be shown when the extenstion is loading the vizualization. Make it a small sprouting plant.
- Include referenced agent file contents in the invocable-agent context size estimation.
- Make a small counter below invocable agents that makes a default context size estimation. A estimation of how big the initial context size is, for a quick assesment of the initial cost of activating that agent. 
- Make user-invocable default to false when creating a new skill
- Add "new skill" to the create menu.
- Visualize Agent Skills as editable graph nodes with a hammer icon inside the node.
- The '+' in the new button is not aligned properly. It's further to the bottom, than the top.
- The text slider should affect the editing view. Not the visualizer.
- Add a text size slider
- Make ctrl+s save the current open node.
- Change "Body" to "System Prompt"
- Default zoom level should be 110%.
- Remove the collapse button from the edit view. Remake the one for the visualization, the icon is too simple.
- When editing agents, move the Name and AI Model input beside each other. 50/50
- Make the "No active tools" section smaller. It has way too much padding or margin.
- The entire window has a y-scrollbar when content becomes large enough. This makes the content jump sometimes. Make a default space for the scrollbar so we dont experience any jittering when selecting nodes.
- Node selection affects part of the inner icons. The node icons must remain unaffected visually when selected, only the border of the nodes must indicate selection.
- The text in the instruction areas does not match the background color very well. Its gray on purple, which is not so pleasant to read.
- Agent nodes that is inferred from a reference and does not have an editable file - make the edge of those nodes pure red.
- Make the star on the robot more visible. Make it larger.
- Make the inner background color of the cogwheel transparent.
- Cogwheel touches the lower edge of the nodes.
- Align the icons better inside the nodes. Right now they are touching the upper edgde of the node borders.
- Redo the cogwheel
- Actually just change the general "Agent" color from blue to red.
- Make the star on the robot yellow.
- Make the color of the cogwheel black instead. Right now its gray on blue, making the cogwheel nearly invisible.
- Create a slider at the top of the visualization for making elements larger and smaller.
- Make nodes larger, it's hard to see the text and icons/contents of the nodes. 
- Revert the CLAUDE.md file back to having the correct instruction color.
- Add a visual marker inside the agents that are invocable, make it a robot head with a star. All sub-agents should have a cogwheel inside their node. If the agent is both runable and a sub-agent, add a icon of a robot head without a star.
- Remove the "AI model" input field when editing instructions files. 
- Filters still does not work.
- Rearrange to 'Instructions, Agents, Prompts' in headers and dropdowns. This is the order they must appear in. Visualization is to be kept as is.
- The instruction type is visible for agent and prompt. It should only be visible for instructions....
- You colored CLAUDE green. Make it orange.
- Add instruction type when creating a instruction file. The type fill be used to define where the file is saved, as for example CLAUDE.md has to be located in .claude folder
- Enable the '+' button to make instruction files aswell.
- Color the CLAUDE.md instructions-file area orange as default.
- Make instruction files editable from the extenstion.
- Note inside the instruction areas what AI agents they affect.
- Next step is to visualize instruction files. https://code.visualstudio.com/docs/copilot/customization/custom-instructions. Add "Instructions" inside the visualization as areas. Instructions are files the define guidelines and rules that automaticly influence how the AI work. So, for example .github/copilot-instructions.md will affect all copilot AI. AGENTS.md will affect ALL ai's. Claude.md will affect Claude based tools.
- Add https://code.visualstudio.com/docs/copilot/customization/custom-instructions to the info section.
- Show the un-editable list of active tools, even though the tools section is collapsed.
- THe tools filter does not work. Make it react automaticly once the user stops typing. 
- THe tools window has a x-axis scroll-bar. Remove it.
- Make the visualizer re-render its content if the user has resized the window.
- Make tools collapsed be default. Maintain a un-editable list of active tools, show as pills above the selector and below the filter. Do it for both the prompt and agent.
- Provide a link to https://code.visualstudio.com/docs/copilot/customization/prompt-files in a info area above the visualizer
- Provide a link to https://code.visualstudio.com/docs/copilot/customization/custom-agents in a info area above the visualizer
- Change the "New node" to a "+" and make it a circular.
- Add a filter to "Tools" so you can find the ones you need faster. The filter should just be a simple input field for a "contains" text.
- Make the visualizer collapseable.
- Add Jeffe747@github as author of this extenstion. Add that it has been AI-engineered with ChatGpt5.5
- Visually, the icon inside the "refresh" button totally missed its mark.
- Make the node viewer collapseable, but open as default.
- Rename "Open" to "Open file".
- Change the "Refresh" visually into a android refresh button.
- Rename "New" into "New node"
- Visually change "window mode" into a android switch button
- As long as "window mode" is open, make the original window inactive.
- Change the "window-mode" button to a toggle.
- Make Window-mode automatically move the visualizer editor into a new VS Code window when supported.
- Rename "Pop out" to Window-mode and make the button distinct from the other buttons.
- Rename "Agent" in prompt edit to "Agent mode"
- Add a top button that opens the visualizer in its own editor panel.
- Fix the visualization regression from the latest model-label changes.
- The tools: field are saved incorrectly in the markdown file. Right now its saves with -, it shouldbe a list [tool,x,y,...]. This bug is present in both prompt and agent.
- Show on the visualization, which model each prompt and agent uses.
- Suppress external Node warnings in the extension debug launch configuration.
- Turn available agents into checkboxes in the "Agents" input field.
- Add '?' descriptions to each tool available in the "Tools" section. Locate it to the right inside each tool.
- Along with the checkbox, add a custom tool aswell that is a input-text field. So you can add a custom tool. It's either active or deleted. Do this for Agent tool aswell.
- Make "AI Model" and "Agents" sit side by side in the agent edit view.
- Move "User invocable" to the top of the edit view.
- Change the "Tools" from a edit view to a flag list. All tools in the "Available tools" should have checkboxes so you can add them by clicking.
- Make "AI model" and "Agent" sit side by side in prompt edit view.
- Change "Project AI Agents" to "Project AI Setup".
- Reduce the size of the Tools input field
- Reduce the size of the Agents input field
- Add a "New" button next to the "Refresh" button that opens a tiny dialog where you can choose to create a new Agent or Prompt
- Fix the "Ai Model" picker so it opens below the field instead of the top-left of VS Code.
- Add a '?' next to all input headers that describes their respective usage.
- Hide tools with a expand/collapse button, so all tools arent shown at once.
- Add a field for selecting ai model
- Add a field for user-invocable
- Add a selector tool for Prompt agent selection, ie. model or custom-agent
- Add a ai model selector for the prompt edit view.

# Initial start 
--
> Scaffold vscode extension
--
I want to visualize Skills in this extenstion.

Familiarize yourself with this VSCode extentions, then make a short, precice and consicse plan for adding AI Skill vizualization.

Read this and use for context: https://code.visualstudio.com/docs/copilot/customization/agent-skills
--


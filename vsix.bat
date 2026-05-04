@echo off
call npm version patch --no-git-tag-version
call npm update -g @vscode/vsce
call vsce package --allow-missing-repository
echo In VS Code, go to the Extensions view (Ctrl+Shift+X), click the ... (More Actions) menu in the top right, and select Install from VSIX....
pause
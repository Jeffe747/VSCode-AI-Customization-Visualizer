@echo off
call npm version patch --no-git-tag-version
if not exist builds mkdir builds
for /f "usebackq tokens=*" %%n in (`node -p "require('./package.json').name"`) do set EXTENSION_NAME=%%n
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version"`) do set EXTENSION_VERSION=%%v
call npx vsce package --out "builds\%EXTENSION_NAME%-%EXTENSION_VERSION%.vsix"
echo In VS Code, go to the Extensions view (Ctrl+Shift+X), click the ... (More Actions) menu in the top right, and select Install from VSIX....
pause
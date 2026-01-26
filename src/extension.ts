import * as vscode from 'vscode';
import { ProfileEditorProvider } from './views/ProfileEditorProvider';
import { ProfileCache } from './cache';

const FILE_FILTERS: Record<string, string[]> = {
  'Callgrind Files': ['callgrind', 'cachegrind', 'out'],
  'All Files': ['*'],
};

const openProfile = (cache: ProfileCache) =>
  vscode.commands.registerCommand('blacksmith.openProfile', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: FILE_FILTERS,
      title: 'Open Profiling File',
    });

    if (uris?.[0]) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        uris[0],
        ProfileEditorProvider.viewType
      );
    }
  });

const clearCache = (cache: ProfileCache) =>
  vscode.commands.registerCommand('blacksmith.clearCache', async () => {
    const count = await cache.clear();
    const msg = count > 0
      ? `Blacksmith: Cleared ${count} cached profile(s)`
      : 'Blacksmith: No cached profiles to clear';
    vscode.window.showInformationMessage(msg);
  });

export const activate = (context: vscode.ExtensionContext): void => {
  const cache = new ProfileCache(context.globalState);

  context.subscriptions.push(
    ProfileEditorProvider.register(context, cache),
    openProfile(cache),
    clearCache(cache)
  );
};

export const deactivate = (): void => {};

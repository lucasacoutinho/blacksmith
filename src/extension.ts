import * as vscode from 'vscode';
import { ProfileEditorProvider } from './views/profile-editor-provider';
import { ProfileCache } from './cache';
import { HotspotNavigator } from './hotspot-navigator';

const FILE_FILTERS: Record<string, string[]> = {
  'Callgrind Files': ['callgrind', 'cachegrind', 'out'],
  'All Files': ['*'],
};

const openProfile = () =>
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
        ProfileEditorProvider.viewType,
      );
    }
  });

const clearCache = (cache: ProfileCache) =>
  vscode.commands.registerCommand('blacksmith.clearCache', async () => {
    const count = await cache.clear();
    const msg =
      count > 0
        ? `Blacksmith: Cleared ${count} cached profile(s)`
        : 'Blacksmith: No cached profiles to clear';
    vscode.window.showInformationMessage(msg);
  });

export const activate = (context: vscode.ExtensionContext): void => {
  const cache = new ProfileCache(context.globalState);
  const { disposable, provider } = ProfileEditorProvider.register(context, cache);

  const navigator = new HotspotNavigator(provider.profileContext, provider.lineView);

  provider.onHotspotsChanged = () => navigator.updateHotspots();

  context.subscriptions.push(
    disposable,
    openProfile(),
    clearCache(cache),
    navigator,
    vscode.commands.registerCommand('blacksmith.nextHotspot', () => navigator.next()),
    vscode.commands.registerCommand('blacksmith.previousHotspot', () => navigator.previous()),
    vscode.commands.registerCommand('blacksmith.listHotspots', () => navigator.showQuickPick()),
    vscode.commands.registerCommand('blacksmith.compareProfile', () => provider.compareProfile()),
  );
};

export const deactivate = (): void => {};

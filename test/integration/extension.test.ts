import assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Blacksmith extension', () => {
  test('activates and registers every contributed command', async () => {
    const extension = vscode.extensions.getExtension('lucasalvcoutinho.blacksmith');
    assert.ok(extension, 'VS Code did not discover the Blacksmith extension');

    await extension.activate();

    const commands = new Set(await vscode.commands.getCommands(true));
    const expectedCommands = [
      'blacksmith.openProfile',
      'blacksmith.clearCache',
      'blacksmith.toggleLineView',
      'blacksmith.toggleHotPathOverlay',
      'blacksmith.nextHotspot',
      'blacksmith.previousHotspot',
      'blacksmith.listHotspots',
      'blacksmith.compareProfile',
    ];

    for (const command of expectedCommands) {
      assert.ok(commands.has(command), `${command} was not registered`);
    }
  });
});

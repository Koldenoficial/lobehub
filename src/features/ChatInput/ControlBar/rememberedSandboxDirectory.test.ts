import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRememberedSandboxDirectory,
  nextSandboxPickTime,
  rememberedSandboxDirectoryKey,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';

const ME = { userId: 'user-a' };
const MY_WS = { userId: 'user-a', workspaceId: 'ws_1' };

afterEach(() => {
  localStorage.clear();
});

describe('rememberedSandboxDirectory', () => {
  it('remembers a folder picked on the drive', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'projects/demo' });

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({
      workingDirectory: 'projects/demo',
    });
  });

  it('keeps the drive of a workspace pick', () => {
    rememberSandboxSelection(MY_WS, 'agent-1', { drive: 'public', workingDirectory: 'team' });

    expect(getRememberedSandboxDirectory(MY_WS, 'agent-1')).toEqual({
      drive: 'public',
      workingDirectory: 'team',
    });
  });

  it('keeps each workspace and agent apart', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'mine' });

    expect(getRememberedSandboxDirectory(MY_WS, 'agent-1')).toBeUndefined();
    expect(getRememberedSandboxDirectory(ME, 'agent-2')).toBeUndefined();
  });

  it('remembers the folder of a repository pick but not the repository', () => {
    rememberSandboxSelection(ME, 'agent-1', {
      environmentId: 'env_1',
      workingDirectory: 'code',
    });

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'code' });
  });

  it('forgets the folder when the temporary sandbox is picked on purpose', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'code' });
    rememberSandboxSelection(ME, 'agent-1', {});

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();
  });

  it('leaves the folder alone when only the repository changes', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'code' });
    rememberSandboxSelection(ME, 'agent-1', { environmentId: 'env_1' });
    rememberSandboxSelection(ME, 'agent-1', { instanceId: 'inst_1' });

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'code' });
  });

  it('ignores a corrupted store', () => {
    const key = rememberedSandboxDirectoryKey(ME, 'agent-1')!;
    localStorage.setItem(key, '{not json');
    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();

    localStorage.setItem(
      rememberedSandboxDirectoryKey,
      JSON.stringify({ 'user-a:personal:agent-1': { drive: 'other', workingDirectory: 'x' } }),
    );
    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();
  });

  // Storage outlives a logout; the next member on the same browser shares the
  // workspace and the agent but not the first member's personal folders.
  it("never hands one member's folder to another on the same browser", () => {
    rememberSandboxSelection(MY_WS, 'agent-1', { drive: 'personal', workingDirectory: 'mine' });

    expect(
      getRememberedSandboxDirectory({ userId: 'user-b', workspaceId: 'ws_1' }, 'agent-1'),
    ).toBeUndefined();
  });

  it('reads and writes nothing before the user is known', () => {
    rememberSandboxSelection({ workspaceId: 'ws_1' }, 'agent-1', { workingDirectory: 'x' });

    expect(localStorage.length).toBe(0);
    expect(getRememberedSandboxDirectory({ workspaceId: 'ws_1' }, 'agent-1')).toBeUndefined();
  });

  // Each entry has a key of its own, so a write for one agent never rewrites
  // another's — two tabs saving at once cannot drop each other's folder.
  it('stores each agent under its own key', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'one' });
    rememberSandboxSelection(ME, 'agent-2', { workingDirectory: 'two' });

    expect(localStorage.getItem(rememberedSandboxDirectoryKey(ME, 'agent-1'))).toContain('"one"');
    expect(localStorage.getItem(rememberedSandboxDirectoryKey(ME, 'agent-2'))).toContain('"two"');
  });

  // Two tabs: the pick made later wins, whichever save lands last.
  it('never lets an older pick from another tab replace a newer one', () => {
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'newer' }, 2000);
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'older' }, 1000);

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'newer' });
  });

  it('keeps a newer temporary-sandbox pick from being undone by an older folder save', () => {
    rememberSandboxSelection(ME, 'agent-1', {}, 2000);
    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'older' }, 1000);

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toBeUndefined();
  });

  // A folder remembered while the clock ran ahead; the page reloads after the
  // clock is set back. Reading the memory moves the pick clock past it.
  it('orders a new pick after one stored with a clock that has since gone back', () => {
    const future = Date.now() + 60 * 60 * 1000;
    localStorage.setItem(
      rememberedSandboxDirectoryKey(ME, 'agent-1')!,
      JSON.stringify({ pickedAt: future, workingDirectory: 'stale' }),
    );
    getRememberedSandboxDirectory(ME, 'agent-1');

    rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'fresh' }, nextSandboxPickTime());

    expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'fresh' });
  });

  // Storage has no locking between tabs; the read-compare-write runs under a
  // Web Lock named after the entry, so two tabs saving it take turns.
  it('serializes writes to an entry through a Web Lock named after it', async () => {
    let queue = Promise.resolve();
    const request = vi.fn((name: string, callback: () => unknown) => {
      const run = queue.then(callback);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });

    try {
      const newer = rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'newer' }, 2000);
      const older = rememberSandboxSelection(ME, 'agent-1', { workingDirectory: 'older' }, 1000);
      await Promise.all([newer, older]);

      expect(request).toHaveBeenCalledWith(
        rememberedSandboxDirectoryKey(ME, 'agent-1'),
        expect.any(Function),
      );
      expect(getRememberedSandboxDirectory(ME, 'agent-1')).toEqual({ workingDirectory: 'newer' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import {
  getRememberedSandboxDirectory,
  REMEMBERED_SANDBOX_DIRECTORY_KEY,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';

afterEach(() => {
  localStorage.removeItem(REMEMBERED_SANDBOX_DIRECTORY_KEY);
});

describe('rememberedSandboxDirectory', () => {
  it('remembers a folder picked on the drive', () => {
    rememberSandboxSelection(null, 'agent-1', { workingDirectory: 'projects/demo' });

    expect(getRememberedSandboxDirectory(null, 'agent-1')).toEqual({
      workingDirectory: 'projects/demo',
    });
  });

  it('keeps the drive of a workspace pick', () => {
    rememberSandboxSelection('ws_1', 'agent-1', { drive: 'public', workingDirectory: 'team' });

    expect(getRememberedSandboxDirectory('ws_1', 'agent-1')).toEqual({
      drive: 'public',
      workingDirectory: 'team',
    });
  });

  it('keeps each workspace and agent apart', () => {
    rememberSandboxSelection(null, 'agent-1', { workingDirectory: 'mine' });

    expect(getRememberedSandboxDirectory('ws_1', 'agent-1')).toBeUndefined();
    expect(getRememberedSandboxDirectory(null, 'agent-2')).toBeUndefined();
  });

  it('remembers the folder of a repository pick but not the repository', () => {
    rememberSandboxSelection(null, 'agent-1', {
      environmentId: 'env_1',
      workingDirectory: 'code',
    });

    expect(getRememberedSandboxDirectory(null, 'agent-1')).toEqual({ workingDirectory: 'code' });
  });

  it('forgets the folder when the temporary sandbox is picked on purpose', () => {
    rememberSandboxSelection(null, 'agent-1', { workingDirectory: 'code' });
    rememberSandboxSelection(null, 'agent-1', {});

    expect(getRememberedSandboxDirectory(null, 'agent-1')).toBeUndefined();
  });

  it('leaves the folder alone when only the repository changes', () => {
    rememberSandboxSelection(null, 'agent-1', { workingDirectory: 'code' });
    rememberSandboxSelection(null, 'agent-1', { environmentId: 'env_1' });
    rememberSandboxSelection(null, 'agent-1', { instanceId: 'inst_1' });

    expect(getRememberedSandboxDirectory(null, 'agent-1')).toEqual({ workingDirectory: 'code' });
  });

  it('ignores a corrupted store', () => {
    localStorage.setItem(REMEMBERED_SANDBOX_DIRECTORY_KEY, '{not json');
    expect(getRememberedSandboxDirectory(null, 'agent-1')).toBeUndefined();

    localStorage.setItem(
      REMEMBERED_SANDBOX_DIRECTORY_KEY,
      JSON.stringify({ 'personal:agent-1': { drive: 'other', workingDirectory: 'x' } }),
    );
    expect(getRememberedSandboxDirectory(null, 'agent-1')).toBeUndefined();
  });
});

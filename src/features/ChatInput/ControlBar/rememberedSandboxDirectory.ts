import type { SandboxSelection } from './useSandboxPlacement';

export const REMEMBERED_SANDBOX_DIRECTORY_KEY = 'lobechat-sandbox-last-directory';

/** The folder part of a selection: which drive, and where on it. */
export type RememberedSandboxDirectory = Pick<SandboxSelection, 'drive' | 'workingDirectory'>;

type Store = Record<string, RememberedSandboxDirectory>;

/** Whose memory this is: the signed-in user, in the active workspace (if any). */
export interface RememberScope {
  userId?: string | null;
  workspaceId?: string | null;
}

// Scoped to the signed-in user first: storage outlives a logout, and a shared
// agent has the same workspace and agent ids for every member, while a
// personal-drive folder is one member's own — the next person on the same
// browser must not inherit it. The drive is per account, so a folder picked in
// one workspace means nothing in another; the agent is part of the key because
// each agent's conversations tend to live in their own folder. Without a known
// user nothing is read or written.
const keyOf = ({ userId, workspaceId }: RememberScope, agentId: string) =>
  userId ? `${userId}:${workspaceId || 'personal'}:${agentId}` : undefined;

const readStore = (): Store => {
  try {
    const raw = localStorage.getItem(REMEMBERED_SANDBOX_DIRECTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: Store) => {
  try {
    localStorage.setItem(REMEMBERED_SANDBOX_DIRECTORY_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private mode, quota): the next conversation starts
    // at the plan's default, as it did before anything was remembered.
  }
};

const isValid = (value: unknown): value is RememberedSandboxDirectory => {
  if (!value || typeof value !== 'object') return false;
  const { drive, workingDirectory } = value as RememberedSandboxDirectory;
  if (typeof workingDirectory !== 'string' || !workingDirectory) return false;
  return drive === undefined || drive === 'personal' || drive === 'public';
};

/** The folder this agent's last conversation was pointed at, if any. */
export const getRememberedSandboxDirectory = (
  scope: RememberScope,
  agentId: string,
): RememberedSandboxDirectory | undefined => {
  const key = keyOf(scope, agentId);
  if (!key) return undefined;

  const value = readStore()[key];
  if (!isValid(value)) return undefined;

  return value.drive
    ? { drive: value.drive, workingDirectory: value.workingDirectory }
    : { workingDirectory: value.workingDirectory };
};

/**
 * Remember a pick so the next conversation starts where this one was put:
 *
 * - a folder on the drive is remembered;
 * - the temporary sandbox, picked on purpose, forgets it — the next
 *   conversation goes back to the plan's default;
 * - a repository switch that leaves the folder unset, or a legacy environment
 *   directory, says nothing about folders and leaves the memory as it was.
 */
export const rememberSandboxSelection = (
  scope: RememberScope,
  agentId: string,
  selection: SandboxSelection,
): void => {
  const key = keyOf(scope, agentId);
  if (!key) return;

  if (!selection.instanceId && selection.workingDirectory) {
    const store = readStore();
    store[key] = selection.drive
      ? { drive: selection.drive, workingDirectory: selection.workingDirectory }
      : { workingDirectory: selection.workingDirectory };
    writeStore(store);
    return;
  }

  const temporary =
    !selection.instanceId && !selection.environmentId && selection.workingDirectory === undefined;
  if (!temporary) return;

  const store = readStore();
  if (!(key in store)) return;
  delete store[key];
  writeStore(store);
};

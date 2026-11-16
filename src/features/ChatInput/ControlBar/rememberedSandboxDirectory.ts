import type { SandboxSelection } from './useSandboxPlacement';

export const REMEMBERED_SANDBOX_DIRECTORY_KEY = 'lobechat-sandbox-last-directory';

/** The folder part of a selection: which drive, and where on it. */
export type RememberedSandboxDirectory = Pick<SandboxSelection, 'drive' | 'workingDirectory'>;

type Store = Record<string, RememberedSandboxDirectory>;

// The drive is per account, so a folder picked in one workspace means nothing
// in another; the agent is part of the key because each agent's conversations
// tend to live in their own folder.
const keyOf = (workspaceId: string | null | undefined, agentId: string) =>
  `${workspaceId || 'personal'}:${agentId}`;

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
  workspaceId: string | null | undefined,
  agentId: string,
): RememberedSandboxDirectory | undefined => {
  const value = readStore()[keyOf(workspaceId, agentId)];
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
  workspaceId: string | null | undefined,
  agentId: string,
  selection: SandboxSelection,
): void => {
  const key = keyOf(workspaceId, agentId);

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

import type { SandboxSelection } from './useSandboxPlacement';

/**
 * Prefix of every entry. Each user + workspace + agent has a key of its own
 * rather than sharing one JSON object, so two tabs saving at once never read
 * the same object and drop each other's entry on write.
 */
export const REMEMBERED_SANDBOX_DIRECTORY_PREFIX = 'lobechat-sandbox-last-directory';

/** The folder part of a selection: which drive, and where on it. */
export type RememberedSandboxDirectory = Pick<SandboxSelection, 'drive' | 'workingDirectory'>;

/**
 * What is stored: the folder, or nothing when the temporary sandbox was picked
 * on purpose, with when the pick began. Comparable across tabs, so a save in
 * one tab that lands after a newer pick in another never replaces it.
 */
interface StoredEntry extends RememberedSandboxDirectory {
  pickedAt?: number;
  /** The tab that made the pick: breaks a tie between equal `pickedAt` from two tabs. */
  tab?: string;
}

// Picks within a tab never tie (its clock strictly increases), but two tabs can
// reach the same `pickedAt`; ordering ties by tab id makes every tab agree on
// which of the two stands.
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Whether `existing` was picked after a pick made in this tab at `pickedAt`. */
const isNewer = (existing: StoredEntry | undefined, pickedAt: number) => {
  if (typeof existing?.pickedAt !== 'number') return false;
  if (existing.pickedAt !== pickedAt) return existing.pickedAt > pickedAt;
  return typeof existing.tab === 'string' && existing.tab > TAB_ID;
};

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
export const rememberedSandboxDirectoryKey = (
  { userId, workspaceId }: RememberScope,
  agentId: string,
) =>
  userId
    ? `${REMEMBERED_SANDBOX_DIRECTORY_PREFIX}:${userId}:${workspaceId || 'personal'}:${agentId}`
    : undefined;

const readEntry = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

// Storage unavailable (private mode, quota): the next conversation starts at
// the plan's default, as it did before anything was remembered.
const writeEntry = (key: string, value: StoredEntry) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // see above
  }
};

// The ordering clock for picks: never behind the wall clock, never behind
// anything already stored. Reading or writing an entry advances it, so after
// a reload with the clock set back the next pick still orders after the one
// remembered before — it would otherwise be rejected until wall time caught up.
let pickClock = 0;

const observePickedAt = (value: unknown) => {
  const pickedAt = (value as StoredEntry | undefined)?.pickedAt;
  if (typeof pickedAt === 'number' && Number.isFinite(pickedAt) && pickedAt > pickClock) {
    pickClock = pickedAt;
  }
};

/** A pick's place in time, after every pick seen so far in this tab or in storage. */
export const nextSandboxPickTime = (): number => {
  pickClock = Math.max(pickClock + 1, Date.now());
  return pickClock;
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
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return undefined;

  const value = readEntry(key);
  observePickedAt(value);
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
  pickedAt: number = nextSandboxPickTime(),
): Promise<void> | undefined => {
  const key = rememberedSandboxDirectoryKey(scope, agentId);
  if (!key) return;

  const folder = !selection.instanceId && !!selection.workingDirectory;
  const temporary =
    !selection.instanceId && !selection.environmentId && selection.workingDirectory === undefined;
  if (!folder && !temporary) return;

  const write = () => {
    // A newer pick, possibly from another tab, already landed.
    const existing = readEntry(key) as StoredEntry | undefined;
    observePickedAt(existing);
    if (isNewer(existing, pickedAt)) return;

    // Forgetting is written too, rather than removing the entry, so an older
    // folder save landing afterwards in another tab cannot bring it back.
    writeEntry(
      key,
      folder
        ? {
            ...(selection.drive && { drive: selection.drive }),
            pickedAt,
            tab: TAB_ID,
            workingDirectory: selection.workingDirectory,
          }
        : { pickedAt, tab: TAB_ID },
    );
  };

  // Storage has no locking between tabs, so the read, the comparison and the
  // write run under a Web Lock named after the entry: two tabs saving the same
  // entry take turns, and the second sees what the first wrote. Without the
  // Locks API (old browsers, tests) the write happens at once, as before.
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) {
    write();
    return;
  }

  return locks.request(key, write).then(
    () => undefined,
    // The lock itself failed (e.g. the document is going away): write anyway.
    () => write(),
  );
};

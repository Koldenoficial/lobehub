import {
  getPendingSandboxScopeGeneration,
  refreshSandboxDefaultSelection,
} from '@/store/chat/pendingSandboxSelection';

import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  nextSandboxPickTime,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
import type { SandboxSelection } from './useSandboxPlacement';

/**
 * The bookkeeping between a pick and its memory, kept per agent at module
 * level rather than in a component: the composer can unmount while a save is
 * in flight and mount again on the same agent, and neither the ordering of
 * picks nor a pick still waiting for the user id may be lost in between.
 */

// The newest pick whose save has landed, per user, workspace and agent — the
// same scope the memory is kept in, so one user's pick never shadows
// another's: an older save that lands late must not replace it. Counted on
// success only, so a newer pick that fails leaves an older one that succeeds
// free to land.
const latestSettled = new Map<string, number>();

const orderKey = ({ agentId, userId, workspaceId }: PickTarget & { userId?: string | null }) =>
  `${userId ?? ''}:${workspaceId ?? ''}:${agentId}`;

/** Record `seq` as the scope's newest landed pick, unless a newer one already is. */
const claimOrder = (target: PickTarget & { userId?: string | null }, seq: number): boolean => {
  const key = orderKey(target);
  if ((latestSettled.get(key) ?? 0) > seq) return false;
  latestSettled.set(key, seq);
  return true;
};
// Picks saved before the user id was known, with the workspace they were made
// in; remembered once the id arrives.
const deferredPicks = new Map<
  string,
  { pick: SandboxSelection; seq: number; workspaceId?: string | null }
>();

interface PickTarget {
  agentId: string;
  workspaceId?: string | null;
}

/** Who is signed in, and where, when a save lands. */
export interface ActiveScope {
  userId?: string | null;
  workspaceId?: string | null;
}

/**
 * Remember a pick for the user, agent and workspace it was made in, and move
 * the composer's own default there too: a new conversation opened while the
 * save was in flight was seeded from the folder before. That default is kept
 * per agent only, so it moves only while the same user is still active in the
 * same workspace — never into someone else's new conversation.
 */
const rememberPick = (
  { agentId, userId, workspaceId }: PickTarget & { userId: string },
  pick: SandboxSelection,
  seq: number,
  active: ActiveScope,
) => {
  const scope = { userId, workspaceId };
  const written = rememberSandboxSelection(scope, agentId, pick, seq);
  if (active.userId !== userId || (active.workspaceId ?? null) !== (workspaceId ?? null)) return;

  // Read back once the entry is written, so the default is what was stored —
  // this pick, or a newer one another tab stored first.
  // The write may wait for a lock; a switch to another account or workspace
  // meanwhile makes this default someone else's, so it is left alone then.
  const generation = getPendingSandboxScopeGeneration();
  const refresh = () => {
    if (generation !== getPendingSandboxScopeGeneration()) return;
    refreshSandboxDefaultSelection(
      agentId,
      resolveDefaultSandboxSelection(workspaceId, getRememberedSandboxDirectory(scope, agentId)),
    );
  };
  if (written) void written.then(refresh);
  else refresh();
};

/** Mark the start of a pick; the returned number orders it among the agent's picks. */
export const beginSandboxPick = (): number => {
  return nextSandboxPickTime();
};

/**
 * A pick's save landed. Remembered unless a newer pick by the same user, in
 * the same workspace, for the same agent has already landed; held for later when the user is not known yet.
 *
 * `userId` is whoever made the pick; it is only filled in at landing time when
 * nobody was known when the pick began, so a sign-in as someone else in
 * another tab cannot claim it.
 */
export const settleSandboxPick = (
  { agentId, seq, userId, workspaceId }: PickTarget & { seq: number; userId?: string | null },
  pick: SandboxSelection,
  active: ActiveScope,
): void => {
  if (!userId) {
    if (claimOrder({ agentId, workspaceId }, seq)) {
      deferredPicks.set(agentId, { pick, seq, workspaceId });
    }
    return;
  }

  // A pick still waiting for the user id may be newer than this one; it joins
  // this user's order first, so this save is then judged against it.
  const deferred = deferredPicks.get(agentId);
  if (deferred) {
    deferredPicks.delete(agentId);
    const target = { agentId, userId, workspaceId: deferred.workspaceId };
    if (claimOrder(target, deferred.seq)) rememberPick(target, deferred.pick, deferred.seq, active);
  }

  if (!claimOrder({ agentId, userId, workspaceId }, seq)) return;
  rememberPick({ agentId, userId, workspaceId }, pick, seq, active);
};

/** Remember every pick that was waiting for the user id, for the user now known. */
export const flushDeferredSandboxPicks = (active: ActiveScope & { userId: string }): void => {
  for (const [agentId, { pick, seq, workspaceId }] of deferredPicks) {
    // Carried into the now-known user's order, so an older save of theirs
    // that lands later cannot replace this newer pick.
    const target = { agentId, userId: active.userId, workspaceId };
    if (claimOrder(target, seq)) rememberPick(target, pick, seq, active);
  }
  deferredPicks.clear();
};

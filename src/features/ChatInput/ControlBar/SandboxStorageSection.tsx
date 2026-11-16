'use client';

import { memo, useCallback, useEffect, useRef } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
import { useSingleton } from '@/hooks/useSingleton';
import { refreshSandboxDefaultSelection } from '@/store/chat/pendingSandboxSelection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useTopicId } from '../hooks/useTopicId';
import { resolveDefaultSandboxSelection } from './defaultSandboxSelection';
import {
  getRememberedSandboxDirectory,
  rememberSandboxSelection,
} from './rememberedSandboxDirectory';
import SandboxDrivePicker from './SandboxDrivePicker';
import { type SandboxSelection, useSandboxPlacement } from './useSandboxPlacement';
import { useSandboxStorageAccess } from './useSandboxStorageAccess';
import { useSeedDefaultSelection } from './useSeedDefaultSelection';

interface PickTarget {
  agentId: string;
  workspaceId?: string | null;
}

/**
 * Remember a pick for the agent and workspace it was made in, and move the
 * composer's own default there too: a new conversation opened while the save
 * was in flight was seeded from the folder before.
 */
const rememberPick = (
  { agentId, userId, workspaceId }: PickTarget & { userId: string },
  next: SandboxSelection,
) => {
  const scope = { userId, workspaceId };
  rememberSandboxSelection(scope, agentId, next);
  refreshSandboxDefaultSelection(
    agentId,
    resolveDefaultSandboxSelection(workspaceId, getRememberedSandboxDirectory(scope, agentId)),
  );
};

interface SandboxStorageSectionProps {
  agentId: string;
}

/**
 * The working directory of a cloud-sandbox run — the counterpart of
 * `WorkingDirectorySection`, which covers runs on a machine, and shaped the
 * same way: one chip that always names the slot, whose menu holds every place
 * the run could work.
 *
 * Nothing chosen means a temporary sandbox, cleaned up with the session; a
 * folder on the drive keeps its files, and a repository starts from a checkout.
 * A plan with a drive starts each new conversation in the folder the agent's
 * last conversation was put in, or on its default folder rather than nothing.
 *
 * A plan without a drive still gets the chip: the temporary sandbox is
 * everyone's, and the way to a plan is a row in the same menu rather than a
 * different control.
 */
const SandboxStorageSectionInner = memo<SandboxStorageSectionProps>(({ agentId }) => {
  const { eligible, status } = useSandboxStorageAccess(agentId);
  const workspaceId = useActiveWorkspaceId();
  const userId = useUserStore(userProfileSelectors.userId);
  const { projectId, selection, setSelection, topicId } = useSandboxPlacement(
    agentId,
    useTopicId(),
  );
  // The user id is read when a save lands, not when the pick began: it can
  // arrive while the save is in flight.
  const userIdRef = useRef(userId);
  // A pick saved before the user id was known, with the agent and workspace it
  // was made for; remembered once the id arrives.
  const unrememberedRef = useRef<{ pick: SandboxSelection; target: PickTarget } | undefined>(
    undefined,
  );
  // The latest pick per agent: an older save that lands late must not replace
  // a newer choice.
  const pickSeqRef = useRef(0);
  const latestPick = useSingleton(() => new Map<string, number>());

  useEffect(() => {
    userIdRef.current = userId;
    const deferred = unrememberedRef.current;
    if (!userId || !deferred) return;

    unrememberedRef.current = undefined;
    rememberPick({ ...deferred.target, userId }, deferred.pick);
  }, [userId]);

  // Every pick that lands is remembered for the next conversation, which would
  // otherwise start back at the drive's root. A failed write is not.
  const pick = useCallback(
    async (next: SandboxSelection) => {
      const target: PickTarget = { agentId, workspaceId };
      const seq = ++pickSeqRef.current;
      latestPick.set(agentId, seq);

      await setSelection(next);
      if (latestPick.get(agentId) !== seq) return;

      const currentUserId = userIdRef.current;
      if (!currentUserId) {
        unrememberedRef.current = { pick: next, target };
        return;
      }
      if (unrememberedRef.current?.target.agentId === agentId) unrememberedRef.current = undefined;
      rememberPick({ ...target, userId: currentUserId }, next);
    },
    [agentId, latestPick, setSelection, workspaceId],
  );
  useSeedDefaultSelection(agentId, {
    eligible,
    entitled: status === 'ready',
    hasTopic: !!topicId,
  });

  if (status === 'hidden') return null;

  return (
    <SandboxDrivePicker
      entitled={status === 'ready'}
      projectId={projectId}
      topicId={topicId}
      value={selection}
      onChange={pick}
    />
  );
});

SandboxStorageSectionInner.displayName = 'SandboxStorageSectionInner';

const SandboxStorageSection = memo<SandboxStorageSectionProps>(({ agentId }) => (
  <SafeBoundary minHeight={22} resetKeys={[agentId]}>
    <SandboxStorageSectionInner agentId={agentId} />
  </SafeBoundary>
));

SandboxStorageSection.displayName = 'SandboxStorageSection';

export default SandboxStorageSection;

'use client';

import { memo, useCallback, useEffect, useRef } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SafeBoundary from '@/components/ErrorBoundary';
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
  // Read at the moment a save lands, not when the pick started: the user id
  // can arrive while the save is in flight.
  const scopeRef = useRef({ userId, workspaceId });
  // A pick saved before the user id was known; remembered once it is.
  const unrememberedRef = useRef<SandboxSelection | undefined>(undefined);

  const remember = useCallback(
    (next: SandboxSelection) => {
      const scope = scopeRef.current;
      if (!scope.userId) {
        unrememberedRef.current = next;
        return;
      }

      unrememberedRef.current = undefined;
      rememberSandboxSelection(scope, agentId, next);
      // A new conversation opened while the save was in flight was seeded from
      // the folder before; carry this one over to it.
      refreshSandboxDefaultSelection(
        agentId,
        resolveDefaultSandboxSelection(
          scope.workspaceId,
          getRememberedSandboxDirectory(scope, agentId),
        ),
      );
    },
    [agentId],
  );

  useEffect(() => {
    scopeRef.current = { userId, workspaceId };
    if (userId && unrememberedRef.current) remember(unrememberedRef.current);
  }, [remember, userId, workspaceId]);

  // Every pick that lands is remembered for the next conversation, which would
  // otherwise start back at the drive's root. A failed write is not.
  const pick = useCallback(
    async (next: SandboxSelection) => {
      await setSelection(next);
      remember(next);
    },
    [remember, setSelection],
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

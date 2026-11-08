import { useState } from 'react';
import { nudgeSchema } from '@gymverse/shared';
import { ApiError, api, errorMessage } from '../lib/api';
import { Icon } from './Icon';
import { useToast } from './Toast';

type Kind = 'renewal' | 'inactive';

const COPY: Record<Kind, { label: string; sent: string; done: (who: string) => string }> = {
  inactive: { label: 'Nudge', sent: 'Nudged', done: (who) => `Nudge sent to ${who}` },
  renewal: { label: 'Remind', sent: 'Reminded', done: (who) => `Renewal reminder sent to ${who}` },
};

/**
 * POST /gyms/:gymId/members/:userId/nudge. Disabled after a successful send; a 409
 * (`already_nudged`) shows the API's message and also disables it, since the server allows one per day.
 */
export function NudgeButton({ gymId, userId, who, kind }: { gymId: string; userId: string; who: string; kind: Kind }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const toast = useToast();
  const copy = COPY[kind];

  async function send() {
    const body = nudgeSchema.parse({ kind });
    setState('sending');
    try {
      await api.post(`/gyms/${gymId}/members/${userId}/nudge`, body);
      setState('sent');
      toast(copy.done(who));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState('sent');
        toast(err.message, 'info');
      } else {
        setState('idle');
        toast(errorMessage(err), 'error');
      }
    }
  }

  return (
    <button
      type="button"
      className="btn btn-small btn-secondary"
      onClick={send}
      disabled={state !== 'idle'}
      aria-label={state === 'sent' ? `${copy.sent} ${who}` : `${copy.label} ${who}`}
    >
      <Icon name={state === 'sent' ? 'check' : 'bell'} size={14} />
      {state === 'sent' ? copy.sent : state === 'sending' ? 'Sending…' : copy.label}
    </button>
  );
}

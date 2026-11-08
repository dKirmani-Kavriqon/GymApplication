import { humanize, type Gym, type MemberRow, type Routine, type WorkoutLog } from '@gymverse/shared';
import { useApiData } from '../lib/useApi';
import { formatDate, formatDateTime, pluralize } from '../lib/format';
import { formatVolume, summarizeSets } from '../lib/workouts';
import { Empty, ErrorBanner, Loading } from '../components/ui';

/** A member's logged workouts and the routines trainers assigned them (staff only). */
export function MemberWorkouts({ gym, member }: { gym: Gym; member: Pick<MemberRow, 'userId' | 'name' | 'phone'> }) {
  const { data, error, loading } = useApiData<{ workouts: WorkoutLog[]; assigned: Routine[] }>(
    `/gyms/${gym.id}/members/${member.userId}/workouts`,
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner message={error} />;
  const workouts = data?.workouts ?? [];
  const assigned = data?.assigned ?? [];
  const volume = workouts.reduce((s, w) => s + w.totalVolumeKg, 0);

  return (
    <div className="stack" data-testid="member-workouts">
      <div className="mini-stats">
        <div>
          <span className="stat-label">Workouts logged</span>
          <strong>{workouts.length}</strong>
        </div>
        <div>
          <span className="stat-label">Total volume</span>
          <strong>{formatVolume(volume)}</strong>
        </div>
        <div>
          <span className="stat-label">Last workout</span>
          <strong>{workouts[0] ? formatDate(workouts[0].completedAt, gym.timezone) : '–'}</strong>
        </div>
      </div>

      <section className="stack-sm">
        <h3>Assigned routines</h3>
        {assigned.length === 0 ? (
          <p className="muted small">No routines assigned yet. Assign one from Workouts → Routines.</p>
        ) : (
          <ul className="plain-list">
            {assigned.map((r) => (
              <li key={r.id} className="list-row" data-testid="assigned-routine">
                <div>
                  <strong>{r.name}</strong>
                  <div className="muted small">
                    {humanize(r.level)} · {pluralize(r.exercises.length, 'exercise')} · ~{r.durationMin} min
                    {r.assignment && ` · by ${r.assignment.by.name ?? 'staff'} on ${formatDate(r.assignment.at, gym.timezone)}`}
                  </div>
                  {r.assignment?.note && <div className="note-quote">“{r.assignment.note}”</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack-sm">
        <h3>History</h3>
        {workouts.length === 0 ? (
          <Empty icon="dumbbell">{member.name ?? 'This member'} hasn't logged a workout yet.</Empty>
        ) : (
          <ul className="plain-list">
            {workouts.map((w) => (
              <li key={w.id} className="workout-log" data-testid="workout-log">
                <div className="section-head">
                  <div>
                    <strong>{w.routineName ?? 'Free workout'}</strong>
                    <div className="muted small">
                      {formatDateTime(w.completedAt, gym.timezone)} · {w.durationMin} min · {pluralize(w.sets.length, 'set')}
                    </div>
                  </div>
                  <span className="badge badge-brand">{formatVolume(w.totalVolumeKg)}</span>
                </div>
                <ul className="set-summary">
                  {summarizeSets(w.sets).map((e) => (
                    <li key={e.exerciseId}>
                      <span>{e.name}</span>
                      <span className="muted">{e.sets}</span>
                    </li>
                  ))}
                </ul>
                {w.notes && <p className="muted small">Note: {w.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

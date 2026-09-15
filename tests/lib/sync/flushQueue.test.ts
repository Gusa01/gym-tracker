import { flushPendingWrites, PendingWrite } from '../../../src/lib/sync/flushQueue';

function fakeSupabase(behavior: (table: string, payload: Record<string, unknown>) => { error: unknown }) {
  const calls: Array<{ table: string; payload: Record<string, unknown>; options?: { onConflict?: string } }> = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>, options?: { onConflict?: string }) {
          calls.push({ table, payload, options });
          return Promise.resolve(behavior(table, payload));
        },
      };
    },
  };
  return { client, calls };
}

describe('flushPendingWrites', () => {
  it('returns empty results for an empty queue', async () => {
    const { client } = fakeSupabase(() => ({ error: null }));
    const result = await flushPendingWrites(client as any, []);
    expect(result).toEqual({ succeededIds: [], failedIds: [] });
  });

  it('upserts every write in order and reports all as succeeded', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [
      { id: 'w1', entity: 'workout_sessions', payload: { id: 'w1', status: 'in_progress' } },
      { id: 'w2', entity: 'logged_sets', payload: { id: 'w2', weight: 60 } },
    ];
    const result = await flushPendingWrites(client as any, writes);
    expect(result).toEqual({ succeededIds: ['w1', 'w2'], failedIds: [] });
    expect(calls.map((c) => c.table)).toEqual(['workout_sessions', 'logged_sets']);
    expect(calls[0].payload).toEqual({ id: 'w1', status: 'in_progress' });
  });

  it('keeps a failed write out of succeededIds but still attempts the rest', async () => {
    const { client } = fakeSupabase((table) => ({ error: table === 'workout_sessions' ? { message: 'network' } : null }));
    const writes: PendingWrite[] = [
      { id: 'w1', entity: 'workout_sessions', payload: { id: 'w1' } },
      { id: 'w2', entity: 'logged_sets', payload: { id: 'w2' } },
    ];
    const result = await flushPendingWrites(client as any, writes);
    expect(result.failedIds).toEqual(['w1']);
    expect(result.succeededIds).toEqual(['w2']);
  });

  it('upserts user_exercise_state on conflict (user_id, exercise_id), not the primary key', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [
      {
        id: 'w1',
        entity: 'user_exercise_state',
        payload: { user_id: 'u1', exercise_id: 'e1', current_weight: 60 },
      },
    ];
    await flushPendingWrites(client as any, writes);
    expect(calls[0].options).toEqual({ onConflict: 'user_id,exercise_id' });
  });

  it('upserts workout_sessions and logged_sets with no onConflict override (primary key default)', async () => {
    const { client, calls } = fakeSupabase(() => ({ error: null }));
    const writes: PendingWrite[] = [{ id: 'w1', entity: 'workout_sessions', payload: { id: 'w1' } }];
    await flushPendingWrites(client as any, writes);
    expect(calls[0].options).toBeUndefined();
  });
});

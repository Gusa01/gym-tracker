import { CREATE_TABLES_SQL } from '../../../src/lib/sqlite/schema';

describe('local SQLite schema', () => {
  it('defines all four cache/queue tables', () => {
    for (const table of [
      'routines_cache',
      'routine_days_cache',
      'routine_exercises_cache',
      'user_exercise_state_cache',
      'pending_writes',
    ]) {
      expect(CREATE_TABLES_SQL).toContain(`create table if not exists ${table}`);
    }
  });
});

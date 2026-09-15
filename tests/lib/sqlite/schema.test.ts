import { CREATE_TABLES_SQL, MIGRATION_STATEMENTS } from '../../../src/lib/sqlite/schema';

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

describe('local SQLite schema migrations', () => {
  it('adds muscle_group and the progress counters for devices upgrading from the prior schema', () => {
    expect(MIGRATION_STATEMENTS).toContain('alter table routine_exercises_cache add column muscle_group text');
    expect(MIGRATION_STATEMENTS).toContain(
      'alter table user_exercise_state_cache add column consecutive_hit_count integer not null default 0'
    );
    expect(MIGRATION_STATEMENTS).toContain(
      'alter table user_exercise_state_cache add column consecutive_miss_count integer not null default 0'
    );
  });
});

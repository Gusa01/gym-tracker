import { SQLiteDatabase } from 'expo-sqlite';
import { PendingWrite } from '../sync/flushQueue';

export function enqueueWrite(
  db: SQLiteDatabase,
  id: string,
  entity: PendingWrite['entity'],
  payload: Record<string, unknown>
): void {
  db.runSync(
    'insert into pending_writes (id, entity, payload_json, created_at, attempts) values (?, ?, ?, ?, 0)',
    [id, entity, JSON.stringify(payload), new Date().toISOString()]
  );
}

export function removePendingWrite(db: SQLiteDatabase, id: string): void {
  db.runSync('delete from pending_writes where id = ?', [id]);
}

export function incrementAttempts(db: SQLiteDatabase, id: string): void {
  db.runSync('update pending_writes set attempts = attempts + 1 where id = ?', [id]);
}

interface PendingWriteRow {
  id: string;
  entity: string;
  payload_json: string;
  created_at: string;
  attempts: number;
}

export function listPendingWrites(db: SQLiteDatabase): PendingWrite[] {
  const rows = db.getAllSync<PendingWriteRow>('select * from pending_writes order by created_at asc');
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity as 'workout_sessions' | 'logged_sets' | 'user_exercise_state',
    payload: JSON.parse(row.payload_json),
  }));
}

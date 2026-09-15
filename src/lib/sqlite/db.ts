import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL, MIGRATION_STATEMENTS } from './schema';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('fit-tracker.db');
  }
  return dbInstance;
}

export function initDatabase(): void {
  const db = getDatabase();
  db.execSync(CREATE_TABLES_SQL);
  for (const statement of MIGRATION_STATEMENTS) {
    try {
      db.execSync(statement);
    } catch {
      // Already applied on a device that had this table before this column existed —
      // expected on every launch after the first one that added it. SQLite has no
      // portable "ADD COLUMN IF NOT EXISTS" old enough to rely on here.
    }
  }
}

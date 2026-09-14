import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL } from './schema';

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
}

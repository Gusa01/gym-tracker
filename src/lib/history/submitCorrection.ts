import * as Crypto from 'expo-crypto';
import { SQLiteDatabase } from 'expo-sqlite';
import { enqueueWrite } from '../sqlite/pendingWrites';
import { LoggedSet } from '../sessions/types';
import { SetCorrection } from './types';
import { buildCorrectionPayload } from './logic';

/** Queues a correction as a full-row upsert. The queue id is fresh, so repeated corrections never collide. */
export function queueSetCorrection(db: SQLiteDatabase, set: LoggedSet, change: SetCorrection): void {
  enqueueWrite(db, Crypto.randomUUID(), 'logged_sets', buildCorrectionPayload(set, change));
}

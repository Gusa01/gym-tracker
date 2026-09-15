import { LoggedSet } from '../sessions/types';

export function hasTopSetDeficit(set: LoggedSet, targetReps: number, rirMin: number | null): boolean {
  const repDeficit = targetReps - set.reps > 0;
  const rirDeficit = rirMin !== null && set.rir !== null && rirMin - set.rir > 0;
  return repDeficit || rirDeficit;
}

export function hasConsecutiveDeficit(
  recentTopSets: LoggedSet[],
  targetReps: number,
  rirMin: number | null
): boolean {
  if (recentTopSets.length < 2) return false;
  return recentTopSets.slice(0, 2).every((set) => hasTopSetDeficit(set, targetReps, rirMin));
}

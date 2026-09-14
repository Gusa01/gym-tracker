jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  saveCurrentSession,
  loadCurrentSession,
  clearCurrentSession,
} from '../../../src/lib/sessions/currentSessionStorage';

describe('current session storage', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadCurrentSession()).toBeNull();
  });

  it('round-trips a saved pointer', async () => {
    const pointer = { sessionId: 'session-1', dayId: 'day-1', sessionDate: '2026-01-05', weekNumber: 2 };
    await saveCurrentSession(pointer);
    expect(await loadCurrentSession()).toEqual(pointer);
  });

  it('overwrites a previously saved pointer', async () => {
    await saveCurrentSession({ sessionId: 'a', dayId: 'd1', sessionDate: '2026-01-05', weekNumber: 1 });
    await saveCurrentSession({ sessionId: 'b', dayId: 'd2', sessionDate: '2026-01-06', weekNumber: 1 });
    expect(await loadCurrentSession()).toEqual({
      sessionId: 'b',
      dayId: 'd2',
      sessionDate: '2026-01-06',
      weekNumber: 1,
    });
  });

  it('clears the pointer', async () => {
    await saveCurrentSession({ sessionId: 'a', dayId: 'd1', sessionDate: '2026-01-05', weekNumber: 1 });
    await clearCurrentSession();
    expect(await loadCurrentSession()).toBeNull();
  });
});

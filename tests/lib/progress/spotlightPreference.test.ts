jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import {
  loadSpotlightExerciseId,
  saveSpotlightExerciseId,
} from '../../../src/lib/progress/spotlightPreference';

describe('spotlight exercise preference', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadSpotlightExerciseId()).toBeNull();
  });

  it('round-trips the chosen exercise id', async () => {
    await saveSpotlightExerciseId('bench');
    expect(await loadSpotlightExerciseId()).toBe('bench');
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fit-tracker:home-progress-exercise';

export async function loadSpotlightExerciseId(): Promise<string | null> {
  return AsyncStorage.getItem(KEY);
}

export async function saveSpotlightExerciseId(exerciseId: string): Promise<void> {
  await AsyncStorage.setItem(KEY, exerciseId);
}

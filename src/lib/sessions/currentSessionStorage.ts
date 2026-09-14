import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fit-tracker:current-session';

export interface CurrentSessionPointer {
  sessionId: string;
  dayId: string;
  sessionDate: string;
  weekNumber: number;
}

export async function saveCurrentSession(pointer: CurrentSessionPointer): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(pointer));
}

export async function loadCurrentSession(): Promise<CurrentSessionPointer | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearCurrentSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

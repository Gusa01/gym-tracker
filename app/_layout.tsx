import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAuthSession } from '../src/hooks/useAuthSession';
import { initDatabase, getDatabase } from '../src/lib/sqlite/db';
import { supabase } from '../src/lib/supabase';
import { startSyncListener } from '../src/lib/sync/syncService';

initDatabase();

export default function RootLayout() {
  const { session, isLoading } = useAuthSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/(app)');
    }
  }, [session, isLoading, segments]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const stop = startSyncListener(getDatabase(), supabase, userId);
    return stop;
  }, [session?.user.id]);

  if (isLoading) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Slot />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

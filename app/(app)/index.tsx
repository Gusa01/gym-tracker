import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuthSession } from '../../src/hooks/useAuthSession';

export default function Home() {
  const { session, isLoading } = useAuthSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fit Tracker</Text>
      {isLoading ? (
        <Text>Cargando...</Text>
      ) : (
        <Text>Sesión iniciada como {session?.user.email}</Text>
      )}
      <Pressable style={styles.button} onPress={() => router.push('/(app)/routines' as any)}>
        <Text style={styles.buttonText}>Ver rutinas</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.buttonText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
});

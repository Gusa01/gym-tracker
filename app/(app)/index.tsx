import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuthSession } from '../../src/hooks/useAuthSession';
import { useHomeData } from '../../src/hooks/useHomeData';

export default function Home() {
  const { session } = useAuthSession();
  const {
    loading,
    error,
    routineName,
    weekNumber,
    todayDayName,
    todayIsRestDay,
    sessionStatus,
    startOrResumeSession,
  } = useHomeData();

  async function handleStart() {
    const sessionId = await startOrResumeSession();
    if (sessionId) {
      router.push(`/(app)/session/${sessionId}` as any);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fit Tracker</Text>
      <Text>Sesión iniciada como {session?.user.email}</Text>

      {loading && <Text>Cargando...</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && (
        <View style={styles.card}>
          {routineName ? (
            <>
              <Text style={styles.routineName}>{routineName}</Text>
              <Text style={styles.weekLabel}>Semana {weekNumber}</Text>
              {todayDayName ? (
                todayIsRestDay ? (
                  <Text>Hoy: {todayDayName} (descanso)</Text>
                ) : (
                  <>
                    <Text>Hoy: {todayDayName}</Text>
                    {sessionStatus === 'completed' ? (
                      <Text style={styles.doneLabel}>✓ Entrenamiento completado hoy</Text>
                    ) : (
                      <Pressable style={styles.button} onPress={handleStart}>
                        <Text style={styles.buttonText}>
                          {sessionStatus === 'in_progress' ? 'Continuar entrenamiento' : 'Empezar entrenamiento'}
                        </Text>
                      </Pressable>
                    )}
                  </>
                )
              ) : (
                <Text>No hay entrenamiento programado para hoy.</Text>
              )}
            </>
          ) : (
            <Text>No tenés una rutina activa. Activá una desde "Ver rutinas".</Text>
          )}
        </View>
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
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  card: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16 },
  routineName: { fontSize: 20, fontWeight: '700' },
  weekLabel: { color: '#666' },
  doneLabel: { color: '#16a34a', fontWeight: '600' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
});

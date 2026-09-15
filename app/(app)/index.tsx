import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
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
    deloadExerciseName,
    routineSwitchAvailable,
    nextRoutineName,
    dismissDeload,
    dismissSwitch,
    acceptDeload,
    acceptSwitch,
  } = useHomeData();

  async function handleStart() {
    const sessionId = await startOrResumeSession();
    if (sessionId) {
      router.push(`/(app)/session/${sessionId}` as any);
    }
  }

  async function handleAcceptDeload() {
    try {
      await acceptDeload();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo registrar el deload.');
    }
  }

  async function handleAcceptSwitch() {
    try {
      await acceptSwitch();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cambiar de rutina.');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fit Tracker</Text>
      <Text>Sesión iniciada como {session?.user.email}</Text>

      {loading && <ActivityIndicator />}
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

      {deloadExerciseName && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            ¿Bajarle la intensidad a "{deloadExerciseName}"? Viene costando en las últimas sesiones.
          </Text>
          <View style={styles.bannerActions}>
            <Pressable style={styles.bannerButton} onPress={handleAcceptDeload}>
              <Text style={styles.bannerButtonText}>Aceptar</Text>
            </Pressable>
            <Pressable style={styles.bannerButtonSecondary} onPress={dismissDeload}>
              <Text style={styles.bannerButtonSecondaryText}>Ignorar</Text>
            </Pressable>
          </View>
        </View>
      )}

      {routineSwitchAvailable && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Ya pasaron las semanas sugeridas de esta rutina
            {nextRoutineName ? ` — ¿cambiar a "${nextRoutineName}"?` : '.'}
          </Text>
          <View style={styles.bannerActions}>
            <Pressable style={styles.bannerButton} onPress={handleAcceptSwitch}>
              <Text style={styles.bannerButtonText}>Aceptar</Text>
            </Pressable>
            <Pressable style={styles.bannerButtonSecondary} onPress={dismissSwitch}>
              <Text style={styles.bannerButtonSecondaryText}>Ignorar</Text>
            </Pressable>
          </View>
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
  banner: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#f59e0b', borderRadius: 8, padding: 16 },
  bannerText: { color: '#111' },
  bannerActions: { flexDirection: 'row', gap: 8 },
  bannerButton: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 10, alignItems: 'center' },
  bannerButtonText: { color: '#fff', fontWeight: '600' },
  bannerButtonSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  bannerButtonSecondaryText: { color: '#111', fontWeight: '600' },
});

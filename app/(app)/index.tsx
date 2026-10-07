import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useHomeData } from '../../src/hooks/useHomeData';
import { WeekCalendarStrip } from '../../src/components/WeekCalendarStrip';
import { HomeProgressCard } from '../../src/components/HomeProgressCard';

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

export default function Home() {
  const {
    loading,
    error,
    routineName,
    weekNumber,
    weekProgress,
    weekCalendar,
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
    recentActivity,
    consistencyStreak,
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {loading && <ActivityIndicator />}
      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && !error && (
        <>
          {routineName ? (
            <>
              <View style={styles.card}>
                <Text style={styles.routineName}>{routineName}</Text>
                {weekProgress !== null ? (
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${weekProgress * 100}%` }]} />
                  </View>
                ) : (
                  <Text style={styles.weekLabel}>Semana {weekNumber}</Text>
                )}

                <WeekCalendarStrip days={weekCalendar} />

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
              </View>

              {consistencyStreak > 0 && (
                <View style={styles.streakCard}>
                  <Text style={styles.streakText}>
                    🔥 {consistencyStreak}{' '}
                    {consistencyStreak === 1 ? 'semana consecutiva' : 'semanas consecutivas'} entrenando
                  </Text>
                </View>
              )}

              {recentActivity.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Actividad reciente</Text>
                  {recentActivity.map((entry) => (
                    <Pressable
                      key={entry.sessionId}
                      style={styles.activityPressable}
                      onPress={() => router.push(`/(app)/history/${entry.sessionId}` as any, { withAnchor: true })}
                    >
                      <Text style={styles.activityRow}>
                        {entry.dayName} — {formatShortDate(entry.sessionDate)}
                      </Text>
                      <Text style={styles.activityChevron}>›</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <HomeProgressCard />
            </>
          ) : (
            <View style={styles.card}>
              <Text>No tenés una rutina activa. Activá una desde el menú "Rutinas".</Text>
            </View>
          )}
        </>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { gap: 16, padding: 16 },
  card: { width: '100%', gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16 },
  routineName: { fontSize: 20, fontWeight: '700' },
  weekLabel: { color: '#666' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#eee', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: '#111' },
  doneLabel: { color: '#16a34a', fontWeight: '600' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14 },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  streakCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 12,
  },
  streakText: { color: '#92400e', fontWeight: '600' },
  sectionTitle: { fontWeight: '700', fontSize: 15 },
  activityRow: { color: '#333' },
  activityPressable: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  activityChevron: { fontSize: 18, color: '#999' },
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

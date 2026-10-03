import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getDatabase } from '../../../src/lib/sqlite/db';
import { resolveToday } from '../../../src/lib/sqlite/cache';
import { useSessionSets } from '../../../src/hooks/useSessionSets';
import { SessionExerciseCard } from '../../../src/components/SessionExerciseCard';
import { PrBanner } from '../../../src/components/PrBanner';

export default function SessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const {
    dayName,
    exercises,
    loggedSets,
    weightByExercise,
    loading,
    loadForDay,
    logSet,
    completeSession,
    prBanner,
    dismissPrBanner,
  } = useSessionSets(sessionId);
  const [resolvedDayName, setResolvedDayName] = useState<string | null>(null);

  useEffect(() => {
    const resolved = resolveToday(getDatabase());
    if (!resolved || !resolved.day) return;
    setResolvedDayName(resolved.day.name);
    loadForDay(resolved.day.id, resolved.day.name);
  }, [loadForDay]);

  async function handleFinish() {
    await completeSession();
    router.replace('/(app)' as any);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{resolvedDayName ?? dayName ?? 'Entrenamiento'}</Text>

        {exercises.map((exercise) => (
          <SessionExerciseCard
            key={exercise.id}
            exercise={exercise}
            initialWeight={weightByExercise[exercise.id] ?? null}
            loggedSets={loggedSets}
            onLogSet={(setIndex, setType, weight, reps, rir) =>
              logSet(exercise.id, setIndex, setType, weight, reps, rir)
            }
          />
        ))}

        <Pressable
          style={styles.finishButton}
          onPress={() =>
            Alert.alert('Terminar entrenamiento', '¿Marcar esta sesión como completada?', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Terminar', onPress: handleFinish },
            ])
          }
        >
          <Text style={styles.finishButtonText}>Terminar entrenamiento</Text>
        </Pressable>
      </ScrollView>
      <PrBanner banner={prBanner} onDismiss={dismissPrBanner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  finishButton: { backgroundColor: '#16a34a', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  finishButtonText: { color: '#fff', fontWeight: '700' },
});

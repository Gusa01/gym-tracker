import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSessionDetail } from '../../../src/hooks/useSessionHistory';
import { groupSessionSets } from '../../../src/lib/history/logic';
import { formatSessionTitle, formatSetLabel, formatSetValues } from '../../../src/lib/history/format';
import { HistoryExercise } from '../../../src/lib/history/types';
import { LoggedSet } from '../../../src/lib/sessions/types';
import { SetEditor } from '../../../src/components/SetEditor';

export default function SessionHistoryDetail() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { detail, isLoading, error, refetch, correctSet } = useSessionDetail(sessionId);
  const [editing, setEditing] = useState<{ set: LoggedSet; exercise: HistoryExercise } | null>(null);
  const [corrected, setCorrected] = useState(false);

  const groups = useMemo(() => (detail ? groupSessionSets(detail.sets, detail.exercises) : []), [detail]);

  if (isLoading && !detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error ?? 'Conectate para ver tu historial'}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  async function finish(change: Parameters<typeof correctSet>[1]) {
    if (!editing) return;
    await correctSet(editing.set.id, change);
    setEditing(null);
    setCorrected(true);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.backRow}>
        <Text style={styles.back}>←</Text>
        <Text style={styles.title}>{formatSessionTitle(detail.sessionDate, detail.dayName)}</Text>
      </Pressable>

      {error ? (
        <Pressable style={styles.banner} onPress={refetch}>
          <Text style={styles.bannerText}>No se pudo actualizar. Tocá para reintentar.</Text>
        </Pressable>
      ) : null}

      {corrected && (
        <Text style={styles.note}>Corregido. El peso sugerido no cambia; si quedó mal, ajustalo en tu próxima sesión.</Text>
      )}

      {groups.length === 0 && <Text style={styles.message}>Esta sesión no tiene series.</Text>}

      {groups.map(({ exercise, sets }) => (
        <View key={exercise.id} style={styles.card}>
          <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
          {sets.map((set) => (
            <View key={set.id} style={styles.setRow}>
              <Text style={styles.setLabel}>{formatSetLabel(set)}</Text>
              <Text style={styles.setValues}>{formatSetValues(set, exercise.rep_unit)}</Text>
              <Pressable onPress={() => setEditing({ set, exercise })} hitSlop={8} accessibilityLabel="Corregir serie">
                <Text style={styles.editIcon}>✎</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}

      <SetEditor
        set={editing?.set ?? null}
        exercise={editing?.exercise ?? null}
        onClose={() => setEditing(null)}
        onSave={finish}
        onDelete={() => finish({ kind: 'delete' })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { textAlign: 'center', color: '#666' },
  retryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 16 },
  retryText: { color: '#fff', fontWeight: '600' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { fontSize: 22 },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  note: { color: '#166534', backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10 },
  banner: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 10 },
  bannerText: { color: '#991b1b', textAlign: 'center' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, gap: 6 },
  exerciseName: { fontSize: 16, fontWeight: '700' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabel: { width: 84, color: '#666' },
  setValues: { flex: 1, fontWeight: '600' },
  editIcon: { fontSize: 18, color: '#111', paddingHorizontal: 4 },
});

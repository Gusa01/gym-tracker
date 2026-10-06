import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useExerciseProgress } from '../../../src/hooks/useExerciseProgress';
import { ProgressChart } from '../../../src/components/ProgressChart';
import { bestSetPerSession, metricKind, primaryMetric } from '../../../src/lib/progress/metrics';
import { computeRecords } from '../../../src/lib/progress/records';
import {
  RECORD_LABEL,
  TOGGLE_LABEL,
  formatMetricValue,
  formatShortDate,
  formatSourceSet,
} from '../../../src/lib/progress/format';
import { Metric, RecordEntry } from '../../../src/lib/progress/types';

export default function ExerciseProgressDetail() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const { session } = useAuthSession();
  const { rows, isLoading, error, refetch } = useExerciseProgress(session?.user.id, exerciseId);
  const { width: screenWidth } = useWindowDimensions();
  const [toggle, setToggle] = useState<'e1rm' | 'weight'>('e1rm');

  const kind = rows.length > 0 ? metricKind(rows) : null;
  const metric: Metric | null = kind === 'weighted' ? toggle : kind ? primaryMetric(kind) : null;
  const points = useMemo(() => (metric ? bestSetPerSession(rows, metric) : []), [rows, metric]);
  const records = useMemo(() => (rows.length > 0 ? computeRecords(rows) : null), [rows]);
  const exerciseName = rows.length > 0 ? rows[rows.length - 1].exercise_name : '';

  if (isLoading && rows.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  // screen padding 16x2, card padding 12x2 + border 1x2
  const chartWidth = screenWidth - 32 - 26;

  const recordRows: Array<{ metric: Metric; entry: RecordEntry | null }> = records
    ? kind === 'weighted'
      ? [
          { metric: 'e1rm', entry: records.bestE1rm },
          { metric: 'weight', entry: records.bestWeight },
        ]
      : kind === 'seconds'
        ? [{ metric: 'seconds', entry: records.bestSeconds }]
        : [{ metric: 'reps', entry: records.bestReps }]
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.backRow}>
        <Text style={styles.back}>←</Text>
        <Text style={styles.title}>{exerciseName}</Text>
      </Pressable>

      {kind === 'weighted' && (
        <View style={styles.toggle}>
          {(['e1rm', 'weight'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.toggleOption, toggle === option && styles.toggleOptionActive]}
              onPress={() => setToggle(option)}
            >
              <Text style={[styles.toggleText, toggle === option && styles.toggleTextActive]}>
                {TOGGLE_LABEL[option]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {metric && points.length > 0 && (
        <View style={styles.card}>
          <ProgressChart key={metric} points={points} metric={metric} width={chartWidth} />
        </View>
      )}

      {recordRows.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏆 Récords</Text>
          {recordRows.map(({ metric: recordMetric, entry }) =>
            entry ? (
              <View key={recordMetric} style={styles.recordRow}>
                <View style={styles.recordHeader}>
                  <Text style={styles.recordLabel}>{RECORD_LABEL[recordMetric]}</Text>
                  <Text style={styles.recordValue}>{formatMetricValue(entry.value, recordMetric)}</Text>
                </View>
                <Text style={styles.recordDetail}>
                  {recordMetric === 'seconds' || recordMetric === 'reps'
                    ? formatShortDate(entry.date)
                    : `${formatSourceSet(entry, recordMetric)} · ${formatShortDate(entry.date)}`}
                </Text>
              </View>
            ) : null
          )}
        </View>
      )}
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
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  toggle: { flexDirection: 'row', backgroundColor: '#eee', borderRadius: 8, padding: 4, alignSelf: 'flex-start' },
  toggleOption: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  toggleOptionActive: { backgroundColor: '#111' },
  toggleText: { fontWeight: '600', color: '#111' },
  toggleTextActive: { color: '#fff' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, overflow: 'hidden' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  recordRow: { paddingVertical: 6 },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  recordLabel: { fontWeight: '600' },
  recordValue: { fontWeight: '700' },
  recordDetail: { color: '#666', marginTop: 2 },
});

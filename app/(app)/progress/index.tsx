import { useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useProgressSummary } from '../../../src/hooks/useExerciseProgress';
import { Sparkline } from '../../../src/components/Sparkline';
import { formatDaysAgo, formatMetricValue } from '../../../src/lib/progress/format';
import { sparklinesByExercise } from '../../../src/lib/progress/spotlight';
import { Trend } from '../../../src/lib/progress/types';

const TREND_ARROW: Record<Trend, string> = { up: '↑', flat: '→', down: '↓' };
const TREND_COLOR: Record<Trend, string> = { up: '#16a34a', flat: '#666', down: '#dc2626' };

export default function ProgressList() {
  const { session } = useAuthSession();
  const { rows, summaries, isLoading, error, refetch } = useProgressSummary(session?.user.id);
  const sparklines = useMemo(() => sparklinesByExercise(rows, summaries), [rows, summaries]);

  if (isLoading && summaries.length === 0) {
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

  const today = new Date();

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={summaries}
      keyExtractor={(item) => item.exerciseId}
      ListEmptyComponent={
        <Text style={styles.message}>
          Todavía no hay datos. Completá tu primera sesión para empezar a ver tu progreso.
        </Text>
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/(app)/progress/${item.exerciseId}` as any)}>
          <View style={styles.rowMain}>
            <Text style={styles.name}>{item.exerciseName}</Text>
            <Text style={styles.subtitle}>{formatDaysAgo(item.lastTrainedDate, today)}</Text>
          </View>
          <Sparkline values={sparklines.get(item.exerciseId) ?? []} color={item.trend ? TREND_COLOR[item.trend] : '#666'} />
          {item.latestValue !== null && (
            <Text style={styles.value}>{formatMetricValue(item.latestValue, item.metric)}</Text>
          )}
          <Text style={[styles.arrow, item.trend ? { color: TREND_COLOR[item.trend] } : null]}>
            {item.trend ? TREND_ARROW[item.trend] : ' '}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { textAlign: 'center', color: '#666', marginTop: 32 },
  retryButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20, marginTop: 16 },
  retryText: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  rowMain: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2, fontSize: 12 },
  value: { fontSize: 16, fontWeight: '600', marginHorizontal: 12 },
  arrow: { fontSize: 20, width: 20, textAlign: 'center' },
  chevron: { fontSize: 22, color: '#999', marginLeft: 8 },
});

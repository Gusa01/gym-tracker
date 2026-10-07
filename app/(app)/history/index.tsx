import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useSessionHistory } from '../../../src/hooks/useSessionHistory';
import { formatSessionTitle } from '../../../src/lib/history/format';

export default function HistoryList() {
  const { session } = useAuthSession();
  const { sessions, isLoading, error, isLoadingMore, loadMoreError, loadMore, refetch } = useSessionHistory(
    session?.user.id
  );

  if (isLoading && sessions.length === 0) {
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

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={sessions}
      keyExtractor={(item) => item.id}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Text style={styles.message}>Todavía no hay sesiones. Completá tu primera sesión para verla acá.</Text>
      }
      ListFooterComponent={
        isLoadingMore ? (
          <ActivityIndicator style={styles.footer} />
        ) : loadMoreError ? (
          <Pressable style={styles.footerRetry} onPress={loadMore}>
            <Text style={styles.footerRetryText}>No se pudieron cargar más sesiones. Reintentar</Text>
          </Pressable>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/(app)/history/${item.id}` as any)}>
          <View style={styles.rowMain}>
            <Text style={styles.title}>{formatSessionTitle(item.sessionDate, item.dayName)}</Text>
            <Text style={styles.subtitle}>
              {item.exerciseCount} {item.exerciseCount === 1 ? 'ejercicio' : 'ejercicios'} · {item.setCount}{' '}
              {item.setCount === 1 ? 'serie' : 'series'}
            </Text>
          </View>
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
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#666', marginTop: 2, fontSize: 12 },
  chevron: { fontSize: 22, color: '#999', marginLeft: 8 },
  footer: { marginVertical: 16 },
  footerRetry: { padding: 16, alignItems: 'center' },
  footerRetryText: { color: '#111', fontWeight: '600' },
});

import { useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { activateRoutine, softDeleteRoutine } from '../../../src/lib/routines/mutations';

export default function RoutinesList() {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const { routines, isLoading, refetch } = useRoutines(userId);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleActivate(routineId: string) {
    if (!userId) return;
    setBusyId(routineId);
    try {
      await activateRoutine(supabase, userId, routineId);
      await refetch();
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(routineId: string, name: string) {
    Alert.alert('Eliminar rutina', `¿Eliminar "${name}"? Esto no borra tu historial de entrenamientos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setBusyId(routineId);
          try {
            await softDeleteRoutine(supabase, routineId);
            await refetch();
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={routines}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Todavía no tenés rutinas.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/(app)/routines/${item.id}` as any)}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {item.name}
                {item.is_active ? ' ⭐' : ''}
              </Text>
            </View>
            <View style={styles.rowActions}>
              {!item.is_active && (
                <Pressable
                  disabled={busyId === item.id}
                  onPress={() => handleActivate(item.id)}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonText}>Activar</Text>
                </Pressable>
              )}
              <Pressable
                disabled={busyId === item.id}
                onPress={() => handleDelete(item.id, item.name)}
                style={[styles.actionButton, styles.deleteButton]}
              >
                <Text style={styles.actionButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <Pressable style={styles.newButton} onPress={() => router.push('/(app)/routines/new' as any)}>
        <Text style={styles.newButtonText}>+ Nueva rutina</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  empty: { textAlign: 'center', marginTop: 32, color: '#666' },
  row: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8 },
  rowText: { marginBottom: 8 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowActions: { flexDirection: 'row', gap: 8 },
  actionButton: { backgroundColor: '#111', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  deleteButton: { backgroundColor: '#dc2626' },
  actionButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  newButton: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 12 },
  newButtonText: { color: '#fff', fontWeight: '600' },
});

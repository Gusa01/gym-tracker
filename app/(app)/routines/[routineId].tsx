import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutine } from '../../../src/hooks/useRoutine';
import { useRoutineDays } from '../../../src/hooks/useRoutineDays';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { updateRoutine, createDay, softDeleteDay, moveDay } from '../../../src/lib/routines/mutations';

export default function RoutineEditor() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const {
    routine,
    isLoading: routineLoading,
    error: routineError,
    refetch: refetchRoutine,
  } = useRoutine(routineId);
  const { days, isLoading: daysLoading, error: daysError, refetch: refetchDays } = useRoutineDays(routineId);
  const { routines: otherRoutines } = useRoutines(userId);

  const [name, setName] = useState('');
  const [usesTopSetBackoff, setUsesTopSetBackoff] = useState(false);
  const [suggestedDurationWeeks, setSuggestedDurationWeeks] = useState('');
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newDayName, setNewDayName] = useState('');
  const [newDayIsRest, setNewDayIsRest] = useState(false);
  const [addingDay, setAddingDay] = useState(false);

  useEffect(() => {
    if (routine && !initialized) {
      setName(routine.name);
      setUsesTopSetBackoff(routine.uses_top_set_backoff);
      setSuggestedDurationWeeks(
        routine.suggested_duration_weeks !== null ? String(routine.suggested_duration_weeks) : ''
      );
      setNextRoutineId(routine.next_routine_id);
      setInitialized(true);
    }
  }, [routine, initialized]);

  async function handleSave() {
    if (!routineId) return;
    setSaving(true);
    try {
      await updateRoutine(supabase, routineId, {
        name: name.trim(),
        usesTopSetBackoff,
        suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
        nextRoutineId,
      });
      await refetchRoutine();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo guardar la rutina.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDay() {
    if (!routineId || !newDayName.trim()) return;
    try {
      await createDay(supabase, routineId, { name: newDayName.trim(), isRestDay: newDayIsRest });
      setNewDayName('');
      setNewDayIsRest(false);
      setAddingDay(false);
      await refetchDays();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo agregar el día.');
    }
  }

  function handleDeleteDay(dayId: string, dayName: string) {
    Alert.alert('Eliminar día', `¿Eliminar "${dayName}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteDay(supabase, dayId);
            await refetchDays();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo eliminar el día.');
          }
        },
      },
    ]);
  }

  async function handleMoveDay(dayId: string, direction: 'up' | 'down') {
    if (!routineId) return;
    try {
      await moveDay(supabase, routineId, dayId, direction);
      await refetchDays();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo reordenar el día.');
    }
  }

  if (routineError || daysError) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{routineError || daysError}</Text>
      </View>
    );
  }

  if (routineLoading || daysLoading || !routine) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  const pickableRoutines = otherRoutines.filter((r) => r.id !== routineId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TextInput
        style={styles.input}
        placeholder="Ej: Fuerza 5x5, Push/Pull/Legs..."
        value={name}
        onChangeText={setName}
      />

      <View style={styles.switchRow}>
        <Text>Usa top set / back-off</Text>
        <Switch value={usesTopSetBackoff} onValueChange={setUsesTopSetBackoff} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Ej: 8 (duración sugerida en semanas, opcional)"
        keyboardType="number-pad"
        value={suggestedDurationWeeks}
        onChangeText={setSuggestedDurationWeeks}
      />

      {pickableRoutines.length > 0 && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Rutina siguiente (opcional)</Text>
          {pickableRoutines.map((r) => (
            <Pressable
              key={r.id}
              style={[styles.pickerRow, nextRoutineId === r.id && styles.pickerRowSelected]}
              onPress={() => setNextRoutineId(nextRoutineId === r.id ? null : r.id)}
            >
              <Text>{r.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Días</Text>
      {days.map((day, index) => (
        <View key={day.id} style={styles.dayRow}>
          <Pressable
            style={styles.dayRowMain}
            onPress={() => router.push(`/(app)/routines/${routineId}/days/${day.id}` as any)}
          >
            <Text style={styles.dayName}>
              {day.name}
              {day.is_rest_day ? ' (descanso)' : ''}
            </Text>
          </Pressable>
          <View style={styles.dayActions}>
            <Pressable disabled={index === 0} onPress={() => handleMoveDay(day.id, 'up')}>
              <Text style={styles.moveButton}>↑</Text>
            </Pressable>
            <Pressable disabled={index === days.length - 1} onPress={() => handleMoveDay(day.id, 'down')}>
              <Text style={styles.moveButton}>↓</Text>
            </Pressable>
            <Pressable onPress={() => handleDeleteDay(day.id, day.name)}>
              <Text style={styles.deleteButton}>Eliminar</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {addingDay ? (
        <View style={styles.addDayForm}>
          <TextInput
            style={styles.input}
            placeholder="Ej: Día A, Empuje, Piernas..."
            value={newDayName}
            onChangeText={setNewDayName}
          />
          <View style={styles.switchRow}>
            <Text>Día de descanso</Text>
            <Switch value={newDayIsRest} onValueChange={setNewDayIsRest} />
          </View>
          <Pressable style={styles.button} onPress={handleAddDay}>
            <Text style={styles.buttonText}>Agregar día</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.newButton} onPress={() => setAddingDay(true)}>
          <Text style={styles.newButtonText}>+ Agregar día</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
  },
  dayRowMain: { flex: 1 },
  dayName: { fontSize: 16, fontWeight: '600' },
  dayActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  moveButton: { fontSize: 18, paddingHorizontal: 6 },
  deleteButton: { color: '#dc2626', fontWeight: '600' },
  addDayForm: { gap: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
});

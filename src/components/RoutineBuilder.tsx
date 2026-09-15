import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../hooks/useAuthSession';
import { useRoutine } from '../hooks/useRoutine';
import { useRoutineDays } from '../hooks/useRoutineDays';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { createRoutine, updateRoutine, createDay, moveDay, softDeleteDay } from '../lib/routines/mutations';
import { Routine } from '../lib/routines/types';
import { DayCard } from './DayCard';

interface RoutineBuilderProps {
  initialRoutineId?: string;
}

export function RoutineBuilder({ initialRoutineId }: RoutineBuilderProps) {
  const { session } = useAuthSession();
  const userId = session?.user.id;

  const [routineId, setRoutineId] = useState<string | undefined>(initialRoutineId);
  const { routine, isLoading: routineLoading, refetch: refetchRoutine } = useRoutine(routineId);
  const { days, refetch: refetchDays } = useRoutineDays(routineId);
  const { routines: allRoutines } = useRoutines(userId);

  const [name, setName] = useState('');
  const [usesTopSetBackoff, setUsesTopSetBackoff] = useState(false);
  const [suggestedDurationWeeks, setSuggestedDurationWeeks] = useState('');
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

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

  async function ensureRoutine(): Promise<string | null> {
    if (routineId) return routineId;
    if (!userId) return null;
    if (!name.trim()) {
      setNameError('Ponele un nombre a la rutina primero.');
      return null;
    }
    setNameError(null);
    const created = await createRoutine(supabase, userId, {
      name: name.trim(),
      usesTopSetBackoff,
      suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
      nextRoutineId,
    });
    setInitialized(true);
    setRoutineId(created.id);
    return created.id;
  }

  async function handleNameBlur() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Ponele un nombre a la rutina.');
      return;
    }
    setNameError(null);
    if (routineId) await updateRoutine(supabase, routineId, { name: trimmed });
  }

  async function handleToggleTopSet(value: boolean) {
    setUsesTopSetBackoff(value);
    if (routineId) await updateRoutine(supabase, routineId, { usesTopSetBackoff: value });
  }

  async function handleDurationBlur() {
    if (!routineId) return;
    await updateRoutine(supabase, routineId, {
      suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
    });
  }

  async function handleSelectNextRoutine(id: string) {
    const next = nextRoutineId === id ? null : id;
    setNextRoutineId(next);
    if (routineId) await updateRoutine(supabase, routineId, { nextRoutineId: next });
  }

  async function handleChanged() {
    await refetchRoutine();
    await refetchDays();
  }

  async function handleAddDay() {
    const id = await ensureRoutine();
    if (!id) return;
    await createDay(supabase, id, { name: `Día ${days.length + 1}`, isRestDay: false });
    await refetchDays();
  }

  async function handleMoveDay(dayId: string, direction: 'up' | 'down') {
    if (!routineId) return;
    await moveDay(supabase, routineId, dayId, direction);
    await refetchDays();
  }

  async function handleDeleteDay(dayId: string) {
    await softDeleteDay(supabase, dayId);
    await refetchDays();
  }

  function handleDone() {
    router.back();
  }

  if (initialRoutineId && (routineLoading || !routine)) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const weekdaySchedule = routine?.weekday_schedule ?? {};
  const pickableRoutines = allRoutines.filter((r: Routine) => r.id !== routineId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Nombre</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: Fuerza 5x5, Push/Pull/Legs..."
        value={name}
        onChangeText={setName}
        onBlur={handleNameBlur}
      />
      {nameError && <Text style={styles.error}>{nameError}</Text>}

      <View style={styles.switchRow}>
        <Text>Usa top set / back-off</Text>
        <Switch value={usesTopSetBackoff} onValueChange={handleToggleTopSet} />
      </View>

      <Text style={styles.label}>Duración sugerida (semanas, opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: 8"
        keyboardType="number-pad"
        value={suggestedDurationWeeks}
        onChangeText={setSuggestedDurationWeeks}
        onBlur={handleDurationBlur}
      />

      {pickableRoutines.length > 0 && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Rutina siguiente (opcional)</Text>
          {pickableRoutines.map((r: Routine) => (
            <Pressable
              key={r.id}
              style={[styles.pickerRow, nextRoutineId === r.id && styles.pickerRowSelected]}
              onPress={() => handleSelectNextRoutine(r.id)}
            >
              <Text>{r.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Días</Text>
      {days.map((day, index) => (
        <DayCard
          key={day.id}
          day={day}
          routineId={routineId as string}
          weekdaySchedule={weekdaySchedule}
          index={index}
          totalDays={days.length}
          onChanged={handleChanged}
          onMove={handleMoveDay}
          onDelete={handleDeleteDay}
        />
      ))}

      <Pressable style={styles.newButton} onPress={handleAddDay}>
        <Text style={styles.newButtonText}>+ Nuevo día</Text>
      </Pressable>

      <Pressable style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.doneButtonText}>Listo</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  label: { fontWeight: '600', marginTop: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  error: { color: '#dc2626' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
  doneButton: { backgroundColor: '#16a34a', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  doneButtonText: { color: '#fff', fontWeight: '700' },
});

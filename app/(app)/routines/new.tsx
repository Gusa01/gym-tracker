import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { createRoutine, createDay, setDayWeekdays } from '../../../src/lib/routines/mutations';
import { Routine, RoutineDay, Weekday } from '../../../src/lib/routines/types';
import { DayExercisesSection } from '../../../src/components/DayExercisesSection';
import { WeekdayPicker } from '../../../src/components/WeekdayPicker';

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Lun',
  tue: 'Mar',
  wed: 'Mié',
  thu: 'Jue',
  fri: 'Vie',
  sat: 'Sáb',
  sun: 'Dom',
};

export default function NewRoutine() {
  const { session } = useAuthSession();
  const userId = session?.user.id;
  const { routines } = useRoutines(userId);

  const [name, setName] = useState('');
  const [usesTopSetBackoff, setUsesTopSetBackoff] = useState(false);
  const [suggestedDurationWeeks, setSuggestedDurationWeeks] = useState('');
  const [nextRoutineId, setNextRoutineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [createdRoutine, setCreatedRoutine] = useState<Routine | null>(null);
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [dayWeekdays, setDayWeekdaysState] = useState<Record<string, Weekday[]>>({});
  const [newDayName, setNewDayName] = useState('');
  const [newDayIsRest, setNewDayIsRest] = useState(false);
  const [newDayWeekdays, setNewDayWeekdays] = useState<Weekday[]>([]);
  const [addingDay, setAddingDay] = useState(false);

  async function handleCreateRoutine() {
    if (!userId) return;
    if (!name.trim()) {
      setError('Ponele un nombre a la rutina.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const routine = await createRoutine(supabase, userId, {
        name: name.trim(),
        usesTopSetBackoff,
        suggestedDurationWeeks: suggestedDurationWeeks ? Number(suggestedDurationWeeks) : null,
        nextRoutineId,
      });
      setCreatedRoutine(routine);
      setAddingDay(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la rutina.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDay() {
    if (!createdRoutine || !newDayName.trim()) return;
    try {
      const day = await createDay(supabase, createdRoutine.id, {
        name: newDayName.trim(),
        isRestDay: newDayIsRest,
      });
      if (!newDayIsRest && newDayWeekdays.length > 0) {
        await setDayWeekdays(supabase, createdRoutine.id, day.id, newDayWeekdays);
        setDayWeekdaysState((prev) => ({ ...prev, [day.id]: newDayWeekdays }));
      }
      setDays((prev) => [...prev, day]);
      setNewDayName('');
      setNewDayIsRest(false);
      setNewDayWeekdays([]);
      setAddingDay(false);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo agregar el día.');
    }
  }

  function handleFinish() {
    if (!createdRoutine) return;
    router.replace(`/(app)/routines/${createdRoutine.id}` as any);
  }

  if (createdRoutine) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{createdRoutine.name}</Text>
        <Text style={styles.stepHint}>Agregá los días de esta rutina, uno por uno.</Text>

        {days.map((day) => (
          <View key={day.id} style={styles.dayBlock}>
            <Text style={styles.dayName}>
              {day.name}
              {day.is_rest_day ? ' (descanso)' : ''}
            </Text>
            {(dayWeekdays[day.id]?.length ?? 0) > 0 && (
              <Text style={styles.weekdaySummary}>
                {dayWeekdays[day.id].map((d) => WEEKDAY_LABELS[d]).join(', ')}
              </Text>
            )}
            {!day.is_rest_day && <DayExercisesSection dayId={day.id} />}
          </View>
        ))}

        {addingDay ? (
          <View style={styles.addDayForm}>
            <Text style={styles.label}>Nombre del día</Text>
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
            {!newDayIsRest && (
              <View>
                <Text style={styles.label}>Días de la semana (opcional)</Text>
                <WeekdayPicker selected={newDayWeekdays} onChange={setNewDayWeekdays} />
              </View>
            )}
            <Pressable style={styles.button} onPress={handleAddDay}>
              <Text style={styles.buttonText}>Agregar día</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.newButton} onPress={() => setAddingDay(true)}>
            <Text style={styles.newButtonText}>+ Agregar otro día</Text>
          </Pressable>
        )}

        <Pressable style={styles.finishButton} onPress={handleFinish}>
          <Text style={styles.finishButtonText}>Terminar</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nueva rutina</Text>
      <Text style={styles.stepHint}>Paso 1 de 2: datos generales de la rutina.</Text>
      <Text style={styles.label}>Nombre</Text>
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

      <Text style={styles.label}>Duración sugerida (semanas, opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: 8"
        keyboardType="number-pad"
        value={suggestedDurationWeeks}
        onChangeText={setSuggestedDurationWeeks}
      />

      {routines.length > 0 && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Rutina siguiente (opcional)</Text>
          {routines.map((r: Routine) => (
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

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={handleCreateRoutine} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Creando...' : 'Continuar'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  stepHint: { color: '#666', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  label: { fontWeight: '600', marginTop: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  dayBlock: { gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  dayName: { fontSize: 16, fontWeight: '600' },
  weekdaySummary: { color: '#666', fontSize: 12 },
  addDayForm: { gap: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
  finishButton: { backgroundColor: '#16a34a', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  finishButtonText: { color: '#fff', fontWeight: '700' },
});

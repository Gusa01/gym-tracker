import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRoutineDay } from '../../../../../src/hooks/useRoutineDay';
import { useRoutine } from '../../../../../src/hooks/useRoutine';
import { supabase } from '../../../../../src/lib/supabase';
import { updateDay, setDayWeekdays } from '../../../../../src/lib/routines/mutations';
import { DayExercisesSection } from '../../../../../src/components/DayExercisesSection';
import { WeekdayPicker } from '../../../../../src/components/WeekdayPicker';
import { Weekday } from '../../../../../src/lib/routines/types';

const ALL_WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export default function DayEditor() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { day, isLoading: dayLoading, error: dayError, refetch: refetchDay } = useRoutineDay(dayId);
  const { routine, refetch: refetchRoutine } = useRoutine(day?.routine_id);

  const [name, setName] = useState('');
  const [isRestDay, setIsRestDay] = useState(false);
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (day && routine && !initialized) {
      setName(day.name);
      setIsRestDay(day.is_rest_day);
      setWeekdays(ALL_WEEKDAYS.filter((w) => routine.weekday_schedule[w] === day.id));
      setInitialized(true);
    }
  }, [day, routine, initialized]);

  async function handleSave() {
    if (!dayId || !day) return;
    setSaving(true);
    try {
      await updateDay(supabase, dayId, { name: name.trim(), isRestDay });
      await setDayWeekdays(supabase, day.routine_id, dayId, isRestDay ? [] : weekdays);
      await refetchDay();
      await refetchRoutine();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  if (dayError) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{dayError}</Text>
      </View>
    );
  }

  if (dayLoading || !day || !routine) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Nombre del día</Text>
      <TextInput
        style={styles.input}
        placeholder="Ej: Día A, Empuje, Piernas..."
        value={name}
        onChangeText={setName}
      />
      <View style={styles.switchRow}>
        <Text>Día de descanso</Text>
        <Switch value={isRestDay} onValueChange={setIsRestDay} />
      </View>
      {!isRestDay && (
        <View>
          <Text style={styles.label}>Días de la semana (opcional)</Text>
          <WeekdayPicker selected={weekdays} onChange={setWeekdays} />
        </View>
      )}
      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
      </Pressable>

      {!day.is_rest_day && dayId && <DayExercisesSection dayId={dayId} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  label: { fontWeight: '600', marginTop: 4 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});

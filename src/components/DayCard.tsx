import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { updateDay, setDayWeekdays } from '../lib/routines/mutations';
import { RoutineDay, Weekday } from '../lib/routines/types';
import { WeekdayPicker } from './WeekdayPicker';
import { DayExercisesSection } from './DayExercisesSection';

const ALL_WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface DayCardProps {
  day: RoutineDay;
  routineId: string;
  weekdaySchedule: Record<string, unknown>;
  index: number;
  totalDays: number;
  onChanged: () => void;
  onMove: (dayId: string, direction: 'up' | 'down') => void;
  onDelete: (dayId: string) => void;
}

export function DayCard({ day, routineId, weekdaySchedule, index, totalDays, onChanged, onMove, onDelete }: DayCardProps) {
  const [name, setName] = useState(day.name);
  const [isRestDay, setIsRestDay] = useState(day.is_rest_day);
  const [weekdays, setWeekdays] = useState<Weekday[]>(
    ALL_WEEKDAYS.filter((w) => weekdaySchedule[w] === day.id)
  );

  async function handleNameBlur() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(day.name);
      return;
    }
    if (trimmed === day.name) return;
    await updateDay(supabase, day.id, { name: trimmed });
    onChanged();
  }

  async function handleToggleRest(value: boolean) {
    setIsRestDay(value);
    await updateDay(supabase, day.id, { isRestDay: value });
    if (value && weekdays.length > 0) {
      setWeekdays([]);
      await setDayWeekdays(supabase, routineId, day.id, []);
    }
    onChanged();
  }

  async function handleWeekdaysChange(next: Weekday[]) {
    setWeekdays(next);
    await setDayWeekdays(supabase, routineId, day.id, next);
    onChanged();
  }

  function handleDeletePress() {
    Alert.alert('Eliminar día', `¿Eliminar "${day.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => onDelete(day.id) },
    ]);
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <TextInput
          style={styles.dayNameInput}
          placeholder="Ej: Día A, Empuje, Piernas..."
          value={name}
          onChangeText={setName}
          onBlur={handleNameBlur}
        />
        <View style={styles.headerActions}>
          <Pressable disabled={index === 0} onPress={() => onMove(day.id, 'up')}>
            <Text style={styles.moveButton}>↑</Text>
          </Pressable>
          <Pressable disabled={index === totalDays - 1} onPress={() => onMove(day.id, 'down')}>
            <Text style={styles.moveButton}>↓</Text>
          </Pressable>
          <Pressable onPress={handleDeletePress}>
            <Text style={styles.deleteButton}>Eliminar</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.switchRow}>
        <Text>Día de descanso</Text>
        <Switch value={isRestDay} onValueChange={handleToggleRest} />
      </View>

      {!isRestDay && (
        <>
          <Text style={styles.label}>Días de la semana (opcional)</Text>
          <WeekdayPicker selected={weekdays} onChange={handleWeekdaysChange} />
          <DayExercisesSection dayId={day.id} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayNameInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  moveButton: { fontSize: 18, paddingHorizontal: 6 },
  deleteButton: { color: '#dc2626', fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: '600', marginTop: 4 },
});

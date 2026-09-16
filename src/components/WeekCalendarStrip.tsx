import { View, Text, StyleSheet } from 'react-native';
import { WeekCalendarDay } from '../lib/home/weekCalendar';

interface WeekCalendarStripProps {
  days: WeekCalendarDay[];
}

export function WeekCalendarStrip({ days }: WeekCalendarStripProps) {
  return (
    <View style={styles.row}>
      {days.map((day) => (
        <View key={day.weekday} style={[styles.cell, day.isToday && styles.cellToday]}>
          <Text style={[styles.label, day.isToday && styles.labelToday]}>{day.label}</Text>
          <Text style={[styles.dayName, day.isToday && styles.labelToday]} numberOfLines={2}>
            {day.isRestDay ? 'Descanso' : day.dayName}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  cell: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 4,
    minHeight: 60,
  },
  cellToday: { backgroundColor: '#111', borderColor: '#111' },
  label: { fontSize: 12, fontWeight: '700', color: '#111' },
  labelToday: { color: '#fff' },
  dayName: { fontSize: 10, color: '#666', textAlign: 'center' },
});

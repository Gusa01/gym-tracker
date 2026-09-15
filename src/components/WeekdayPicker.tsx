import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Weekday } from '../lib/routines/types';

interface WeekdayPickerProps {
  selected: Weekday[];
  onChange: (weekdays: Weekday[]) => void;
}

const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: 'mon', label: 'L' },
  { key: 'tue', label: 'M' },
  { key: 'wed', label: 'X' },
  { key: 'thu', label: 'J' },
  { key: 'fri', label: 'V' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'D' },
];

export function WeekdayPicker({ selected, onChange }: WeekdayPickerProps) {
  function toggle(day: Weekday) {
    onChange(selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day]);
  }

  return (
    <View style={styles.row}>
      {WEEKDAYS.map(({ key, label }) => {
        const isSelected = selected.includes(key);
        return (
          <Pressable key={key} style={[styles.chip, isSelected && styles.chipSelected]} onPress={() => toggle(key)}>
            <Text style={isSelected ? styles.chipTextSelected : styles.chipText}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  chip: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#111', fontWeight: '600' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
});

import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

interface WeightStepperProps {
  value: string;
  onChange: (value: string) => void;
}

const STEPS = [5, 2.5, 1.25];

export function WeightStepper({ value, onChange }: WeightStepperProps) {
  function bump(delta: number) {
    const current = value === '' ? 0 : Number(value);
    if (Number.isNaN(current)) return;
    const next = Math.max(0, current + delta);
    onChange(String(next));
  }

  return (
    <View style={styles.row}>
      {[...STEPS].reverse().map((step) => (
        <Pressable key={`minus-${step}`} style={styles.button} onPress={() => bump(-step)}>
          <Text style={styles.buttonText}>-{step}</Text>
        </Pressable>
      ))}
      <TextInput style={styles.input} keyboardType="numeric" value={value} onChangeText={onChange} />
      {STEPS.map((step) => (
        <Pressable key={`plus-${step}`} style={styles.button} onPress={() => bump(step)}>
          <Text style={styles.buttonText}>+{step}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  button: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
  },
  buttonText: { fontSize: 12, fontWeight: '600' },
  input: {
    width: 60,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    textAlign: 'center',
  },
});

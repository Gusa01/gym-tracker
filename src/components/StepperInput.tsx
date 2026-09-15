import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

interface StepperInputProps {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function StepperInput({ value, onChange, min = 0, max = 99, step = 1 }: StepperInputProps) {
  function bump(delta: number) {
    const current = value === '' ? 0 : Number(value);
    if (Number.isNaN(current)) return;
    const next = Math.min(max, Math.max(min, current + delta));
    onChange(String(next));
  }

  return (
    <View style={styles.row}>
      <Pressable style={styles.button} onPress={() => bump(-step)}>
        <Text style={styles.buttonText}>−</Text>
      </Pressable>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={value}
        onChangeText={onChange}
      />
      <Pressable style={styles.button} onPress={() => bump(step)}>
        <Text style={styles.buttonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 20, fontWeight: '600' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    textAlign: 'center',
  },
});

import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRoutineDay } from '../../../../../src/hooks/useRoutineDay';
import { supabase } from '../../../../../src/lib/supabase';
import { updateDay } from '../../../../../src/lib/routines/mutations';
import { DayExercisesSection } from '../../../../../src/components/DayExercisesSection';

export default function DayEditor() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { day, isLoading: dayLoading, error: dayError, refetch: refetchDay } = useRoutineDay(dayId);

  const [name, setName] = useState('');
  const [isRestDay, setIsRestDay] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (day && !initialized) {
      setName(day.name);
      setIsRestDay(day.is_rest_day);
      setInitialized(true);
    }
  }, [day, initialized]);

  async function handleSave() {
    if (!dayId) return;
    setSaving(true);
    try {
      await updateDay(supabase, dayId, { name: name.trim(), isRestDay });
      await refetchDay();
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

  if (dayLoading || !day) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});

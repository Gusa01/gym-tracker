import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuthSession } from '../../../src/hooks/useAuthSession';
import { useRoutines } from '../../../src/hooks/useRoutines';
import { supabase } from '../../../src/lib/supabase';
import { createRoutine } from '../../../src/lib/routines/mutations';
import { Routine } from '../../../src/lib/routines/types';

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

  async function handleCreate() {
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
      router.replace(`/(app)/routines/${routine.id}` as any);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la rutina.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nueva rutina</Text>
      <TextInput style={styles.input} placeholder="Nombre" value={name} onChangeText={setName} />

      <View style={styles.switchRow}>
        <Text>Usa top set / back-off</Text>
        <Switch value={usesTopSetBackoff} onValueChange={setUsesTopSetBackoff} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Duración sugerida (semanas, opcional)"
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

      <Pressable style={styles.button} onPress={handleCreate} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Creando...' : 'Crear rutina'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerSection: { gap: 6 },
  pickerLabel: { fontWeight: '600' },
  pickerRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 10 },
  pickerRowSelected: { borderColor: '#111', backgroundColor: '#f0f0f0' },
  error: { color: '#dc2626' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
});

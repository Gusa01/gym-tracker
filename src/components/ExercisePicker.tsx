import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { useExercises } from '../hooks/useExercises';
import { supabase } from '../lib/supabase';
import { createRoutineExercise, findOrCreateExercise } from '../lib/routines/mutations';
import { Exercise } from '../lib/routines/types';

interface ExercisePickerProps {
  dayId: string;
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}

const DEFAULTS = {
  role: 'accessory' as const,
  schemeType: 'normal' as const,
  repUnit: 'reps' as const,
  sets: 3,
  repMin: 8,
  repMax: 12,
  rirMin: null,
  rirMax: null,
  topSetReps: null,
  backoffSets: null,
  backoffRepMin: null,
  backoffRepMax: null,
};

export function ExercisePicker({ dayId, onDone, onCancel }: ExercisePickerProps) {
  const { exercises: catalog, refetch: refetchCatalog } = useExercises();
  const [extraCatalog, setExtraCatalog] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [browseFilter, setBrowseFilter] = useState<'upper' | 'lower' | 'core' | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [newName, setNewName] = useState('');
  const [newMuscleGroup, setNewMuscleGroup] = useState<'upper' | 'lower' | 'core'>('upper');
  const [addingCustom, setAddingCustom] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allExercises = [...extraCatalog, ...catalog.filter((e) => !extraCatalog.some((x) => x.id === e.id))];
  const query = search.trim().toLowerCase();
  const visible = allExercises
    .filter((e) => !browseFilter || e.muscle_group === browseFilter)
    .filter((e) => !query || e.name.toLowerCase().includes(query));

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleAddCustom() {
    if (!newName.trim()) return;
    try {
      const exercise = await findOrCreateExercise(supabase, newName.trim(), newMuscleGroup);
      setExtraCatalog((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]));
      setSelectedIds((prev) => (prev.includes(exercise.id) ? prev : [...prev, exercise.id]));
      setNewName('');
      setAddingCustom(false);
      refetchCatalog();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo crear el ejercicio.');
    }
  }

  async function handleConfirm() {
    if (selectedIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const exerciseId of selectedIds) {
        await createRoutineExercise(supabase, dayId, { exerciseId, ...DEFAULTS });
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron agregar los ejercicios.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Elegir ejercicios</Text>
      <TextInput
        style={styles.input}
        placeholder="Buscar por nombre..."
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.segmented}>
        {(['upper', 'lower', 'core'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.segment, browseFilter === option && styles.segmentSelected]}
            onPress={() => setBrowseFilter(browseFilter === option ? null : option)}
          >
            <Text style={browseFilter === option ? styles.segmentTextSelected : styles.segmentText}>{option}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.list}>
        {visible.map((exercise) => {
          const checked = selectedIds.includes(exercise.id);
          return (
            <Pressable key={exercise.id} style={styles.row} onPress={() => toggle(exercise.id)}>
              <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                {checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.rowName}>{exercise.name}</Text>
              <Text style={styles.rowMeta}>{exercise.muscle_group}</Text>
            </Pressable>
          );
        })}
        {visible.length === 0 && <Text style={styles.hint}>Sin resultados.</Text>}
      </ScrollView>

      {addingCustom ? (
        <View style={styles.customForm}>
          <TextInput
            style={styles.input}
            placeholder="Nombre del ejercicio nuevo"
            value={newName}
            onChangeText={setNewName}
          />
          <View style={styles.segmented}>
            {(['upper', 'lower', 'core'] as const).map((option) => (
              <Pressable
                key={option}
                style={[styles.segment, newMuscleGroup === option && styles.segmentSelected]}
                onPress={() => setNewMuscleGroup(option)}
              >
                <Text style={newMuscleGroup === option ? styles.segmentTextSelected : styles.segmentText}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.newButton} onPress={handleAddCustom}>
            <Text style={styles.newButtonText}>+ Agregar a la lista</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.newButton} onPress={() => setAddingCustom(true)}>
          <Text style={styles.newButtonText}>+ No está en la lista, crear nuevo</Text>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={handleConfirm} disabled={saving || selectedIds.length === 0}>
          <Text style={styles.buttonText}>
            {saving ? 'Agregando...' : `Agregar ${selectedIds.length || ''} ejercicio${selectedIds.length === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  title: { fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  segmented: { flexDirection: 'row', gap: 6 },
  segment: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  segmentSelected: { backgroundColor: '#111', borderColor: '#111' },
  segmentText: { color: '#111' },
  segmentTextSelected: { color: '#fff' },
  list: { maxHeight: 260, borderWidth: 1, borderColor: '#eee', borderRadius: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#111', borderColor: '#111' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowName: { flex: 1, fontSize: 15 },
  rowMeta: { color: '#666', fontSize: 12 },
  hint: { color: '#666', fontSize: 12, fontStyle: 'italic', padding: 10 },
  customForm: { gap: 8 },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 12, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
  error: { color: '#dc2626' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelButtonText: { color: '#111', fontWeight: '600' },
});

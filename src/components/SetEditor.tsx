import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, Alert } from 'react-native';
import { RoutineExerciseRepUnit } from '../lib/routines/types';
import { LoggedSet } from '../lib/sessions/types';
import { SetCorrection, SetEditValues } from '../lib/history/types';
import { editFromValues, validateSetEdit } from '../lib/history/logic';
import { formatSetLabel } from '../lib/history/format';
import { WeightStepper } from './WeightStepper';
import { StepperInput } from './StepperInput';

const RIR_OPTIONS = [0, 1, 2, 3, 4];

interface SetEditorProps {
  set: LoggedSet | null;
  exercise: { exercise_name: string; rep_unit: RoutineExerciseRepUnit; rir_min: number | null } | null;
  onSave: (change: SetCorrection) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

function valuesFrom(set: LoggedSet): SetEditValues {
  return { weight: String(set.weight), reps: String(set.reps), rir: set.rir };
}

export function SetEditor({ set, exercise, onSave, onDelete, onClose }: SetEditorProps) {
  const [values, setValues] = useState<SetEditValues>({ weight: '', reps: '', rir: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (set) setValues(valuesFrom(set));
  }, [set]);

  if (!set || !exercise) return null;

  const timeBased = exercise.rep_unit === 'seconds';
  const showRir = exercise.rir_min !== null;
  const problem = validateSetEdit(values, exercise);

  async function handleSave() {
    if (!set || !exercise || problem) return;
    setSaving(true);
    try {
      await onSave(editFromValues(values, exercise, set));
    } catch {
      Alert.alert('Error', 'No se pudo guardar la corrección. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert('Borrar serie', '¿Borrar esta serie?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await onDelete();
          } catch {
            Alert.alert('Error', 'No se pudo guardar la corrección. Probá de nuevo.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>{exercise.exercise_name}</Text>
        <Text style={styles.subtitle}>{formatSetLabel(set)}</Text>

        {!timeBased && (
          <>
            <Text style={styles.label}>Peso (kg)</Text>
            <WeightStepper value={values.weight} onChange={(weight) => setValues((v) => ({ ...v, weight }))} />
          </>
        )}

        <Text style={styles.label}>{timeBased ? 'Segundos' : 'Reps'}</Text>
        <StepperInput
          value={values.reps}
          onChange={(reps) => setValues((v) => ({ ...v, reps }))}
          min={0}
          max={200}
          step={timeBased ? 5 : 1}
        />

        {showRir && (
          <>
            <Text style={styles.label}>RIR</Text>
            <View style={styles.rirRow}>
              {RIR_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.rirOption, values.rir === option && styles.rirOptionSelected]}
                  onPress={() => setValues((v) => ({ ...v, rir: option }))}
                >
                  <Text style={values.rir === option ? styles.rirTextSelected : styles.rirText}>{option}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {problem && <Text style={styles.problem}>{problem}</Text>}

        <Pressable
          style={[styles.saveButton, (problem !== null || saving) && styles.disabled]}
          disabled={problem !== null || saving}
          onPress={handleSave}
        >
          <Text style={styles.saveText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable style={[styles.deleteButton, saving && styles.disabled]} disabled={saving} onPress={handleDelete}>
            <Text style={styles.deleteText}>Borrar serie</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} disabled={saving} onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { color: '#666' },
  label: { fontWeight: '600', marginTop: 4 },
  rirRow: { flexDirection: 'row', gap: 6 },
  rirOption: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rirOptionSelected: { backgroundColor: '#111', borderColor: '#111' },
  rirText: { color: '#111' },
  rirTextSelected: { color: '#fff' },
  problem: { color: '#dc2626' },
  saveButton: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  saveText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  secondaryRow: { flexDirection: 'row', gap: 8 },
  deleteButton: { flex: 1, borderWidth: 1, borderColor: '#dc2626', borderRadius: 8, padding: 12, alignItems: 'center' },
  deleteText: { color: '#dc2626', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelText: { color: '#111', fontWeight: '600' },
});

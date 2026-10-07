import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CachedRoutineExercise } from '../lib/sqlite/cache';
import { LoggedSet, SetType } from '../lib/sessions/types';
import { buildPrescribedSets, formatTargetScheme } from '../lib/sessions/prescribedSets';
import { WeightStepper } from './WeightStepper';
import { StepperInput } from './StepperInput';
import { SetEditor } from './SetEditor';
import { SetCorrection } from '../lib/history/types';

interface SessionExerciseCardProps {
  exercise: CachedRoutineExercise;
  initialWeight: number | null;
  loggedSets: LoggedSet[];
  onLogSet: (setIndex: number, setType: SetType, weight: number, reps: number, rir: number | null) => Promise<void>;
  onCorrectSet: (setId: string, change: SetCorrection) => Promise<void>;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

const SET_TYPE_LABELS: Record<SetType, string> = {
  top_set: 'Top set',
  back_off: 'Back-off',
  working: 'Serie de trabajo',
  warmup: 'Entrada en calor',
};

export function SessionExerciseCard({ exercise, initialWeight, loggedSets, onLogSet, onCorrectSet }: SessionExerciseCardProps) {
  const [weight, setWeight] = useState(initialWeight !== null ? String(initialWeight) : '0');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState<number | null>(exercise.rir_min !== null ? exercise.rir_min : null);
  const [saving, setSaving] = useState(false);
  const [editingSet, setEditingSet] = useState<LoggedSet | null>(null);

  const prescribed = buildPrescribedSets(exercise);
  const showRir = exercise.rir_min !== null;
  const unitLabel = exercise.rep_unit === 'seconds' ? 'Segundos' : 'Reps';

  const loggedByIndex = new Map(
    loggedSets.filter((s) => s.routine_exercise_id === exercise.id).map((s) => [s.set_index, s])
  );
  const nextSet = prescribed.find((set) => !loggedByIndex.has(set.setIndex));

  async function handleLogNext() {
    if (!nextSet || !weight || !reps) return;
    setSaving(true);
    try {
      await onLogSet(nextSet.setIndex, nextSet.setType, Number(weight), Number(reps), showRir ? rir : null);
      // Reps/weight/RIR usually repeat across sets of the same exercise — leave them as-is
      // so the next set is a single tap to confirm instead of retyping the same values.
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{exercise.exercise_name}</Text>
      <Text style={styles.target}>{formatTargetScheme(exercise)}</Text>

      {prescribed.map((set) => {
        const logged = loggedByIndex.get(set.setIndex);
        if (!logged) return null;
        return (
          <View key={set.setIndex} style={styles.loggedRow}>
            <Text style={[styles.loggedText, styles.loggedTextFlex]}>
              ✓ Serie {set.setIndex} ({SET_TYPE_LABELS[set.setType]}): {logged.weight}kg × {logged.reps}
              {exercise.rep_unit === 'seconds' ? 's' : ' reps'}
              {logged.rir !== null ? ` · RIR ${logged.rir}` : ''}
            </Text>
            <Pressable onPress={() => setEditingSet(logged)} hitSlop={8} accessibilityLabel="Corregir serie">
              <Text style={styles.editIcon}>✎</Text>
            </Pressable>
          </View>
        );
      })}

      {nextSet ? (
        <>
          <Text style={styles.activeSetTitle}>
            Serie {nextSet.setIndex} de {prescribed.length} — {SET_TYPE_LABELS[nextSet.setType]}
          </Text>

          <Text style={styles.label}>Peso (kg)</Text>
          <WeightStepper value={weight} onChange={setWeight} />

          <Text style={styles.label}>{unitLabel}</Text>
          <StepperInput
            value={reps}
            onChange={setReps}
            min={0}
            max={200}
            step={exercise.rep_unit === 'seconds' ? 5 : 1}
          />

          {showRir && (
            <>
              <Text style={styles.label}>RIR</Text>
              <View style={styles.rirRow}>
                {RIR_OPTIONS.map((option) => (
                  <Pressable
                    key={option}
                    style={[styles.rirOption, rir === option && styles.rirOptionSelected]}
                    onPress={() => setRir(option)}
                  >
                    <Text style={rir === option ? styles.rirTextSelected : styles.rirText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Pressable
            style={[styles.saveButton, (!weight || !reps || saving) && styles.saveButtonDisabled]}
            disabled={!weight || !reps || saving}
            onPress={handleLogNext}
          >
            <Text style={styles.saveButtonText}>
              {saving ? 'Guardando...' : `Guardar serie ${nextSet.setIndex}`}
            </Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.doneText}>✓ Ejercicio completo</Text>
      )}

      <SetEditor
        set={editingSet}
        exercise={exercise}
        onClose={() => setEditingSet(null)}
        onSave={async (change) => {
          if (!editingSet) return;
          await onCorrectSet(editingSet.id, change);
          setEditingSet(null);
        }}
        onDelete={async () => {
          if (!editingSet) return;
          await onCorrectSet(editingSet.id, { kind: 'delete' });
          setEditingSet(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  target: { color: '#666' },
  label: { fontWeight: '600', marginTop: 4 },
  activeSetTitle: { fontWeight: '700', fontSize: 15, marginTop: 4 },
  rirRow: { flexDirection: 'row', gap: 6 },
  rirOption: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rirOptionSelected: { backgroundColor: '#111', borderColor: '#111' },
  rirText: { color: '#111' },
  rirTextSelected: { color: '#fff' },
  loggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
  },
  loggedText: { color: '#166534' },
  loggedTextFlex: { flex: 1 },
  editIcon: { fontSize: 18, color: '#166534', paddingHorizontal: 4 },
  saveButton: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 4 },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: '#fff', fontWeight: '700' },
  doneText: { color: '#16a34a', fontWeight: '700', marginTop: 4 },
});

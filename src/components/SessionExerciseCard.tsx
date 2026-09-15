import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CachedRoutineExercise } from '../lib/sqlite/cache';
import { LoggedSet, SetType } from '../lib/sessions/types';
import { buildPrescribedSets, formatTargetScheme } from '../lib/sessions/prescribedSets';
import { WeightStepper } from './WeightStepper';
import { StepperInput } from './StepperInput';

interface SessionExerciseCardProps {
  exercise: CachedRoutineExercise;
  initialWeight: number | null;
  loggedSets: LoggedSet[];
  onLogSet: (setIndex: number, setType: SetType, weight: number, reps: number, rir: number | null) => Promise<void>;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

const SET_TYPE_LABELS: Record<SetType, string> = {
  top_set: 'Top set',
  back_off: 'Back-off',
  working: 'Serie de trabajo',
  warmup: 'Entrada en calor',
};

export function SessionExerciseCard({ exercise, initialWeight, loggedSets, onLogSet }: SessionExerciseCardProps) {
  const [weight, setWeight] = useState(initialWeight !== null ? String(initialWeight) : '');
  const [reps, setReps] = useState('');
  const [rir, setRir] = useState<number | null>(exercise.rir_min !== null ? exercise.rir_min : null);
  const [saving, setSaving] = useState(false);

  const prescribed = buildPrescribedSets(exercise);
  const showRir = exercise.rir_min !== null;

  async function handleLog(setIndex: number, setType: SetType) {
    if (!weight || !reps) return;
    setSaving(true);
    try {
      await onLogSet(setIndex, setType, Number(weight), Number(reps), showRir ? rir : null);
      setReps('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{exercise.exercise_name}</Text>
      <Text style={styles.target}>{formatTargetScheme(exercise)}</Text>

      <Text style={styles.label}>Peso (kg)</Text>
      <WeightStepper value={weight} onChange={setWeight} />

      <Text style={styles.label}>{exercise.rep_unit === 'seconds' ? 'Segundos' : 'Reps'}</Text>
      <StepperInput value={reps} onChange={setReps} min={0} max={200} step={exercise.rep_unit === 'seconds' ? 5 : 1} />

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

      {prescribed.map((set) => {
        const done = loggedSets.some(
          (logged) => logged.routine_exercise_id === exercise.id && logged.set_index === set.setIndex
        );
        return (
          <Pressable
            key={set.setIndex}
            style={[styles.setRow, done && styles.setRowDone]}
            disabled={done || saving}
            onPress={() => handleLog(set.setIndex, set.setType)}
          >
            <Text>
              {done ? '✓ ' : ''}Serie {set.setIndex} ({SET_TYPE_LABELS[set.setType]})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  target: { color: '#666' },
  label: { fontWeight: '600', marginTop: 4 },
  rirRow: { flexDirection: 'row', gap: 6 },
  rirOption: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12 },
  rirOptionSelected: { backgroundColor: '#111', borderColor: '#111' },
  rirText: { color: '#111' },
  rirTextSelected: { color: '#fff' },
  setRow: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  setRowDone: { backgroundColor: '#f0fdf4', borderColor: '#16a34a' },
});

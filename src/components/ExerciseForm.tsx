import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from 'react-native';
import {
  Exercise,
  RoutineExerciseRole,
  RoutineExerciseSchemeType,
  RoutineExerciseRepUnit,
  RoutineExerciseWithName,
} from '../lib/routines/types';

export interface ExerciseFormValues {
  exerciseName: string;
  muscleGroup: 'upper' | 'lower' | 'core';
  role: RoutineExerciseRole;
  schemeType: RoutineExerciseSchemeType;
  repUnit: RoutineExerciseRepUnit;
  sets: string;
  repMin: string;
  repMax: string;
  rirMin: string;
  rirMax: string;
  topSetReps: string;
  backoffSets: string;
  backoffRepMin: string;
  backoffRepMax: string;
}

interface ExerciseFormProps {
  exercises: Exercise[];
  initial?: RoutineExerciseWithName;
  onSubmit: (values: ExerciseFormValues) => Promise<void>;
  onCancel: () => void;
}

function initialValues(initial?: RoutineExerciseWithName): ExerciseFormValues {
  if (!initial) {
    return {
      exerciseName: '',
      muscleGroup: 'upper',
      role: 'accessory',
      schemeType: 'normal',
      repUnit: 'reps',
      sets: '',
      repMin: '',
      repMax: '',
      rirMin: '',
      rirMax: '',
      topSetReps: '',
      backoffSets: '',
      backoffRepMin: '',
      backoffRepMax: '',
    };
  }
  return {
    exerciseName: initial.exercise_name,
    muscleGroup: 'upper',
    role: initial.role,
    schemeType: initial.scheme_type,
    repUnit: initial.rep_unit,
    sets: initial.sets !== null ? String(initial.sets) : '',
    repMin: initial.rep_min !== null ? String(initial.rep_min) : '',
    repMax: initial.rep_max !== null ? String(initial.rep_max) : '',
    rirMin: initial.rir_min !== null ? String(initial.rir_min) : '',
    rirMax: initial.rir_max !== null ? String(initial.rir_max) : '',
    topSetReps: initial.top_set_reps !== null ? String(initial.top_set_reps) : '',
    backoffSets: initial.backoff_sets !== null ? String(initial.backoff_sets) : '',
    backoffRepMin: initial.backoff_rep_min !== null ? String(initial.backoff_rep_min) : '',
    backoffRepMax: initial.backoff_rep_max !== null ? String(initial.backoff_rep_max) : '',
  };
}

export function ExerciseForm({ exercises, initial, onSubmit, onCancel }: ExerciseFormProps) {
  const [values, setValues] = useState<ExerciseFormValues>(initialValues(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [browseFilter, setBrowseFilter] = useState<'upper' | 'lower' | 'core' | null>(null);

  const typedName = values.exerciseName.trim().toLowerCase();
  const suggestions =
    typedName.length > 0 || browseFilter
      ? exercises
          .filter((e) => !browseFilter || e.muscle_group === browseFilter)
          .filter((e) => !typedName || e.name.toLowerCase().includes(typedName))
          .slice(0, browseFilter ? 20 : 5)
      : [];

  function selectSuggestion(exercise: Exercise) {
    update('exerciseName', exercise.name);
    if (exercise.muscle_group === 'upper' || exercise.muscle_group === 'lower' || exercise.muscle_group === 'core') {
      update('muscleGroup', exercise.muscle_group);
    }
  }

  function update<K extends keyof ExerciseFormValues>(key: K, value: ExerciseFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (!values.exerciseName.trim()) return 'Ponele un nombre al ejercicio.';
    if (values.schemeType === 'normal') {
      if (!values.sets || !values.repMin || !values.repMax) {
        return 'Series, reps mínimas y reps máximas son obligatorias.';
      }
      if (Number(values.repMin) > Number(values.repMax)) {
        return 'Las reps mínimas no pueden ser mayores a las máximas.';
      }
    } else {
      if (!values.topSetReps || !values.backoffSets || !values.backoffRepMin || !values.backoffRepMax) {
        return 'Top set y back-off son obligatorios para este esquema.';
      }
      if (Number(values.backoffRepMin) > Number(values.backoffRepMax)) {
        return 'El rango de back-off es inválido.';
      }
    }
    if (values.rirMin && values.rirMax && Number(values.rirMin) > Number(values.rirMax)) {
      return 'El rango de RIR es inválido.';
    }
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el ejercicio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder="Ej: Press banca, Sentadilla, Remo..."
        value={values.exerciseName}
        onChangeText={(text) => update('exerciseName', text)}
      />

      <Text style={styles.label}>Explorar ejercicios comunes</Text>
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

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((s) => (
            <Pressable key={s.id} onPress={() => selectSuggestion(s)} style={styles.suggestionRow}>
              <Text>{s.name}</Text>
              <Text style={styles.suggestionMeta}>{s.muscle_group}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {browseFilter && suggestions.length === 0 && (
        <Text style={styles.hint}>No hay ejercicios cargados todavía en "{browseFilter}".</Text>
      )}

      <Text style={styles.label}>Grupo muscular</Text>
      <View style={styles.segmented}>
        {(['upper', 'lower', 'core'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.segment, values.muscleGroup === option && styles.segmentSelected]}
            onPress={() => update('muscleGroup', option)}
          >
            <Text style={values.muscleGroup === option ? styles.segmentTextSelected : styles.segmentText}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Rol</Text>
      <View style={styles.segmented}>
        {(['main', 'accessory', 'core'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.segment, values.role === option && styles.segmentSelected]}
            onPress={() => update('role', option)}
          >
            <Text style={values.role === option ? styles.segmentTextSelected : styles.segmentText}>
              {option}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <Text>Top set / back-off</Text>
        <Switch
          value={values.schemeType === 'top_set_backoff'}
          onValueChange={(value) => update('schemeType', value ? 'top_set_backoff' : 'normal')}
        />
      </View>

      <View style={styles.switchRow}>
        <Text>Medido en segundos</Text>
        <Switch
          value={values.repUnit === 'seconds'}
          onValueChange={(value) => update('repUnit', value ? 'seconds' : 'reps')}
        />
      </View>

      {values.schemeType === 'normal' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Series"
            keyboardType="number-pad"
            value={values.sets}
            onChangeText={(text) => update('sets', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps mínimas"
            keyboardType="number-pad"
            value={values.repMin}
            onChangeText={(text) => update('repMin', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps máximas"
            keyboardType="number-pad"
            value={values.repMax}
            onChangeText={(text) => update('repMax', text)}
          />
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Reps del top set"
            keyboardType="number-pad"
            value={values.topSetReps}
            onChangeText={(text) => update('topSetReps', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Series de back-off"
            keyboardType="number-pad"
            value={values.backoffSets}
            onChangeText={(text) => update('backoffSets', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps mínimas de back-off"
            keyboardType="number-pad"
            value={values.backoffRepMin}
            onChangeText={(text) => update('backoffRepMin', text)}
          />
          <TextInput
            style={styles.input}
            placeholder="Reps máximas de back-off"
            keyboardType="number-pad"
            value={values.backoffRepMax}
            onChangeText={(text) => update('backoffRepMax', text)}
          />
        </>
      )}

      <TextInput
        style={styles.input}
        placeholder="RIR mínimo (opcional)"
        keyboardType="number-pad"
        value={values.rirMin}
        onChangeText={(text) => update('rirMin', text)}
      />
      <TextInput
        style={styles.input}
        placeholder="RIR máximo (opcional)"
        keyboardType="number-pad"
        value={values.rirMax}
        onChangeText={(text) => update('rirMax', text)}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={handleSubmit} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
        </Pressable>
        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  suggestions: { borderWidth: 1, borderColor: '#eee', borderRadius: 8 },
  suggestionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionMeta: { color: '#666', fontSize: 12 },
  hint: { color: '#666', fontSize: 12, fontStyle: 'italic' },
  label: { fontWeight: '600', marginTop: 4 },
  segmented: { flexDirection: 'row', gap: 6 },
  segment: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  segmentSelected: { backgroundColor: '#111', borderColor: '#111' },
  segmentText: { color: '#111' },
  segmentTextSelected: { color: '#fff' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  error: { color: '#dc2626' },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelButtonText: { color: '#111', fontWeight: '600' },
});

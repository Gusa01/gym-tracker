import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Switch, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRoutineDay } from '../../../../../src/hooks/useRoutineDay';
import { useDayExercises } from '../../../../../src/hooks/useDayExercises';
import { useExercises } from '../../../../../src/hooks/useExercises';
import { supabase } from '../../../../../src/lib/supabase';
import {
  updateDay,
  createRoutineExercise,
  updateRoutineExercise,
  softDeleteRoutineExercise,
  moveRoutineExercise,
  findOrCreateExercise,
} from '../../../../../src/lib/routines/mutations';
import { ExerciseForm, ExerciseFormValues } from '../../../../../src/components/ExerciseForm';
import { RoutineExerciseWithName } from '../../../../../src/lib/routines/types';

export default function DayEditor() {
  const { dayId } = useLocalSearchParams<{ dayId: string }>();
  const { day, isLoading: dayLoading, refetch: refetchDay } = useRoutineDay(dayId);
  const { exercises, isLoading: exercisesLoading, refetch: refetchExercises } = useDayExercises(dayId);
  const { exercises: catalog } = useExercises();

  const [name, setName] = useState('');
  const [isRestDay, setIsRestDay] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  const [addingExercise, setAddingExercise] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);

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
    } finally {
      setSaving(false);
    }
  }

  function toMutationInput(values: ExerciseFormValues) {
    return {
      role: values.role,
      schemeType: values.schemeType,
      repUnit: values.repUnit,
      sets: values.sets ? Number(values.sets) : null,
      repMin: values.repMin ? Number(values.repMin) : null,
      repMax: values.repMax ? Number(values.repMax) : null,
      rirMin: values.rirMin ? Number(values.rirMin) : null,
      rirMax: values.rirMax ? Number(values.rirMax) : null,
      topSetReps: values.topSetReps ? Number(values.topSetReps) : null,
      backoffSets: values.backoffSets ? Number(values.backoffSets) : null,
      backoffRepMin: values.backoffRepMin ? Number(values.backoffRepMin) : null,
      backoffRepMax: values.backoffRepMax ? Number(values.backoffRepMax) : null,
    };
  }

  async function handleCreateExercise(values: ExerciseFormValues) {
    if (!dayId) return;
    const exercise = await findOrCreateExercise(supabase, values.exerciseName.trim(), values.muscleGroup);
    await createRoutineExercise(supabase, dayId, { exerciseId: exercise.id, ...toMutationInput(values) });
    setAddingExercise(false);
    await refetchExercises();
  }

  async function handleUpdateExercise(routineExerciseId: string, values: ExerciseFormValues) {
    const exercise = await findOrCreateExercise(supabase, values.exerciseName.trim(), values.muscleGroup);
    await updateRoutineExercise(supabase, routineExerciseId, {
      exerciseId: exercise.id,
      ...toMutationInput(values),
    });
    setEditingExerciseId(null);
    await refetchExercises();
  }

  function handleDeleteExercise(routineExerciseId: string, exerciseName: string) {
    Alert.alert('Eliminar ejercicio', `¿Eliminar "${exerciseName}" de este día?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await softDeleteRoutineExercise(supabase, routineExerciseId);
          await refetchExercises();
        },
      },
    ]);
  }

  async function handleMoveExercise(routineExerciseId: string, direction: 'up' | 'down') {
    if (!dayId) return;
    await moveRoutineExercise(supabase, dayId, routineExerciseId, direction);
    await refetchExercises();
  }

  if (dayLoading || exercisesLoading || !day) {
    return (
      <View style={styles.container}>
        <Text>Cargando...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TextInput style={styles.input} placeholder="Nombre del día" value={name} onChangeText={setName} />
      <View style={styles.switchRow}>
        <Text>Día de descanso</Text>
        <Switch value={isRestDay} onValueChange={setIsRestDay} />
      </View>
      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
      </Pressable>

      {!isRestDay && (
        <>
          <Text style={styles.sectionTitle}>Ejercicios</Text>
          {exercises.map((exercise: RoutineExerciseWithName, index: number) =>
            editingExerciseId === exercise.id ? (
              <ExerciseForm
                key={exercise.id}
                exercises={catalog}
                initial={exercise}
                onSubmit={(values) => handleUpdateExercise(exercise.id, values)}
                onCancel={() => setEditingExerciseId(null)}
              />
            ) : (
              <View key={exercise.id} style={styles.exerciseRow}>
                <Pressable style={styles.exerciseRowMain} onPress={() => setEditingExerciseId(exercise.id)}>
                  <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
                  <Text style={styles.exerciseMeta}>
                    {exercise.role} · {exercise.scheme_type}
                  </Text>
                </Pressable>
                <View style={styles.exerciseActions}>
                  <Pressable disabled={index === 0} onPress={() => handleMoveExercise(exercise.id, 'up')}>
                    <Text style={styles.moveButton}>↑</Text>
                  </Pressable>
                  <Pressable
                    disabled={index === exercises.length - 1}
                    onPress={() => handleMoveExercise(exercise.id, 'down')}
                  >
                    <Text style={styles.moveButton}>↓</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteExercise(exercise.id, exercise.exercise_name)}>
                    <Text style={styles.deleteButton}>Eliminar</Text>
                  </Pressable>
                </View>
              </View>
            )
          )}

          {addingExercise ? (
            <ExerciseForm
              exercises={catalog}
              onSubmit={handleCreateExercise}
              onCancel={() => setAddingExercise(false)}
            />
          ) : (
            <Pressable style={styles.newButton} onPress={() => setAddingExercise(true)}>
              <Text style={styles.newButtonText}>+ Agregar ejercicio</Text>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: { backgroundColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
  },
  exerciseRowMain: { flex: 1 },
  exerciseName: { fontSize: 16, fontWeight: '600' },
  exerciseMeta: { color: '#666', fontSize: 12 },
  exerciseActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  moveButton: { fontSize: 18, paddingHorizontal: 6 },
  deleteButton: { color: '#dc2626', fontWeight: '600' },
  newButton: { borderWidth: 1, borderColor: '#111', borderRadius: 8, padding: 14, alignItems: 'center' },
  newButtonText: { color: '#111', fontWeight: '600' },
});

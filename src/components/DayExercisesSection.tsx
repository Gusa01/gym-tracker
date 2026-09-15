import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Modal, ActivityIndicator } from 'react-native';
import { useDayExercises } from '../hooks/useDayExercises';
import { useExercises } from '../hooks/useExercises';
import { supabase } from '../lib/supabase';
import {
  updateRoutineExercise,
  softDeleteRoutineExercise,
  moveRoutineExercise,
  findOrCreateExercise,
} from '../lib/routines/mutations';
import { ExerciseForm, ExerciseFormValues } from './ExerciseForm';
import { ExercisePicker } from './ExercisePicker';
import { RoutineExerciseWithName } from '../lib/routines/types';
import { formatTargetScheme } from '../lib/sessions/prescribedSets';

interface DayExercisesSectionProps {
  dayId: string;
}

function toMutationInput(values: ExerciseFormValues) {
  const isTopSet = values.schemeType === 'top_set_backoff';
  return {
    role: values.role,
    schemeType: values.schemeType,
    repUnit: values.repUnit,
    sets: isTopSet ? null : values.sets ? Number(values.sets) : null,
    repMin: isTopSet ? null : values.repMin ? Number(values.repMin) : null,
    repMax: isTopSet ? null : values.repMax ? Number(values.repMax) : null,
    rirMin: values.rirMin ? Number(values.rirMin) : null,
    rirMax: values.rirMax ? Number(values.rirMax) : null,
    topSetReps: isTopSet ? (values.topSetReps ? Number(values.topSetReps) : null) : null,
    backoffSets: isTopSet ? (values.backoffSets ? Number(values.backoffSets) : null) : null,
    backoffRepMin: isTopSet ? (values.backoffRepMin ? Number(values.backoffRepMin) : null) : null,
    backoffRepMax: isTopSet ? (values.backoffRepMax ? Number(values.backoffRepMax) : null) : null,
  };
}

export function DayExercisesSection({ dayId }: DayExercisesSectionProps) {
  const { exercises, isLoading, error, refetch } = useDayExercises(dayId);
  const { exercises: catalog } = useExercises();

  const [addingExercise, setAddingExercise] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);

  async function handlePickerDone() {
    setAddingExercise(false);
    await refetch();
  }

  async function handleUpdateExercise(routineExerciseId: string, values: ExerciseFormValues) {
    try {
      const exercise = await findOrCreateExercise(supabase, values.exerciseName.trim(), values.muscleGroup);
      await updateRoutineExercise(supabase, routineExerciseId, {
        exerciseId: exercise.id,
        ...toMutationInput(values),
      });
      setEditingExerciseId(null);
      await refetch();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo guardar el ejercicio.');
    }
  }

  function handleDeleteExercise(routineExerciseId: string, exerciseName: string) {
    Alert.alert('Eliminar ejercicio', `¿Eliminar "${exerciseName}" de este día?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await softDeleteRoutineExercise(supabase, routineExerciseId);
            await refetch();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo eliminar el ejercicio.');
          }
        },
      },
    ]);
  }

  async function handleMoveExercise(routineExerciseId: string, direction: 'up' | 'down') {
    try {
      await moveRoutineExercise(supabase, dayId, routineExerciseId, direction);
      await refetch();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo reordenar el ejercicio.');
    }
  }

  if (error) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ejercicios</Text>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ejercicios</Text>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.section}>
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
              <Text style={styles.exerciseMeta}>{formatTargetScheme(exercise)}</Text>
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

      <Pressable style={styles.newButton} onPress={() => setAddingExercise(true)}>
        <Text style={styles.newButtonText}>+ Agregar ejercicios</Text>
      </Pressable>

      <Modal visible={addingExercise} transparent animationType="slide" onRequestClose={() => setAddingExercise(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setAddingExercise(false)} />
          <View style={styles.modalSheet}>
            <ExercisePicker dayId={dayId} onDone={handlePickerDone} onCancel={() => setAddingExercise(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  error: { color: '#dc2626' },
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
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '85%',
  },
});

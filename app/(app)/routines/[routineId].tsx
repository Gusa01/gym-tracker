import { useLocalSearchParams } from 'expo-router';
import { RoutineBuilder } from '../../../src/components/RoutineBuilder';

export default function RoutineEditor() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  return <RoutineBuilder initialRoutineId={routineId} />;
}

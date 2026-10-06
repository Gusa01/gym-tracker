import { Drawer } from 'expo-router/drawer';
import { AppDrawerContent } from '../../src/components/AppDrawerContent';

export default function AppLayout() {
  return (
    <Drawer screenOptions={{ headerShown: true }} drawerContent={(props) => <AppDrawerContent {...props} />}>
      <Drawer.Screen name="index" options={{ title: 'Inicio' }} />
      <Drawer.Screen name="routines" options={{ title: 'Rutinas', swipeEnabled: false }} />
      <Drawer.Screen name="progress" options={{ title: 'Progreso', swipeEnabled: false }} />
      <Drawer.Screen
        name="session"
        options={{ headerShown: false, drawerItemStyle: { display: 'none' }, swipeEnabled: false }}
      />
    </Drawer>
  );
}

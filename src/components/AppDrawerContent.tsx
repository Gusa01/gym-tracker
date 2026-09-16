import { View, Text, Pressable, StyleSheet } from 'react-native';
import { DrawerContentScrollView, DrawerItemList, DrawerContentComponentProps } from 'expo-router/drawer';
import { supabase } from '../lib/supabase';

export function AppDrawerContent(props: DrawerContentComponentProps) {
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
      <View style={styles.items}>
        <DrawerItemList {...props} />
      </View>
      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Cerrar sesión</Text>
      </Pressable>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flex: 1, justifyContent: 'space-between' },
  items: { flex: 1 },
  signOutButton: {
    margin: 16,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
  },
  signOutText: { color: '#fff', fontWeight: '600' },
});

import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PrBannerData } from '../lib/progress/types';
import { buildPrBannerText } from '../lib/progress/format';

const VISIBLE_MS = 3000;

export function PrBanner({ banner, onDismiss }: { banner: PrBannerData | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [banner, onDismiss]);

  if (!banner) return null;
  const { title, detail } = buildPrBannerText(banner.exerciseName, banner.broken);

  return (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 15 },
  detail: { color: '#e5e5e5', marginTop: 2 },
});

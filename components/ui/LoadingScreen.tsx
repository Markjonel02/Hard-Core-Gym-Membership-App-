import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useThemeColor } from '@/components/Themed';

/** Full-bleed spinner used while auth resolves and by route guards mid-redirect. */
export function LoadingScreen() {
  const background = useThemeColor({}, 'background');
  const brand = useThemeColor({}, 'brand');

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <ActivityIndicator size="large" color={brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

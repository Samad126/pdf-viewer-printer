import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface RecentThumbnailProps {
  thumbnailPath?: string;
  width: number;
  height: number;
}

/**
 * A small page preview for a recent file, falling back to a plain placeholder (echoing the app
 * icon's page shape) when there's no thumbnail yet, or its cached file has since been cleared by
 * the OS (CacheDir, unlike the recents list itself, isn't guaranteed to survive).
 */
export function RecentThumbnail({ thumbnailPath, width, height }: RecentThumbnailProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  if (thumbnailPath == null || failed) {
    return (
      <View style={[styles.placeholder, { width, height }]}>
        <View style={styles.placeholderPage} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: thumbnailPath }}
      style={[styles.image, { width, height }]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: 6,
    backgroundColor: '#1c2128',
  },
  placeholder: {
    borderRadius: 6,
    backgroundColor: '#2f6fed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderPage: {
    width: '55%',
    height: '70%',
    borderRadius: 2,
    backgroundColor: '#ffffff',
  },
});

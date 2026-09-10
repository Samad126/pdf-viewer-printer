import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { recordRecentFile } from './src/screens/recentFiles';
import { useSharedPdfIntent } from './src/sharing/useSharedPdfIntent';
import { ViewerScreen } from './src/viewer/ViewerScreen';

interface SelectedFile {
  path: string;
  name: string;
}

function App(): React.JSX.Element {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);

  // Single entry point for opening a file, used by both HomeScreen's own picker/recents list and
  // useSharedPdfIntent below, so every way a file can be opened gets recorded exactly once, in the
  // same place.
  const openFile = useCallback((filePath: string, fileName: string) => {
    setSelectedFile({ path: filePath, name: fileName });
    recordRecentFile(filePath, fileName).catch(() => undefined);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedFile(null);
  }, []);

  // Bare hardware/gesture back on the Viewer returns to Home; on Home itself, returning false lets
  // it fall through to BackHandler's own default (exit app), which is correct there. ViewerScreen
  // registers its own listener (for closing overlays) only while it's mounted, and since
  // BackHandler dispatches to the most-recently-registered listener first, that one takes priority
  // over this one whenever it's active - so back only reaches this handler once nothing in the
  // viewer itself needs to consume it first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedFile == null) return false;
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [selectedFile, handleBack]);

  useSharedPdfIntent(
    useCallback(
      file => {
        openFile(file.path, file.name);
      },
      [openFile],
    ),
  );

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {selectedFile == null ? (
          <HomeScreen onFilePicked={openFile} />
        ) : (
          <ViewerScreen filePath={selectedFile.path} fileName={selectedFile.name} onBack={handleBack} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});

export default App;

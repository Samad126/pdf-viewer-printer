import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { useSharedPdfIntent } from './src/sharing/useSharedPdfIntent';
import { ViewerScreen } from './src/viewer/ViewerScreen';

interface SelectedFile {
  path: string;
  name: string;
}

function App(): React.JSX.Element {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);

  const handleFilePicked = useCallback((filePath: string, fileName: string) => {
    setSelectedFile({ path: filePath, name: fileName });
  }, []);

  const handleBack = useCallback(() => {
    setSelectedFile(null);
  }, []);

  useSharedPdfIntent(
    useCallback(file => {
      setSelectedFile({ path: file.path, name: file.name });
    }, []),
  );

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {selectedFile == null ? (
          <HomeScreen onFilePicked={handleFilePicked} />
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

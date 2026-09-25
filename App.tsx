import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DocxConversionModal, isWordFileName, useDocxConversion } from './src/docx';
import { HomeScreen } from './src/screens/HomeScreen';
import { recordRecentFile } from './src/screens/recentFiles';
import { useSharedDocumentIntent } from './src/sharing/useSharedDocumentIntent';
import { ViewerScreen } from './src/viewer/ViewerScreen';

interface SelectedFile {
  path: string;
  name: string;
}

function App(): React.JSX.Element {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const {
    state: conversionState,
    convert: convertDocx,
    dismissError: dismissConversionError,
    cancel: cancelConversion,
  } = useDocxConversion();

  // Single entry point for opening a file, used by both HomeScreen's own picker/recents list and
  // useSharedDocumentIntent below, so every way a file can be opened gets recorded exactly once, in the
  // same place.
  //
  // A Word document is converted to PDF here, before anything else sees it, so that no other part
  // of the app has to know Word documents exist: the viewer, both print paths, draw/annotate,
  // export and share all keep taking a plain PDF path and are unchanged. That conversion goes to a
  // server, so unlike every other path through this function it can fail on the network - the
  // conversion's own modal is what reports that, and a null result means the user was already told.
  const openFile = useCallback(
    async (filePath: string, fileName: string) => {
      if (!isWordFileName(fileName) && !isWordFileName(filePath)) {
        setSelectedFile({ path: filePath, name: fileName });
        recordRecentFile(filePath, fileName).catch(() => undefined);
        return;
      }

      const converted = await convertDocx(filePath, fileName);
      if (converted == null) return;

      // The viewer is given the converted PDF's path and name, so the reading tools derive their
      // own output names from a name that ends in .pdf - `Report.pdf` exports as
      // `Report-pages.zip` and shares as `Report.pdf`, where passing `Report.docx` through would
      // give `Report.docx-pages.zip`.
      setSelectedFile({ path: converted.uri, name: converted.name });
      // But the recents entry keeps the document the user actually opened, so the list shows
      // "Report.docx" and reopening it re-runs the (cached, so instant) conversion rather than
      // leaving a bare PDF in the list.
      recordRecentFile(filePath, fileName, converted.uri).catch(() => undefined);
    },
    [convertDocx],
  );

  const handleBack = useCallback(() => {
    setSelectedFile(null);
  }, []);

  // Bare hardware/gesture back on the Viewer returns to Home; on Home itself, returning false lets
  // it fall through to BackHandler's own default (exit app), which is correct there. ViewerScreen
  // registers its own listener (for closing overlays) only while it's mounted, and since
  // BackHandler dispatches to the most-recently-registered listener first, that one takes priority
  // over this one whenever it's active - so back only reaches this handler once nothing in the
  // viewer itself needs to consume it first.
  //
  // A conversion in progress has no viewer to go back from; its own modal claims back via
  // onRequestClose and treats it as cancelling the conversion.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedFile == null) return false;
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [selectedFile, handleBack]);

  useSharedDocumentIntent(
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

      <DocxConversionModal
        state={conversionState}
        onDismissError={dismissConversionError}
        onCancel={cancelConversion}
      />
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

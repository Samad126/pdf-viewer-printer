import { pick, isErrorWithCode, errorCodes, types, keepLocalCopy } from '@react-native-documents/picker';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface HomeScreenProps {
  onFilePicked: (filePath: string, fileName: string) => void;
}

export function HomeScreen({ onFilePicked }: HomeScreenProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const [picked] = await pick({ type: [types.pdf] });
      const [copy] = await keepLocalCopy({
        files: [{ uri: picked.uri, fileName: picked.name ?? 'document.pdf' }],
        destination: 'cachesDirectory',
      });

      if (copy.status === 'error') {
        setError(copy.copyError);
        return;
      }

      onFilePicked(copy.localUri, picked.name ?? 'document.pdf');
    } catch (pickError) {
      if (isErrorWithCode(pickError) && pickError.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    }
  }, [onFilePicked]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PDF Printer</Text>
      <Text style={styles.subtitle}>
        Pick a PDF to view it, or print it through a PDFium-rasterized, font-free copy.
      </Text>

      <Pressable style={styles.pickButton} onPress={handlePick}>
        <Text style={styles.pickButtonLabel}>Choose a PDF</Text>
      </Pressable>

      {error != null && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#000000',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#a0a0a0',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
  pickButton: {
    backgroundColor: '#2f6fed',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  pickButtonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 20,
    textAlign: 'center',
  },
});

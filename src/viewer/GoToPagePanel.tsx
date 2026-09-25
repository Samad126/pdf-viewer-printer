import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CloseButton } from '../ui/CloseButton';

interface GoToPagePanelProps {
  pageCount: number;
  onGo: (pageNumber: number) => void;
  onClose: () => void;
}

export function GoToPagePanel({ pageCount, onGo, onClose }: GoToPagePanelProps): React.JSX.Element {
  const [text, setText] = useState('');
  const page = Number.parseInt(text, 10);
  const valid = Number.isFinite(page) && page >= 1 && page <= pageCount;

  const submit = useCallback(() => {
    if (valid) onGo(page);
  }, [valid, page, onGo]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Go to page</Text>
        <CloseButton onPress={onClose} />
      </View>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={value => setText(value.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder={`1 - ${pageCount}`}
          placeholderTextColor="#6b7280"
          autoFocus
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <Pressable style={[styles.goButton, !valid && styles.goDisabled]} onPress={submit} disabled={!valid}>
          <Text style={styles.goLabel}>Go</Text>
        </Pressable>
      </View>
      {text.length > 0 && !valid && <Text style={styles.errorText}>Enter a page from 1 to {pageCount}.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#101418', borderRadius: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#0c0f13',
    color: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
  },
  goButton: { marginLeft: 10, backgroundColor: '#2f6fed', paddingHorizontal: 24, paddingVertical: 13, borderRadius: 8 },
  goDisabled: { opacity: 0.5 },
  goLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#ff6b6b', fontSize: 12, marginTop: 8 },
});

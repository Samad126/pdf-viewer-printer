import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { closePdfDocument, openPdfDocument } from '../pdf/NativePdfiumModule';
import { CloseButton } from '../ui/CloseButton';
import { findTextInPdf } from './NativePdfTextModule';
import type { PdfFindMatch } from './types';

/**
 * Splits a snippet into the text before/at/after the first case-insensitive occurrence of `query`
 * so the match can be rendered highlighted. The snippet is built server-side by centering on the
 * exact match, so the query text is virtually always still present verbatim - this is a plain
 * client-side re-search rather than threading match offsets through the native bridge, since a
 * short snippet is cheap to re-scan and this avoids touching the native find code at all.
 */
function splitSnippetAtMatch(snippet: string, query: string): { before: string; match: string; after: string } | null {
  if (query.length === 0) return null;
  const matchIndex = snippet.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex < 0) return null;
  return {
    before: snippet.slice(0, matchIndex),
    match: snippet.slice(matchIndex, matchIndex + query.length),
    after: snippet.slice(matchIndex + query.length),
  };
}

interface FindPanelProps {
  filePath: string;
  onJumpToPage: (pageIndex: number) => void;
  onClose: () => void;
}

type DocumentPhase = 'opening' | 'ready' | 'open-error';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Self-contained find-in-document panel: opens its own PDFium handle on mount (independent of
 * whatever handle the viewer itself may be using) and closes it on unmount, so it never has to
 * coordinate document lifetime with the screen that hosts it.
 */
export function FindPanel({ filePath, onJumpToPage, onClose }: FindPanelProps): React.JSX.Element {
  const [phase, setPhase] = useState<DocumentPhase>('opening');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<PdfFindMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleRef = useRef<string | null>(null);
  const searchTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    openPdfDocument(filePath, null)
      .then(inspection => {
        if (cancelled) {
          if (inspection.handle) {
            closePdfDocument(inspection.handle).catch(() => undefined);
          }
          return;
        }
        if (!inspection.canOpen || !inspection.handle) {
          setPhase('open-error');
          return;
        }
        handleRef.current = inspection.handle;
        setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('open-error');
      });

    return () => {
      cancelled = true;
      if (handleRef.current) {
        closePdfDocument(handleRef.current).catch(() => undefined);
        handleRef.current = null;
      }
    };
  }, [filePath]);

  useEffect(() => {
    if (phase !== 'ready') {
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setMatches([]);
      setHasSearched(false);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const token = ++searchTokenRef.current;
    const timer = setTimeout(() => {
      const handle = handleRef.current;
      if (!handle) return;
      findTextInPdf(handle, trimmed, false, false)
        .then(results => {
          if (searchTokenRef.current !== token) return;
          setMatches(results);
          setSearchError(null);
          setHasSearched(true);
          setIsSearching(false);
        })
        .catch(error => {
          if (searchTokenRef.current !== token) return;
          setSearchError(error instanceof Error ? error.message : String(error));
          setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, phase]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Find in document</Text>
        <CloseButton onPress={onClose} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Search text…"
        placeholderTextColor="#6b7280"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        editable={phase === 'ready'}
      />

      {phase === 'opening' && (
        <View style={styles.centeredRow}>
          <ActivityIndicator size="small" color="#63a4ff" />
          <Text style={styles.hint}>Opening document…</Text>
        </View>
      )}

      {phase === 'open-error' && <Text style={styles.errorText}>Could not open this PDF for searching.</Text>}

      {phase === 'ready' && isSearching && (
        <View style={styles.centeredRow}>
          <ActivityIndicator size="small" color="#63a4ff" />
          <Text style={styles.hint}>Searching…</Text>
        </View>
      )}

      {searchError != null && <Text style={styles.errorText}>{searchError}</Text>}

      {phase === 'ready' && !isSearching && hasSearched && matches.length === 0 && (
        <Text style={styles.emptyText}>No matches found.</Text>
      )}

      {matches.length > 0 && (
        <FlatList
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          data={matches}
          keyExtractor={(item, index) => `${item.pageIndex}-${index}`}
          renderItem={({ item }) => {
            const split = splitSnippetAtMatch(item.snippet, query.trim());
            return (
              <Pressable style={styles.resultRow} onPress={() => onJumpToPage(item.pageIndex)}>
                <Text style={styles.resultPage}>Page {item.pageIndex + 1}</Text>
                <Text style={styles.resultSnippet} numberOfLines={2}>
                  {split == null ? (
                    item.snippet
                  ) : (
                    <>
                      {split.before}
                      <Text style={styles.resultSnippetMatch}>{split.match}</Text>
                      {split.after}
                    </>
                  )}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101418',
    borderRadius: 12,
    padding: 16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0c0f13',
    color: '#ffffff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  centeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  hint: {
    color: '#a0a8b4',
    marginLeft: 8,
  },
  errorText: {
    color: '#ff6b6b',
    marginTop: 4,
  },
  emptyText: {
    color: '#a0a8b4',
    marginTop: 8,
  },
  list: {
    marginTop: 4,
    flexShrink: 1,
  },
  resultRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1a2028',
    marginBottom: 6,
  },
  resultPage: {
    color: '#63a4ff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  resultSnippet: {
    color: '#e6e6e6',
    fontSize: 13,
  },
  resultSnippetMatch: {
    color: '#101418',
    backgroundColor: '#ffd54a',
    fontWeight: '700',
  },
});

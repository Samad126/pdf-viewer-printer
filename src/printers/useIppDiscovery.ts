import { useCallback, useEffect, useRef, useState } from 'react';
import { startDiscovery, stopDiscovery, subscribeToDiscoveryEvents } from './NativeIppDiscoveryModule';
import { INITIAL_IPP_DISCOVERY_STATE, IppDiscoveryState } from './types';

export interface UseIppDiscoveryResult {
  state: IppDiscoveryState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Wraps IppDiscoveryModule's start/stop + streamed found/lost/error events into a single state
 * machine. Discovery is stopped and the event subscription torn down on unmount so a leftover
 * NsdManager listener/multicast lock never outlives the screen that started it.
 */
export function useIppDiscovery(): UseIppDiscoveryResult {
  const [state, setState] = useState<IppDiscoveryState>(INITIAL_IPP_DISCOVERY_STATE);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    setState({ ...INITIAL_IPP_DISCOVERY_STATE, stage: 'discovering' });

    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeToDiscoveryEvents({
      onFound: printer => {
        setState(previous => {
          const withoutExisting = previous.printers.filter(
            existing => !(existing.name === printer.name && existing.host === printer.host),
          );
          return { ...previous, printers: [...withoutExisting, printer] };
        });
      },
      onLost: event => {
        setState(previous => ({
          ...previous,
          printers: previous.printers.filter(printer => printer.name !== event.name),
        }));
      },
      onError: event => {
        setState(previous => ({
          ...previous,
          stage: 'unavailable',
          errorMessage: `Discovery unavailable (${event.errorCode}). Enter your printer's address manually.`,
        }));
      },
    });

    try {
      await startDiscovery();
    } catch (error) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setState(previous => ({
        ...previous,
        stage: 'unavailable',
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const stop = useCallback(async () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setState(previous => ({ ...previous, stage: 'stopped' }));
    await stopDiscovery().catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      stopDiscovery().catch(() => undefined);
    },
    [],
  );

  return { state, start, stop };
}

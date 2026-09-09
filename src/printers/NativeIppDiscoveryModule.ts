import { NativeEventEmitter, NativeModules } from 'react-native';
import type { IppDiscoveredPrinter } from './types';

interface IppDiscoveryModuleInterface {
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
}

interface IppPrinterLostEvent {
  name: string;
}

interface IppDiscoveryErrorEvent {
  errorCode: string;
}

const IppDiscoveryModule = NativeModules.IppDiscoveryModule as IppDiscoveryModuleInterface | undefined;

const EVENT_FOUND = 'PdfPrinter:IppPrinterFound';
const EVENT_LOST = 'PdfPrinter:IppPrinterLost';
const EVENT_ERROR = 'PdfPrinter:IppDiscoveryError';

type IppDiscoveryEventMap = {
  [EVENT_FOUND]: [IppDiscoveredPrinter];
  [EVENT_LOST]: [IppPrinterLostEvent];
  [EVENT_ERROR]: [IppDiscoveryErrorEvent];
};

function requireModule(): IppDiscoveryModuleInterface {
  if (!IppDiscoveryModule) {
    throw new Error(
      'IppDiscoveryModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return IppDiscoveryModule;
}

export function startDiscovery(): Promise<void> {
  return requireModule().startDiscovery();
}

export function stopDiscovery(): Promise<void> {
  return requireModule().stopDiscovery();
}

export interface IppDiscoveryEventHandlers {
  onFound?: (printer: IppDiscoveredPrinter) => void;
  onLost?: (event: IppPrinterLostEvent) => void;
  onError?: (event: IppDiscoveryErrorEvent) => void;
}

/**
 * Subscribes to the three discovery events emitted from IppDiscoveryModule as printers are
 * found/lost/fail to be discoverable, mirroring subscribeToRebuildProgress's pattern in
 * NativePdfRebuildModule.ts. Returns a single combined unsubscribe function.
 */
export function subscribeToDiscoveryEvents(handlers: IppDiscoveryEventHandlers): () => void {
  if (!IppDiscoveryModule) {
    return () => {};
  }
  const emitter = new NativeEventEmitter<IppDiscoveryEventMap>(NativeModules.IppDiscoveryModule);
  const subscriptions = [
    handlers.onFound ? emitter.addListener(EVENT_FOUND, event => handlers.onFound?.(event)) : null,
    handlers.onLost ? emitter.addListener(EVENT_LOST, event => handlers.onLost?.(event)) : null,
    handlers.onError ? emitter.addListener(EVENT_ERROR, event => handlers.onError?.(event)) : null,
  ];
  return () => {
    subscriptions.forEach(subscription => subscription?.remove());
  };
}

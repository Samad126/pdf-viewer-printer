import { useCallback, useState } from 'react';
import { usePrintPipeline } from '../print/usePrintPipeline';
import type { PrintPipelineState } from '../print/types';
import { useIppDiscovery, UseIppDiscoveryResult } from '../printers/useIppDiscovery';
import { useIppPrintPipeline } from '../printers/useIppPrintPipeline';
import type { IppPrintOptions, IppPrinterTarget, IppPrintPipelineState } from '../printers/types';
import type { MoreActionsMenuItem } from './MoreActionsMenu';

export interface UsePrintFlowResult {
  printState: PrintPipelineState;
  ippState: IppPrintPipelineState;
  discovery: UseIppDiscoveryResult;
  showPrintChoice: boolean;
  printChoiceItems: MoreActionsMenuItem[];
  showPrinterPicker: boolean;
  printOptionsTarget: IppPrinterTarget | null;
  isBusy: boolean;
  openPrintChoice: () => void;
  closePrintChoice: () => void;
  handleClosePrinterPicker: () => void;
  handleSelectPrinter: (target: IppPrinterTarget) => void;
  handleCancelPrintOptions: () => void;
  handleSubmitPrintOptions: (printOptions: IppPrintOptions) => void;
  handleCancelIppPrint: () => void;
  dismissPrint: () => void;
  dismissIppPrint: () => void;
}

/**
 * Bundles both print paths this screen offers (android.print.PrintManager, and the direct-IPP
 * bypass) plus the printer picker/options flow between them, so ViewerScreen doesn't have to hold
 * all of their state and handlers itself. Both paths sit behind one "Print" entry point
 * (showPrintChoice) rather than two separate header buttons.
 */
export function usePrintFlow(filePath: string, fileName: string): UsePrintFlowResult {
  const [showPrintChoice, setShowPrintChoice] = useState(false);
  const [showPrinterPicker, setShowPrinterPicker] = useState(false);
  const [printOptionsTarget, setPrintOptionsTarget] = useState<IppPrinterTarget | null>(null);
  const { state: printState, startPrint, reset } = usePrintPipeline();
  const discovery = useIppDiscovery();
  const {
    state: ippState,
    startPrint: startIppPrint,
    cancel: cancelIppPrint,
    reset: resetIppPrint,
  } = useIppPrintPipeline();

  const openPrintChoice = useCallback(() => setShowPrintChoice(true), []);
  const closePrintChoice = useCallback(() => setShowPrintChoice(false), []);

  const handlePrint = useCallback(() => {
    reset();
    startPrint(filePath, fileName).catch(() => undefined);
  }, [filePath, fileName, reset, startPrint]);

  const handleOpenPrinterPicker = useCallback(() => {
    resetIppPrint();
    setPrintOptionsTarget(null);
    setShowPrinterPicker(true);
    discovery.start().catch(() => undefined);
  }, [discovery, resetIppPrint]);

  const handleClosePrinterPicker = useCallback(() => {
    setShowPrinterPicker(false);
    discovery.stop().catch(() => undefined);
  }, [discovery]);

  const handleSelectPrinter = useCallback(
    (target: IppPrinterTarget) => {
      setShowPrinterPicker(false);
      discovery.stop().catch(() => undefined);
      setPrintOptionsTarget(target);
    },
    [discovery],
  );

  const handleCancelPrintOptions = useCallback(() => {
    setPrintOptionsTarget(null);
  }, []);

  const handleSubmitPrintOptions = useCallback(
    (printOptions: IppPrintOptions) => {
      const target = printOptionsTarget;
      setPrintOptionsTarget(null);
      if (target == null) return;
      startIppPrint(filePath, fileName, target, printOptions).catch(() => undefined);
    },
    [filePath, fileName, printOptionsTarget, startIppPrint],
  );

  const handleCancelIppPrint = useCallback(() => {
    cancelIppPrint().catch(() => undefined);
  }, [cancelIppPrint]);

  const dismissPrint = useCallback(() => reset(), [reset]);
  const dismissIppPrint = useCallback(() => resetIppPrint(), [resetIppPrint]);

  const printChoiceItems: MoreActionsMenuItem[] = [
    { key: 'print', label: 'Print', onPress: handlePrint },
    { key: 'print-directly', label: 'Print directly', onPress: handleOpenPrinterPicker },
  ];

  const isPrintBusy = printState.stage !== 'idle' && printState.stage !== 'done' && printState.stage !== 'error';
  const isIppBusy =
    ippState.stage !== 'idle' &&
    ippState.stage !== 'done' &&
    ippState.stage !== 'error' &&
    ippState.stage !== 'cancelled';
  const isBusy = isPrintBusy || isIppBusy || printOptionsTarget != null;

  return {
    printState,
    ippState,
    discovery,
    showPrintChoice,
    printChoiceItems,
    showPrinterPicker,
    printOptionsTarget,
    isBusy,
    openPrintChoice,
    closePrintChoice,
    handleClosePrinterPicker,
    handleSelectPrinter,
    handleCancelPrintOptions,
    handleSubmitPrintOptions,
    handleCancelIppPrint,
    dismissPrint,
    dismissIppPrint,
  };
}

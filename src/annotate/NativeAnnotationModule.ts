import { NativeModules } from 'react-native';
import type { Stroke } from './types';

export interface AnnotationPageInput {
  pageIndex: number;
  /**
   * The effective dpi of the coordinate space `strokes[].points` were captured in - i.e. the dpi
   * a bitmap would need to be rendered at for its pixel dimensions to match however the drawing
   * canvas was actually displayed on screen for this page. Not necessarily the dpi any background
   * preview image was literally rasterized at.
   */
  pageDpi: number;
  strokes: Stroke[];
}

export interface AnnotationSaveResult {
  outputPath: string;
  pageCount: number;
}

interface AnnotationModuleInterface {
  saveAnnotatedPdf(
    handle: string,
    dpi: number,
    outputPath: string,
    pageAnnotations: AnnotationPageInput[],
  ): Promise<AnnotationSaveResult>;
}

const AnnotationModule = NativeModules.AnnotationModule as AnnotationModuleInterface | undefined;

function requireModule(): AnnotationModuleInterface {
  if (!AnnotationModule) {
    throw new Error(
      'AnnotationModule native module is not available. Did you forget to run a native (non-Expo Go) build?',
    );
  }
  return AnnotationModule;
}

export function saveAnnotatedPdf(
  handle: string,
  dpi: number,
  outputPath: string,
  pageAnnotations: AnnotationPageInput[],
): Promise<AnnotationSaveResult> {
  return requireModule().saveAnnotatedPdf(handle, dpi, outputPath, pageAnnotations);
}

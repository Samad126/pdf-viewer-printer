import { NativeModules } from 'react-native';

/** What the server answered, or what went wrong before it could. */
export interface PdfUploadResult {
  status: number;
  contentType: string | null;
  /** True when the response body was written to the destination, which only a 2xx does. */
  written: boolean;
  /** The server's own error body, when it sent one. Its `message` is shown to the user as-is. */
  errorBody: string | null;
}

interface PdfUploadModuleInterface {
  upload(
    url: string,
    sourcePath: string,
    fileName: string,
    destinationPath: string,
  ): Promise<PdfUploadResult>;
  cancel(): Promise<void>;
}

/**
 * The native upload that carries a document to the conversion server and writes the PDF back.
 *
 * It replaced react-native-blob-util's HTTP client, which could not complete this request reliably:
 * see the note on `PdfUploadModule` for what it did instead. The library is still used for the
 * filesystem, which is all this app needs from it now.
 */
export const PdfUpload = NativeModules.PdfUpload as PdfUploadModuleInterface;

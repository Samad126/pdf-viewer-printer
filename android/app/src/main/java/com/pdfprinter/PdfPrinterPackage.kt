package com.pdfprinter

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.pdfprinter.annotate.AnnotationModule
import com.pdfprinter.docx.DocxModule
import com.pdfprinter.pdf.PdfRebuildModule
import com.pdfprinter.pdf.PdfTextModule
import com.pdfprinter.pdf.PdfiumModule
import com.pdfprinter.pdf.ZipModule
import com.pdfprinter.print.PrintModule
import com.pdfprinter.printers.IppDiscoveryModule
import com.pdfprinter.printers.IppPrintModule
import com.pdfprinter.sharing.FileShareModule
import com.pdfprinter.sharing.ShareIntentModule

class PdfPrinterPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(
            PdfiumModule(reactContext),
            PdfRebuildModule(reactContext),
            PrintModule(reactContext),
            IppDiscoveryModule(reactContext),
            IppPrintModule(reactContext),
            ShareIntentModule(reactContext),
            PdfTextModule(reactContext),
            ZipModule(reactContext),
            FileShareModule(reactContext),
            AnnotationModule(reactContext),
            DocxModule(reactContext),
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

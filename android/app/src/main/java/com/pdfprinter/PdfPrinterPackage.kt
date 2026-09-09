package com.pdfprinter

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.pdfprinter.pdf.PdfRebuildModule
import com.pdfprinter.pdf.PdfiumModule
import com.pdfprinter.print.PrintModule
import com.pdfprinter.printers.IppDiscoveryModule
import com.pdfprinter.printers.IppPrintModule
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
        )

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

package com.pdfprinter

import android.app.Application
import android.webkit.WebView
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(PdfPrinterPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()

    // Since API 21 a WebView draws only the part of the DOM that is currently visible when it is
    // asked to paint into a caller-supplied Canvas; everything outside the visible region comes out
    // blank. That is fatal to the .docx conversion, which renders the document in a one-page-tall
    // WebView and captures page after page by scrolling - the first page is the visible one and
    // draws, and every page after it captured white.
    //
    // This has to run before any WebView in the process is constructed, so it cannot live in
    // DocxModule next to the code that needs it. The cost is that Chromium keeps the whole
    // document rather than the visible slice, which is exactly the point here and which nothing
    // else in this app pays for - react-native-pdf renders through PDFium, not through a WebView.
    WebView.enableSlowWholeDocumentDraw()

    loadReactNative(this)
  }
}

package com.pdfprinter.pdf

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Rasterization and PDF rebuilding are CPU/IO heavy and must not run on React Native's single
 * NativeModules thread, or every other native call would queue up behind a multi-page print job.
 */
object PdfWorkExecutors {
    val io: ExecutorService = Executors.newFixedThreadPool(2)
}

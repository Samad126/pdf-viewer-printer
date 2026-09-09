package com.pdfprinter.printers.ipp

import java.net.HttpURLConnection
import java.util.concurrent.ConcurrentHashMap

/**
 * Tracks in-flight IPP HTTP connections by a caller-supplied request token, so a submitPrintJob
 * call still uploading/waiting on a response can be cancelled from JS. Calling
 * HttpURLConnection.disconnect() from another thread while a blocking read/write is in progress
 * on the connecting thread is a standard, supported way to unblock it - the blocked thread gets
 * an IOException whose exact type varies (often SocketException, not more specific subclasses
 * like SocketTimeoutException). Because that exception is otherwise indistinguishable from a
 * genuine mid-transfer network failure, [cancel] also records the token in [cancelledTokens] so
 * IppHttpClient's catch block can tell the two apart and report E_CANCELLED instead of a scary
 * network error for something the user intentionally stopped.
 */
object IppCancellationRegistry {

    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val cancelledTokens = ConcurrentHashMap.newKeySet<String>()

    fun register(token: String, connection: HttpURLConnection) {
        connections[token] = connection
    }

    fun unregister(token: String) {
        connections.remove(token)
    }

    fun cancel(token: String): Boolean {
        val connection = connections.remove(token) ?: return false
        cancelledTokens.add(token)
        connection.disconnect()
        return true
    }

    fun wasCancelled(token: String): Boolean = cancelledTokens.contains(token)

    fun clearCancelled(token: String) {
        cancelledTokens.remove(token)
    }
}

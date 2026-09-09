package com.pdfprinter.printers

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.charset.StandardCharsets
import java.util.ArrayDeque

private const val SERVICE_TYPE = "_ipp._tcp."
private const val DEFAULT_RESOURCE_PATH = "ipp/print"
private const val TXT_KEY_RESOURCE_PATH = "rp"
private const val TXT_KEY_DISPLAY_NAME = "ty"
private const val EVENT_FOUND = "PdfPrinter:IppPrinterFound"
private const val EVENT_LOST = "PdfPrinter:IppPrinterLost"
private const val EVENT_ERROR = "PdfPrinter:IppDiscoveryError"
private const val MULTICAST_LOCK_TAG = "pdfprinter-ipp"

/**
 * Discovers IPP printers on the local network via mDNS/DNS-SD (`_ipp._tcp.`) using Android's
 * NsdManager. Results stream to JS as events as they resolve, not through the startDiscovery
 * promise - the promise only resolves once discovery has *started*, mirroring PrintModule's
 * "resolves on handoff, not on completion" convention.
 */
class IppDiscoveryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    // NsdManager.resolveService is unreliable when multiple resolves are in flight at once on
    // many Android versions/OEM builds, so services found while a resolve is already running are
    // queued and resolved one at a time instead of concurrently.
    private val pendingResolves = ArrayDeque<NsdServiceInfo>()
    private var isResolving = false

    private val nsdManager: NsdManager
        get() = reactContext.getSystemService(Context.NSD_SERVICE) as NsdManager

    // NativeEventEmitter on the JS side checks for these two methods and warns if they're
    // missing. Event emission itself goes through RCTDeviceEventEmitter directly (see emit
    // below), so there's no listener bookkeeping to do here.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        try {
            acquireMulticastLock()

            val listener =
                object : NsdManager.DiscoveryListener {
                    override fun onDiscoveryStarted(serviceType: String) {}

                    override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                        enqueueResolve(serviceInfo)
                    }

                    override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                        emitLost(serviceInfo.serviceName)
                    }

                    override fun onDiscoveryStopped(serviceType: String) {}

                    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                        emitError(errorCode.toString())
                    }

                    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                        emitError(errorCode.toString())
                    }
                }
            discoveryListener = listener
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
            promise.resolve(null)
        } catch (error: SecurityException) {
            // Defensive: this is the seam for any local-network runtime permission a given OEM
            // build or Android version might require for mDNS discovery. JS routes this to a
            // manual host/port entry fallback rather than crashing.
            promise.reject("E_DISCOVERY_PERMISSION_DENIED", error.message, error)
        } catch (error: Exception) {
            promise.reject("E_DISCOVERY_START_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        try {
            discoveryListener?.let { listener -> nsdManager.stopServiceDiscovery(listener) }
            discoveryListener = null
            synchronized(pendingResolves) {
                pendingResolves.clear()
                isResolving = false
            }
            releaseMulticastLock()
            promise.resolve(null)
        } catch (error: IllegalArgumentException) {
            // stopServiceDiscovery throws this when the listener passed isn't the one currently
            // registered (e.g. discovery was never started, or already stopped) - treat that as
            // already-stopped rather than a failure.
            discoveryListener = null
            releaseMulticastLock()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_DISCOVERY_STOP_FAILED", error.message, error)
        }
    }

    private fun enqueueResolve(serviceInfo: NsdServiceInfo) {
        val shouldResolveNow =
            synchronized(pendingResolves) {
                pendingResolves.add(serviceInfo)
                if (isResolving) {
                    false
                } else {
                    isResolving = true
                    true
                }
            }
        if (shouldResolveNow) resolveNext()
    }

    private fun resolveNext() {
        val next =
            synchronized(pendingResolves) {
                if (pendingResolves.isEmpty()) {
                    isResolving = false
                    null
                } else {
                    pendingResolves.poll()
                }
            } ?: return

        nsdManager.resolveService(
            next,
            object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    resolveNext()
                }

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    emitFound(serviceInfo)
                    resolveNext()
                }
            },
        )
    }

    private fun emitFound(serviceInfo: NsdServiceInfo) {
        val txtRecord = Arguments.createMap()
        serviceInfo.attributes.forEach { (key, value) -> txtRecord.putString(key, decodeTxtValue(value)) }

        val resourcePath =
            serviceInfo.attributes[TXT_KEY_RESOURCE_PATH]?.let(::decodeTxtValue)?.takeIf { it.isNotBlank() }
                ?: DEFAULT_RESOURCE_PATH
        val displayName =
            serviceInfo.attributes[TXT_KEY_DISPLAY_NAME]?.let(::decodeTxtValue)?.takeIf { it.isNotBlank() }
                ?: serviceInfo.serviceName

        val payload =
            Arguments.createMap().apply {
                putString("name", displayName)
                putString("host", serviceInfo.host?.hostAddress)
                putInt("port", serviceInfo.port)
                putString("resourcePath", resourcePath)
                putMap("txtRecord", txtRecord)
            }
        emit(EVENT_FOUND, payload)
    }

    private fun emitLost(serviceName: String) {
        emit(EVENT_LOST, Arguments.createMap().apply { putString("name", serviceName) })
    }

    private fun emitError(errorCode: String) {
        emit(EVENT_ERROR, Arguments.createMap().apply { putString("errorCode", errorCode) })
    }

    private fun emit(eventName: String, payload: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }

    private fun decodeTxtValue(bytes: ByteArray?): String =
        bytes?.let { String(it, StandardCharsets.UTF_8) } ?: ""

    private fun acquireMulticastLock() {
        val wifiManager =
            reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = wifiManager?.createMulticastLock(MULTICAST_LOCK_TAG)
        lock?.setReferenceCounted(true)
        lock?.acquire()
        multicastLock = lock
    }

    private fun releaseMulticastLock() {
        multicastLock?.let { lock -> if (lock.isHeld) lock.release() }
        multicastLock = null
    }

    companion object {
        const val NAME = "IppDiscoveryModule"
    }
}

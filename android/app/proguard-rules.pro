# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# React Native invokes @ReactMethod-annotated native module methods via reflection, not direct
# calls - R8 can't see that usage through normal reachability analysis, so without a keep rule it
# could rename or strip them. Also keep every one of this app's own native module classes wholesale
# (PdfiumModule, PrintModule, IppPrintModule, AnnotationModule, etc.) - this is a small amount of
# code, so exempting all of it from minification costs virtually nothing size-wise while removing
# any risk to the print/IPP pipeline from R8 subtly altering it.
-keep,allowobfuscation @interface com.facebook.react.bridge.ReactMethod
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
}
-keep class com.pdfprinter.** { *; }

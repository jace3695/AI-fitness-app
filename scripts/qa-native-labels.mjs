// Classify browser process output, never persist the original line.
export function nativeLabel(line) {
  if (!line.includes('pw:browser')) return null;
  if (/WebKit encountered an internal error|internallyFailedLoadTimerFired/.test(line)) return 'webkit-internal';
  if (/libsoup.*CRITICAL|SOUP_IS_SESSION_FEATURE/.test(line)) return 'libsoup-critical';
  if (/GLib.*CRITICAL|G_IS_OBJECT|g_object_ref|g_object_unref/.test(line)) return 'glib-critical';
  if (/malloc\(\)|double free|corrupt/.test(line)) return 'heap-error';
  if (/NetworkProcess|network process/i.test(line)) return 'network-process';
  if (/EGL|MESA|VK_ERROR/.test(line)) return 'graphics-driver';
  if (/process did exit/.test(line)) return 'process-exit';
  if (/<launched>/.test(line)) return 'browser-launched';
  return 'other-native';
}

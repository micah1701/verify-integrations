/**
 * Lightweight conditional logger for the Ad-Hoc Verify storefront plugin.
 *
 * Call setLogging(true) once after reading config.logging.
 * Every log() call is a no-op until then, so there is zero console noise
 * for merchants who do not opt in.
 */

let _enabled = false;

export function setLogging(enabled: boolean): void {
  _enabled = enabled;
}

export function log(message: string, ...data: unknown[]): void {
  if (!_enabled) return;
  if (data.length > 0) {
    console.log(`[AD-HOC VERIFY] ${message}`, ...data);
  } else {
    console.log(`[AD-HOC VERIFY] ${message}`);
  }
}

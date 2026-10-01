/**
 * Whether this browser can share its screen with a web page. Phone browsers
 * cannot (MDN: no getDisplayMedia on Safari for iOS, Chrome for Android or
 * Firefox for Android), and a page served without HTTPS has no media devices
 * at all. Pass `navigator.mediaDevices`.
 */
export function canShareScreen(mediaDevices: object | undefined): boolean {
  return (
    mediaDevices !== undefined &&
    'getDisplayMedia' in mediaDevices &&
    typeof mediaDevices.getDisplayMedia === 'function'
  );
}

/**
 * How to spell the palette shortcut on the machine the operator is actually
 * using. Printing `Ctrl K` to a Mac user is a small thing that makes a console
 * feel like it was ported rather than built.
 *
 * Read at render time rather than cached in a module constant so a test can
 * render under either platform without module-registry gymnastics.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function shortcutLabel(): string {
  return isApplePlatform() ? "⌘K" : "Ctrl K";
}

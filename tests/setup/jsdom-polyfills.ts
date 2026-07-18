// Minimal DOM API shims Radix UI primitives (Select's popper positioning,
// pointer-capture-based open/close) call into but jsdom doesn't implement.
// Guarded so this file is a no-op under the default "node" test environment.
if (typeof window !== "undefined") {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  if (!("ResizeObserver" in window)) {
    // @ts-expect-error minimal test-only polyfill
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom has no PointerEvent constructor, so fireEvent.pointerDown() built on
  // the base Event class silently drops pointerType/button/pointerId — Radix
  // UI's Select reads those to decide whether to open, so without this its
  // trigger never opens under test.
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      width: number;
      height: number;
      pressure: number;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
        this.width = params.width ?? 1;
        this.height = params.height ?? 1;
        this.pressure = params.pressure ?? 0;
      }
    }
    // @ts-expect-error minimal test-only polyfill
    window.PointerEvent = PointerEventPolyfill;
  }
}

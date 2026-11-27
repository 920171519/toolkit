export const POPOVER_EDGE = 8;

export function getPopoverViewport(visual: VisualViewport | null) {
  const left = visual?.offsetLeft ?? 0;
  const top = visual?.offsetTop ?? 0;
  return {
    left,
    top,
    width: visual?.width ?? document.documentElement.clientWidth,
    bottom: top + (visual?.height ?? document.documentElement.clientHeight),
  };
}

export function getPopoverLeft(anchorLeft: number, panelWidth: number, viewport: { left: number; width: number }) {
  const rightLimit = viewport.left + viewport.width - panelWidth - POPOVER_EDGE;
  return Math.max(viewport.left + POPOVER_EDGE, Math.min(anchorLeft, rightLimit));
}

export function observePopoverViewport(visual: VisualViewport | null, reposition: (event: Event) => void, observeVisualScroll = false) {
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  visual?.addEventListener("resize", reposition);
  if (observeVisualScroll) visual?.addEventListener("scroll", reposition);
  return () => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    visual?.removeEventListener("resize", reposition);
    if (observeVisualScroll) visual?.removeEventListener("scroll", reposition);
  };
}

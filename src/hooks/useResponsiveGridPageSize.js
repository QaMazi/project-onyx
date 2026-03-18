import { useEffect, useState } from "react";

function calculatePageSize(container, options) {
  if (!container) return options.fallback;

  const width = Math.max(0, container.clientWidth - (options.paddingX || 0));
  const height = Math.max(0, container.clientHeight - (options.paddingY || 0));

  if (!width || !height) return options.fallback;

  const columnWidth = options.minColumnWidth || 140;
  const columnGap = options.columnGap || 14;
  const rowGap = options.rowGap || 16;
  const cardAspectRatio = options.cardAspectRatio || 1185 / 813;
  const textHeight = options.textHeight || 40;
  const extraHeight = options.extraHeight || 0;

  const columns = Math.max(
    1,
    Math.floor((width + columnGap) / (columnWidth + columnGap))
  );
  const tileWidth = (width - columnGap * (columns - 1)) / columns;
  const tileHeight = tileWidth * cardAspectRatio + textHeight + extraHeight;
  const rows = Math.max(1, Math.floor((height + rowGap) / (tileHeight + rowGap)));

  return Math.max(options.minPageSize || 1, columns * rows);
}

export default function useResponsiveGridPageSize(containerRef, options = {}) {
  const [pageSize, setPageSize] = useState(options.fallback || options.minPageSize || 1);

  useEffect(() => {
    const element = containerRef?.current;
    if (!element) return undefined;

    let frameId = null;

    const updatePageSize = () => {
      const nextPageSize = calculatePageSize(element, options);
      setPageSize((currentPageSize) =>
        currentPageSize === nextPageSize ? currentPageSize : nextPageSize
      );
    };

    const scheduleUpdate = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updatePageSize);
    };

    scheduleUpdate();

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(element);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [containerRef, options]);

  return pageSize;
}

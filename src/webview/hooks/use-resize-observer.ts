import { useCallback, useRef, useState, type RefCallback } from 'react';

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export const useResizeObserver = <T extends HTMLElement>(
  offset = 0,
): [RefCallback<T>, Dimensions] => {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 });

  const ref = useCallback(
    (element: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!element) return;

      const update = () =>
        setDimensions({
          width: element.clientWidth,
          height: Math.max(0, element.clientHeight - offset),
        });

      update();
      observerRef.current = new ResizeObserver(update);
      observerRef.current.observe(element);
    },
    [offset],
  );

  return [ref, dimensions];
};

import { useEffect, useRef, useState, type RefObject } from 'react';
import { pipe, Option } from 'effect';

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export const useResizeObserver = <T extends HTMLElement>(
  offset = 0
): [RefObject<T>, Dimensions] => {
  const ref = useRef<T>(null!) as RefObject<T>;
  const [dimensions, setDimensions] = useState<Dimensions>({ width: 0, height: 0 });

  useEffect(() =>
    pipe(
      Option.fromNullable(ref.current),
      Option.map((element) => {
        const update = () =>
          setDimensions({
            width: element.clientWidth,
            height: element.clientHeight - offset,
          });

        update();

        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
      }),
      Option.getOrElse(() => undefined)
    ),
    [offset]
  );

  return [ref, dimensions];
};

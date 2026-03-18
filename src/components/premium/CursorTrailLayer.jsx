import { useEffect, useMemo, useRef } from "react";
import { usePremium } from "../../context/PremiumContext";

const TRAIL_COUNT = 7;

function CursorTrailLayer() {
  const { equippedBySlot } = usePremium();
  const cursorStyle = equippedBySlot?.cursor_effect_style?.metadata?.styleId || "";
  const trailRefs = useRef([]);

  const points = useMemo(() => {
    return Array.from({ length: TRAIL_COUNT }, () => ({ x: 0, y: 0 }));
  }, []);

  useEffect(() => {
    if (!cursorStyle) return undefined;

    let animationFrame = 0;
    const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    function handlePointerMove(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }

    function animate() {
      points[0].x += (pointer.x - points[0].x) * 0.32;
      points[0].y += (pointer.y - points[0].y) * 0.32;

      for (let index = 1; index < points.length; index += 1) {
        points[index].x += (points[index - 1].x - points[index].x) * 0.34;
        points[index].y += (points[index - 1].y - points[index].y) * 0.34;
      }

      trailRefs.current.forEach((node, index) => {
        if (!node) return;

        node.style.transform = `translate3d(${points[index].x}px, ${points[index].y}px, 0)`;
        node.style.opacity = String(Math.max(0.14, 1 - index * 0.12));
      });

      animationFrame = window.requestAnimationFrame(animate);
    }

    window.addEventListener("pointermove", handlePointerMove);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [cursorStyle, points]);

  if (!cursorStyle) return null;

  return (
    <div className={`premium-cursor-layer premium-cursor-layer--${cursorStyle}`}>
      {Array.from({ length: TRAIL_COUNT }).map((_, index) => (
        <span
          key={index}
          ref={(node) => {
            trailRefs.current[index] = node;
          }}
          className="premium-cursor-dot"
        />
      ))}
    </div>
  );
}

export default CursorTrailLayer;

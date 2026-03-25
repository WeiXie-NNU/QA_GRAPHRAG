import { useCallback, useEffect, useState } from "react";

interface UseViewportActivationOptions {
  enabled?: boolean;
  once?: boolean;
  rootMargin?: string;
  threshold?: number;
}

interface UseViewportActivationResult<T extends Element> {
  isActive: boolean;
  ref: (node: T | null) => void;
}

export function useViewportActivation<T extends Element>({
  enabled = true,
  once = true,
  rootMargin = "600px 0px",
  threshold = 0,
}: UseViewportActivationOptions = {}): UseViewportActivationResult<T> {
  const [node, setNode] = useState<T | null>(null);
  const [isActive, setIsActive] = useState(!enabled);

  const ref = useCallback((nextNode: T | null) => {
    setNode(nextNode);
  }, []);

  useEffect(() => {
    if (enabled && !once) {
      setIsActive(false);
    }
  }, [enabled, node, once]);

  useEffect(() => {
    if (!enabled) {
      setIsActive(true);
      return;
    }

    if (once && isActive) {
      return;
    }

    if (!node) {
      return;
    }

    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") {
      setIsActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const nextVisible = entries.some((entry) => entry.isIntersecting);
        if (!once) {
          setIsActive(nextVisible);
          return;
        }

        if (!nextVisible) {
          return;
        }

        setIsActive(true);
        if (once) {
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin,
        threshold,
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [enabled, isActive, node, once, rootMargin, threshold]);

  return { isActive, ref };
}

export default useViewportActivation;

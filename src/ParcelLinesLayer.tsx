import { useEffect, useRef, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";

type Props = {
  token: string;
  enabled?: boolean;
};

export default function ParcelLinesLayer({ token, enabled = true }: Props) {
  const map = useMap();
  const [data, setData] = useState<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const fetchForViewport = async () => {
    if (!enabled) return;

    // Debounce (avoid spamming requests while dragging)
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      try {
        abortRef.current?.abort();
        abortRef.current = new AbortController();

        const b = map.getBounds();
        const bbox = [
          b.getWest(),
          b.getSouth(),
          b.getEast(),
          b.getNorth(),
        ].join(",");

        const res = await fetch(`/api/parcel-lines?bbox=${bbox}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortRef.current.signal,
        });

        if (!res.ok) return;
        const fc = await res.json();
        setData(fc);
      } catch (e: any) {
        // ignore abort errors
        if (e?.name !== "AbortError") console.error(e);
      }
    }, 250);
  };

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }

    // initial load
    fetchForViewport();

    // refresh on move/zoom
    const onMoveEnd = () => fetchForViewport();
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);

    return () => {
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onMoveEnd);
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled]);

  if (!enabled || !data) return null;

  return (
    <GeoJSON
      data={data}
      // No explicit colors set (Leaflet defaults). If you want styling, tell me what you want.
    />
  );
}
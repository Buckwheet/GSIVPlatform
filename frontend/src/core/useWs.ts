import { useEffect } from "react";
import { onWs, type WsEvent } from "./ws";

/** Subscribe to WS events of the given type (or all when types is empty). */
export function useWsEvents(types: string[], handler: (e: WsEvent) => void): void {
  useEffect(() => {
    return onWs((e) => {
      if (types.length === 0 || types.includes(e.type)) handler(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.join(",")]);
}

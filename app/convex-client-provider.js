"use client";

import {
  createContext,
  useContext,
  useMemo,
} from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const ConvexDeploymentContext = createContext("");

/** Non-empty when this browser session should read/write Convex (from server prop or env). */
export function useConvexDeploymentUrl() {
  return useContext(ConvexDeploymentContext).trim();
}

/**
 * Pass `deploymentUrl` from the root layout (`process.env.NEXT_PUBLIC_CONVEX_URL`)
 * so the client always agrees with the server. Falls back to `NEXT_PUBLIC_*` on the client.
 */
export function ConvexClientProvider({ children, deploymentUrl = "" }) {
  const url = useMemo(() => {
    const fromProp = typeof deploymentUrl === "string" ? deploymentUrl.trim() : "";
    if (fromProp) return fromProp;
    return (process.env.NEXT_PUBLIC_CONVEX_URL || "").trim();
  }, [deploymentUrl]);

  const client = useMemo(() => {
    return new ConvexReactClient(
      url.length > 0 ? url : "https://invalid.convex.cloud"
    );
  }, [url]);

  return (
    <ConvexDeploymentContext.Provider value={url}>
      <ConvexProvider client={client}>{children}</ConvexProvider>
    </ConvexDeploymentContext.Provider>
  );
}

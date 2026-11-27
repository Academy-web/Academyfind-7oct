"use client";

import dynamic from "next/dynamic";

const NextTopLoader = dynamic(() => import("nextjs-toploader"), { ssr: false });

export default function TopLoader() {
  return <NextTopLoader color="#f59e0b" showSpinner={false} />;
}

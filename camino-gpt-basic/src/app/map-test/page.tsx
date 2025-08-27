"use client";
import dynamic from "next/dynamic";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function MapTest() {
  return (
    <main style={{ position: "relative", height: "100dvh", width: "100dvw" }}>
      <Map />
    </main>
  );
}

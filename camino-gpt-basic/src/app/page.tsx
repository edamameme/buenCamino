// app/page.tsx
"use client";

import dynamic from "next/dynamic";
import Chat from "@/components/Chat";
import Preferences from "@/components/Preferences";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function HomePage() {
  return (
    <main style={{ position: "relative", height: "100dvh", width: "100dvw" }}>
      <div className="absolute inset-0 z-0">
        <Map />
      </div>

      {/* Let them position via 'fixed' */}
      <Chat />
      <Preferences />

    </main>

  );
}

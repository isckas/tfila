import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "tfila.co — next minyan near you",
    short_name: "tfila.co",
    description:
      "Find the next minyan near you. Mobile-first directory of Jewish shul times, kept fresh automatically.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#ffffff",
    orientation: "portrait",
    icons: [
      {
        src: "/tfila-icon.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/tfila-icon.png",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

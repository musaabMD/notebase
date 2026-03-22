export default function manifest() {
  return {
    name: "Notes",
    short_name: "Notes",
    description: "Voice and text notes",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f4f1",
    theme_color: "#1a1a1a",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

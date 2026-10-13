import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Study Planner | ตารางอ่านหนังสือ",
  description: "จัดตารางอ่านหนังสือมัธยมศึกษาด้วย Genetic Algorithm",
  applicationName: "Smart Study Planner",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Smart Study Planner",
  },
  icons: {
    icon: [
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f7154",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}

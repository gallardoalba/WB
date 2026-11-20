import type { Metadata } from "next";
import { renderAppView, type AppViewPageProps } from "../app-view";

export const instant = false;

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: AppViewPageProps) {
  return renderAppView("discover", await searchParams, "/descubrir");
}

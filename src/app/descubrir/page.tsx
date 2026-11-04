import { renderAppView, type AppViewPageProps } from "../app-view";

export const instant = false;

export default async function Page({ searchParams }: AppViewPageProps) {
  return renderAppView("discover", await searchParams, "/descubrir");
}

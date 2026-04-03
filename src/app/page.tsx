import { Suspense } from "react";
import { ContentStudioDashboard } from "@/components/dashboard/content-studio-dashboard";

export default function Home() {
  return (
    <Suspense>
      <ContentStudioDashboard />
    </Suspense>
  );
}

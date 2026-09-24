import { BasicStats } from "@/components/stats/basic";
import EmptyStats from "@/components/stats/empty";
import { Heatmap } from "@/components/stats/heatmap";
import { TimeOfDayChart } from "@/components/stats/radial-time-of-day";
import { RatingPieChart } from "@/components/stats/rating-pie-chart";
import { ReviewChart } from "@/components/stats/review-chart";
import { TimeBarChart } from "@/components/stats/time-bar-chart";
import { db } from "@/lib/db/persistence";
import { processReviewLogOperations } from "@/lib/review/review";
import { useLiveQuery } from "dexie-react-hooks";
import { Loader2 } from "lucide-react";

export default function StatsRoute() {
  const allReviewLogOperations = useLiveQuery(() =>
    db.reviewLogOperations.toArray(),
  );

  if (!allReviewLogOperations) {
    return (
      <div className="flex flex-col h-full col-start-1 col-end-13 xl:col-start-3 xl:col-end-11 md:px-24 pb-6 gap-2 animate-fade-in">
        <div className="flex flex-col h-full min-h-96 justify-center items-center">
          <Loader2 className="w-16 h-16 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const reviewLogs = processReviewLogOperations(allReviewLogOperations);
  const hasStats = reviewLogs.length > 0;

  return (
    <div className="flex flex-col h-full col-start-1 col-end-13 xl:col-start-3 xl:col-end-11 md:px-24 pb-6 gap-2 animate-fade-in">
      {hasStats ? (
        <>
          <BasicStats reviewLogs={reviewLogs} />
          <Heatmap reviewLogs={reviewLogs} />
          <TimeBarChart reviewLogs={reviewLogs} />
          <div className="flex sm:flex-row flex-col gap-2 w-full">
            <RatingPieChart reviewLogs={reviewLogs} />
            <TimeOfDayChart reviewLogs={reviewLogs} />
          </div>
          <ReviewChart reviewLogs={reviewLogs} />
        </>
      ) : (
        <EmptyStats />
      )}
    </div>
  );
}

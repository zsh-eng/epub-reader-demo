import { addStudyDays, studyDayKey } from "@/lib/study-day";
import { useStatisticsClock } from "@/components/hooks/use-clock";
import { Card, CardContent } from "@/components/ui/card";
import * as React from "react";
import { ReviewLog } from "ts-fsrs";

interface BasicStatsProps {
  reviewLogs: ReviewLog[];
}

export function BasicStats({ reviewLogs }: BasicStatsProps) {
  const clock = useStatisticsClock();
  const stats = React.useMemo(() => {
    // Get unique days of learning
    const uniqueDays = new Set(
      reviewLogs.map((log) => studyDayKey(log.review)),
    );
    const totalDays = uniqueDays.size;

    // Calculate reviews per day
    const reviewsPerDay =
      totalDays > 0 ? Math.round((reviewLogs.length / totalDays) * 10) / 10 : 0;

    // Calculate streaks
    const sortedDays = Array.from(uniqueDays).sort();
    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;

    for (let i = 0; i < sortedDays.length; i++) {
      if (i > 0 && addStudyDays(sortedDays[i - 1], 1) === sortedDays[i]) {
        streak++;
      } else {
        streak = 1;
      }

      longestStreak = Math.max(longestStreak, streak);

      // Check if streak is current (includes today)
      const today = studyDayKey(clock);
      if (sortedDays[i] === today) {
        currentStreak = streak;
      }
    }

    return {
      totalReviews: reviewLogs.length,
      reviewsPerDay,
      totalDays,
      currentStreak,
      longestStreak,
    };
  }, [reviewLogs, clock]);

  return (
    <Card>
      <CardContent className="flex flex-wrap sm:flex-nowrap py-10 sm:py-6 space-y-2">
        <div className="flex flex-col items-center w-full">
          <span className="text-3xl sm:text-2xl font-bold">
            {stats.totalReviews}
          </span>
          <span className="text-sm text-muted-foreground">Total Reviews</span>
        </div>
        <div className="flex flex-col items-center w-1/2 sm:w-full">
          <span className="text-lg sm:text-2xl font-bold">
            {stats.reviewsPerDay}
          </span>
          <span className="text-sm text-muted-foreground">Reviews/Day</span>
        </div>
        <div className="flex flex-col items-center w-1/2 sm:w-full">
          <span className="text-lg sm:text-2xl font-bold">
            {stats.totalDays}
          </span>
          <span className="text-sm text-muted-foreground">Days Studied</span>
        </div>
        <div className="flex flex-col items-center w-1/2 sm:w-full">
          <span className="text-lg sm:text-2xl font-bold">
            {stats.currentStreak}
          </span>
          <span className="text-sm text-muted-foreground">Current Streak</span>
        </div>
        <div className="flex flex-col items-center w-1/2 sm:w-full">
          <span className="text-lg sm:text-2xl font-bold">
            {stats.longestStreak}
          </span>
          <span className="text-sm text-muted-foreground">Longest Streak</span>
        </div>
      </CardContent>
    </Card>
  );
}

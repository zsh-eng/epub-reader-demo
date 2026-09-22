import {
  addStudyDays,
  addStudyMonths,
  studyDayDate,
  studyDayKey,
  isInStudyRange,
} from "@/lib/study-day";
import { useStatisticsClock } from "@/components/hooks/use-clock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as React from "react";
import { ReviewLog } from "ts-fsrs";

interface HeatmapProps {
  reviewLogs: ReviewLog[];
}

export function Heatmap({ reviewLogs }: HeatmapProps) {
  const clock = useStatisticsClock();
  const [selectedDate, setSelectedDate] = React.useState<string>();
  const [hoveredDate, setHoveredDate] = React.useState<string>();
  const dismiss = () => {
    setSelectedDate(undefined);
    setHoveredDate(undefined);
  };
  const heatmapData = React.useMemo(() => {
    const today = studyDayKey(clock);
    const yearAgo = addStudyMonths(today, -12);
    const dates: string[] = [];
    for (let day = yearAgo; day <= today; day = addStudyDays(day, 1)) {
      dates.push(day);
    }

    // Count reviews per day
    const dailyCounts = reviewLogs
      .filter((log) => isInStudyRange(log.review, yearAgo, today))
      .reduce((acc: Record<string, number>, log) => {
        const date = studyDayKey(log.review);
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {});

    // Map dates to their counts
    return dates.map((date) => {
      const dateStr = date;
      return {
        date: dateStr,
        count: dailyCounts[dateStr] || 0,
      };
    });
  }, [reviewLogs, clock]);

  const getColorClass = (count: number) => {
    if (count === 0) return "bg-muted";
    if (count <= 3) return "bg-cyan-100";
    if (count <= 6) return "bg-cyan-200";
    if (count <= 9) return "bg-cyan-300";
    if (count <= 12) return "bg-cyan-400";
    return "bg-cyan-500";
  };

  const weeks = React.useMemo(() => {
    const result: (typeof heatmapData)[] = [];
    for (let i = 0; i < heatmapData.length; i += 7) {
      result.push(heatmapData.slice(i, i + 7));
    }
    return result;
  }, [heatmapData]);

  const formatTooltipDate = (dateStr: string) => {
    const date = studyDayDate(dateStr);
    return `${date.toLocaleString("default", {
      month: "long",
    })} ${date.getDate()}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1 overflow-x-auto pb-4">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.map(({ date, count }) => (
                <TooltipProvider key={date} delayDuration={50}>
                  <Tooltip
                    open={(selectedDate ?? hoveredDate) === date}
                    onOpenChange={(open) =>
                      setHoveredDate((previous) =>
                        open ? date : previous === date ? undefined : previous,
                      )
                    }
                  >
                    <TooltipTrigger
                      aria-label={`${count} reviews on ${date}`}
                      aria-pressed={selectedDate === date}
                      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onFocus={() => setSelectedDate(date)}
                      onClick={() => setSelectedDate(date)}
                      onBlur={() =>
                        setSelectedDate((previous) =>
                          previous === date ? undefined : previous,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") dismiss();
                      }}
                    >
                      <div
                        className={cn(
                          "h-3 w-3 rounded-sm",
                          getColorClass(count),
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      onEscapeKeyDown={dismiss}
                      onPointerDownOutside={dismiss}
                    >
                      <p>
                        {count} reviews on {formatTooltipDate(date)}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-1">
            <div className="h-3 w-3 rounded-sm bg-muted" />
            <div className="h-3 w-3 rounded-sm bg-cyan-100" />
            <div className="h-3 w-3 rounded-sm bg-cyan-200" />
            <div className="h-3 w-3 rounded-sm bg-cyan-300" />
            <div className="h-3 w-3 rounded-sm bg-cyan-400" />
            <div className="h-3 w-3 rounded-sm bg-cyan-500" />
          </div>
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  );
}

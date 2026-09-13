import { useStatisticsClock } from "@/components/hooks/use-clock";
import {
  addStudyMonths,
  studyDayDate,
  studyDayKey,
  isInStudyRange,
} from "@/lib/study-day";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ReviewLog, State } from "ts-fsrs";

interface TimeBarChartProps {
  reviewLogs: (ReviewLog & { duration: number })[];
}

function capitalise(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const chartConfig = {
  new: {
    label: "New",
    color: "hsl(var(--chart-4))",
  },
  learning: {
    label: "Learning",
    color: "hsl(var(--chart-3))",
  },
  relearning: {
    label: "Relearning",
    color: "hsl(var(--chart-2))",
  },
  review: {
    label: "Review",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

const RANGES = {
  "1M": 1,
  "3M": 3,
  "1Y": 12,
} as const;

export function TimeBarChart({ reviewLogs }: TimeBarChartProps) {
  const clock = useStatisticsClock();
  const [selectedRange, setSelectedRange] =
    React.useState<keyof typeof RANGES>("1M");

  const chartData = React.useMemo(() => {
    const today = studyDayKey(clock);
    const monthsAgo = addStudyMonths(today, -RANGES[selectedRange]);

    const dailyDurations = reviewLogs
      .filter((log) => isInStudyRange(log.review, monthsAgo, today))
      .reduce(
        (acc, log) => {
          const date = studyDayKey(log.review);
          if (!acc[date]) {
            acc[date] = {
              date,
              new: 0,
              learning: 0,
              relearning: 0,
              review: 0,
            };
          }

          if (log.state === State.New) {
            acc[date].new += log.duration;
          } else if (log.state === State.Learning) {
            acc[date].learning += log.duration;
          } else if (log.state === State.Relearning) {
            acc[date].relearning += log.duration;
          } else {
            acc[date].review += log.duration;
          }

          return acc;
        },
        {} as Record<
          string,
          {
            date: string;
            new: number;
            learning: number;
            relearning: number;
            review: number;
          }
        >,
      );

    return Object.values(dailyDurations).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [reviewLogs, selectedRange, clock]);

  return (
    <Card>
      <CardHeader>
        <div className="flex sm:flex-row flex-col justify-between items-center">
          <div>
            <CardTitle>Review Duration</CardTitle>
            <CardDescription>Time spent reviewing cards</CardDescription>
          </div>
          <Select
            value={selectedRange}
            onValueChange={(value: string) =>
              setSelectedRange(value as keyof typeof RANGES)
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1M">Last Month</SelectItem>
              <SelectItem value="3M">Last 3 Months</SelectItem>
              <SelectItem value="1Y">Last Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-80 aspect-auto">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) =>
                studyDayDate(value).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    studyDayDate(value).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }
                  formatter={(value, name) =>
                    `${capitalise(name as string)}: ${(
                      (value as number) /
                      1000 /
                      60
                    ).toFixed(1)} min`
                  }
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="new"
              stackId="a"
              fill="var(--color-new)"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="learning"
              stackId="a"
              fill="var(--color-learning)"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="relearning"
              stackId="a"
              fill="var(--color-relearning)"
            />
            <Bar
              dataKey="review"
              stackId="a"
              fill="var(--color-review)"
              radius={[0, 0, 4, 4]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

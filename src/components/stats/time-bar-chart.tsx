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
import { format, startOfMonth, startOfWeek } from "date-fns";
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
  "1M": {
    months: 1,
    bucket: "day",
  },
  "3M": {
    months: 3,
    bucket: "week",
  },
  "1Y": {
    months: 12,
    bucket: "month",
  },
} as const;

type RangeKey = keyof typeof RANGES;
type Bucket = (typeof RANGES)[RangeKey]["bucket"];

type ChartDatum = {
  date: string;
  new: number;
  learning: number;
  relearning: number;
  review: number;
};

function getBucketStart(date: Date, bucket: Bucket) {
  if (bucket === "week") {
    return startOfWeek(date, { weekStartsOn: 1 });
  }

  if (bucket === "month") {
    return startOfMonth(date);
  }

  return date;
}

function getBucketKey(date: Date, bucket: Bucket) {
  const bucketStart = getBucketStart(studyDayDate(studyDayKey(date)), bucket);

  if (bucket === "month") {
    return format(bucketStart, "yyyy-MM-01");
  }

  return format(bucketStart, "yyyy-MM-dd");
}

function parseBucketDate(value: string) {
  return studyDayDate(value);
}

function formatBucketLabel(value: string, bucket: Bucket) {
  const date = parseBucketDate(value);

  if (bucket === "month") {
    return format(date, "MMM yyyy");
  }

  return format(date, "MMM d");
}

function formatTooltipLabel(value: string, bucket: Bucket) {
  const date = parseBucketDate(value);

  if (bucket === "month") {
    return format(date, "MMMM yyyy");
  }

  if (bucket === "week") {
    return `Week of ${format(date, "MMM d, yyyy")}`;
  }

  return format(date, "MMM d, yyyy");
}

export function TimeBarChart({ reviewLogs }: TimeBarChartProps) {
  const clock = useStatisticsClock();
  const [selectedRange, setSelectedRange] = React.useState<RangeKey>("1M");

  const chartData = React.useMemo(() => {
    const today = studyDayKey(clock);
    const range = RANGES[selectedRange];
    const monthsAgo = addStudyMonths(today, -range.months);

    const durations = reviewLogs
      .filter((log) => isInStudyRange(log.review, monthsAgo, today))
      .reduce(
        (acc, log) => {
          const date = getBucketKey(new Date(log.review), range.bucket);

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
        {} as Record<string, ChartDatum>,
      );

    return Object.values(durations).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [reviewLogs, selectedRange, clock]);

  const bucket = RANGES[selectedRange].bucket;

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
              setSelectedRange(value as RangeKey)
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
              minTickGap={24}
              tickFormatter={(value) => formatBucketLabel(value, bucket)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) =>
                    formatTooltipLabel(value as string, bucket)
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

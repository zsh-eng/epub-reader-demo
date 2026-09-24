import * as React from "react";
import { Label, Pie, PieChart } from "recharts";
import { Rating, ReviewLog } from "ts-fsrs";

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
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface RatingPieChartProps {
  reviewLogs: ReviewLog[];
}

const chartConfig = {
  count: {
    label: "Reviews",
  },
  again: {
    label: "Again",
    color: "hsl(var(--chart-1))",
  },
  hard: {
    label: "Hard",
    color: "hsl(var(--chart-2))",
  },
  good: {
    label: "Good",
    color: "hsl(var(--chart-3))",
  },
  easy: {
    label: "Easy",
    color: "hsl(var(--chart-4))",
  },
  manual: {
    label: "Manual",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig;

export function RatingPieChart({ reviewLogs }: RatingPieChartProps) {
  const chartData = React.useMemo(() => {
    const counts = reviewLogs.reduce((acc: Record<string, number>, log) => {
      const rating = Rating[log.rating].toLowerCase();
      acc[rating] = (acc[rating] || 0) + 1;
      return acc;
    }, {});

    return [
      {
        rating: "again",
        count: counts.again || 0,
        fill: "hsl(var(--chart-1))",
      },
      { rating: "hard", count: counts.hard || 0, fill: "hsl(var(--chart-2))" },
      { rating: "good", count: counts.good || 0, fill: "hsl(var(--chart-3))" },
      { rating: "easy", count: counts.easy || 0, fill: "hsl(var(--chart-4))" },
      {
        rating: "manual",
        count: counts.manual || 0,
        fill: "hsl(var(--chart-5))",
      },
    ];
  }, [reviewLogs]);

  const totalReviews = React.useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.count, 0);
  }, [chartData]);

  return (
    <Card className="w-full">
      <CardHeader className="items-center pb-2">
        <CardTitle>Rating Distribution</CardTitle>
        <CardDescription>Breakdown of review ratings</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square w-full"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="rating"
              innerRadius={60}
              strokeWidth={5}
            >
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {totalReviews.toLocaleString()}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 24}
                          className="fill-muted-foreground"
                        >
                          Reviews
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

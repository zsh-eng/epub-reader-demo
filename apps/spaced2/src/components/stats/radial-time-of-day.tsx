import * as React from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart } from "recharts";
import { ReviewLog } from "ts-fsrs";

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

interface TimeOfDayChartProps {
  reviewLogs: ReviewLog[];
}

const chartConfig = {
  reviews: {
    label: "Reviews",
    color: "hsl(var(--cyan-500))",
  },
} satisfies ChartConfig;

export function TimeOfDayChart({ reviewLogs }: TimeOfDayChartProps) {
  const chartData = React.useMemo(() => {
    // Initialize 24 hour buckets
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      reviews: 0,
    }));

    // Count reviews per hour
    reviewLogs.forEach((log) => {
      const hour = new Date(log.review).getHours();
      hours[hour].reviews++;
    });

    // Format hours for display
    return hours.map((data) => ({
      ...data,
      hour: data.hour.toString().padStart(2, "0") + ":00",
    }));
  }, [reviewLogs]);

  return (
    <Card className="w-full">
      <CardHeader className="items-center pb-4">
        <CardTitle>Review Time of Day</CardTitle>
        <CardDescription>When you typically review your cards</CardDescription>
      </CardHeader>
      <CardContent className="h-full">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square w-full"
        >
          <RadarChart data={chartData}>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent className="w-[150px]" nameKey="reviews" />
              }
            />
            <PolarGrid className="fill-cyan-500/20" gridType="circle" />
            <PolarAngleAxis
              dataKey="hour"
              tickLine={false}
              tick={({ x, y, textAnchor, index, ...props }) => {
                const data = chartData[index];
                if (index % 3 !== 0) {
                  return <></>;
                }

                return (
                  <text
                    x={x}
                    y={y}
                    textAnchor={textAnchor}
                    fontSize={13}
                    fontWeight={500}
                    {...props}
                  >
                    <tspan className="fill-muted-foreground">{data.hour}</tspan>
                  </text>
                );
              }}
            />
            <Radar
              dataKey="reviews"
              fill="rgb(6 182 212)"
              fillOpacity={0.5}
              stroke="rgb(6 182 212)"
            />
          </RadarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

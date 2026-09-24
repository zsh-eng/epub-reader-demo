import { useAccountSubmit } from "./use-account-submit";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { loginFormSchema, LoginFormValues } from "@/lib/form-schema";
import VibrationPattern from "@/lib/vibrate";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, Mail } from "lucide-react";
import { useForm } from "react-hook-form";

type LoginFormProps = {
  onSubmit: (data: LoginFormValues) => Promise<void>;
};

export function LoginForm({ onSubmit }: LoginFormProps) {
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const { submit, pending, error } = useAccountSubmit(onSubmit);

  const handleSubmit = async (data: LoginFormValues) => {
    navigator?.vibrate?.(VibrationPattern.successConfirm);
    await submit(data);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col gap-4 py-4"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem className="flex flex-col items-start">
              <FormLabel className="text-foreground">Email</FormLabel>
              <FormControl>
                <div className="relative items-center gap-2 w-full">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input className="pl-10 text-sm" {...field} />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem className="flex flex-col items-start">
              <FormLabel className="text-foreground">Password</FormLabel>
              <FormControl>
                <div className="relative items-center gap-2 w-full">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input className="pl-10 text-sm" type="password" {...field} />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full active:scale-95 transition-all duration-100 ease-out mt-4"
          size={"lg"}
          disabled={pending}
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
        </Button>
      </form>
    </Form>
  );
}

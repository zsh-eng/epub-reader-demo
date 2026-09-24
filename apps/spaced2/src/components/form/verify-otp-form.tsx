import { Button } from "@/components/ui/button";
import { useAccountSubmit } from "./use-account-submit";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { verifyOtpFormSchema, VerifyOtpFormValues } from "@/lib/form-schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";

type VerifyOtpProps = {
  onSubmit: (data: VerifyOtpFormValues) => Promise<void>;
};

export default function VerifyOtpForm({ onSubmit }: VerifyOtpProps) {
  const form = useForm<VerifyOtpFormValues>({
    resolver: zodResolver(verifyOtpFormSchema),
    defaultValues: {
      pin: "",
    },
  });

  const { submit, pending, error } = useAccountSubmit(onSubmit);
  const attemptedPin = useRef<string>();
  const pinWatch = form.watch("pin");

  // A complete code is tried once. A failed code can be retried with the button.
  useEffect(() => {
    if (pinWatch.length !== 8) {
      attemptedPin.current = undefined;
      return;
    }
    if (pending || attemptedPin.current === pinWatch) return;
    attemptedPin.current = pinWatch;
    void form.handleSubmit(submit)();
  }, [pinWatch, pending, form, submit]);

  return (
    <Form {...form}>
      <form className="w-full space-y-6" onSubmit={form.handleSubmit(submit)}>
        <FormField
          control={form.control}
          name="pin"
          render={({ field: { onChange, ...field } }) => (
            <FormItem>
              <FormLabel>One-Time Password</FormLabel>
              <FormControl>
                <InputOTP
                  maxLength={8}
                  disabled={pending}
                  {...field}
                  onChange={(value) => onChange(value.toUpperCase())}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                    <InputOTPSlot index={6} />
                    <InputOTPSlot index={7} />
                  </InputOTPGroup>
                </InputOTP>
              </FormControl>
              <FormDescription>
                Please enter the one-time password sent to your email.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Verifying..." : "Verify code"}
        </Button>
      </form>
    </Form>
  );
}

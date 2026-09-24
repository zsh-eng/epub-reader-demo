import { deckFormSchema, DeckFormValues } from "@/lib/form-schema";
import { createNewDeck } from "@/lib/sync/operation";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { toast } from "sonner";

export default function CreateDeckForm({
  open,
  onOpenChange,
  persistDeck = createNewDeck,
}: {
  persistDeck?: typeof createNewDeck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<DeckFormValues>({
    resolver: zodResolver(deckFormSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const handleSubmit = async (data: DeckFormValues) => {
    setSubmitError(null);
    try {
      await persistDeck(data.name, data.description ?? "");
      onOpenChange(false);
      form.reset();

      toast.success("New deck created");
    } catch (error) {
      console.error(error);
      setSubmitError("Could not save the deck. Your text is kept. Try again.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!submitting.current) onOpenChange(value);
      }}
    >
      <DialogContent className={cn("rounded-2xl")}>
        <DialogHeader>
          <DialogTitle>Create New Deck</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              try {
                await form.handleSubmit(handleSubmit)(event);
              } finally {
                submitting.current = false;
              }
            }}
            className="space-y-4"
          >
            <fieldset
              disabled={form.formState.isSubmitting}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name*</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter deck name"
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter deck description"
                        className="resize-none text-sm"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" className="rounded-lg" size={"lg"}>
                  Create Deck
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

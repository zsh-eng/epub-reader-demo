import { FormInputProps } from "@/components/form/input.types";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardEventHandler } from "react";
import { FieldValues } from "react-hook-form";

type FormTextareaImageUploadProps<TFieldValues extends FieldValues> =
  FormInputProps<TFieldValues> & {
    placeholder?: string;
    description?: string;
    className?: string;
    rows?: number;
    onUploadImage?: (image: File) => Promise<void>;
  };

/**
 * A textarea that allows for image uploads.
 */
export function FormTextareaImageUpload<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  disabled,
  className,
  placeholder,
  description,
  rows,
  onUploadImage,
}: FormTextareaImageUploadProps<TFieldValues>) {
  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = async (e) => {
    const dataTransfer = Array.from(e.clipboardData.items);
    const images: File[] = dataTransfer
      .filter((item) => item.type.includes("image"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (images.length === 0) return;

    // Only handle the first image for now
    const image = images[0];
    onUploadImage?.(image);
  };

  return (
    <FormField
      control={form.control}
      name={name}
      disabled={disabled}
      render={({ field }) => (
        <FormItem className="h-full">
          {label && <FormLabel>{label}</FormLabel>}
          <FormControl>
            <Textarea
              className={className}
              placeholder={placeholder}
              rows={rows}
              onPaste={handlePaste}
              {...field}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

FormTextareaImageUpload.displayName = "FormTextareaImageUpload";

import { toast as sonnerToast } from 'sonner';

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  duration?: number;
}

export function useToast() {
  const toast = ({ title, description, variant, duration }: ToastOptions) => {
    const message = title || '';
    const descriptionText = description || '';

    if (variant === 'destructive') {
      sonnerToast.error(message, {
        description: descriptionText,
        duration: duration || 4000,
      });
    } else {
      sonnerToast.success(message, {
        description: descriptionText,
        duration: duration || 4000,
      });
    }
  };

  return { toast };
}

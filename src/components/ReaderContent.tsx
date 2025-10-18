import { forwardRef } from "react";

interface ReaderContentProps {
  content: string;
  chapterIndex: number;
}

const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(
  ({ content, chapterIndex }, ref) => {
    return (
      <div
        key={chapterIndex}
        ref={ref}
        className="reader-content max-w-[80ch] mx-auto px-6 py-8 sm:px-8 md:px-12"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  },
);

ReaderContent.displayName = "ReaderContent";

export default ReaderContent;

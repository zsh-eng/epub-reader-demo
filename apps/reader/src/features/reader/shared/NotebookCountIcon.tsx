/** Square note outline and vector digits share one coordinate system, so the
 * count stays optically centered without depending on platform font metrics. */
const digits: Record<string, string> = {
  "0": "M2 0C.6 0 0 1.1 0 3s.6 3 2 3 2-1.1 2-3S3.4 0 2 0Z",
  "1": "M.8 1.2 2.2 0v6M.7 6h3",
  "2": "M0 1.4C0-.5 4-.5 4 1.4 4 3 0 4.2 0 6h4",
  "3": "M0 .5C1-.3 4-.3 4 1.5 4 2.5 3 3 2 3c1 0 2 .5 2 1.5C4 6.3 1 6.3 0 5.5",
  "4": "M3.2 6V0L0 4h4",
  "5": "M4 0H.3L0 3c1-.8 4-.8 4 1.3C4 6.5 1 6.4 0 5.5",
  "6": "M3.7 .4C1-1 0 1.5 0 3.5 0 7 4 6.5 4 4.4 4 2.3 1.1 2.2 0 3.5",
  "7": "M0 0h4L1 6",
  "8": "M2 3C-.7 3-.7 0 2 0s2.7 3 0 3Zm0 0c-2.7 0-2.7 3 0 3s2.7-3 0-3Z",
  "9": "M.3 5.6C3 7 4 4.5 4 2.5 4-1 0-.5 0 1.6 0 3.7 2.9 3.8 4 2.5",
  "+": "M0 3h4M2 1v4",
};

export function NotebookCountIcon({ count }: { count: number }) {
  const characters = count > 99 ? "99+" : String(count);
  const scale = characters.length > 2 ? 0.8 : 1;
  const width = characters.length * 5.5 - 1.5;
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M5 2.5h14A2.5 2.5 0 0 1 21.5 5v11l-5.5 5.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5Z M16 21.5v-4A1.5 1.5 0 0 1 17.5 16h4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <g
        transform={`translate(${11.5 - (width * scale) / 2} ${11.5 - 3 * scale}) scale(${scale})`}
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {[...characters].map((digit, index) => (
          <path
            key={index}
            d={digits[digit]}
            transform={`translate(${index * 5.5} 0)`}
          />
        ))}
      </g>
    </svg>
  );
}

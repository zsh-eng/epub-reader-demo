import { CommandIcon, CornerDownLeft } from "lucide-react";

export default function CmdEnterIcon() {
  return (
    <div className="gap-1 items-center text-background uppercase hidden sm:flex">
      <CommandIcon />
      <span>+</span>
      <CornerDownLeft className="scale-120" />
    </div>
  );
}

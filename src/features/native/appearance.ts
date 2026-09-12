/** Resolve the existing CSS palette for UIKit. Color values
 * cross the bridge as sRGB hex because native controls cannot parse CSS tokens.
 */
export function readNativeAppearance(theme?: string) {
  const element = theme
    ? document.createElement("div")
    : document.documentElement;
  if (theme) {
    element.className = theme;
    element.style.display = "none";
    document.body.appendChild(element);
  }
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  const color = (name: string) => {
    context.fillStyle =
      style.getPropertyValue(name).trim() ||
      style.getPropertyValue("--muted-foreground").trim();
    context.fillRect(0, 0, 1, 1);
    const values = context.getImageData(0, 0, 1, 1).data;
    return `#${[...values]
      .slice(0, 3)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  };
  const colors = {
    background: color("--background"),
    foreground: color("--foreground"),
    secondary: color("--secondary"),
    muted: color("--muted-foreground"),
    primary: color("--primary"),
    border: color("--border"),
    marks: Object.fromEntries(
      [
        "destructive",
        "yellow-secondary",
        "green-secondary",
        "blue-secondary",
        "magenta-secondary",
        "purple-secondary",
        "cyan-secondary",
        "orange-secondary",
        "red-secondary",
      ].map((name) => [name, color(`--${name}`)]),
    ),
  };
  if (theme) element.remove();
  const rgb = colors.background
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16));
  return {
    ...colors,
    dark: rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 128,
  };
}
